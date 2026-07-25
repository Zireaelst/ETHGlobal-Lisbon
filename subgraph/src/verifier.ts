// subgraph/src/verifier.ts — Verifier.sol mapping'i.
//
// İtibarın kaynağı BURASI: `verifiedDeliveries` yalnızca kontratın yaydığı
// `JobVerified` ile artıyor. Kullanıcı girdisi, yorum, yıldız yok — sayaç ancak
// ödenmiş ve çift imzayla doğrulanmış bir işle artabiliyor.
// (CLAUDE.md §11 sınırı: bu "Sybil-proof" DEĞİL — şişirmek pahalı, imkânsız değil.)
//
// `agentId` event'te `uint256` geliyor, `Agent.id` de ondalık string; eşleşme tek
// satır: `agentId.toString()`. Bu, subgraph/README.md Karar 2'nin sebebi — bytes32
// yayılsaydı burada little-endian dönüşüm yapmak ve yanlış yaparsak Job'ları
// hiçbir Agent'a bağlayamamak riski olurdu.

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
  // `job == null` kısa devre yaptığı için `job.status` yalnızca var olan entity'de
  // okunuyor — atanmamış alan okumak graph-node'u düşürür (bkz. handleJobRejected).
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

  // Aynı intentHash iki kez doğrulanamaz (kontrat AlreadyVerified veriyor), ama
  // önce reddedilip sonra doğrulanan bir iş olabilir — sayacı bir kez artır.
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
  // DİKKAT: yeni bir entity'de HENÜZ ATANMAMIŞ non-null alanı okumak graph-node'u
  // düşürüyor ("indexing_error"). Bu yüzden `job.status`'a ancak var olan bir
  // entity üzerinde bakıyoruz — `isNew` bayrağı tam olarak bunun için.
  let isNew = false;
  if (job == null) {
    job = new Job(event.params.intentHash);
    job.price = BigInt.zero(); // reddedilen işin fiyatı event'te taşınmıyor
    isNew = true;
  }
  job.agent = agent.id;
  job.client = event.params.client;
  // Zaten doğrulanmış bir işi sonradan gelen bir ret KAYDI bozmamalı.
  if (isNew || job.status != 'VERIFIED') {
    job.status = 'REJECTED';
    job.rejectionCode = rejectionName(event.params.code);
  }
  job.timestamp = event.block.timestamp;
  job.block = event.block.number;
  job.txHash = event.transaction.hash;
  job.save();

  // Her ret bir DENEMEDİR — tekrarlananlar da sayılır (fraud demosu bunu gösteriyor).
  agent.rejectedAttempts = agent.rejectedAttempts + 1;
  agent.updatedAt = event.block.timestamp;
  agent.save();

  const registry = getRegistry();
  registry.rejectedJobs = registry.rejectedJobs + 1;
  registry.save();
}
