// tests/gates/P1-D.ts — Fraud modu altyapısı kapısı.
//
// BUILD-PLAN P1-D geçiş kriterleri:
//   [ ] 5 modun her biri /task yanıtında beklenen match / imza durumunu üretiyor
//       (kontrat henüz yok, ÇIKTI SEVİYESİNDE doğrula)
//   [ ] FRAUD_MODE RUNTIME'da değişebiliyor (yeniden başlatma gerekmiyor)
//       — demo sırasında restart seal key'i kaybettirir (v3 §06)
//
// Kapının fazladan iddiası: hile kodu enclave'e FİZİKSEL olarak giremiyor.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { createBobAgent, type BobAgent } from '../../packages/bob-agent/src/index.js';
import { EXPECTED_OUTCOME, FRAUD_MODES, type FraudMode } from '../../packages/bob-agent/src/fraud.js';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import { decodeBody, recoverBindingSigner } from '../../packages/bob-binding/src/binding.js';
import {
  PLACEHOLDER_VERIFIER,
  createEciesIdentity,
  type Constraints,
  type EchoResult,
} from '../../packages/shared/src/index.js';
import { loadDotenv, optionalEnv, repoRoot } from '../../packages/shared/src/config.js';
import { Gate, fail, pass } from './_harness.js';

loadDotenv();
const root = repoRoot();
const gate = new Gate('P1-D', 'Fraud modu altyapısı (5 mod, runtime anahtar)');

// Verifier deploy edildiyse GERÇEK adresi kullan — imzalar üretim domain'inde üretilsin.
const VERIFYING_CONTRACT = optionalEnv('VERIFIER_ADDRESS') ?? PLACEHOLDER_VERIFIER;

const BRIEF = 'Assess revenue-recognition risk in the attached quarterly figures.';
const DATA = 'Q3-2026 revenue 12,400,000 EUR; deferred 3,100,000 EUR; 41 contracts.';
const CONSTRAINTS: Constraints = { model: 'qwen2.5-omni-7b', maxTokens: 2048, temperature: 0.2 };

