# subgraph — ERC-8004 keşif + doğrulanmış teslimat sayacı

Canlı: Subgraph Studio · sorgu adresi `.env` içinde `SUBGRAPH_QUERY_URL`.
Kapı: `pnpm gate:P2-B`. Zincirden çıkarılan bağlayıcı bulgular: [`DECISION.md`](./DECISION.md)
(bu dosyayı `pnpm gate:P0-F` üretir, elle düzenlenmez).

```bash
pnpm --filter @ca/subgraph compile     # graph codegen && graph build
# deploy (GRAPH_DEPLOY_KEY ve SUBGRAPH_SLUG .env'den):
npx graph deploy <slug> --node https://api.studio.thegraph.com/deploy/ \
  --deploy-key <key> --version-label v0.0.1
```

Testnet subgraph'ları Studio'da kalır, merkeziyetsiz ağa publish edilemez — bu bir
eksiklik değil, The Graph'ın testnet politikası.

---

## Karar 1 — `Agent.id` ondalık String, Bytes değil

`agentId` bir `uint256` (ERC-721 token id). AssemblyScript'te `BigInt → Bytes`
dönüşümü endianlığa duyarlı (`ByteArray.fromBigInt` little-endian döner), yanlış
yapılırsa **sessizce** yanlış id üretir. Ondalık string tek anlamlı ve sorguda
okunaklı: `agent(id: "8429")`.

The Graph'ın *"Bytes as IDs"* önerisi, doğası gereği bytes olan id'ler içindir
(adres, tx hash). NFT token id'si için ondalık string yaygın ve idiomatic.

`Job.id` doğal olarak `bytes32` (intentHash) olduğu için `Bytes` kaldı.

## Karar 2 — P3-A için BAĞLAYICI: `JobVerified` `agentId`'yi `uint256` yayacak

> Bu, Karar 1'in doğrudan sonucudur. `Verifier.sol` yazılırken uyulması zorunlu.

`Verifier.sol` içindeki EIP-712 `Intent` yapısı `agentId`'yi **`bytes32`** tutuyor
(BUILD-PLAN §2.3 böyle tanımlıyor, imza şeması değişmiyor). Ama **event** onu doğal
tipiyle yaymalı:

```solidity
event JobVerified(
    bytes32 indexed intentHash,
    bytes32 outputHash,
    address indexed client,
    uint256 indexed agentId,   // <-- bytes32 DEĞİL
    uint256 price
);

// yayınlarken:
emit JobVerified(i.intentHash, outputHash, i.client, uint256(i.agentId), i.price);
```

**Neden:** subgraph `Job`'u `Agent`'a bağlarken id'leri eşleştirmek zorunda.

- Event `uint256` yayarsa mapping tek satır: `Agent.load(event.params.agentId.toString())`.
  Dönüşüm yok, endianlık yok, sessiz hata yok.
- Event `bytes32` yayarsa mapping `bytes32 → BigInt → decimal` çevirmek zorunda kalır;
  `BigInt.fromUnsignedBytes()` **little-endian** beklediği için byte'ları ters çevirmek
  gerekir. Yanlış yapılırsa `Job` kayıtları hiçbir `Agent`'a bağlanmaz ve **sessizce**
  boş kalır — P2-B'de `MetadataSet` ile yakaladığımız hata sınıfının aynısı.

Solidity tarafındaki `uint256(bytes32)` cast'i EVM big-endian olduğu için **tam ve
kayıpsız**. Yani riskli dönüşümü, kayıpsız olduğu yere taşıyoruz.

`JobRejected` da aynı kuralı izler.

## İndekslenen event'ler

`IdentityRegistry` (proxy `0x8004A818BFB912233c491871b3d84c89A494BD9e`,
`startBlock` 44584172):

| Event | Handler | Ne veriyor |
|---|---|---|
| `Registered` | `handleRegistered` | kimlik, sahip, URI |
| `MetadataSet` | `handleMetadataSet` | **skill / endpoint / eciesPubKey** |
| `URIUpdated` | `handleURIUpdated` | URI güncellemesi |
| `Transfer` | `handleTransfer` | kimlik devri (mint hariç) |

`Verifier` data source'u P3-A deploy edildikten sonra eklenecek: `JobVerified` →
`verifiedDeliveries`, `JobRejected` → `rejectedAttempts`.

**Tuzak:** `MetadataSet`in indexed anahtarı bir `indexed string`; topic'te anahtarın
**keccak hash'i** durur. Mapping non-indexed `metadataKey` alanını okur.
