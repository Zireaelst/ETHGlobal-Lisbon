// subgraph/src/entities.ts — helpers shared by the two mappings (identity + verifier).
//
// BOTH data sources must be able to create an Agent: a job can be verified before the agent's
// registration is indexed (the Verifier's startBlock is ahead of the registry's). Hence
// `getOrCreateAgent` lives in one place and is called from both sides.

import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Agent, Registry } from '../generated/schema';

export const REGISTRY_ID = 'global';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function getRegistry(): Registry {
  let registry = Registry.load(REGISTRY_ID);
  if (registry == null) {
    registry = new Registry(REGISTRY_ID);
    registry.agentCount = 0;
    registry.verifiedJobs = 0;
    registry.rejectedJobs = 0;
  }
  return registry as Registry;
}

/**
 * Get the Agent, creating it when absent.
 *
 * `registeredBlock == 0` means "no Registered event seen yet". In a real register() receipt
 * Transfer arrives BEFORE Registered; and the Verifier side may encounter an agent before its
 * registration. Hence this is order-independent.
 */
export function getOrCreateAgent(agentId: BigInt, event: ethereum.Event): Agent {
  const id = agentId.toString();
  let agent = Agent.load(id);
  if (agent == null) {
    agent = new Agent(id);
    agent.owner = Bytes.fromHexString(ZERO_ADDRESS) as Bytes;
    agent.skills = [];
    agent.registeredAt = event.block.timestamp;
    agent.registeredBlock = BigInt.zero();
    agent.updatedAt = event.block.timestamp;
    agent.verifiedDeliveries = 0;
    agent.rejectedAttempts = 0;
  }
  return agent as Agent;
}