const aliceEcies = optionalEnv('ALICE_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const bobEcies = optionalEnv('BOB_ECIES_PRIV') ?? createEciesIdentity().privateKey;
const aliceWallet = Wallet.createRandom();
const bobWallet = Wallet.createRandom();
const BINDING_KEY = keccak256(toUtf8Bytes('confidential-agents/P1-D/binding'));
const BOB_AGENT_ID = optionalEnv('BOB_AGENT_ID') ?? '8429';

let bob: BobAgent | undefined;
let nonce = 100n;

async function runJob(): Promise<{
  result: EchoResult;
  signedIntentHash: string;
  claimedBodyHex: string;
  claimedSeal: EchoResult['seal'];
  sealTampered: boolean;
}> {
  if (!bob) throw new Error('bob yok');
  const report = await runAliceJob({
    bobUrl: bob.url(),
    brief: BRIEF,
    data: DATA,
    constraints: CONSTRAINTS,
    wallet: aliceWallet,
    eciesPrivateKey: aliceEcies,
    verifyingContract: VERIFYING_CONTRACT,
    nonce: nonce++,
    log: () => {},
  });
  return {
    result: report.result,
    signedIntentHash: report.intent.intentHash,
    claimedBodyHex: report.claimedBodyHex,
    claimedSeal: report.claimedSeal,
    sealTampered: report.sealTampered,
  };
}

gate.check('Bob ayakta, binding imzalayıcısı kayıtlı', async () => {
  bob = createBobAgent({
    eciesPrivateKey: bobEcies,
    agentId: BOB_AGENT_ID,
    owner: bobWallet.address,
    skills: ['market-analysis'],
    price: { amount: '1000000', asset: 'USDC', decimals: 6 },
    verifyingContract: VERIFYING_CONTRACT,
    bindingKey: BINDING_KEY,
    fraudMode: 'none',
    log: () => {},
  });
  await bob.listen();
  return pass(`binding signer ${bob.bindingSigner()} · başlangıç modu ${bob.fraudMode()}`);
});

// ---------------------------------------------------------------------------
// 1. Beş mod — her biri beklenen sonucu üretiyor
// ---------------------------------------------------------------------------

/**
 * Kontratın vereceği kararı, Alice'in ZİNCİRE GÖTÜRECEĞİ artefaktlardan türet.
 *
 * ECIES sınırı enclave'e taşındıktan sonra bu model değişti ve önemli:
 * enclave'in kendi `clientSigOk` raporu, ALDIĞI paket hakkındadır — Alice'in
 * zincire göndereceği intent+imza hakkında değil. `substitute` modunda Bob sahte
 * bir istemci imzası koyar, enclave bunu dürüstçe "HATALI" der, ama Alice zincire
 * KENDİ geçerli imzasını gönderir. Dolayısıyla kontrat orada `MatchFalse` verir,
 * `BadClientSig` değil.
 *
 * Kontratın gerçek sırası (Verifier._check): client imzası → enclave imzası → match.
 */
function outcomeOf(
  result: EchoResult,
  signedIntentHash: string,
  claimedBodyIntentHash: string,
  sealOk: boolean,
): string {
  // Zincire giden gövdedeki taahhüt Alice'in imzaladığından farklıysa, onun imzası
  // o yapıyı kurtarmaz → BadClientSig. (`selfintent` böyle düşer.)
  if (claimedBodyIntentHash.toLowerCase() !== signedIntentHash.toLowerCase()) return 'BadClientSig';
  if (!sealOk) return 'BadEnclaveSig';
  if (!result.match) return 'MatchFalse';
  return 'JobVerified';
}

const observed = new Map<
  FraudMode,
  { outcome: string; result: EchoResult; claimedBodyHex: string; sealTampered: boolean; sealOk: boolean }
>();

for (const mode of FRAUD_MODES) {
  gate.check(`FRAUD_MODE=${mode} → ${EXPECTED_OUTCOME[mode]}`, async () => {
    if (!bob) return fail('bob yok');
    bob.setFraudMode(mode);
    const run = await runJob();

    // Zincire giden artefaktlar üzerinden değerlendir — Alice'in çözdüğü kopya
    // üzerinden değil. `forge` modunda ikisi ayrışır ve fark tam burada görünür.
    const claimedBody = decodeBody(run.claimedBodyHex);
    const claimedSigner = recoverBindingSigner(
      run.claimedBodyHex,
      run.claimedSeal,
      run.result.expectedBindingSigner,
    );
    const sealOk = claimedSigner.toLowerCase() === run.result.expectedBindingSigner.toLowerCase();

    const outcome = outcomeOf(run.result, run.signedIntentHash, claimedBody.intentHash, sealOk);
    observed.set(mode, {
      outcome,
      result: run.result,
      claimedBodyHex: run.claimedBodyHex,
      sealTampered: run.sealTampered,
      sealOk,
    });

    const detail = [
      `match=${claimedBody.match}`,
      `bodyIntentHash=${claimedBody.intentHash === run.signedIntentHash ? 'Alice\'inki' : 'FARKLI'}`,
      `seal=${sealOk ? 'ok' : 'HATALI'}`,
      `→ ${outcome}`,
    ].join(' · ');

    return outcome === EXPECTED_OUTCOME[mode]
      ? pass(detail)
      : fail(`${detail}\nbeklenen ${EXPECTED_OUTCOME[mode]}`);
  });
}

gate.check('Beş mod BİRBİRİNDEN ayırt edilebilir sonuç üretiyor', () => {
  // substitute ve tamper aynı koda (MatchFalse) düşüyor — bu doğru ve beklenen.
  // Ama üç FARKLI ret kodu görebilmeliyiz, yoksa fraud demosu tek senaryoya iner.
  const codes = new Set([...observed.values()].map((v) => v.outcome));
  const rejections = [...codes].filter((c) => c !== 'JobVerified');
  return rejections.length >= 3
    ? pass(`gözlenen kodlar: ${[...codes].join(', ')}`)
    : fail(`sadece ${rejections.length} farklı ret kodu: ${rejections.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 2. Enclave dürüstlüğü — tezin özü
// ---------------------------------------------------------------------------
gate.check('Enclave match:false olsa BİLE gövdeyi imzalıyor (yalan söylemiyor)', () => {
  const sub = observed.get('substitute');
  if (!sub) return fail('substitute koşusu yok');
  if (sub.result.match) return fail('substitute modunda match=true çıktı');
  if (!sub.result.bindingSigOk) return fail('substitute modunda imza da bozulmuş — mod izolasyonu yok');

  // İmzalanan gövde gerçekten match=false taşıyor mu?
  const body = decodeBody(sub.result.bodyHex);
  if (body.match !== false) return fail('imzalanan gövdede match alanı false değil');
  return pass('gövde match=false ile imzalandı — reddi kontrat verecek, enclave sadece raporluyor');
});

gate.check('İmzalanan gövde alanlardan yeniden üretilebiliyor (kontratın yapacağı şey)', () => {
  const none = observed.get('none');
  if (!none) return fail('none koşusu yok');
  const body = decodeBody(none.result.bodyHex);
  const problems: string[] = [];
  if (body.intentHash !== none.result.intentHash) problems.push('intentHash gövdeyle uyuşmuyor');
  if (body.match !== none.result.match) problems.push('match gövdeyle uyuşmuyor');
  // `v` atıldığı için beklenen imzacıyı verip doğru pariteyi seçtiriyoruz — kontrat da
  // aynı şeyi yapıyor (27, tutmazsa 28).
  const recovered = recoverBindingSigner(
    none.result.bodyHex,
    none.result.seal,
    none.result.expectedBindingSigner,
  );
  if (recovered !== none.result.bindingSigner) {
    problems.push(`gövdeden kurtarılan imzacı ${recovered} ≠ raporlanan ${none.result.bindingSigner}`);
  }
  return problems.length === 0
    ? pass(`abi.decode → intentHash ${body.intentHash.slice(0, 18)}… match=${body.match}`)
    : fail(problems.join('\n'));
});

gate.check('0G bağlı değilken sistem bunu DÜRÜSTÇE raporluyor', () => {
  const none = observed.get('none');
  if (!none) return fail('none koşusu yok');
  const r = none.result;
  const problems: string[] = [];

  // Sahte bir TEE imzası üretmek, mock'lanabilecek en hassas şey olurdu.
  if (r.ogVerified) problems.push('0G bağlı değilken ogVerified=true — sahte attestation iddiası');
  if (r.ogSig !== undefined) problems.push('0G imzası yokken ogSig alanı dolu');
  if (r.computeProvider !== 'none') problems.push(`computeProvider="${r.computeProvider}", beklenen "none"`);

  // İmza yoksa gövdedeki taahhüt de SIFIR olmalı — uydurma hash yazılmamalı.
  const body = decodeBody(r.bodyHex);
  const zero = `0x${'00'.repeat(32)}`;
  if (body.ogSigHash !== zero) problems.push(`ogSigHash sıfır değil (${body.ogSigHash.slice(0, 18)}…)`);

  return problems.length === 0
    ? pass('computeProvider="none" · ogVerified=false · ogSig yok · gövdede ogSigHash=0')
    : fail(problems.join('\n'));
});

gate.check('forge modunda gövde DOĞRU ama İDDİA EDİLEN imza yabancı', () => {
  const forge = observed.get('forge');
  if (!forge) return fail('forge koşusu yok');
  if (!forge.result.match) return fail('forge modunda match false — gövde de bozulmuş, beklenmiyor');

  // ENCLAVE dürüstçe imzaladı ve Alice'e şifrelediği kopyada imza GEÇERLİ.
  // Sahtecilik, Bob'un zincire götürülmesini istediği kopyada.
  if (!forge.result.bindingSigOk) return fail('enclave kendi imzasını bozmuş — mod izolasyonu yok');
  if (!forge.sealTampered) return fail('iddia edilen seal enclave\'inkiyle aynı — hile uygulanmamış');
  if (forge.sealOk) return fail('iddia edilen seal kayıtlı anahtarı veriyor — kontrat bunu kabul ederdi');

  return pass(
    [
      'enclave kopyası: imza geçerli (Alice bunu çözüyor)',
      'Bob\'un ilettiği kopya: imza YABANCI → kontrat BadEnclaveSig verir',
      'Alice iki kopyayı karşılaştırıp kurcalamayı görebiliyor (sealTampered=true)',
    ].join('\n'),
  );
});

gate.check('selfintent modunda Bob kendi işini uyduruyor, Alice imzası tutmuyor', () => {
  const self = observed.get('selfintent');
  if (!self) return fail('selfintent koşusu yok');
  if (self.result.clientSigOk) return fail('uydurma intent\'te clientSigOk=true');
  // Bob içerikle tutarlı bir hash ürettiği için enclave match:true diyor —
  // reddin client imzasından gelmesi tam olarak istenen davranış.
  if (!self.result.match) return fail('selfintent match=false verdi; ret kodu MatchFalse\'a düşer, BadClientSig değil');
  return pass('match=true ama imza Alice\'e ait değil → BadClientSig');
});

// ---------------------------------------------------------------------------
// 3. Runtime anahtar — restart YOK
// ---------------------------------------------------------------------------
gate.check('FRAUD_MODE runtime\'da değişiyor (aynı süreç, aynı port)', async () => {
  if (!bob) return fail('bob yok');
  const pidPort = bob.url();

  bob.setFraudMode('none');
  const honest = await runJob();
  bob.setFraudMode('substitute');
  const cheating = await runJob();
  bob.setFraudMode('none');
  const honestAgain = await runJob();

  if (bob.url() !== pidPort) return fail('sunucu adresi değişti — restart olmuş');
  const seq = [honest.result.match, cheating.result.match, honestAgain.result.match];
  return seq.join(',') === 'true,false,true'
    ? pass(`${pidPort} üzerinde match dizisi: ${seq.join(' → ')} (restart yok)`)
    : fail(`beklenen true,false,true; gelen ${seq.join(',')}`);
});

gate.check('HTTP ile de değişiyor (demo dApp fraud butonu bunu kullanacak)', async () => {
  if (!bob) return fail('bob yok');
  const base = bob.url();

  const set = (mode: string) =>
    fetch(`${base}/admin/fraud-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });

  const res = await set('tamper');
  if (res.status !== 200) return fail(`POST /admin/fraud-mode ${res.status}`);
  if (bob.fraudMode() !== 'tamper') return fail('HTTP çağrısı modu değiştirmedi');

  const tampered = await runJob();
  if (tampered.result.match) return fail('tamper moduna geçildiği hâlde match=true');

  const bad = await set('gecersizmod');
  if (bad.status !== 400) return fail(`bilinmeyen mod ${bad.status} döndü, 400 bekleniyordu`);

  const current = await (await fetch(`${base}/admin/fraud-mode`)).json();
  await set('none');
  return pass(`POST → 200, GET → ${JSON.stringify(current)}, bilinmeyen mod → 400`);
});

