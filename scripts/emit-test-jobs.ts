// scripts/emit-test-jobs.ts — zincire GERÇEK bir JobVerified ve bir JobRejected yazar.
//
// Amacı subgraph'ın Verifier mapping'ini kanıtlamak: event olmadan indeksleme
// doğruluğu hakkında hiçbir şey bilemeyiz ve "sessizce boş indeksleyen subgraph"
// hata sınıfına açık kalırız (P2-B'de MetadataSet ile tam bunu yakalamıştık).
//
// Yan etkisi P3-C'nin çekirdeğini de yapıyor: enclave imzalayıcısını on-chain kaydeder.
// Gerçek Tapp geldiğinde `setEnclaveSigner` yeniden çağrılacak — setter bilerek mutable.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { loadConfig, loadDotenv, repoRoot, requireEnv } from '../packages/shared/src/config.js';
import { agentIdToBytes32, buildIntentHash, signIntent, type Constraints } from '../packages/shared/src/index.js';
import { runBinding } from '../packages/bob-binding/src/binding.js';

const BASESCAN = 'https://sepolia.basescan.org';
const CHAIN_ID = 84532;
const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };

async function main(): Promise<void> {
  loadDotenv();
  const cfg = loadConfig();
  const root = repoRoot();

  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const deployer = new ethers.Wallet(cfg.PRIVATE_KEY_DEPLOYER, provider);
  const alice = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE, provider);

  const verifierAddress = requireEnv('VERIFIER_ADDRESS');
  const bobAgentId = requireEnv('BOB_AGENT_ID');
  const agentIdB32 = agentIdToBytes32(BigInt(bobAgentId));

  const abi = (
    JSON.parse(readFileSync(resolve(root, 'contracts/out/Verifier.sol/Verifier.json'), 'utf8')) as {
      abi: ethers.InterfaceAbi;
    }
  ).abi;

  // bob-agent ile AYNI türetme — kayıtlı imzacı ile üreten imzacı ayrışmasın.
  const bindingKey = ethers.keccak256(ethers.toUtf8Bytes(`phase1-binding-key/${cfg.PRIVATE_KEY_BOB}`));
  const bindingSigner = new ethers.Wallet(bindingKey).address;

  // --- 1. enclave imzalayıcısını kaydet (P3-C çekirdeği) ---
  const asOwner = new ethers.Contract(verifierAddress, abi, deployer);
  const current = (await asOwner.enclaveSignerOf(agentIdB32)) as string;
  if (current.toLowerCase() !== bindingSigner.toLowerCase()) {
    const tx = await asOwner.setEnclaveSigner(agentIdB32, bindingSigner);
    await tx.wait();
    console.log(`setEnclaveSigner(${bobAgentId}, ${bindingSigner})  ${BASESCAN}/tx/${tx.hash}`);
  } else {
    console.log(`enclaveSigner zaten kayıtlı: ${bindingSigner}`);
  }

  const asAlice = new ethers.Contract(verifierAddress, abi, alice);

  /** Bir iş kur: intent + imza + enclave gövdesi. */
  async function buildJob(brief: string, data: string, nonce: bigint, substituteBrief?: string) {
    const price = 1_000_000n;
    const intentHash = buildIntentHash({ brief, data, constraints: CONSTRAINTS, price, nonce });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const intent = { intentHash, client: alice.address, agentId: agentIdB32, price, deadline };
    const clientSig = await signIntent(intent, alice, verifierAddress, CHAIN_ID);

    // Bob hile yapıyorsa enclave'e BAŞKA bir brief giriyor — iddia edilen hash aynı kalıyor.
    const bound = await runBinding(
      {
        claimedIntentHash: intentHash,
        brief: substituteBrief ?? brief,
        data,
        constraints: CONSTRAINTS,
        price,
        nonce,
        agentId: `agent-${bobAgentId}`,
        sealId: ethers.keccak256(ethers.toUtf8Bytes(`seal/${bindingSigner}/${bobAgentId}`)).slice(0, 18),
        timestamp: Math.floor(Date.now() / 1000).toString(),
      },
      bindingKey,
    );
    const seal = {
      agentId: bound.seal.agentId,
      sealId: bound.seal.sealId,
      timestamp: bound.seal.timestamp,
      r: bound.seal.r,
      s: bound.seal.s,
    };
    return { intent, clientSig, bound, seal };
  }

  // --- 2. DÜRÜST iş -> verifyJob -> JobVerified ---
  const honest = await buildJob(
    'On-chain dogrulama testi: bu is gercekten siparis edildi.',
    'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.',
    9001n,
  );
  const preview = (await asAlice.previewJob(
    honest.intent,
    honest.clientSig,
    honest.bound.outputHash,
    honest.bound.match,
    honest.bound.ogSigHash,
    honest.seal,
  )) as bigint;
  if (preview !== 0n) throw new Error(`dürüst iş previewJob kodu ${preview}, 0 bekleniyordu`);

  const okTx = await asAlice.verifyJob(
    honest.intent,
    honest.clientSig,
    honest.bound.outputHash,
    honest.bound.match,
    honest.bound.ogSigHash,
    honest.seal,
  );
  const okReceipt = await okTx.wait();
  console.log(`\nJobVerified  intentHash ${honest.intent.intentHash}`);
  console.log(`  blok ${okReceipt?.blockNumber}  ${BASESCAN}/tx/${okTx.hash}`);

  // --- 3. HİLELİ iş -> verifyJobLenient -> JobRejected(MatchFalse) ---
  // Lenient yol revert ETMEZ; tx Basescan'de başarılı görünür ve subgraph indeksleyebilir.
  const fraud = await buildJob(
    'On-chain fraud testi: Alice bu isi siparis etti.',
    'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR.',
    9002n,
    'Bob bambaska bir isi cevapladi.',
  );
  if (fraud.bound.match) throw new Error('substitute senaryosunda match=true çıktı');

  const badTx = await asAlice.verifyJobLenient(
    fraud.intent,
    fraud.clientSig,
    fraud.bound.outputHash,
    fraud.bound.match,
    fraud.bound.ogSigHash,
    fraud.seal,
  );
  const badReceipt = await badTx.wait();
  console.log(`\nJobRejected  intentHash ${fraud.intent.intentHash}`);
  console.log(`  blok ${badReceipt?.blockNumber}  status=${badReceipt?.status} (revert YOK)  ${BASESCAN}/tx/${badTx.hash}`);

  console.log('\nSubgraph birkaç saniye içinde bu event\'leri indeksleyecek.');
}

await main();
