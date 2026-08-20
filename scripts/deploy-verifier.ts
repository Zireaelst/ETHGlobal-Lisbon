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

/**
 * The chains this contract can be deployed to.
 *
 * BASE IS THE VERDICT. X Layer is a MIRROR: the same bytecode, the same rules, deployed a
 * second time so the verdict can be re-checked on a gas-free chain. It is NOT a second source
 * of truth, and nothing reads it to decide anything — discovery cannot even live there,
 * because The Graph does not index X Layer testnet (only its mainnet). Anyone tempted to make
 * it authoritative should read that sentence twice.
 *
 * `gasToken` exists because it is NOT ETH everywhere: X Layer charges gas in OKB, and a
 * deploy log that prints "ETH" on a chain that has none is how a funded wallet gets mistaken
 * for an empty one.
 */
interface TargetChain {
  key: string;
  chainId: number;
  name: string;
  rpcEnv: string;
  rpcDefault?: string;
  /** The .env key holding the deployed address — one per chain, so neither overwrites the other. */
  addressEnv: 'VERIFIER_ADDRESS' | 'VERIFIER_ADDRESS_XLAYER';
  /** Set only for the chain the subgraph indexes. X Layer has none: nothing indexes it. */
  blockEnv?: 'VERIFIER_DEPLOY_BLOCK';
  explorer: string;
  gasToken: string;
  /** `forge verify-contract --chain <this>`, when the explorer supports it. */
  forgeChain?: string;
}

const CHAINS: Record<string, TargetChain> = {
  base: {
    key: 'base',
    chainId: 84532,
    name: 'Base Sepolia',
    rpcEnv: 'BASE_RPC_URL',
    addressEnv: 'VERIFIER_ADDRESS',
    blockEnv: 'VERIFIER_DEPLOY_BLOCK',
    explorer: BASESCAN,
    gasToken: 'ETH',
    forgeChain: 'base-sepolia',
  },
  xlayer: {
    key: 'xlayer',
    chainId: 1952,
    name: 'X Layer testnet',
    rpcEnv: 'XLAYER_RPC_URL',
    rpcDefault: 'https://testrpc.xlayer.tech/terigon',
    addressEnv: 'VERIFIER_ADDRESS_XLAYER',
    explorer: 'https://www.oklink.com/xlayer-test',
    gasToken: 'OKB',
  },
};

function selectChain(): TargetChain {
  const flagIndex = process.argv.indexOf('--chain');
  const raw = (
    (flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined) ??
    process.env.TARGET_CHAIN ??
    'base'
  )
    .trim()
    .toLowerCase();
  const chain = CHAINS[raw];
  if (!chain) {
    throw new Error(
      `unknown --chain "${raw}" — expected one of: ${Object.keys(CHAINS).join(', ')}. ` +
        'Refusing to guess: deploying to the wrong chain writes an address the whole demo then trusts.',
    );
  }
  return chain;
}

async function main(): Promise<void> {
  loadDotenv();
  const cfg = loadConfig();
  const root = repoRoot();

  const chain = selectChain();
  const CHAIN_ID = chain.chainId;
  const rpcUrl = (process.env[chain.rpcEnv]?.trim() || chain.rpcDefault) ?? '';
  if (!rpcUrl) throw new Error(`${chain.rpcEnv} is empty — no RPC for ${chain.name}`);

  console.log(`Target    : ${chain.name} (chainId ${CHAIN_ID}, gas in ${chain.gasToken})`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(cfg.PRIVATE_KEY_DEPLOYER, provider);
  const alice = new ethers.Wallet(cfg.PRIVATE_KEY_ALICE);

  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(`chainId is ${net.chainId}, expected ${CHAIN_ID} — ${chain.rpcEnv} points at the wrong network`);
  }

  const artifactPath = resolve(root, 'contracts/out/Verifier.sol/Verifier.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: ethers.InterfaceAbi;
    bytecode: { object: string };
  };

  // --- already deployed? ---
  const existing = optionalEnv(chain.addressEnv);
  if (existing) {
    const code = await provider.getCode(existing);
    if (code !== '0x') {
      console.log(`Already deployed: ${existing}`);
      await ensureClientRegistered(existing, artifact.abi, deployer, alice.address);
      return;
    }
    console.log(`${chain.addressEnv} is set (${existing}) but there is no code there — redeploying.`);
  }

  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance : ${ethers.formatEther(balance)} ${chain.gasToken}`);
  if (balance === 0n) {
    throw new Error(
      `deployer ${deployer.address} holds no ${chain.gasToken} on ${chain.name}` +
        (chain.key === 'xlayer' ? ' — fund it at https://web3.okx.com/xlayer/faucet' : ''),
    );
  }

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
  console.log(`Block     : ${block}`);
  console.log(`Explorer  : ${chain.explorer}/address/${address}`);

  setEnvValue(chain.addressEnv, address);
  const written: string[] = [chain.addressEnv];
  if (chain.blockEnv) {
    // The subgraph's Verifier data source starts from this block. Only Base has one —
    // The Graph does not index X Layer testnet, so a block number there indexes nothing.
    setEnvValue(chain.blockEnv, String(block));
    written.push(chain.blockEnv);
  }
  console.log(`\n.env updated: ${written.join(', ')}`);

  await ensureClientRegistered(address, artifact.abi, deployer, alice.address, chain.explorer);

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
      ...(chain.forgeChain
        ? [
            `  1. Source verification (requires ETHERSCAN_API_KEY):`,
            `     cd contracts && forge verify-contract ${address} src/Verifier.sol:Verifier \\`,
            `       --chain ${chain.forgeChain} --constructor-args $(cast abi-encode "constructor(uint256)" ${CHAIN_ID})`,
          ]
        : [`  1. Source verification: ${chain.name} has no forge --chain alias; verify via ${chain.explorer}`]),
      ...(chain.blockEnv
        ? [`  2. Add the Verifier data source to the subgraph (startBlock ${block})`]
        : [`  2. NO subgraph step — The Graph does not index ${chain.name}. Discovery stays on Base.`]),
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
  explorer: string = BASESCAN,
): Promise<void> {
  const verifier = new ethers.Contract(address, abi, deployer);
  const already = (await verifier.registeredClient(client)) as boolean;
  if (already) {
    console.log(`registeredClient[${client}] is already true`);
    return;
  }
  const tx = await verifier.setRegisteredClient(client, true);
  await tx.wait();
  console.log(`registeredClient[${client}] = true  ${explorer}/tx/${tx.hash}`);
}

await main();
