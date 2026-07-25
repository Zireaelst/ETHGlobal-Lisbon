// scripts/og-list.ts — 0G Compute keşfi (SALT OKUNUR, para harcamaz).
//
// P0-B'nin ilk adımı. Amaç tek soruyu cevaplamak: ağda gerçekten `TeeML`
// sağlayıcı var mı, ve hangisini seçeceğiz?
//
// Bu ayrım kozmetik değil. BUILD-PLAN P0-B/2:
//   TeeML  → model enclave'in İÇİNDE çalışır; operatör veriyi göremez
//   TeeTLS → sadece taşıma şifreli; model normal makinede
// "Altyapı veriyi göremez" iddiamız TeeML'e dayanıyor. TeeTLS seçersek demo
// çalışır ama iddia yalan olur — bu yüzden burada eleme yapıyoruz, sonra değil.

import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { loadDotenv, requireEnv } from '../packages/shared/src/config.js';

// SDK v0.9.0'ın ESM build'i KIRIK: lib.esm/index.mjs, CJS olan bir dosyadan
// isimlendirilmiş export çekmeye çalışıyor →
//   SyntaxError: The requested module './index-28fb2bc1.js' does not provide an export named 'C'
// CJS build'i sağlam, o yüzden createRequire ile onu yüklüyoruz. Paket
// yamalandığında bu düz import'a dönebilir.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

loadDotenv();

const provider = new ethers.JsonRpcProvider(requireEnv('OG_RPC_URL'));
const wallet = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);

console.log(`cüzdan  : ${wallet.address}`);
console.log(`bakiye  : ${ethers.formatEther(await provider.getBalance(wallet.address))} OG`);
console.log(`ağ      : chainId ${(await provider.getNetwork()).chainId}\n`);

const broker = await createZGComputeNetworkBroker(wallet);

// Defter durumu — henüz FONLAMIYORUZ, sadece bakıyoruz.
try {
  const ledger = await broker.ledger.getLedger();
  console.log(`defter  : ${ethers.formatEther(ledger.totalBalance)} OG (kilitli: ${ethers.formatEther(ledger.availableBalance)})\n`);
} catch (err) {
  console.log(`defter  : henüz yok (${(err as Error).message.slice(0, 60)})\n`);
}

// DİKKAT: inference tarafının imzası fine-tuning'den FARKLI.
//   inference   : listService(offset = 0, limit = 50, includeUnacknowledged = false)
//   fine-tuning : listService(includeUnacknowledged = false)
// .d.ts ikisini de aynı isimle gösteriyor; `listService(true)` demek offset'e
// `true` geçirmek oluyor → "invalid BigNumberish value". Kaynaktan doğrulandı:
// lib.commonjs/inference/broker/read-only-broker.js:36
const services = await broker.inference.listService(0, 50, true);
console.log(`${services.length} servis bulundu:\n`);

const byVerifiability = new Map<string, number>();
for (const s of services) {
  const v = s.verifiability || '(boş)';
  byVerifiability.set(v, (byVerifiability.get(v) ?? 0) + 1);
}
console.log('verifiability dağılımı:', Object.fromEntries(byVerifiability), '\n');

for (const s of services) {
  const teeml = s.verifiability === 'TeeML';
  console.log(`${teeml ? '✅ TeeML' : `   ${s.verifiability || '(boş)'}`}  ${s.provider}`);
  console.log(`     model     : ${s.model}`);
  console.log(`     url       : ${s.url}`);
  console.log(`     fiyat     : input ${s.inputPrice} / output ${s.outputPrice} (neuron)`);
  if (teeml) {
    // Struct'tan DOĞRUDAN okuyoruz. checkProviderSignerStatus() çağırmıyoruz:
    // o fonksiyon sağlayıcıda alt hesap yoksa MIN_TRANSFER_AMOUNT (1 OG!)
    // transfer ediyor — sırf listelemek için sağlayıcı başına 1 OG yakardık.
    console.log(`     TEE signer: ${s.teeSignerAddress}`);
    console.log(`     onaylı mı : ${s.teeSignerAcknowledged ? 'EVET' : 'HAYIR — processResponse false döner'}`);
    console.log(`     ek bilgi  : ${s.additionalInfo || '(boş)'}`);
  }
  console.log();
}
