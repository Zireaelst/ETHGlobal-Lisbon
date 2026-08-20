// Probe: does OKX's facilitator accept our credentials, and does it list X Layer testnet?
import { loadDotenv } from '../../packages/shared/src/config.js';
import { createOkxFacilitatorFromEnv } from '../../packages/payment/src/okx-facilitator.js';

loadDotenv();
const f = createOkxFacilitatorFromEnv();
if (!f) {
  console.log('❌ OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE okunamadı');
  process.exit(1);
}
const s = (await f.getSupported()) as { kinds?: Array<{ scheme?: string; network?: string }> };
const kinds = s?.kinds ?? [];
console.log(`✅ /supported cevap verdi — ${kinds.length} kayıt\n`);
for (const k of kinds) {
  const tag = String(k.network).includes('1952') ? '  ← TESTNET' : '';
  console.log(`   ${k.scheme}/${k.network}${tag}`);
}
