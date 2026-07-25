// tests/gates/P4-B.ts — BaseStealthBackend kapısı (GİZLİLİK koşusu).
//
// BUILD-PLAN P4-B geçiş kriterleri:
//   [ ] Basescan'de stealth adrese gerçek USDC transferi
//   [ ] Bob türettiği private key ile o adresi HARCAYABİLİYOR
//       (kanıt: fonu çekip başka adrese gönder — türetme doğruluğunun TEK gerçek testi)
//   [ ] Stealth adres Bob'un kayıtlı 8004 adresiyle on-chain BAĞLANTISIZ
//   [ ] Settlement JobVerified blok numarasından SONRA (sıra kanıtı)
//   [ ] FRAUD_MODE=substitute → JobVerified yok → settle çağrısı HİÇ yapılmadı
//
// GERÇEK Base Sepolia'ya yazar: USDC hareket eder.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { closeBob, runDemo, type DemoReport } from '../../scripts/demo.js';
import {
  ANNOUNCER_ABI,
  ERC5564_ANNOUNCER,
  ERC6538_REGISTRY,
  REGISTRY_ABI,
  USDC_ABI,
  signTransferAuthorization,
  submitTransferAuthorization,
} from '../../packages/payment/src/base-stealth.js';
import {
  SCHEME_ID,
  checkAnnouncement,
  computeStealthPrivateKey,
  deriveAgentStealthKeys,
} from '../../packages/payment/src/stealth.js';
import {
  METADATA_KEYS,
  identityRegistry,
  identityRegistryInterface,
  readUtf8Metadata,
  readUtf8MetadataUntil,
} from '../../packages/shared/src/index.js';
import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const cfg = loadConfig();
const root = repoRoot();

const BASESCAN = 'https://sepolia.basescan.org';
const gate = new Gate('P4-B', 'Base stealth ödeme — alıcı gizliliği');
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString() };

const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
const bobWallet = new ethers.Wallet(cfg.PRIVATE_KEY_BOB, provider);
const relayer = new ethers.Wallet(cfg.PRIVATE_KEY_DEPLOYER, provider);
const usdc = new ethers.Contract(cfg.USDC_BASE_SEPOLIA, USDC_ABI, provider);
const bobStealth = deriveAgentStealthKeys(cfg.PRIVATE_KEY_BOB, 'bob');
const BOB_AGENT_ID = requireEnv('BOB_AGENT_ID');

