// subgraph/src/identity.ts — ERC-8004 IdentityRegistry mapping'i.
//
// DECISION.md'deki iki bağlayıcı bulgu burada uygulanıyor:
//
// 1. Metadata `Registered`'da DEĞİL, ayrı `MetadataSet` event'inde geliyor.
//    Sadece Registered indekslersek skill'siz/endpoint'siz agent'lar üretiriz.
//
// 2. `MetadataSet`in indexed alanı (`indexedMetadataKey`) bir `indexed string`;
//    topic'te anahtarın KECCAK HASH'i durur, okunabilir hâli değil. Anahtarı
//    non-indexed `metadataKey` alanından okuyoruz. Topic üzerinden eşleştirmeye
//    çalışmak SESSİZCE boş metadata üretir.
//
// Olay sırası (canlı bir register() receipt'inden doğrulandı):
//   Transfer(mint) -> MetadataUpdate -> Registered -> her anahtar için MetadataSet
// Yani Transfer, Registered'dan ÖNCE geliyor. Handler'lar bu yüzden sıradan
// bağımsız: hangisi önce gelirse Agent'ı o oluşturur.

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

  // Okunabilir anahtar NON-INDEXED alandan gelir (yukarıdaki 2. bulgu).
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

  // Bilinen anahtarları Agent'a da yansıt — keşif sorguları join yapmasın.
  if (key == 'skill') {
    agent.skills = [value];
  } else if (key == 'endpoint') {
    agent.endpoint = value;
  } else if (key == 'eciesPubKey') {
    agent.eciesPubKey = value;
  } else if (key == 'stealthMetaAddress') {
    agent.stealthMetaAddress = value;
  } else if (key != 'agentWallet') {
    // agentWallet'ı registry kendisi yazıyor; onun dışındaki bilinmeyen anahtarlar
    // AgentMetadata'da duruyor ama şemaya yansımıyor — kaydı düşelim ki fark edilsin.
    log.info('bilinmeyen metadata anahtarı: {} (agent {})', [key, agent.id]);
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
  // Mint'te (from == 0) sahibi Registered zaten yazacak; burada sadece devirleri
  // takip ediyoruz ki kimlik el değiştirince keşif yanlış sahibi göstermesin.
  if (event.params.from.toHexString() == ZERO_ADDRESS) return;

  const agent = getOrCreateAgent(event.params.tokenId, event);
  agent.owner = event.params.to;
  agent.updatedAt = event.block.timestamp;
  agent.save();
}
