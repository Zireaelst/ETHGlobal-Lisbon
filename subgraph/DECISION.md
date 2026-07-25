# P0-F kararı — ERC-8004 metadata: (a) on-chain key/value

> Bu dosyayı `pnpm gate:P0-F` üretir. Elle düzenlenirse kapı bir sonraki koşuda üzerine yazar.

## Karar: **(a)** — metadata doğrudan zincirde

BUILD-PLAN P0-F iki seçenek sunuyordu. Base Sepolia'daki canlı registry
`0x8004A818BFB912233c491871b3d84c89A494BD9e` **(a)**'yı destekliyor, o yüzden (a) seçildi:

- `register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata)`
  kayıt anında keyfi key/value metadata yazıyor.
- `setMetadata(uint256 agentId, string key, bytes value)` ile **sonradan güncellenebiliyor**
  — kapı bunu her koşuda canlı yazıp geri okuyarak kanıtlıyor. Yani P2-A gerçek
  skill/endpoint/eciesPubKey'i yeniden kayıt yapmadan yazabilir.

Sonuç: `skill`, `endpoint`, `eciesPubKey`, `stealthMetaAddress` zincirde durur;
subgraph hepsini indeksler. Agent card'ı HTTP'den çekmeye **gerek yok** (b yolu düştü).

## Subgraph için bağlayıcı bulgular

| Alan | Değer |
|---|---|
| Ağ | `base-sepolia` (chainId 84532) |
| Registry adresi | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Kontrat tipi | UUPS proxy (~130 byte kod) — **proxy adresi indekslenir**, implementasyon değişse de sabit |
| `startBlock` | **44584172** |

### İndekslenecek event'ler

Alan adları resmî ABI'den (github.com/erc-8004/erc-8004-contracts, abis/IdentityRegistry.json):

```
Registered(uint256 indexed agentId, string agentURI, address indexed owner)
MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)
URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)
Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
```

**Dikkat — `MetadataSet` tuzağı:** `indexedMetadataKey` `indexed string` olduğu için topic'te
anahtarın **keccak hash'i** durur, okunabilir hâli değil. Mapping'de `event.params.metadataKey`
(non-indexed) kullanılmalı; indexed alan üzerinden eşleştirmeye çalışmak sessizce boş metadata üretir.

Canlı bir `register()` tx'i şu logları yayıyor (blok 44584172 örneği):
`Transfer` (mint) → `MetadataUpdate` → `Registered` → her anahtar için bir `MetadataSet`.
Registry ayrıca istemediğimiz hâlde bir `agentWallet` metadata'sı ekliyor (değeri = owner adresi).

## Kayıtlı kimlikler

| Agent | agentId | Adres | Kayıt bloğu |
|---|---|---|---|
| Bob | `8429` | `0x4F5Cd20a4a3fBc9957f8D2A8D27D658B51Fda326` | 44584172 |
| Alice | `8431` | `0x827F728d4B7816019585891A1BCfAfF5aB93d823` | 44589222 |

Metadata şu an **yer tutucu**. Gerçek değerleri P2-A yazacak — `setMetadata` ile, yeniden kayıt yok.
