// Probe the OKX rail in ISOLATION: quote → authorize → verifyAuthorization.
//
// Deliberately does NOT run the demo: that would spend 0G faucet credit on an inference call
// and Base gas on a verification, to test a payment leg that can be tested on its own.
// NO MONEY MOVES here — settle() is never called.
import { ethers } from 'ethers';
import { loadConfig, loadDotenv, requireEnv } from '../../packages/shared/src/config.js';
import { createOkxX402Backend, xlayerAsset } from '../../packages/payment/src/okx-x402.js';
import { createOkxFacilitatorFromEnv } from '../../packages/payment/src/okx-facilitator.js';

loadDotenv();
const cfg = loadConfig();
const facilitator = createOkxFacilitatorFromEnv();
if (!facilitator) { console.log('❌ OKX kimlik bilgileri yok'); process.exit(1); }

const asset = xlayerAsset();
const bob = process.env.OKX_PAY_ACCOUNT?.trim() || new ethers.Wallet(cfg.PRIVATE_KEY_BOB).address;
const alice = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE).address;
console.log(`asset : ${asset.symbol} ${asset.address} (v${asset.eip712Version})`);
console.log(`payer : ${alice}`);
console.log(`payTo : ${bob}\n`);

const backend = createOkxX402Backend({
  payerPrivateKey: cfg.PRIVATE_KEY_ALICE,
  facilitator,
  verifierProvider: new ethers.JsonRpcProvider(cfg.BASE_RPC_URL),
  verifierAddress: requireEnv('VERIFIER_ADDRESS'),
  payoutAddress: bob,
  log: (l) => console.log(l),
});

const intentHash = ethers.keccak256(ethers.toUtf8Bytes('okx-pay-probe'));

try {
  const quote = await backend.quote({ intentHash, amount: '1000', recipient: bob });
  console.log(`✅ quote  : ${quote.amount} ${quote.asset} → ${quote.payTo}`);

  const proof = await backend.authorize(quote);
  console.log('✅ authorize: EIP-3009 imzalandı — PARA HAREKET ETMEDİ');

  const check = await backend.verifyAuthorization(proof, { amount: '1000', intentHash });
  console.log(check.ok ? '✅ verify  : OKX yetkilendirmeyi kabul etti' : `❌ verify  : ${check.reason}`);
  console.log('\nsettle() ÇAĞRILMADI — bu bir sonda değil, kapının önünde durma.');
} catch (err) {
  console.log(`\n❌ ${String(err).slice(0, 400)}`);
}
