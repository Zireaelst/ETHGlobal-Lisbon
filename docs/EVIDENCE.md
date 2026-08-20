# Kanıtlar — OKX entegrasyonu

Bu dosyanın kuralı `web/src/lib/server/networks.ts`'inkiyle aynı: **üretmediğimiz bir adresi
uydurmuyoruz.** Henüz gerçekleşmemiş her şey "HENÜZ YOK" olarak yazılı, boş bırakılmış ya da
makul görünen bir değerle doldurulmuş değil.

Branch: `feat/okx-integration` · Tarih: 2026-08-20 · Commit atılmadı.

---

## 1. Regresyon: eklenen var, çıkarılan yok

Aynı makine, aynı `.env`, aynı sıra. Baseline **kod değişmeden önce** alındı.

| Gate | Baseline | Sonra | |
|---|---|---|---|
| P0-A | PASS | PASS | |
| P0-B | PASS | PASS | |
| P0-D | PASS | PASS | |
| P0-E | PASS | PASS | |
| P0-F | FAIL | FAIL | mevcut — Base Sepolia RPC + `SUBGRAPH_START_BLOCK` |
| P0-G | FAIL | FAIL | mevcut — ölçüm dosyası bayat |
| P1-A · P1-B · P1-C · P1-D | PASS | PASS | |
| P2-A | PASS | PASS | |
| P2-B | FAIL | FAIL | mevcut — kaynakta hard-coded Bob adresi bulunuyor |
| P2-C | PASS | PASS | |
| P3-A · P3-B | PASS | PASS | |
| P3-D | FAIL | **PASS** | kendiliğinden düzeldi (flaky, ağ bağımlı) |
| P3-E | FAIL | FAIL | mevcut — `OG_STORAGE=0`, arşiv opt-in |
| P4-A | PASS | PASS | üç ray artık arayüzü karşılıyor |
| P4-B · P4-C | PASS | PASS | |
| P4-D | FAIL | FAIL | mevcut — **aşağıya bakın** |
| **P4-E** | — | **PASS 9/9** | **YENİ** |

**16 PASS / 6 FAIL → 18 PASS / 5 FAIL.** Hiçbir gate benim değişikliklerim yüzünden
kırılmadı.

> **P4-D benim işimle ilgisiz, ama ciddi.** Gate şunu yakalıyor:
> `timeline: the SETTLED event leaks plaintext ("CONFIDENTIAL-TIM") — only commitments go to
> the topic`. HCS zaman çizelgesine düz metin sızıyor ve guard bunu **gönderimden önce**
> reddediyor, yani zincire bir şey düşmüş değil. Gizlilik tezi üzerine kurulu bir projede bu
> ayrı ve öncelikli bir iş — OKX kapsamında düzeltmedim, çünkü kapsam dışı ve kararı senin.

Ham loglar: `scratchpad/baseline/*.log` ve `scratchpad/after/*.log`.

---

## 2. Üçüncü ray — `okx-x402`

`gate:P4-E` · 9/9 yeşil · **OKX kimlik bilgisi olmadan** çalışır (bir üçüncü tarafın API
anahtarına bağlı gate, gate değildir).

### Zincirden doğrulanan sabitler

`scripts/spikes/xlayer-verify.mjs` bunların hepsini yeniden üretir.

| | Değer | Nasıl doğrulandı |
|---|---|---|
| Ağ | `eip155:1952` (X Layer testnet) | `eth_chainId` → `0x7a0` |
| RPC | `https://testrpc.xlayer.tech/terigon` | blok 38 775 395 okundu |
| Gas token | **OKB** (ETH değil) | `okx-agentic-wallet/_shared/chain-support.md` |
| Varsayılan asset | `USDC_TEST` `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` | `name()` `decimals()` |
| EIP-712 domain | `name="USDC_TEST"` · `version="2"` | `DOMAIN_SEPARATOR()` = `0x7513e76c…baef959`, **yerel keccak ile yeniden üretildi** |
| EIP-3009 | canlı | `authorizationState(address,bytes32)` revert etmiyor |

Alternatifler de doğrulandı: USD₮0 `0x9e29b3aa…` (`name="USD₮0"`, `version="1"` —
`version()` getter'ı yok, `DOMAIN_SEPARATOR`'dan türetildi) ve Circle'ın native USDC'si
`0xDec90b78…` (`name="USDC"`, `version="2"`). Üçü de gerçek ve farklı token'lar.