// ---------------------------------------------------------------------------
// 4. Yapısal iddia: hile enclave'e giremiyor
// ---------------------------------------------------------------------------
gate.check('Enclave paketinde FRAUD/hile izi YOK (yapısal kanıt)', () => {
  const files = ['binding.ts', 'index.ts'];
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(resolve(root, 'packages/bob-binding/src', f), 'utf8');
    // Yorum satırlarını at — açıklamalarda "FRAUD_MODE yok" yazmak serbest.
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n');
    for (const needle of ['FRAUD_MODE', 'fraudMode', 'applyPreBindingFraud', 'applyPostBindingFraud', 'rogue']) {
      if (code.includes(needle)) offenders.push(`${f}: "${needle}"`);
    }
  }
  // bob-binding, bob-agent'a bağımlı OLMAMALI — bağımlılık yönü tek taraflı.
  const pkg = JSON.parse(readFileSync(resolve(root, 'packages/bob-binding/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  if (pkg.dependencies && '@ca/bob-agent' in pkg.dependencies) {
    offenders.push('bob-binding, bob-agent\'a bağımlı — hile kodu enclave\'e sızabilir');
  }

  return offenders.length === 0
    ? pass('enclave kaynağında hile sembolü yok; bağımlılık yönü bob-agent → bob-binding (tek yönlü)')
    : fail(offenders.join('\n'));
});

gate.check('Sunucu kapatıldı', async () => {
  await bob?.close();
  return pass('bob kapandı');
});

await gate.run();