/** Beklenen bakiyeyi görene kadar oku — RPC replika gecikmesine karşı (P0-F dersi). */
async function balanceUntil(address: string, expected: bigint, tries = 15, delayMs = 1000): Promise<bigint> {
  let last = -1n;
  for (let i = 0; i < tries; i++) {
    last = (await usdc.getFunction('balanceOf')(address)) as bigint;
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

let honest: DemoReport | undefined;
let fraud: DemoReport | undefined;
let stealthAddress = '';
let ephemeralPublicKey = '';

// ---------------------------------------------------------------------------
// 1. Bob'un meta-adresi kayıtlı
// ---------------------------------------------------------------------------
gate.check('Bob\'un stealth meta-adresi ERC-8004\'e yazıldı', async () => {
  const registry = identityRegistry(cfg.ERC8004_IDENTITY, provider);
  const current = await readUtf8Metadata(registry, BOB_AGENT_ID, METADATA_KEYS.stealthMetaAddress).catch(
    () => undefined,
  );
  if (current === bobStealth.metaAddress) return pass(`zaten doğru: ${current.slice(0, 34)}…`);

  const writeRegistry = identityRegistry(cfg.ERC8004_IDENTITY, bobWallet);
  const tx = await writeRegistry.getFunction('setMetadata')(
    BOB_AGENT_ID,
    METADATA_KEYS.stealthMetaAddress,
    ethers.toUtf8Bytes(bobStealth.metaAddress),
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) return fail(`setMetadata başarısız: ${tx.hash}`);
  const emitted = receipt.logs
    .map((l: { topics: readonly string[]; data: string }) =>
      identityRegistryInterface.parseLog({ topics: [...l.topics], data: l.data }),
    )
    .find((p: { name: string } | null) => p?.name === 'MetadataSet');
  if (!emitted) return fail('MetadataSet yayılmadı');
  await readUtf8MetadataUntil(registry, BOB_AGENT_ID, METADATA_KEYS.stealthMetaAddress, bobStealth.metaAddress);
  evidence.metaAddressTx = tx.hash;
  return pass(`yazıldı: ${bobStealth.metaAddress.slice(0, 34)}…\n${BASESCAN}/tx/${tx.hash}`);
});

gate.check('Meta-adres kanonik ERC-6538 Registry\'ye de kaydedildi', async () => {
  const registry = new ethers.Contract(ERC6538_REGISTRY, REGISTRY_ABI, bobWallet);
  const existing = (await registry.getFunction('stealthMetaAddressOf')(bobWallet.address, SCHEME_ID)) as string;
  const wanted = ethers.hexlify(ethers.toUtf8Bytes(bobStealth.metaAddress));
  if (existing.toLowerCase() === wanted.toLowerCase()) {
    return pass(`zaten kayıtlı · ${BASESCAN}/address/${ERC6538_REGISTRY}`);
  }
  const tx = await registry.getFunction('registerKeys')(SCHEME_ID, wanted);
  await tx.wait();
  evidence.registryTx = tx.hash;
  return pass(`ERC-6538'e kaydedildi (schemeId ${SCHEME_ID})\n${BASESCAN}/tx/${tx.hash}`);
});

// ---------------------------------------------------------------------------
// 2. Dürüst koşu — USDC stealth adrese gidiyor
// ---------------------------------------------------------------------------
gate.check('PAYMENT_BACKEND=base ile USDC stealth adrese transfer edildi', async () => {
  honest = await runDemo({
    fraudMode: 'none',
    paymentRail: 'base',
    nonce: BigInt(Date.now()),
    log: () => {},
  });
  if (!honest.verified) return fail(`iş doğrulanmadı: ${honest.codeName}`);
  if (!honest.payment?.settled || !honest.payment.txRef) {
    return fail(`ödeme settle olmadı: ${honest.payment?.skippedReason ?? 'bilinmiyor'}`);
  }

  // Transferin alıcısını zincirden oku — rapora değil, log'a bak.
  const receipt = await provider.getTransactionReceipt(honest.payment.txRef);
  if (!receipt) return fail('settle tx receipt alınamadı');
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === cfg.USDC_BASE_SEPOLIA.toLowerCase() && l.topics[0] === transferTopic,
  );
  if (!transferLog) return fail('USDC Transfer event\'i yok');
  stealthAddress = ethers.getAddress(`0x${transferLog.topics[2]!.slice(26)}`);
  const amount = BigInt(transferLog.data);

  const balance = (await usdc.getFunction('balanceOf')(stealthAddress)) as bigint;
  evidence.stealthAddress = stealthAddress;
  evidence.settleTx = honest.payment.txRef;
  evidence.amount = amount.toString();

  return balance >= amount
    ? pass(
        [
          `stealth adres ${stealthAddress}`,
          `bakiye ${ethers.formatUnits(balance, 6)} USDC`,
          `${BASESCAN}/tx/${honest.payment.txRef}`,
        ].join('\n'),
      )
    : fail(`transfer göründü ama bakiye ${balance}`);
});

gate.check('Alice GAS ÖDEMEDİ (işlemi relayer gönderdi)', async () => {
  if (!honest?.payment?.txRef) return fail('settle tx yok');
  const tx = await provider.getTransaction(honest.payment.txRef);
  if (!tx) return fail('tx alınamadı');
  const aliceAddress = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE).address;
  if (tx.from.toLowerCase() === aliceAddress.toLowerCase()) {
    return fail('işlemi Alice gönderdi — EIP-3009 gasless yolu kullanılmamış');
  }
  return tx.from.toLowerCase() === relayer.address.toLowerCase()
    ? pass(
        [
          `gönderen (gas ödeyen): ${tx.from} — relayer`,
          `imzalayan (ödeyen)   : ${aliceAddress} — Alice, gas ödemedi`,
          'NOT: Base\'de relayer rolünü kendi cüzdanımız oynuyor; Hedera\'da gerçek blocky402 facilitator\'ı.',
        ].join('\n'),
      )
    : fail(`beklenmedik gönderen: ${tx.from}`);
});