### 🔴 OKX'in kendi ucu yanlış domain version'ı ilan ediyor

```
$ curl -s https://www.okx.com/api/v1/pay/mock-merchant/resource
  accepts[0].extra = { "version": "1", "name": "USDC_TEST" }

$ eth_call USDC_TEST version()  →  "2"
```

`version="1"` altında atılan bir imza **farklı bir digest** üretir ve
`transferWithAuthorization` onu reddeder. Kontrat imzayı doğrulayan taraf olduğu için
kontrata inanıyoruz. `gate:P4-E` her çalıştırmada `DOMAIN_SEPARATOR`'ı yeniden türetiyor —
biri sabiti "düzeltip" merchant'a uydurursa gate düşer.

Bu bulgu bağımsız olarak Kinora projesinde de üretilmişti; bugün tekrar doğrulandı.

### 🔵 §8.8'deki "mainnet-only" sonucum yanlıştı

`ANALYSIS.md` §8.8, OKX x402'nin yalnızca mainnet olduğunu söylüyordu. **Değil.** OKX'in
kendi canlı ucu X Layer testnet sunuyor:

```
$ curl -s https://www.okx.com/api/v1/pay/mock-merchant/resource | jq '.accepts[].network'
"eip155:1952"
"eip155:1952"
```

Hatanın kaynağı: `typescript/SELLER.md`'deki *"X Layer only — no other networks"* ifadesini
"testnet yok" diye okumuştum; "Base/Solana yok" demek. Sonuç, planı **iyileştirdi** —
blocky402'ye düşmeye gerek kalmadı, ray OKX'in gerçek facilitator'ından geçiyor ve proje
%100 testnet kalıyor.

### Ödeme, `JobVerified` olmadan serbest kalmıyor

Üçüncü rayın da aynı yapısal kapıya bağlı olduğu, **gerçek zincir verisiyle** kanıtlı
(`fixtures/p3d/P3-D.json`, Base Sepolia):

