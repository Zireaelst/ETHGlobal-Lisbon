# contracts — Foundry

```bash
cd contracts
forge build
forge test
forge test --match-contract IntentLibTest -vv
```

`test/fixtures/intent.json` **elle düzenlenmez** — `pnpm gate:P1-A` onu TypeScript
tarafından üretir. Böylece Solidity testleri uydurma değerlere değil, agent'ların
gerçekten kullandığı koda karşı koşar.

## Durum

| Dosya | Durum |
|---|---|
| `src/IntentLib.sol` | ✅ `intentHash`, EIP-712 domain/struct/digest, `recoverSigner`. TS ile birebir (`gate:P1-A`). |
| `src/Verifier.sol` | 🔴 **Stub.** Asıl doğrulama mantığı P3-A'da (BUILD-PLAN §P3-A / CLAUDE.md §3.5). |

## P3-A yazılırken uyulacak bağlayıcı kararlar

### 1. `JobVerified` / `JobRejected` `agentId`'yi `uint256` yayar

EIP-712 `Intent` yapısında `agentId` **`bytes32`** kalır — imza şeması değişmiyor
(BUILD-PLAN §2.3). Ama event onu doğal tipiyle yaymalı:

```solidity
emit JobVerified(i.intentHash, outputHash, i.client, uint256(i.agentId), i.price);
```

Gerekçe subgraph tarafında: `uint256` yayarsak mapping `Agent.load(agentId.toString())`
ile biter. `bytes32` yayarsak mapping `BigInt.fromUnsignedBytes()` ile little-endian
dönüşüm yapmak zorunda kalır ve yanlış yapılırsa `Job` kayıtları hiçbir `Agent`'a
bağlanmadan **sessizce** boş kalır. Solidity'deki `uint256(bytes32)` cast'i EVM
big-endian olduğu için kayıpsız — riskli dönüşümü güvenli olduğu yere taşıyoruz.
Ayrıntı: [`../subgraph/README.md`](../subgraph/README.md) Karar 2.

### 2. `verifyJobLenient` revert etmez, `JobRejected` yayar

Fraud butonu bu yolu çağırır: revert eden bir tx jüriye Basescan'de kötü görünür ve
subgraph onu indeksleyemez. Settlement yolu her zaman katı `verifyJob`'u kullanır.

### 3. Seal imzasının `v`'si dışarıdan gelir

`agent-wrapper` imzayı 64-byte R‖S olarak döndürüyor, `v` atılıyor (CLAUDE.md §3.1B).
`v` off-chain brute-force edilir (önce 27, tutmazsa 28) ve kontrata parametre olarak
geçilir. Kontrat `v`'yi kendisi denemez.

### 4. `setEnclaveSigner` 36 saat MUTABLE kalır

Konteyner yeniden başlarsa seal key değişir; setter kapalıysa demo kurtarılamaz
(BUILD-PLAN P3-C kurtarma provası).
