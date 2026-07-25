// scripts/og-storage-probe.ts — de-risk the 0G Storage leg BEFORE wiring it into the flow.
//
// BUILD-PLAN P3-E depends on three things being true, and none of them is worth assuming:
//   1. an in-memory blob can be uploaded without touching the filesystem,
//   2. the root hash we compute locally is the one the network stores it under,
//   3. the bytes come back byte-identical.
//
// It spends real faucet credit (a storage fee plus gas), so it uploads ~1 KB and no more.
//
//   pnpm tsx scripts/og-storage-probe.ts

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { loadDotenv, requireEnv } from '../packages/shared/src/config.js';

loadDotenv();

const INDEXER_URL = process.env.OG_STORAGE_INDEXER ?? 'https://indexer-storage-testnet-turbo.0g.ai';

async function main(): Promise<void> {
  const { Indexer, MemData } = await import('@0gfoundation/0g-ts-sdk');

  const rpcUrl = requireEnv('OG_RPC_URL');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(requireEnv('OG_PRIVATE_KEY'), provider);

  const balance = await provider.getBalance(signer.address);
  console.log(`signer   : ${signer.address}`);
  console.log(`balance  : ${ethers.formatEther(balance)} OG`);
  console.log(`indexer  : ${INDEXER_URL}`);

  // A recognisable payload, so a byte-for-byte comparison means something.
  const payload = Buffer.concat([
    Buffer.from('confidential-agents/P3-E probe\n', 'utf8'),
    randomBytes(512),
  ]);
  console.log(`payload  : ${payload.length} bayt`);

  const file = new MemData(payload);
  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null || tree === null) throw new Error(`merkleTree: ${treeErr}`);
  const localRoot = tree.rootHash();
  console.log(`root     : ${localRoot}  (yerelde hesaplandı)`);

  const startedUpload = Date.now();
  const indexer = new Indexer(INDEXER_URL);
  const [tx, uploadErr] = await indexer.upload(file, rpcUrl, signer);
  if (uploadErr !== null) throw new Error(`upload: ${uploadErr}`);
  console.log(`upload   : ${Date.now() - startedUpload} ms · ${JSON.stringify(tx)}`);

  // The download reads from the storage nodes, not from our process — a round trip that
  // proves the blob is actually retrievable by root hash alone.
  const dir = mkdtempSync(resolve(tmpdir(), 'og-probe-'));
  const out = resolve(dir, 'blob.bin');
  try {
    const startedDownload = Date.now();
    const downloadErr = await indexer.download(localRoot as string, out, true);
    if (downloadErr !== null) throw new Error(`download: ${downloadErr}`);
    const back = readFileSync(out);
    console.log(`download : ${Date.now() - startedDownload} ms · ${back.length} bayt`);

    const identical = back.equals(payload);
    console.log(`\nbayt bayt aynı mı : ${identical ? 'EVET' : 'HAYIR'}`);
    if (!identical) throw new Error('indirilen blob yüklenenle aynı değil');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const spent = balance - (await provider.getBalance(signer.address));
  console.log(`harcanan          : ${ethers.formatEther(spent)} OG`);
  console.log('\nP3-E bacağı ÇALIŞIYOR.');
}

main().catch((err) => {
  console.error(`\nPROBE BAŞARISIZ: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
