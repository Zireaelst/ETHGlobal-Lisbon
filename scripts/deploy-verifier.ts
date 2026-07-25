// scripts/deploy-verifier.ts — Verifier.sol'ü Base Sepolia'ya deploy eder (P3-A kapanışı).
//
// Neden Foundry script değil de TS: deploy'dan sonra .env'e adres + blok yazmak,
// setRegisteredClient çağırmak ve idempotent davranmak (zaten deploy edilmişse
// tekrar etmemek) tek yerde toplansın diye. Kaynak doğrulaması yine `forge verify-contract`.
//
// Idempotent: VERIFIER_ADDRESS doluysa ve o adreste kod varsa yeniden deploy ETMEZ.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers } from 'ethers';

import { loadConfig, loadDotenv, optionalEnv, repoRoot } from '../packages/shared/src/config.js';
import { setEnvValue } from '../tests/gates/_env-write.js';

const BASESCAN = 'https://sepolia.basescan.org';
const CHAIN_ID = 84532;

async function main(): Promise<void> {
  loadDotenv();
  const cfg = loadConfig();
  const root = repoRoot();

  const provider = new ethers.JsonRpcProvider(cfg.BASE_RPC_URL);
  const deployer = new ethers.Wallet(cfg.PRIVATE_KEY_DEPLOYER, provider);
  const alice = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE);

  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(`chainId ${net.chainId}, beklenen ${CHAIN_ID} — BASE_RPC_URL yanlış ağa bakıyor`);
  }

  const artifactPath = resolve(root, 'contracts/out/Verifier.sol/Verifier.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: ethers.InterfaceAbi;
    bytecode: { object: string };
  };

  // --- zaten deploy edilmiş mi? ---
  const existing = optionalEnv('VERIFIER_ADDRESS');
  if (existing) {
    const code = await provider.getCode(existing);
    if (code !== '0x') {
      console.log(`Zaten deploy edilmiş: ${existing}`);
      await ensureClientRegistered(existing, artifact.abi, deployer, alice.address);
      return;
    }
    console.log(`VERIFIER_ADDRESS dolu (${existing}) ama o adreste kod yok — yeniden deploy ediliyor.`);
  }

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Bakiye  : ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  // constructor(uint256 chainId) — EIP-712 domain'i buradan kuruluyor.
  const contract = await factory.deploy(CHAIN_ID);
  const tx = contract.deploymentTransaction();
  console.log(`Deploy tx: ${tx?.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = tx ? await provider.getTransactionReceipt(tx.hash) : null;
  const block = receipt?.blockNumber ?? (await provider.getBlockNumber());

  console.log(`\nVerifier  : ${address}`);
  console.log(`Blok      : ${block}`);
  console.log(`Basescan  : ${BASESCAN}/address/${address}`);

  setEnvValue('VERIFIER_ADDRESS', address);
  // Subgraph'ın Verifier data source'u bu bloktan başlayacak.
  setEnvValue('VERIFIER_DEPLOY_BLOCK', String(block));
  console.log('\n.env güncellendi: VERIFIER_ADDRESS, VERIFIER_DEPLOY_BLOCK');

  await ensureClientRegistered(address, artifact.abi, deployer, alice.address);

  // Sağlık kontrolü: domain separator kontratın KENDİ adresinden türetilmiş olmalı.
  const verifier = new ethers.Contract(address, artifact.abi, provider);
  const onChainDomain = (await verifier.DOMAIN_SEPARATOR()) as string;
  const expectedDomain = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        ethers.keccak256(
          ethers.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
        ),
        ethers.keccak256(ethers.toUtf8Bytes('ConfidentialAgents')),
        ethers.keccak256(ethers.toUtf8Bytes('1')),
        CHAIN_ID,
        address,
      ],
    ),
  );
  if (onChainDomain !== expectedDomain) {
    throw new Error(`DOMAIN_SEPARATOR uyuşmuyor:\n  zincir  ${onChainDomain}\n  beklenen ${expectedDomain}`);
  }
  console.log(`DOMAIN_SEPARATOR doğrulandı: ${onChainDomain}`);

  console.log(
    [
      '',
      'Sonraki adımlar:',
      `  1. Kaynak doğrulaması (ETHERSCAN_API_KEY gerekiyor):`,
      `     cd contracts && forge verify-contract ${address} src/Verifier.sol:Verifier \\`,
      `       --chain base-sepolia --constructor-args $(cast abi-encode "constructor(uint256)" ${CHAIN_ID})`,
      `  2. Subgraph'a Verifier data source ekle (startBlock ${block})`,
      `  3. P3-C: setEnclaveSigner(agentId, sealKey)`,
    ].join('\n'),
  );
}

/** Alice kayıtlı istemci değilse kaydet — kontrat aksi hâlde BadClientSig verir. */
async function ensureClientRegistered(
  address: string,
  abi: ethers.InterfaceAbi,
  deployer: ethers.Wallet,
  client: string,
): Promise<void> {
  const verifier = new ethers.Contract(address, abi, deployer);
  const already = (await verifier.registeredClient(client)) as boolean;
  if (already) {
    console.log(`registeredClient[${client}] zaten true`);
    return;
  }
  const tx = await verifier.setRegisteredClient(client, true);
  await tx.wait();
  console.log(`registeredClient[${client}] = true  ${BASESCAN}/tx/${tx.hash}`);
}

await main();
