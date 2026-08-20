# Bob'u Railway'e deploy etmek

Bob'un (`packages/bob-agent`) public bir HTTPS adresine çıkması gereken tek sebep var:
**OKX.AI'ye ASP olarak kaydolmak** `localhost`'u reddediyor ve endpoint'i kalıcı olarak
zincire yazıyor (`okx-ai/references/identity-register.md` §6). Demo ve 21 gate bunsuz da
çalışır — bu dosya yalnızca Faz E içindir.

> **Bu adım X Layer MAINNET'te kalıcı bir kayıtla sonuçlanır.** Deploy'un kendisi geri
> alınabilir; kayıt değil. Sırayı bozma: önce deploy, sonra doğrulama, en son kayıt.

---

## 0. Ön koşul: kod zaten hazır

İki değişiklik yapıldı, ikisi de varsayılan davranışı **değiştirmiyor**:

| Değişken | Varsayılan | Deploy'da |
|---|---|---|
| `BOB_HOST` | `127.0.0.1` (loopback — güvenli olan) | `0.0.0.0` |
| `PORT` | yok → `BOB_PORT` → `8801` | Railway atar |

`BOB_HOST` bilinçli olarak opt-in: her gate ve yerel demo, gerçek testnet anahtarları taşıyan
bir ajan çalıştırıyor; kazara `0.0.0.0`'a bağlanan bir süreç ağdaki her şeye açıktır.

---

## 0.5 Node sürümü — ilk deploy'u bu düşürdü

**Node 20.19+ ZORUNLU, tercih 22.** `.nvmrc` (`22`) ve `package.json` → `engines.node`
(`>=20.19 <25`) bunun için var; ikisi de yokken Nixpacks **Node 18**'e düştü ve container
hiç açılmadı:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module
  @noble/curves/secp256k1.js
  from @ethereumjs/util/dist/cjs/constants.js not supported.
Node.js v18.20.5
```

Sebep zincirin dibinde: `eth-crypto@4.1.0` → `@ethereumjs/util@10.1.1` → `@noble/curves@2.2.0`.
Bu son paket **ESM-only** (`"type": "module"`; `@noble/curves` 1.x sürümlerinin hepsi CJS).
CJS'ten ESM `require()` etmek ancak `require(esm)` desteğiyle çalışıyor — Node 22.12'de
açıldı, 20.19'a geri portlandı, **18'de yok**.

Yerelde görünmemesinin sebebi: geliştirme makinesi Node 22 çalıştırıyor, dolayısıyla aynı
kod sorunsuz açılıyor. Fark yalnızca container'da ortaya çıkıyor.

Doğrulama — build loglarında Node sürümünü gör; 18 yazıyorsa `.nvmrc` okunmamıştır ve
Railway → Variables'a `NIXPACKS_NODE_VERSION=22` eklemek gerekir.

---

## 1. Servisi oluştur

```bash
railway login
railway init            # veya: mevcut projeye `railway link`
railway up
```

Kök dizindeki `railway.json` build ve start komutlarını zaten taşıyor:

```
build : pnpm install --frozen-lockfile && pnpm build
start : node packages/bob-agent/dist/index.js
health: /health
```

`pnpm build` kökten `tsc -b` çalıştırır; bu, `@ca/shared` → `@ca/payment` →
`@ca/bob-binding` → `@ca/bob-agent` zincirinin tamamını derler. Next.js uygulaması bu
grafiğin dışında olduğu için Railway build'i onu **derlemez** — istenen de bu.

---

## 2. Ortam değişkenleri

Railway → Variables. `.env`'deki değerlerin **aynısı**, artı bu ikisi:

```
BOB_HOST=0.0.0.0
BOB_PUBLIC_URL=https://<railway-domaininiz>
```

Zorunlu olanlar (`packages/shared/src/config.ts` `coreSchema`, eksikse süreç adını söyleyerek
düşer): `BASE_RPC_URL`, `PRIVATE_KEY_ALICE`, `PRIVATE_KEY_BOB`, `PRIVATE_KEY_DEPLOYER`,
`ERC8004_IDENTITY`, `USDC_BASE_SEPOLIA`, `OG_RPC_URL`, `OG_PRIVATE_KEY`,
`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_NETWORK`, `BLOCKY402_URL`,
`BLOCKY402_FEE_PAYER`.

⚠️ **Passphrase / anahtar `#` içeriyorsa tırnak içine al.** dotenv tırnaksız `#` sonrasını
yorum sayar ve değeri sessizce kırpar — sonuç, yanlış anahtar gibi görünen bir 401.

