// guard.ts — binds settlement to `JobVerified` STRUCTURALLY.
//
// The BUILD-PLAN P4 rule: "settlement comes AFTER JobVerified". Rather than leaving that to
// each backend's good intentions, we route it through a single gate: a backend calling
// settle must come through here first, and here we read the CHAIN and confirm that the
// transaction really emitted `JobVerified` for this `intentHash`.
//
// Why we do not merely check "was a tx hash supplied": Bob could have invented a random tx
// hash for an unverified job and triggered settlement. Reading the event makes that
// impossible.

import { Interface, type JsonRpcProvider } from 'ethers';
import { SettlementNotAuthorizedError } from './index.js';

const JOB_VERIFIED_ABI = [
  'event JobVerified(bytes32 indexed intentHash, bytes32 outputHash, address indexed client, uint256 indexed agentId, uint256 price)',
];

export interface JobVerifiedProof {
  intentHash: string;
  outputHash: string;
  client: string;
  agentId: string;
  price: string;
  blockNumber: number;
  txHash: string;
}

/**
 * Verify that `jobVerifiedTx` emitted `JobVerified` for this `intentHash`.
 *
 * @throws SettlementNotAuthorizedError when the tx is missing, failed, has no such event, or
 *         the event belongs to a different job.
 */
export async function assertJobVerified(
  provider: JsonRpcProvider,
  verifierAddress: string,
  jobVerifiedTx: string,
  intentHash: string,
): Promise<JobVerifiedProof> {
  if (!jobVerifiedTx) {
    throw new SettlementNotAuthorizedError(
      'settle() was called without a JobVerified tx reference — payment is only released for verified jobs',
    );
  }

  const receipt = await provider.getTransactionReceipt(jobVerifiedTx);
  if (!receipt) {
    throw new SettlementNotAuthorizedError(`JobVerified tx not found: ${jobVerifiedTx}`);
  }
  if (receipt.status !== 1) {
    throw new SettlementNotAuthorizedError(`JobVerified tx failed (status=${receipt.status}): ${jobVerifiedTx}`);
  }

  const iface = new Interface(JOB_VERIFIED_ABI);
  const target = verifierAddress.toLowerCase();
  const wanted = intentHash.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== target) continue;
    let parsed;
    try {
      parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (parsed?.name !== 'JobVerified') continue;
    if ((parsed.args.intentHash as string).toLowerCase() !== wanted) continue;

    return {
      intentHash: parsed.args.intentHash as string,
      outputHash: parsed.args.outputHash as string,
      client: parsed.args.client as string,
      agentId: (parsed.args.agentId as bigint).toString(),
      price: (parsed.args.price as bigint).toString(),
      blockNumber: receipt.blockNumber,
      txHash: jobVerifiedTx,
    };
  }

  throw new SettlementNotAuthorizedError(
    `transaction ${jobVerifiedTx} did not emit JobVerified for ${intentHash} — ` +
      'the job was not verified, the payment WILL NOT settle',
  );
}
