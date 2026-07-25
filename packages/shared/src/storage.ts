// storage.ts — 0G Storage, encrypted (BUILD-PLAN P3-E).
//
// WHAT THIS BUYS, precisely: the on-chain `outputHash` stops being a hash of something only
// Bob happens to still have in memory, and becomes a hash of something ANYONE can fetch. The
// verdict was already public; the artefact it refers to now is too.
//
// WHAT IT DOES NOT BUY: any new guarantee about the work. A blob on 0G Storage is not more
// true than the same blob on Bob's disk — it is more AVAILABLE. Say it that way (CLAUDE.md §11).
//
// PRIVACY: the network sees ciphertext only. Encryption is AES-256-GCM, the key is generated
// per blob inside the enclave and travels to Alice inside the ECIES result envelope — it is
// deliberately NOT part of `BindingResponse`, so Bob's outer layer never holds it. Anyone can
// download the blob; only Alice can read it.
//
// WHY WE ENCRYPT RATHER THAN USE THE SDK's OWN ENCRYPTION: the gate has to prove that the
// bytes coming back hash to the SAME `outputHash` that went on chain. That requires knowing
// exactly which bytes were sealed, so the plaintext here is EXACTLY the deliverable — no
// wrapper object, no re-serialisation, no key ordering to depend on.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// node:fs/os/path are pulled in lazily inside `get()`. This module is re-exported from the
// @ca/shared barrel, which the Next.js dashboard imports; a top-level `node:fs` would drag the
// filesystem into that module graph for the sake of a code path the browser never runs.

/** 0G's public testnet indexer. Overridable, because a self-hosted indexer is a valid setup. */
export const DEFAULT_INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface StoredBlob {
  /** The 0G Storage root hash — the address the blob is fetched by. Public. */
  rootHash: string;
  /** The 0G chain transaction that registered the upload. Public. */
  txHash: string;
  /** AES-256-GCM key, 0x-prefixed hex. SECRET — for Alice's envelope only. */
  keyHex: string;
  /** Ciphertext length, for the report. */
  bytes: number;
  uploadMs: number;
}

export interface StorageBackend {
  readonly provider: '0g-storage';
  /** Encrypt with a fresh key, upload, return the public root plus the secret key. */
  put(plaintext: string): Promise<StoredBlob>;
  /** Download by root hash and decrypt. Throws if the blob was tampered with (GCM tag). */
  get(rootHash: string, keyHex: string): Promise<string>;
}

export interface ZeroGStorageOptions {
  rpcUrl: string;
  /** The wallet paying the storage fee and gas. */
  privateKey: string;
  indexerUrl?: string;
}

/** `iv ‖ tag ‖ ciphertext` — self-describing, so `decryptBlob` needs no side channel. */
export function encryptBlob(plaintext: string, keyHex: string): Buffer {
  const key = hexToKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptBlob(blob: Buffer, keyHex: string): string {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error(`blob is too short to be an AES-GCM payload: ${blob.length} bytes`);
  }
  const key = hexToKey(keyHex);
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // A wrong key or a flipped byte throws here rather than returning plausible garbage —
  // the same property the ECIES boundary has (gate P1-B).
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function newBlobKey(): string {
  return `0x${randomBytes(KEY_BYTES).toString('hex')}`;
}

function hexToKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex.replace(/^0x/, ''), 'hex');
  if (key.length !== KEY_BYTES) throw new Error(`the AES key must be ${KEY_BYTES} bytes, got ${key.length}`);
  return key;
}

export function createZeroGStorage(options: ZeroGStorageOptions): StorageBackend {
  const indexerUrl = options.indexerUrl ?? DEFAULT_INDEXER_URL;

  // The SDK pulls in ethers and a JSON-RPC provider; loaded on first use so that importing
  // @ca/shared in a process that never stores anything stays cheap.
  async function sdk() {
    const { Indexer, MemData } = await import('@0gfoundation/0g-ts-sdk');
    const { ethers } = await import('ethers');
    return { Indexer, MemData, ethers };
  }

  return {
    provider: '0g-storage',

    async put(plaintext: string): Promise<StoredBlob> {
      const { Indexer, MemData, ethers } = await sdk();
      const keyHex = newBlobKey();
      const blob = encryptBlob(plaintext, keyHex);

      const file = new MemData(blob);
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr !== null || tree === null) throw new Error(`0G Storage merkleTree: ${treeErr}`);
      const localRoot = tree.rootHash();
      if (!localRoot) throw new Error('0G Storage returned an empty root hash');

      const provider = new ethers.JsonRpcProvider(options.rpcUrl);
      const signer = new ethers.Wallet(options.privateKey, provider);
      const started = Date.now();
      // The cast is a TYPE-IDENTITY problem, not a value problem: the 0G SDK's declarations
      // reference ethers' CommonJS build while this dynamic import resolves the ESM one, so
      // TypeScript sees two `Signer` types with private members it refuses to unify. It is the
      // same wallet either way — the probe (scripts/og-storage-probe.ts) runs this exact call.
      const [tx, uploadErr] = await new Indexer(indexerUrl).upload(
        file,
        options.rpcUrl,
        signer as unknown as Parameters<InstanceType<typeof Indexer>['upload']>[2],
      );
      if (uploadErr !== null) throw new Error(`0G Storage upload: ${uploadErr}`);

      // The SDK returns either a single result or a batch; a single MemData is always the
      // former, but the union is checked rather than cast away.
      const single = tx as { txHash?: string; rootHash?: string };
      const rootHash = single.rootHash ?? (localRoot as string);
      if (rootHash !== localRoot) {
        // If these ever disagree, the address we publish is not the address we sealed.
        throw new Error(`0G Storage root mismatch: local ${localRoot}, network ${rootHash}`);
      }

      return {
        rootHash,
        txHash: single.txHash ?? '',
        keyHex,
        bytes: blob.length,
        uploadMs: Date.now() - started,
      };
    },

    async get(rootHash: string, keyHex: string): Promise<string> {
      const { Indexer } = await sdk();
      // `downloadToBlob` exists but hands back a wrapper whose inner File is null under Node,
      // so the documented file path is used. Downloads happen on the client side, never in
      // the enclave, so touching the filesystem here costs nothing architecturally.
      const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { resolve } = await import('node:path');
      const dir = mkdtempSync(resolve(tmpdir(), '0g-storage-'));
      const path = resolve(dir, 'blob.bin');
      try {
        const err = await new Indexer(indexerUrl).download(rootHash, path, true);
        if (err !== null) throw new Error(`0G Storage download: ${err}`);
        return decryptBlob(readFileSync(path), keyHex);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export interface StorageSelectionEnv {
  OG_STORAGE?: string;
  OG_RPC_URL?: string;
  OG_PRIVATE_KEY?: string;
  OG_STORAGE_INDEXER?: string;
}

/**
 * Opt-in, like the live payment rails: storage costs faucet credit on every job, so a run
 * that did not ask for it does not get billed for it. Returns null when it is off — the
 * caller then reports "no storage" rather than inventing a root hash.
 */
export function selectStorageBackend(env: StorageSelectionEnv): StorageBackend | null {
  if (env.OG_STORAGE !== '1' && env.OG_STORAGE !== 'true') return null;
  if (!env.OG_RPC_URL || !env.OG_PRIVATE_KEY) return null;
  return createZeroGStorage({
    rpcUrl: env.OG_RPC_URL,
    privateKey: env.OG_PRIVATE_KEY,
    indexerUrl: env.OG_STORAGE_INDEXER,
  });
}
