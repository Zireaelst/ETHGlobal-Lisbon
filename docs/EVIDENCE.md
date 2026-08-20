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

### ⚠️ Canlı settlement HENÜZ YOK

Bir X Layer ödeme tx'i **üretilmedi**. `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE`
girildiğinde tek komut:

```bash
PAYMENT_BACKEND=okx pnpm demo:base
```

Bu bölüm o zaman gerçek bir tx hash'i ve OKLink linkiyle güncellenecek. O ana kadar burada
tx yok — çünkü yok.

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
| X Layer deploy'u | ⚠️ **HENÜZ YOK — faucet bekliyor** |

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

**Deploy için tek eksik:** `0x351c9f1a638cf018425dB6547c52cD5Ba5aD7Ed6` adresine
[faucet](https://web3.okx.com/xlayer/faucet)'ten OKB. Sonra:

```bash
npx tsx scripts/deploy-verifier.ts --chain xlayer
```

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
| Canlı X Layer ödemesi | OKX API anahtarı yok |
| X Layer'a Verifier deploy'u | Deployer'da OKB yok (faucet tarayıcı gerektiriyor) |
| `nonce` bağlaması (§4) | Ayrı iş, ayrı ray, ayrı tez — `ROADMAP.md` §A.4 |
| ASP kaydı | X Layer **mainnet**, kalıcı — ayrı onay bekliyor |
| P4-D düz metin sızıntısı | Mevcut hata, OKX kapsamı dışı |
| OKX resmî logosu | Asset elimizde yok; markayı ezberden çizmek `SponsorLogo.tsx`'in kendi kuralını çiğnerdi |
