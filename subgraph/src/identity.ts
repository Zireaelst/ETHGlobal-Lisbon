// subgraph/src/identity.ts — ERC-8004 IdentityRegistry mapping'i.
//
// The two binding findings from DECISION.md are applied here:
//
// 1. Metadata does NOT arrive in `Registered` but in a separate `MetadataSet` event.
//    Indexing only Registered would produce agents with no skill and no endpoint.
//
// 2. `MetadataSet`'s indexed field (`indexedMetadataKey`) is an `indexed string`; the topic
//    holds the KECCAK HASH of the key, not its readable form. We read the key from the
//    non-indexed `metadataKey` field. Trying to match through the topic produces SILENTLY
//    empty metadata.
//
// Event order (confirmed from a live register() receipt):
//   Transfer(mint) -> MetadataUpdate -> Registered -> one MetadataSet per key
// So Transfer arrives BEFORE Registered. The handlers are therefore order-independent:
// whichever arrives first creates the Agent.

import { BigInt, log } from '@graphprotocol/graph-ts';
import {
  MetadataSet,
  Registered,
  Transfer,
  URIUpdated,
} from '../generated/IdentityRegistry/IdentityRegistry';
import { AgentMetadata } from '../generated/schema';
import { ZERO_ADDRESS, getOrCreateAgent, getRegistry } from './entities';

export function handleRegistered(event: Registered): void {
  const agent = getOrCreateAgent(event.params.agentId, event);

  const firstRegistration = agent.registeredBlock.equals(BigInt.zero());

  agent.owner = event.params.owner;
  agent.agentURI = event.params.agentURI;
  agent.registeredAt = event.block.timestamp;
  agent.registeredBlock = event.block.number;
  agent.updatedAt = event.block.timestamp;
  agent.save();

  if (firstRegistration) {
    const registry = getRegistry();
    registry.agentCount = registry.agentCount + 1;
    registry.save();
  }
}

export function handleMetadataSet(event: MetadataSet): void {
  const agent = getOrCreateAgent(event.params.agentId, event);

  // The readable key comes from the NON-INDEXED field (finding 2 above).
  const key = event.params.metadataKey;
  const value = event.params.metadataValue.toString();

  const metadataId = agent.id + '-' + key;
  let entry = AgentMetadata.load(metadataId);
  if (entry == null) {
    entry = new AgentMetadata(metadataId);
    entry.agent = agent.id;
    entry.key = key;
  }
  entry.value = value;
  entry.updatedAt = event.block.timestamp;
  entry.save();

  // Mirror known keys onto the Agent too — so discovery queries need no join.
  if (key == 'skill') {
    agent.skills = [value];
  } else if (key == 'endpoint') {
    agent.endpoint = value;
  } else if (key == 'eciesPubKey') {
    agent.eciesPubKey = value;
  } else if (key == 'stealthMetaAddress') {
    agent.stealthMetaAddress = value;
  } else if (key != 'agentWallet') {
    // The registry writes agentWallet itself; other unknown keys sit in AgentMetadata but are
    // not reflected in the schema — log them so they get noticed.
    log.info('unknown metadata key: {} (agent {})', [key, agent.id]);
  }

  agent.updatedAt = event.block.timestamp;
  agent.save();
}

export function handleURIUpdated(event: URIUpdated): void {
  const agent = getOrCreateAgent(event.params.agentId, event);
  agent.agentURI = event.params.newURI;
  agent.updatedAt = event.block.timestamp;
  agent.save();
}

export function handleTransfer(event: Transfer): void {
  // On a mint (from == 0) Registered will write the owner anyway; here we only track transfers
  // so that discovery does not show the wrong owner when an identity changes hands.
  if (event.params.from.toHexString() == ZERO_ADDRESS) return;

  const agent = getOrCreateAgent(event.params.tokenId, event);
  agent.owner = event.params.to;
  agent.updatedAt = event.block.timestamp;
  agent.save();
}