---

## 3. Public domain — `.railway.internal` YETMEZ

Railway'in varsayılan `*.railway.internal` adresi **yalnızca proje içinden** erişilebilir.
OKX.AI'nin doğrulayıcısı dışarıdan bakar ve bunu reddeder.

**Settings → Networking → Public Networking → Generate Domain.**

---

## 4. Dışarıdan doğrula — kayıttan ÖNCE, üç kez

Kayıt endpoint'i **kalıcı olarak** zincire yazıyor. Yanlış URL'i düzeltmek yeni bir işlem
demek.

```bash
URL=https://<railway-domaininiz>

# 1) sağlık
curl -fsS "$URL/health" | jq .
#    → {"status":"healthy","agentId":"...","stage":"echo"}

# 2) agent card — DİKKAT: yol /card DEĞİL
curl -fsS "$URL/.well-known/agent-card.json" | jq '{agentId, skills, price, endpoint}'
#    → endpoint ALANI GERÇEK PUBLIC URL'İ GÖSTERMELİ, localhost değil.
#      Göstermiyorsa BOB_PUBLIC_URL yanlış/eksik.

# 3) ücretli uç pazarlıksız reddediyor mu (402 beklenir, 200 DEĞİL)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/task" \
  -H 'Content-Type: application/json' -d '{}'
```

**Üçünü de farklı bir ağdan tekrarla** (telefon hotspot'u yeterli). Yerel DNS ya da VPN'in
çözdüğü bir adres, OKX'in doğrulayıcısı için var olmayabilir.

---

## 5. Zincirdeki endpoint'i güncelle

`BOB_PUBLIC_URL` bugün `.env`'de **boş**, dolayısıyla ERC-8004 kaydına `localhost` yazılmış
durumda — `tests/gates/P2-A.ts:269-271` bunu zaten uyarı olarak basıyor.

```bash
BOB_PUBLIC_URL=https://<railway-domaininiz> pnpm gate:P2-A
```

Bu, Base Sepolia'daki `endpoint` metadata'sını gerçek URL'e çeker. **OKX kaydından önce
yapılmalı**, yoksa iki registry iki farklı endpoint gösterir.

---

## 6. Sonra: ASP kaydı

`ROADMAP.md` §E.2. Buradan sonrası geri alınamaz; ayrı onay gerektiriyor.

Kayıt için gerekenler, hazır olması gereken sırayla:

| Alan | Bu projedeki karşılığı |
|---|---|
| `--role` | `asp` |
| Servis tipi | `A2MCP` (HTTP endpoint + x402) |
| Endpoint | `https://<domain>/task` |
| Fiyat | Bob bugün **1.00 USDC** istiyor (`bob-agent/src/index.ts:531`, `amount: '1000000'`, 6 hane). OKX listelemesi **USDT** ister ve **tek sabit sayı** kabul eder. |
| Avatar | **ZORUNLU**, ≤1 MB, PNG/JPEG/WebP — link kabul edilmiyor |
| Ad / açıklama | ≤500 karakter |

⚠️ **Çift ücretlendirme tuzağı:** uç kendi x402 ücretini zaten alıyor. Pazaryeri listesindeki
fiyat ayrı bir tahsilat olarak okunuyorsa oraya `0` (ya da düşük bir vitrin rakamı) yaz.
Kinora bu sebeple 0.1 USDT ile listelenmiş.

⚠️ **Listeleme doğrulayıcısı servis açıklamasındaki `a2a` kelimesini "yanlış servis tipi"
sanıp blokluyor.** Bizim yolumuz `/task`, dolayısıyla güvendeyiz — ama açıklama metnine
`a2a` yazma.