| Senaryo | tx | Sonuç |
|---|---|---|
| Dürüst iş → `JobVerified` | [`0xb20b24f6…`](https://sepolia.basescan.org/tx/0xb20b24f6bcd4fdb6e70d1a1d398a6eafd761211894bf4d1ae2f6548d448d2fbe) | kapıdan **geçti** |
| `substitute` → `MatchFalse` | [`0x14d997dd…`](https://sepolia.basescan.org/tx/0x14d997dd94e4f277d41c89ebabcd76ff1fda82b8cb4396e78fad077972688509) | **reddedildi** |
| `forge` → `BadEnclaveSig` | [`0xf02c22fb…`](https://sepolia.basescan.org/tx/0xf02c22fb5bd0416d5f7f8ea053a0a874dc97f8c5d3f805e23e8d99aad7b40985) | **reddedildi** |
| `selfintent` → `BadClientSig` | [`0xeccade1a…`](https://sepolia.basescan.org/tx/0xeccade1a7b830f2dec0ae524810fffacba10d65341737c4b73c1342a34c159cf) | **reddedildi** |

Verifier: [`0x3B116D648B710f551e37223c4c4d39879AFEEb96`](https://sepolia.basescan.org/address/0x3B116D648B710f551e37223c4c4d39879AFEEb96) (Base Sepolia)

### ✅ Kimlik bilgileriyle doğrulandı — OKX testnet'i BİZİM anahtarımızla listeliyor

`scripts/spikes/okx-supported.ts`, gerçek kimlik bilgileriyle `/supported` (2026-08-20):

```
✅ /supported cevap verdi — 9 kayıt
   exact/eip155:196          aggr_deferred/eip155:196    upto/eip155:196    period/eip155:196
   exact/eip155:1952  ←      aggr_deferred/eip155:1952   upto/eip155:1952
```

`exact/eip155:1952` artık üçüncü tarafın mock merchant'ından değil, **kendi API
anahtarımızla** doğrulandı. §8.8'in "mainnet-only" sonucunun çürütülmesi tamamlandı.

### ✅ Ödeme ayağı uçtan uca çalışıyor (settle hariç)

`scripts/spikes/okx-pay-probe.ts` — demoyu çalıştırmadan, yani 0G kredisi ve Base gas'ı
harcamadan ödeme rayını izole eder. **`settle()` çağrılmaz.**

```
asset : USDC_TEST 0xcb8bf24c…7f2bec79d (v2)
✅ quote     : 1000 USDC_TEST → 0x4F5Cd20a…Fda326
✅ authorize : EIP-3009 imzalandı — PARA HAREKET ETMEDİ
❌ verify    : payer's USDC_TEST balance is insufficient (0 < 1000)
```

### 🔴 OKX'in `/verify`'ı bakiyeye BAKMIYOR

İlk çalıştırmada aynı probe `✅ verify: OKX yetkilendirmeyi kabul etti` dedi — **Alice'in
bakiyesi 0 iken.** Yani facilitator, ödenemeyecek bir yetkilendirmeyi geçerli sayıyor.

Sonucu somut: Bob işi yapar, teslimatı verir, sonra settle başarısız olur ve para gelmez.
`base-stealth.ts` bu kontrolü hep kendisi yapıyordu; bu rayda facilitator'ın yapacağı
varsayılmıştı ve varsayım yanlıştı. Kontrol `verifyAuthorization`'a eklendi ve yukarıdaki
çıktı düzeltilmiş hâli.

### ✅ CANLI SETTLEMENT — uçtan uca, 2026-08-21

`PAYMENT_BACKEND=okx pnpm demo:base` · tek koşu · 56 489 ms

| Aşama | Kanıt |
|---|---|
| Keşif | The Graph → `agentId 8429`, adres verilmedi |
| Intent | `0x650fd8ad896c83d2221352351096dd0a0976041766e116a7f6e07ae63801bc4d` |
| 402 | `1000000 USDC` rail=**okx-x402** |
| Fiyat kararı | Claude (`claude-local`) onayladı |
| Compute | `0g-sealed-inference`, TEE imzası doğrulandı, `match=true` |
| **Verdict (Base)** | [`0x59e7bd41…`](https://sepolia.basescan.org/tx/0x59e7bd41f2992a5a0397378d90bc2695fbebdeabfc62be4ef64112f5ba1f9df1) · blok 45 745 850 · `OK` |
| **Settlement (X Layer)** | [`0x56c23314…`](https://www.oklink.com/xlayer-test/tx/0x56c23314f99013737d487a7d7a8ae977002ae916f2132ea53e25d19a9a3b3e32) · blok 38 801 151 · `status 0x1` |
| Zaman çizelgesi | HCS #882→#886, beş aşama |

**Zincirden doğrulanan para hareketi:**

```
Transfer: 0x827f728d…3d823 (Alice) → 0x4f5cd20a…da326 (Bob)   1.000000 USDC_TEST
bakiye:   Alice 10 → 9        Bob 0 → 1
```

**Gas'ı Alice ÖDEMEDİ.** İşlemi gönderen `0x40817a0d9043732d48823c05ab2ffb643ef8d90a` —
OKX'in relayer'ı. Alice'in OKB bakiyesi **sıfır** ve ödeme yine de geçti; EIP-3009'un tüm
mesele bu: imzayı ödeyen atar, işlemi başkası gönderir. Bu, rayın "ajan kendi parasını
harcıyor ama gas için ayrı bir varlık tutmuyor" iddiasının zincir üstündeki karşılığı.

**Sıralama korundu:** `settle()` `assertJobVerified`'i geçtikten sonra çağrıldı — Base'deki
`JobVerified` olmasaydı X Layer'da hiçbir şey hareket etmezdi. Verdict Base'de, para
X Layer'da, ve ikisi arasındaki bağ tek yönlü.

---

## 3. İkinci verdict zinciri — X Layer aynası

**Rol, açıkça:** X Layer = **aynı verdict'in gas-free ayna zinciri.** Doğruluk kaynağı hâlâ
Base. Keşif Base'de kalmak **zorunda**, çünkü The Graph X Layer **testnet**'ini indekslemiyor
(yalnızca mainnet'ini, `eip155:196`).

| | Durum |
|---|---|
| `Verifier.sol` | **değişmedi** — constructor zaten `chainId` alıyor |
| `scripts/deploy-verifier.ts` | chain-agnostik: `--chain base\|xlayer` / `TARGET_CHAIN` |
| Chain başına idempotency | `VERIFIER_ADDRESS` · `VERIFIER_ADDRESS_XLAYER` |
| Gas token etiketi | chain'e göre (X Layer'da **OKB**) |
| Base yolu | **bozulmadı** — aşağıya bakın |
| X Layer deploy'u | ✅ **YAPILDI** — aşağıya bakın |

Base yolunun hâlâ idempotent olduğu, gerçek çalıştırma:

```
$ npx tsx scripts/deploy-verifier.ts --chain base
Target    : Base Sepolia (chainId 84532, gas in ETH)
Already deployed: 0x3B116D648B710f551e37223c4c4d39879AFEEb96
registeredClient[0x827F728d4B7816019585891A1BCfAfF5aB93d823] is already true
```

X Layer yolu, doğru sebeple ve temiz duruyor:

```
$ npx tsx scripts/deploy-verifier.ts --chain xlayer
Target    : X Layer testnet (chainId 1952, gas in OKB)
Deployer: 0x351c9f1a638cf018425dB6547c52cD5Ba5aD7Ed6
Balance : 0.0 OKB
Error: deployer 0x351c9f1a638cf018425dB6547c52cD5Ba5aD7Ed6 holds no OKB on X Layer testnet
       — fund it at https://web3.okx.com/xlayer/faucet
```

Yanlış chain reddediliyor:

```
$ npx tsx scripts/deploy-verifier.ts --chain ethereum
Error: unknown --chain "ethereum" — expected one of: base, xlayer.
       Refusing to guess: deploying to the wrong chain writes an address the whole demo then trusts.
```

### ✅ X Layer ayna Verifier'ı canlı

Deployer fonlandıktan sonra deploy edildi ve **zincirden doğrulandı** (2026-08-20):

| | |
|---|---|
| Adres | [`0x941729B3263ebE6fD0A9E7872F81962585C48028`](https://www.oklink.com/xlayer-test/address/0x941729B3263ebE6fD0A9E7872F81962585C48028) |
| Ağ | X Layer testnet, `eip155:1952` |
| Bytecode | 7 860 byte |
| `owner()` | `0x351c9f1a…7Ed6` — bizim deployer'ımız |
| `registeredClient(Alice)` | `true` |
| `DOMAIN_SEPARATOR()` | `0xfdce3a0e…2561565` |

**Domain separator'ın chainId'si doğrulandı.** Yerel keccak ile `1952`, `84532`, `196` ve
`195` denendi; **yalnızca 1952 eşleşiyor.** Yani kontrat X Layer'ın kendi chainId'siyle
kurulmuş — Base'in domain'i kopyalanmamış. Bu önemli: yanlış chainId ile kurulmuş bir ayna,
Base'in imzalarını kabul eder ve "ayrı zincirde bağımsız doğrulama" iddiasını boşa çıkarırdı.

Base'inkiyle **kasıtlı olarak farklı** (`0xfdce3a0e…` ≠ Base'inki): aynı bytecode, farklı
chainId, dolayısıyla farklı domain. Bir zincirin imzası diğerinde geçerli değil.

> **Yine de doğruluk kaynağı Base.** Demo `VERIFIER_ADDRESS`'e karşı çalışıyor ve üç rayın
> `settle()`'ı da `assertJobVerified`'i **Base** provider'ıyla çağırıyor. Bu ayna, aynı
> kuralların gas-free bir zincirde yeniden çalıştırılabilmesi için var — kimse ona bakarak
> karar vermiyor.

---

## 3.5 Barındırılan Bob — dışarıdan doğrulandı

Railway: `https://ethglobal-lisbon-production.up.railway.app` (2026-08-21)

| Kontrol | Sonuç |
|---|---|
| `/health` | `{"status":"healthy","agentId":"8429","stage":"echo"}` |
| TLS | geçerli (`ssl_verify_result 0`), ~0.45 s |
| Agent card `endpoint` | `https://ethglobal-lisbon-production.up.railway.app/task` — localhost DEĞİL |
| Gerçek iş (`scripts/spikes/probe-deployed-bob.ts`) | `matched=true` · `ogVerified=true` · 1912 karakter analiz |
| intentHash echo | çıktı `ORDER-ID: 0x2822727c…` ile başlıyor |

**İki hata bu doğrulama sırasında bulundu ve düzeltildi:**

`main()` **hiç çağrılmıyordu** — `node dist/index.js` modülü yükleyip çıkıyordu. Railway'de
bu, hata vermeden başlayıp ölen ve sonsuza dek yeniden başlatılan bir container olarak
görünüyordu. Yerelde görünmemesinin sebebi her çağıranın `createBobAgent`'ı kütüphane olarak
import etmesi; dosya entry point olarak hiç kullanılmamıştı.

`main()` **compute geçmiyordu** — `createNoComputeBackend()`'e düşüyor ve her `/task`'a
"NO real inference was run" diyen bir placeholder dönüyordu. Bu hâldeyken ücretli bir ASP
olarak listelenmek, ucun veremeyeceği bir şeyi ilan etmek olurdu.

> **Probe'un kendisi de bir kez yanlış cevap verdi.** İlk sürümü `report.output` okuyordu;
> doğru alan `report.result.output`. Boş string'te placeholder işareti bulamayınca "gerçek
> analiz" dedi — eksik veride geçen bir kontrol, hiç kontrol olmamasından kötüdür. Artık boş
> çıktıda `KARARSIZ` diyor ve sonuç çıkarmıyor.

**Ödeme kapısı bilinçli olarak KAPALI.** Barındırılan Bob 402 döndürmüyor. A2MCP listelemesinde
ödemeyi OKX topluyor; ucun ayrıca kendi x402 ücretini alması çift ücretlendirme olurdu.

---

## 3.6 OKX.AI ASP kaydı — X Layer MAINNET, kalıcı

2026-08-21. **Faz E yapıldı.**

| | |
|---|---|
| agentId | **11070** — https://www.okx.ai/agents/11070 |
| chainIndex | **196** (X Layer **mainnet**) |
| Kayıt tx | `0xfa81b7630167d803b7d716e6b67520722cbb8102146af348d9db3594fb9d6b24` |
| Rol | ASP |
| Servis | Confidential Market Analysis · `A2MCP` · **1 USDT** |
| Endpoint | `https://ethglobal-lisbon-production.up.railway.app/task` |
| Owner | `0xe93f1546c2082e9cb278b9a7d3ded3bb562ea36d` |
| Durum | `Listing under review` — **gönderildi, kuyrukta** |

**Onay akışı tamamlandı; yapılacak başka bir şey yok.** `activate` iki iş yapıyor —
`agent-status` + `submit-approval`. İkincisi başarılı oldu (`approvalStatus 1 → 2`); birincisi
`success:false` dönüyor ve bu **doğru davranış**: bir ajan ancak onaydan SONRA `active`
olabiliyor. `identity-errors.md:52` bunu açıkça yazıyor:

> `activate.approvalStatus: 2` → "under review — usually ready within 24h; once approved it
> appears on the marketplace." **Stop.** Don't call `submit-approval`.

Yani `activate`'i tekrar çalıştırmak gereksiz (ikinci çağrı zaten `submitApproval`'ı yanıta
bile koymadı). Onaylanınca `approvalDisplayStatus` 2 → 4 olur ve `statusLabel` `active`'e
döner — Kinora #11036'nın bugünkü hâli. Kontrol için:
`onchainos agent get-agents --agent-ids 11070`

**Gas ödenmedi.** Kayıt platformun sponsorlu kanalından geçti — `ANALYSIS.md` §8'de
"gerçek OKB gerekiyor" diye yazdığım iddia yanlıştı ve §S6-DÜZELTME'de düzeltildi.

**Listeleme metni bilerek kısa tutuldu.** Kinora'nın kaydı yapı olarak doğru ama okunaksız:
1. satır 400, 2. satır 600, 4. satır ~700 karakterlik duvarlar. Bizimki sırasıyla 192 / 373 /
227 — aynı bilgi, yarı yoğunluk. Hiçbir satırda baş/son boşluk yok, satırlar tam olarak tek
`\n` ile ayrılmış. `validate-listing` yazmadan önce çalıştırıldı: `pass: true`, sıfır bulgu.

**Açıklamada testnet uyarısı bilerek duruyor:**

> "Verification and settlement run on testnets (Base Sepolia, X Layer testnet) — this is a
> hackathon build, not a production service."

Uç gerçek analiz üretiyor (§3.5'te doğrulandı), ama doğrulama zinciri testnet ve 0G faucet
kredisine bağlı. 1 USDT ödeyecek birine bunu söylememek §11'i çiğnerdi.

**Aktivasyon `okx-a2a` 0.2.7'de takıldı**, 0.2.8'e yükseltilip daemon yeniden başlatıldı
(`okx-a2a doctor --fix`) — Kinora playbook'unun uyardığı adım. Sonrasında 8/8 yeşil.

---

## 4. Dürüstlük: `intentHash` bu rayda İMZAYLA KORUNMUYOR

`extra.intentHash` ödeme isteğinde **taşınıyor**, ama `exact` şeması yalnızca
`(from, to, value, validAfter, validBefore, nonce)` imzalıyor — `extra` digest'in dışında.
Bir aracı onu değiştirebilir ve imza geçerli kalır.

**Alan gözlemlenebilirlik ve hata ayıklama içindir. Kanıt değildir.**

| | |
|---|---|
| ✅ Denilebilir | "intentHash ödeme isteğiyle birlikte taşınıyor; bağlama enclave'de ve kontratta, ödeme imzasında değil." |
| ❌ Denilemez | "intentHash payload'a gömülü ve imzayla korunuyor" · "ödeme işe kriptografik olarak bağlı" |

Bu kural bir yorum değil, **bir gate**: `P4-E` repoyu `git grep` ile tarıyor ve yasak
cümlelerden birini olumlu bir bağlamda bulursa düşüyor. Sebep basit — bu projenin
dürüstlüğünü kaybetmesinin en kolay yolu, birinin altı hafta sonra README'ye o cümleyi
yazması.

**Bağlamanın gerçekten mümkün olduğu yer** EIP-3009'un kendi `nonce`'u: ödeyenin seçtiği
serbest bir bytes32. `nonce = keccak256(intentHash ‖ salt)` intent'i imzalı struct'ın içine
sokar. Bu, `base-stealth.ts:135`'te ayrı bir değişiklik (`ROADMAP.md` §A.4) ve **yapılmadı**.

---

## 5. Dosya dökümü

**Yeni**

| Dosya | Ne |
|---|---|
| `packages/payment/src/okx-facilitator.ts` | OKX facilitator'ı `FacilitatorClient` olarak (HMAC-SHA256) |
| `packages/payment/src/okx-x402.ts` | Üçüncü `PaymentBackend` |
| `tests/gates/P4-E.ts` | 9 kriter |
| `scripts/spikes/xlayer-verify.mjs` | Zincirden domain doğrulama |
| `railway.json` · `docs/deploy-bob-railway.md` | Faz E hazırlığı |
| `docs/okx-tooling.md` | Araç/ürün sınırı |
| `docs/EVIDENCE.md` | bu dosya |

**Değişen**

| Dosya | Ne |
|---|---|
| `packages/payment/src/index.ts` | `PaymentRail`'e `okx-x402` |
| `packages/shared/src/schema.ts` | `PaymentRailSchema` üç değer |
| `packages/shared/src/config.ts` | `LATER_KEYS` — **`OKX_SECRET_KEY` ve `OKX_PASSPHRASE` bilinçli olarak YOK** |
| `packages/demo/src/index.ts` | `okx` dalı; kimlik yoksa **başka raya düşmüyor**, hata veriyor |
| `packages/bob-agent/src/index.ts` | `host`/`PORT` opt-in (varsayılan hâlâ `127.0.0.1`) |
| `scripts/deploy-verifier.ts` | chain-agnostik |
| `web/src/lib/explorers.ts` | `xlayer` + `networkForSponsor()` |
| `web/src/lib/server/networks.ts` | beşinci kanıt bloğu |
| `web/src/lib/run-types.ts` · `server/runner.ts` · `api/run/route.ts` | `okx` rayı |
| `web/src/components/dashboard/FraudPanel.tsx` | üçüncü ray seçeneği |
| `web/src/components/SponsorLogo.tsx` | ⚠️ OKX **wordmark** — resmî lockup değil, açıkça etiketli |
| `.env.example` | OKX bloğu |
| `package.json` | `@x402/evm@2.19.0` (tam pin) + `gate:P4-E` |

### Sırlar

`OKX_SECRET_KEY` ve `OKX_PASSPHRASE` `LATER_KEYS`'e **eklenmedi**. `HEDERA_OPERATOR_KEY` ile
aynı disiplin: yalnızca kullanıldıkları yerde okunuyorlar
(`packages/payment/src/okx-facilitator.ts`), `loadConfig()` onları döndürmüyor, dolayısıyla
hiçbir ajan bağlamına girmiyorlar. Listelemek `gate:P4-C`'nin korumak için yazıldığı sınırı
bozardı.

---

## 6. Yapılmayanlar

| | Neden |
|---|---|
| `nonce` bağlaması (§4) | Ayrı iş, ayrı ray, ayrı tez — `ROADMAP.md` §A.4 |
| ASP kaydı | X Layer **mainnet**, kalıcı — ayrı onay bekliyor |
| P4-D düz metin sızıntısı | Mevcut hata, OKX kapsamı dışı |
| OKX resmî logosu | Asset elimizde yok; markayı ezberden çizmek `SponsorLogo.tsx`'in kendi kuralını çiğnerdi |
