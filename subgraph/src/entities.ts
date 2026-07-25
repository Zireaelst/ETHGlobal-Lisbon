// subgraph/src/entities.ts — iki mapping'in (identity + verifier) paylaştığı yardımcılar.
//
// Agent'ı HER İKİ data source da oluşturabilmeli: bir iş, agent'ın kaydı indekslenmeden
// önce doğrulanabilir (Verifier'ın startBlock'u registry'ninkinden ileride). O yüzden
// `getOrCreateAgent` tek yerde ve her iki taraftan çağrılıyor.

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
 * Agent'ı getir, yoksa oluştur.
 *
 * `registeredBlock == 0` "henüz Registered event'i görülmedi" demektir. Gerçek bir
 * register() receipt'inde Transfer, Registered'dan ÖNCE geliyor; ayrıca Verifier
 * tarafı da kayıttan önce bir agent'a rastlayabilir. Bu yüzden sıradan bağımsız.
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
