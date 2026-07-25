// guard.ts — settlement'ı `JobVerified`'a YAPISAL olarak bağlar.
//
// BUILD-PLAN P4 kuralı: "settlement JobVerified'tan SONRA". Bunu her backend'in
// kendi iyi niyetine bırakmak yerine tek bir kapıdan geçiriyoruz: settle çağıran
// backend önce buraya uğramak zorunda, burası da ZİNCİRE bakıp o tx'in gerçekten
// bu `intentHash` için `JobVerified` yaydığını doğruluyor.
//
// Neden sadece "tx hash verildi mi" bakmıyoruz: Bob doğrulanmamış bir iş için
// rastgele bir tx hash'i uydurup settle tetikleyebilirdi. Event'i okumak bunu
// imkânsız kılıyor.

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
 * `jobVerifiedTx`'in bu `intentHash` için `JobVerified` yaydığını doğrula.
 *
 * @throws SettlementNotAuthorizedError tx yoksa, başarısızsa, event yoksa ya da
 *         event başka bir işe aitse.
 */
export async function assertJobVerified(
  provider: JsonRpcProvider,
  verifierAddress: string,
  jobVerifiedTx: string,
  intentHash: string,
): Promise<JobVerifiedProof> {
  if (!jobVerifiedTx) {
    throw new SettlementNotAuthorizedError(
      'settle() JobVerified tx referansı olmadan çağrıldı — ödeme yalnızca doğrulanmış işler için serbest bırakılır',
    );
  }

  const receipt = await provider.getTransactionReceipt(jobVerifiedTx);
  if (!receipt) {
    throw new SettlementNotAuthorizedError(`JobVerified tx bulunamadı: ${jobVerifiedTx}`);
  }
  if (receipt.status !== 1) {
    throw new SettlementNotAuthorizedError(`JobVerified tx başarısız (status=${receipt.status}): ${jobVerifiedTx}`);
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
    `${jobVerifiedTx} işlemi ${intentHash} için JobVerified yaymamış — ` +
      'iş doğrulanmadı, ödeme settle EDİLMEYECEK',
  );
}