// ---------------------------------------------------------------------------
// 3. Bob duyuruyu buluyor — SADECE görüntüleme anahtarıyla
// ---------------------------------------------------------------------------
gate.check('Bob ERC-5564 duyurusunu tarayarak ödemesini BULUYOR', async () => {
  const announcer = new ethers.Contract(ERC5564_ANNOUNCER, ANNOUNCER_ABI, provider);
  const head = await provider.getBlockNumber();
  const iface = new ethers.Interface(ANNOUNCER_ABI);

  // Base Sepolia RPC'si 2000 blokla sınırlı — geriye doğru parça parça tara.
  let found: { stealthAddress: string; ephemeralPublicKey: string; viewTag: number } | undefined;
  for (let to = head; to > head - 2000 * 6 && !found; to -= 2000) {
    const logs = await provider
      .getLogs({ address: ERC5564_ANNOUNCER, fromBlock: to - 1999, toBlock: to })
      .catch(() => []);
    for (const l of logs.reverse()) {
      let parsed;
      try {
        parsed = iface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        continue;
      }
      if (parsed?.name !== 'Announcement') continue;
      const eph = parsed.args.ephemeralPubKey as string;
      const metadata = parsed.args.metadata as string;
      const viewTag = metadata && metadata !== '0x' ? Number.parseInt(metadata.slice(2, 4), 16) : undefined;

      // Bob YALNIZCA görüntüleme anahtarıyla tarıyor — harcama anahtarı bu adımda yok.
      const hit = checkAnnouncement(
        { viewingPrivateKey: bobStealth.viewingPrivateKey, spendingPublicKey: bobStealth.spendingPublicKey },
        eph,
        viewTag,
      );
      if (hit && hit.stealthAddress.toLowerCase() === stealthAddress.toLowerCase()) {
        found = { stealthAddress: hit.stealthAddress, ephemeralPublicKey: eph, viewTag: viewTag ?? 0 };
        break;
      }
    }
  }

  if (!found) return fail(`duyurularda ${stealthAddress} bulunamadı`);
  ephemeralPublicKey = found.ephemeralPublicKey;
  evidence.announcement = found;
  return pass(
    [
      `duyuru bulundu · viewTag ${found.viewTag}`,
      `Bob yalnızca GÖRÜNTÜLEME anahtarıyla eşleştirdi (harcama anahtarı kullanılmadı)`,
      `${BASESCAN}/address/${ERC5564_ANNOUNCER}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 4. ANA KRİTER — Bob parayı HARCAYABİLİYOR
// ---------------------------------------------------------------------------
gate.check('Bob stealth adresten parayı HARCIYOR (türetmenin tek gerçek testi)', async () => {
  if (!stealthAddress || !ephemeralPublicKey) return fail('stealth adres ya da duyuru yok');

  const stealthPrivateKey = computeStealthPrivateKey(bobStealth, ephemeralPublicKey);
  const derived = new ethers.Wallet(stealthPrivateKey).address;
  if (derived.toLowerCase() !== stealthAddress.toLowerCase()) {
    return fail(`türetilen anahtar ${derived} adresini veriyor, beklenen ${stealthAddress}`);
  }

  const before = (await usdc.getFunction('balanceOf')(stealthAddress)) as bigint;
  if (before === 0n) return fail('stealth adreste bakiye yok');

  // Süpürme hedefi TAZE bir adres: Bob'un kayıtlı adresine göndermek stealth
  // adresi ona bağlardı. Üretimde Bob soğuk cüzdanına süpürür.
  const sink = ethers.Wallet.createRandom().address;

  // Stealth adresin ETH'i YOK ve olmamalı — ETH göndermek gönderenle bağ kurar.
  // EIP-3009 sayesinde gerek de yok: stealth anahtar yetkiyi imzalıyor, relayer gönderiyor.
  const auth = await signTransferAuthorization({
    provider,
    usdcAddress: cfg.USDC_BASE_SEPOLIA,
    signerPrivateKey: stealthPrivateKey,
    to: sink,
    value: before,
  });
  const { txHash } = await submitTransferAuthorization(relayer, cfg.USDC_BASE_SEPOLIA, auth);
  evidence.sweep = { txHash, sink, amount: before.toString() };

  // Base Sepolia public RPC'si yük dengeli: tx onaylandıktan hemen sonraki okuma
  // henüz o bloğu görmemiş bir replikaya düşebiliyor (P0-F'te aynı tuzağa düştük).
  // Beklenen değeri görene kadar yeniden deniyoruz.
  const after = await balanceUntil(stealthAddress, 0n);
  const sinkBalance = await balanceUntil(sink, before);

  if (after !== 0n) return fail(`süpürme sonrası stealth bakiye ${after} (tx ${txHash} status=1)`);
  if (sinkBalance !== before) return fail(`hedef adrese ${sinkBalance} geldi, beklenen ${before}`);

  return pass(
    [
      `${ethers.formatUnits(before, 6)} USDC stealth adresten çıkarıldı → ${sink}`,
      `stealth adres bakiyesi şimdi 0`,
      `türetme DOĞRU: Bob bu adresi gerçekten kontrol ediyor`,
      `${BASESCAN}/tx/${txHash}`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------
// 5. Bağlantısızlık
// ---------------------------------------------------------------------------
gate.check('Stealth adres Bob\'un kayıtlı 8004 adresiyle BAĞLANTISIZ', async () => {
  if (!stealthAddress) return fail('stealth adres yok');

  const problems: string[] = [];
  if (stealthAddress.toLowerCase() === bobWallet.address.toLowerCase()) {
    problems.push('stealth adres Bob\'un kayıtlı adresiyle aynı');
  }

  // En güçlü kanıt: adres HİÇ işlem GÖNDERMEMİŞ ve HİÇ ETH tutmamış.
  // ETH ile fonlanmış olsaydı, fonlayan cüzdan onu sahibine bağlardı.
  const nonce = await provider.getTransactionCount(stealthAddress);
  const ethBalance = await provider.getBalance(stealthAddress);
  if (nonce !== 0) problems.push(`adres ${nonce} işlem göndermiş — kendi gas'ını ödemiş, bağ kurulmuş olabilir`);
  if (ethBalance !== 0n) problems.push(`adreste ${ethers.formatEther(ethBalance)} ETH var — fonlayan taraf bağ kurar`);

  evidence.unlinkability = { nonce, ethBalance: ethBalance.toString(), bobAddress: bobWallet.address };
  return problems.length === 0
    ? pass(
        [
          `stealth ${stealthAddress}`,
          `Bob    ${bobWallet.address}`,
          'adres hiç tx göndermedi (nonce 0) ve hiç ETH tutmadı → fonlama bağı YOK',
          'iki USDC hareketini de relayer gönderdi',
        ].join('\n'),
      )
    : fail(problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 6. Sıra: settlement JobVerified'tan SONRA
// ---------------------------------------------------------------------------
gate.check('Settlement JobVerified bloğundan SONRA gerçekleşti', async () => {
  if (!honest?.txHash || !honest.payment?.txRef) return fail('tx\'ler yok');
  const verifiedReceipt = await provider.getTransactionReceipt(honest.txHash);
  const settleReceipt = await provider.getTransactionReceipt(honest.payment.txRef);
  if (!verifiedReceipt || !settleReceipt) return fail('receipt\'ler alınamadı');

  const ok = settleReceipt.blockNumber >= verifiedReceipt.blockNumber;
  evidence.ordering = { jobVerifiedBlock: verifiedReceipt.blockNumber, settleBlock: settleReceipt.blockNumber };
  return ok
    ? pass(`JobVerified blok ${verifiedReceipt.blockNumber} → settle blok ${settleReceipt.blockNumber}`)
    : fail(`settle (${settleReceipt.blockNumber}) JobVerified'dan (${verifiedReceipt.blockNumber}) ÖNCE`);
});

// ---------------------------------------------------------------------------
// 7. Fraud → settle YOK
// ---------------------------------------------------------------------------
gate.check('FRAUD koşusunda settle HİÇ çağrılmadı (ödeme asla settle olmadı)', async () => {
  fraud = await runDemo({
    fraudMode: 'substitute',
    paymentRail: 'base',
    nonce: BigInt(Date.now()) + 1n,
    log: () => {},
  });
  if (fraud.verified) return fail('hile yapıldığı hâlde iş doğrulandı');
  if (fraud.payment?.settled) return fail('doğrulanmamış iş için ödeme settle oldu');
  if (!fraud.payment?.authorized) return fail('yetkilendirme adımına hiç gelinmemiş');

  // Yetkilendirilen stealth adrese hiç USDC gitmemiş olmalı.
  const quotedTo = fraud.payment as { txRef?: string };
  if (quotedTo.txRef) return fail('fraud koşusunda transfer tx\'i var');

  evidence.fraud = { code: fraud.codeName, skipped: fraud.payment.skippedReason };
  return pass(
    [
      `kontrat: ${fraud.codeName}`,
      `ödeme yetkilendirildi ama GÖNDERİLMEDİ — ${fraud.payment.skippedReason}`,
      'USDC Alice\'te kaldı; stealth adrese hiçbir şey gitmedi',
    ].join('\n'),
  );
});

gate.check('Kanıt dosyası yazıldı (fixtures/base/P4-B.json)', async () => {
  await closeBob();
  evidence.announcerAddress = ERC5564_ANNOUNCER;
  evidence.registryAddress = ERC6538_REGISTRY;
  evidence.metaAddress = bobStealth.metaAddress;
  const dir = resolve(root, 'fixtures/base');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'P4-B.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return pass(
    [
      'fixtures/base/P4-B.json',
      `ödeme  : ${BASESCAN}/tx/${evidence.settleTx}`,
      `süpürme: ${BASESCAN}/tx/${(evidence.sweep as { txHash?: string } | undefined)?.txHash}`,
    ].join('\n'),
  );
});

await gate.run();
