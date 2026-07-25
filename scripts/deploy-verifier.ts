// scripts/deploy-verifier.ts — deploys Verifier.sol to Base Sepolia (closing out P3-A).
//
// Why TS rather than a Foundry script: so that writing the address + block to .env after the
// deploy, calling setRegisteredClient, and behaving idempotently (not redeploying when already
// deployed) all live in one place. Source verification is still `forge verify-contract`.
//
// Idempotent: when VERIFIER_ADDRESS is populated and there is code at that address, it does NOT
// redeploy.

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
    throw new Error(`chainId is ${net.chainId}, expected ${CHAIN_ID} — BASE_RPC_URL points at the wrong network`);
  }

  const artifactPath = resolve(root, 'contracts/out/Verifier.sol/Verifier.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: ethers.InterfaceAbi;
    bytecode: { object: string };
  };

  // --- already deployed? ---
  const existing = optionalEnv('VERIFIER_ADDRESS');
  if (existing) {
    const code = await provider.getCode(existing);
    if (code !== '0x') {
      console.log(`Already deployed: ${existing}`);
      await ensureClientRegistered(existing, artifact.abi, deployer, alice.address);
      return;
    }
    console.log(`VERIFIER_ADDRESS dolu (${existing}) ama o adreste kod yok — yeniden deploy ediliyor.`);
  }

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance : ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);

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
  // The subgraph's Verifier data source will start from this block.
  setEnvValue('VERIFIER_DEPLOY_BLOCK', String(block));
  console.log('\n.env updated: VERIFIER_ADDRESS, VERIFIER_DEPLOY_BLOCK');

  await ensureClientRegistered(address, artifact.abi, deployer, alice.address);

  // Sanity check: the domain separator must be derived from the contract's OWN address.
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
    throw new Error(`DOMAIN_SEPARATOR mismatch:\n  on chain ${onChainDomain}\n  expected ${expectedDomain}`);
  }
  console.log(`DOMAIN_SEPARATOR verified: ${onChainDomain}`);

  console.log(
    [
      '',
      'Next steps:',
      `  1. Source verification (requires ETHERSCAN_API_KEY):`,
      `     cd contracts && forge verify-contract ${address} src/Verifier.sol:Verifier \\`,
      `       --chain base-sepolia --constructor-args $(cast abi-encode "constructor(uint256)" ${CHAIN_ID})`,
      `  2. Subgraph'a Verifier data source ekle (startBlock ${block})`,
      `  3. P3-C: setEnclaveSigner(agentId, sealKey)`,
    ].join('\n'),
  );
}

/** Register Alice as a client if she is not already — otherwise the contract returns BadClientSig. */
async function ensureClientRegistered(
  address: string,
  abi: ethers.InterfaceAbi,
  deployer: ethers.Wallet,
  client: string,
): Promise<void> {
  const verifier = new ethers.Contract(address, abi, deployer);
  const already = (await verifier.registeredClient(client)) as boolean;
  if (already) {
    console.log(`registeredClient[${client}] is already true`);
    return;
  }
  const tx = await verifier.setRegisteredClient(client, true);
  await tx.wait();
  console.log(`registeredClient[${client}] = true  ${BASESCAN}/tx/${tx.hash}`);
}

await main();
