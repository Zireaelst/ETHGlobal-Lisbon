// P0(e) — ERC-8004 register + read on Base Sepolia.
//
// Uses the canonical ERC-8004 (Trustless Agents) IdentityRegistry reference deployment
// from https://github.com/erc-8004/erc-8004-contracts, live on Base Sepolia at
// ERC8004_IDENTITY (see .env). This is an ERC-721-based registry: `register()`
// mints an agentId NFT to the caller and optionally stores arbitrary key/value
// metadata (bytes) alongside it in the same tx. We register Bob as an agent with
// placeholder skill/endpoint/pubkey metadata, then read it all back to confirm the
// round trip.
import { ethers } from 'ethers';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).split('#')[0].trim()];
    })
);

const REGISTRY_ADDR = env.ERC8004_IDENTITY;
if (!REGISTRY_ADDR) throw new Error('ERC8004_IDENTITY is empty in .env');

// Minimal ABI slice for what we need (from erc-8004-contracts abis/IdentityRegistry.json).
const ABI = [
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const provider = new ethers.JsonRpcProvider(env.BASE_RPC_URL);
const wallet = new ethers.Wallet(env.PRIVATE_KEY_BOB, provider);
const registry = new ethers.Contract(REGISTRY_ADDR, ABI, wallet);

console.log('--- network / signer ---');
const net = await provider.getNetwork();
console.log('chainId:', net.chainId.toString());
console.log('registry:', REGISTRY_ADDR);
console.log('agent (Bob) address:', wallet.address);
const balance = await provider.getBalance(wallet.address);
console.log('balance:', ethers.formatEther(balance), 'ETH');

// Placeholder agent data (Phase 2 will fill these with real skill/endpoint/pubkey).
const agentURI = 'ipfs://placeholder-bob-agent-card';
const skill = 'confidential-inference-relay';
const endpoint = 'https://bob-agent.example.invalid/task';
// Placeholder ECIES/secp256k1 pubkey bytes (33-byte compressed placeholder, not real key material).
const pubkey = '0x02' + '11'.repeat(32);

const metadata = [
  { metadataKey: 'skill', metadataValue: ethers.toUtf8Bytes(skill) },
  { metadataKey: 'endpoint', metadataValue: ethers.toUtf8Bytes(endpoint) },
  { metadataKey: 'pubkey', metadataValue: pubkey },
];

console.log('--- register() ---');
const tx = await registry['register(string,(string,bytes)[])'](agentURI, metadata);
console.log('tx hash:', tx.hash);
const receipt = await tx.wait();
console.log('tx mined, block:', receipt.blockNumber, 'status:', receipt.status);

let agentId;
for (const log of receipt.logs) {
  try {
    const parsed = registry.interface.parseLog(log);
    if (parsed?.name === 'Registered') {
      agentId = parsed.args.agentId;
      console.log('Registered event -> agentId:', agentId.toString(), 'owner:', parsed.args.owner);
    }
  } catch {
    // not our event, ignore
  }
}
if (agentId === undefined) throw new Error('Registered event not found in receipt logs');

console.log('--- read back ---');
const owner = await registry.ownerOf(agentId);
const uri = await registry.tokenURI(agentId);
const skillBytes = await registry.getMetadata(agentId, 'skill');
const endpointBytes = await registry.getMetadata(agentId, 'endpoint');
const pubkeyBytes = await registry.getMetadata(agentId, 'pubkey');

const readSkill = ethers.toUtf8String(skillBytes);
const readEndpoint = ethers.toUtf8String(endpointBytes);
const readPubkey = ethers.hexlify(pubkeyBytes);

console.log('owner:', owner);
console.log('tokenURI:', uri);
console.log('skill:', readSkill);
console.log('endpoint:', readEndpoint);
console.log('pubkey:', readPubkey);

console.log('--- verify round-trip ---');
const ok =
  owner.toLowerCase() === wallet.address.toLowerCase() &&
  uri === agentURI &&
  readSkill === skill &&
  readEndpoint === endpoint &&
  readPubkey.toLowerCase() === pubkey.toLowerCase();

console.log(ok ? 'PASS: register + read round-trip matched.' : 'FAIL: mismatch, see values above.');
if (!ok) process.exit(1);
