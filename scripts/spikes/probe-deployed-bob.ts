// Run ONE real job against the DEPLOYED Bob and report what actually came back.
//
// The question this answers: is the hosted agent producing a real analysis, or the
// `[compute: none]` placeholder? Nothing else distinguishes the two from outside — the card,
// /health and the 402 behaviour look identical either way.
import { ethers } from 'ethers';
import { runAliceJob } from '../../packages/alice-agent/src/index.js';
import { loadConfig, loadDotenv, requireEnv } from '../../packages/shared/src/config.js';

loadDotenv();
const cfg = loadConfig();
const bobUrl = process.argv[2] ?? 'https://ethglobal-lisbon-production.up.railway.app';
console.log(`hedef: ${bobUrl}\n`);

const report = await runAliceJob({
  bobUrl,
  brief: 'Assess revenue-recognition risk in the attached quarterly figures.',
  data: 'Q3: revenue 4.2M, deferred 1.1M, top customer 38% of bookings.',
  constraints: { model: 'gpt-oss-120b', maxTokens: 400, temperature: 0.2 },
  wallet: new ethers.Wallet(cfg.PRIVATE_KEY_ALICE),
  eciesPrivateKey: requireEnv('ALICE_ECIES_PRIV'),
  verifyingContract: requireEnv('VERIFIER_ADDRESS'),
  chainId: 84532,
  log: (l) => console.log(l),
});

const out = report.result?.output ?? '';
console.log('\n─────────────────────────────');
console.log('matched      :', report.matched);
console.log('ogVerified   :', report.result?.ogVerified);
console.log('provider     :', report.result?.provider ?? '(bildirilmedi)');
console.log('çıktı uzunluğu:', out.length);
console.log('çıktı (ilk 260):');
console.log(out.slice(0, 260) || '(BOŞ)');
console.log('─────────────────────────────');

// An empty output is NOT evidence of a real analysis. The first version of this probe read the
// wrong field, got '', found no placeholder marker in it and declared success — a check that
// passes on missing data is worse than no check.
if (!out) {
  console.log('❓ KARARSIZ — çıktı boş geldi, alan adı yanlış olabilir. Sonuç çıkarma.');
} else if (out.includes('[compute: none]')) {
  console.log('❌ PLACEHOLDER — compute bağlı DEĞİL (eski kod ya da 0G anahtarı okunmuyor).');
} else {
  console.log('✅ GERÇEK ANALİZ — compute bağlı, uç satacak bir şeye sahip.');
}
