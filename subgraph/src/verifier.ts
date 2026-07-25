// subgraph/src/verifier.ts — Verifier.sol mapping'i.
//
// THIS is the source of reputation: `verifiedDeliveries` increments only on the `JobVerified`
// the contract emits. No user input, no reviews, no stars — the counter can only move on a job
// that was paid for and verified by two signatures.
// (CLAUDE.md §11 boundary: this is NOT "Sybil-proof" — inflating it is expensive, not impossible.)
//
// `agentId` arrives as a `uint256` in the event and `Agent.id` is a decimal string; the match is
// one line: `agentId.toString()`. This is the reason for Decision 2 in subgraph/README.md — had
// bytes32 been emitted we would have to do a little-endian conversion here, and getting it wrong
// would leave Jobs attached to no Agent at all.

import { BigInt } from '@graphprotocol/graph-ts';
import { JobRejected, JobVerified } from '../generated/Verifier/Verifier';
import { Job } from '../generated/schema';
import { getOrCreateAgent, getRegistry } from './entities';

/** Verifier.sol'deki CODE_* sabitleri. */
function rejectionName(code: i32): string {
  if (code == 1) return 'Expired';
  if (code == 2) return 'AlreadyVerified';
  if (code == 3) return 'BadClientSig';
  if (code == 4) return 'BadEnclaveSig';
  if (code == 5) return 'MatchFalse';
  return 'Unknown';
}

export function handleJobVerified(event: JobVerified): void {
  const agent = getOrCreateAgent(event.params.agentId, event);

  let job = Job.load(event.params.intentHash);
  // Because `job == null` short-circuits, `job.status` is only read on an existing entity —
  // reading an unassigned field takes graph-node down (see handleJobRejected).
  const firstVerification = job == null || job.status != 'VERIFIED';
  if (job == null) {
    job = new Job(event.params.intentHash);
  }
  job.agent = agent.id;
  job.client = event.params.client;
  job.outputHash = event.params.outputHash;
  job.status = 'VERIFIED';
  job.rejectionCode = null;
  job.price = event.params.price;
  job.timestamp = event.block.timestamp;
  job.block = event.block.number;
  job.txHash = event.transaction.hash;
  job.save();

  // The same intentHash cannot be verified twice (the contract returns AlreadyVerified), but a
  // job may be rejected first and verified later — increment the counter exactly once.
  if (firstVerification) {
    agent.verifiedDeliveries = agent.verifiedDeliveries + 1;
    const registry = getRegistry();
    registry.verifiedJobs = registry.verifiedJobs + 1;
    registry.save();
  }
  agent.updatedAt = event.block.timestamp;
  agent.save();
}

export function handleJobRejected(event: JobRejected): void {
  const agent = getOrCreateAgent(event.params.agentId, event);

  let job = Job.load(event.params.intentHash);
  // CAREFUL: reading a non-null field that has NOT YET BEEN ASSIGNED on a new entity takes
  // graph-node down ("indexing_error"). That is why we only look at `job.status` on an existing
  // entity — the `isNew` flag exists precisely for this.
  let isNew = false;
  if (job == null) {
    job = new Job(event.params.intentHash);
    job.price = BigInt.zero(); // a rejected job's price is not carried in the event
    isNew = true;
  }
  job.agent = agent.id;
  job.client = event.params.client;
  // A later rejection RECORD must not corrupt a job that was already verified.
  if (isNew || job.status != 'VERIFIED') {
    job.status = 'REJECTED';
    job.rejectionCode = rejectionName(event.params.code);
  }
  job.timestamp = event.block.timestamp;
  job.block = event.block.number;
  job.txHash = event.transaction.hash;
  job.save();

  // Every rejection is an ATTEMPT — repeats count too (the fraud demo shows this).
  agent.rejectedAttempts = agent.rejectedAttempts + 1;
  agent.updatedAt = event.block.timestamp;
  agent.save();

  const registry = getRegistry();
  registry.rejectedJobs = registry.rejectedJobs + 1;
  registry.save();
}
