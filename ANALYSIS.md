# OKX.AI Ekosistem Entegrasyon Analizi

**Repo:** Confidential Agents (ETHGlobal Lisbon 2026)
**Tarih:** 2026-08-20
**Kapsam:** Sadece analiz. Bu raporun üretimi sırasında hiçbir kaynak dosya değiştirilmedi.

---

## 1. Mevcut mimari

### 1.1 Stack

| Katman | Teknoloji |
|---|---|
| Dil / runtime | TypeScript (strict), Node 20+, ESM |
| Paket yönetimi | pnpm workspaces monorepo, kök `tsc -b` solution build |
| Kontrat | Solidity ^0.8.24, Foundry (`contracts/`) |
| Web | Next.js 15 App Router + React 19 + Tailwind 4 (`web/`) |
| Zincir kütüphanesi | `ethers` v6 (baskın), `viem` (bağımlılıkta var, kullanımı marjinal) |
| İndeksleme | The Graph — `subgraph/`, Subgraph Studio'ya canlı deploy |
| Compute | `@0gfoundation/0g-compute-ts-sdk` (0G Sealed Inference / TeeML) |
| Storage | `@0gfoundation/0g-ts-sdk` (opt-in, `OG_STORAGE=1`) |
| Ödeme | `@x402/core` 2.19.0 + `@x402/hedera` (exact scheme), blocky402 testnet facilitator |
| Hedera | `@hiero-ledger/sdk`, `@hashgraph/hedera-agent-kit` v4, `@hashgraphonline/standards-sdk` |
| Gizlilik | `eth-crypto` (ECIES), `@scopelift/stealth-address-sdk` (ERC-5564) |
| Ajan beyni | `claude -p --output-format json` (subscription auth) veya 0G Compute veya deterministik policy |

Toplam ~6.4k satır `packages/`, ~5k satır `web/src`, 270 satır `Verifier.sol`, 21 faz kapısı (`tests/gates/`).

### 1.2 Ana modüller

```
packages/shared/      @ca/shared     — intent (EIP-712), ECIES, ERC-8004 identity,
                                       discovery (The Graph), compute-0g, ogsig, sealsig,
                                       canonical JSON, storage, timeline, reasoning katmanı
packages/payment/     @ca/payment    — PaymentBackend arayüzü + 2 ray:
                                       base-stealth.ts (EIP-3009 + ERC-5564)
                                       hedera-x402.ts (x402 exact + blocky402)
                                       signer/hedera-signer.ts (delegated signing)
                                       guard.ts (assertJobVerified)
packages/bob-binding/ @ca/bob-binding— intentHash recompute + 0G SI çağrısı + echo doğrulama
packages/bob-agent/   @ca/bob-agent  — public HTTP: /card, /task (402 gate), /settle, fraud.ts
packages/alice-agent/ @ca/alice-agent— discover → intent imzala → ECIES → 402 akışı → doğrula
packages/demo/        @ca/demo       — runDemo(): uçtan uca akış kütüphanesi
contracts/            Verifier.sol + IntentLib.sol (Base Sepolia)
subgraph/             ERC-8004 IdentityRegistry + JobVerified/JobRejected indeksi
web/                  Demo dApp: landing + /dashboard (5 panel) + /api route'ları
```

### 1.3 Mevcut cüzdan / chain / işlem entegrasyonları

**Chain'ler (hepsi testnet):**

| Rol | Chain | Kanıt |
|---|---|---|
| Karar (verdict) | Base Sepolia (84532) | `packages/demo/src/index.ts:42` `CHAIN_ID = 84532`, `scripts/deploy-verifier.ts:18` |
| Zaman çizelgesi | Hedera testnet (HCS topic) | `packages/payment/src/hcs-timeline.ts` |
| Okuma katmanı | The Graph (Base Sepolia'yı indeksler) | `subgraph/subgraph.yaml` |
| Compute | 0G testnet (EVM RPC + broker ledger) | `packages/shared/src/compute-0g.ts` |

**Cüzdan/anahtar yönetimi — kritik bulgu:**

- **Tarayıcı cüzdanı YOK.** `web/` içinde `wagmi`, `WalletConnect`, `window.ethereum`, RainbowKit — hiçbiri yok. Grep ile doğrulandı. Dashboard tamamen server-side render + `/api/*` route handler'ları üzerinden çalışır; kullanıcı hiçbir şey imzalamaz.
- **Tüm anahtarlar sunucu tarafında, `.env`'den.** `packages/shared/src/config.ts:73-96` — `PRIVATE_KEY_ALICE`, `PRIVATE_KEY_BOB`, `PRIVATE_KEY_DEPLOYER`, `OG_PRIVATE_KEY` zod ile doğrulanır ve doğrudan `ethers.Wallet`'a verilir.
- **Hedera anahtarı bilinçli olarak redakte edilir.** `config.ts:88-92` — `HEDERA_OPERATOR_KEY` doğrulanır ama değeri `REDACTED_SECRET` olarak döner; gerçek okuma sadece `packages/payment/src/signer/hedera-signer.ts` içinde yapılır. `gate:P4-C` bunu runtime'da test eder. Bu, projenin "delegated signing" tezinin somut hâli.
- **Ajan beynine giden env scrub edilir.** `packages/shared/src/reasoning-claude.ts` içindeki `scrubbedEnv` — spawn edilen Claude CLI'ye hiçbir secret geçmez (CLAUDE.md §13, Duvar 2).

**İmzalama noktalarının tam listesi:**

| # | Ne imzalanıyor | Dosya | Kim |
|---|---|---|---|
| 1 | EIP-712 intent (`intentHash`) | `packages/shared/src/intent.ts` | Alice |
| 2 | EIP-3009 `TransferWithAuthorization` (USDC) | `packages/payment/src/base-stealth.ts:114-158` | Alice |
| 3 | Hedera transfer (x402 exact payload) | `packages/payment/src/hedera-x402.ts:141` üzerinden `ExactHederaClientScheme` | delegated signer |
| 4 | HCS `TopicMessageSubmitTransaction` | `packages/payment/src/hcs-timeline.ts` | Hedera operator |
| 5 | 0G TEE seal (EIP-191) | **0G donanımı** — biz sadece doğrularız (`ogsig.ts`, `compute-0g.ts`) | 0G |
| 6 | Enclave seal-key (R‖S, brute-v) | `packages/shared/src/sealsig.ts` | Bob binding |
| 7 | Kontrat deploy + `setEnclaveSigner` | `scripts/deploy-verifier.ts` | Deployer |
| 8 | ERC-5564 `announce` (relayer) | `base-stealth.ts:322-330` | Relayer (deployer key) |

**Trading / DeFi kodu:** **hiç yok.** Repoda tek bir swap, quote, order, DEX, pool, fiyat feed'i, portföy ya da PnL çağrısı bulunmuyor. `USDC_BASE_SEPOLIA` sadece ödeme birimi olarak var; hiçbir yerde takas edilmiyor.

---

## 2. Projenin doğası

**Bu bir trading/DeFi projesi değil.**

Proje, iki otonom AI ajanının (Alice = müşteri, Bob = uzman analist) birbirini ERC-8004 kayıt defterinden bulup **gizli bir iş sözleşmesi** yürütmesidir. Satılan şey bir **hizmet** — somut olarak, ekli çeyreklik finansal tablolarda gelir tanıma riskinin değerlendirilmesi (`packages/demo/src/index.ts:337`, skill etiketi `market-analysis`). Deliverable bir 0G Sealed Inference enclave'inde üretilir; brief ve veri hiçbir zaman altyapının göreceği bir yere düşmez.

Tezin özü **intent-bound verification**'dır: tek bir imzalı intent hash'i ödemeden enclave'e, oradan itibar katmanına taşınır. Değerli olan şey "bir TEE çalıştı" değil, "**sipariş edilen iş** çalıştı"dır.

Alan sınıflandırması:
- **Ana alan:** gizli B2B/A2A hizmet ticareti + doğrulanabilir hesaplama + ajan itibarı.
- **Bitişik alan:** ödeme altyapısı (x402), ajan kimliği (ERC-8004). Bu iki bitişik alan OKX.AI ile **doğrudan örtüşüyor**.
- **İlgisiz alan:** spot/futures/options ticaret, DEX aggregation, yield farming, prediction market, portföy takibi. Bunlar için projede ne veri, ne kullanıcı, ne de bir hikâye var.

Konu başlığı "market-analysis" olduğu için bir trading bağlantısı varmış gibi görünebilir; yoktur. Analiz edilen şey bir **müşterinin özel finansal tabloları**dır ve gizli kalması gerektiği için gizlilik tezi anlamlıdır. Onu bir piyasa fiyat akışıyla değiştirmek, ürünün varlık sebebini yok eder.

---

## 3. Yedi bileşenin tek tek değerlendirmesi

### 3.1 X Layer (L2, contract deploy hedefi, gas-free)

**Karar: UYGUN — ama Base'in yerine değil, ikinci bir verdict zinciri olarak. Orta risk.**

Neden uyuyor:
- `Verifier.sol` düz EVM Solidity ^0.8.24'tür; X Layer EVM-eşdeğeri olduğu için değişiklik gerekmeden derlenir.
- Deploy scripti zaten idempotent ve chainId'i doğruluyor (`scripts/deploy-verifier.ts:29-32`) — parametrikleştirmesi ucuz.
- Gas-free işlem, jüri önünde canlı çalıştırılan bir demo için gerçek bir fayda: her fraud tekrarı şu an Base Sepolia ETH yakıyor.

Neden risk:
- **ERC-8004 IdentityRegistry X Layer testnet'te deploy edilmiş değil** (bildiğim kadarıyla). Keşif katmanının tamamı ona bağlı (`packages/shared/src/identity.ts`, `subgraph/`). Registry'yi kendimiz deploy etmek gerekirse bu "canlı bir kamu registry'sini kullanıyoruz" iddiasını zayıflatır.
- **Subgraph'ın X Layer desteği doğrulanmalı.** The Graph hosted/Studio X Layer'ı indeksliyor mu — açık soru. İndekslemiyorsa keşif katmanı Base'de kalmak zorunda ve "temiz ayrım" (Base = verdict) bulanıklaşır.
- **ERC-5564 Announcer + ERC-6538 Registry singleton'ları X Layer'da yok** (`base-stealth.ts:35-36` sabit adresler). Stealth ödeme rayı X Layer'a taşınamaz; deterministic deploy gerekir.
- USDC EIP-3009 desteği X Layer'da farklı token contract'ı demek (`USDC_BASE_SEPOLIA` sabiti).

**Sonuç:** X Layer'a taşınacak tek şey `Verifier.sol` + `JobVerified` yayını olmalı. Ödeme ve keşif Base'de kalır. Bu "aynı verdict iki zincirde de doğrulanabilir" anlatısını verir ve mevcut hiçbir şeyi kırmaz.

### 3.2 OKX Wallet (insan kullanıcı cüzdanı, WalletConnect, 60+ chain)

**Karar: UYGUN DEĞİL. Zorlama olur.**

- Projede **hiçbir insan kullanıcı yok**. Demo dApp'in tamamı okunur: kanıt panelleri, keşif tablosu, fraud tekrarı. Kullanıcının bağlayacağı bir cüzdan, imzalayacağı bir şey, göndereceği bir işlem yok.
- Tarayıcı cüzdanı eklemek, projenin ana iddiasıyla **çelişir**: bu ajanların kendi anahtarlarına sahip, insansız çalışan varlıklar olduğu iddiasıdır (CLAUDE.md §13). "Cüzdanını bağla" butonu koymak, ajan otonomisi tezini görsel olarak yalanlar.
- Tek meşru kullanım: jürinin `intentHash`'i kendi cüzdanıyla imzalayıp `IntentPlaygroundSection.tsx`'te oynayabilmesi. Bu bir *gösteri* faydası, mimari fayda değil — ve zaten mevcut playground bunu anahtarsız yapıyor.

**Söylenecek şey:** "Bu projede OKX Wallet anlamsız çünkü akışta imzalayacak bir insan yok; her imza bir ajanın kendi anahtarından çıkıyor ve bu bilinçli."

### 3.3 Agentic Wallet (TEE korumalı ajan cüzdanı, CLI/MCP, risk simülasyonu)

**Karar: EN GÜÇLÜ ADAY. Projenin en zayıf noktasını tam olarak kapatıyor.**

Bu, ekosistemdeki tek bileşen ki *mevcut bir dürüstlük borcunu* ödüyor.

Projenin bugün itiraf etmek zorunda kaldığı boşluk (CLAUDE.md §2.1, §11): **TDX host bulunamadı, dolayısıyla Bob'un binding'i attested olmayan sıradan bir makinede çalışıyor**, `attestation: 'none'`, `imageHash: null`. Ayrıca ajan anahtarları düz `.env` dosyasında duruyor (`config.ts:73-78`) — bir ajan cüzdanı için en zayıf saklama biçimi.

Agentic Wallet'ın TEE korumalı anahtar saklaması bunun bir kısmını kapatır:
- **Anahtar bir enclave'in içinde durur, `.env`'de değil.** "Beyin özel anahtarı asla görmez" duvarı (§13, Duvar 2) bugün *disiplinle* uygulanıyor; TEE'li bir cüzdanla *inşa gereği* uygulanır.
- **Risk simülasyonu**, `approvePrice` kararına gerçek bir on-chain ön-kontrol ekler — bugün orada sadece bir sayısal tavan var (`alice-agent/src/index.ts:288-300`).
- X Layer desteği var, yani 3.1 ile birlikte tek bir tutarlı hikâye kurulur.

Dikkat edilecek nokta: bu bir **ikame değil, ek bir ray** olmalıdır. Hedera delegated signer (`signer/hedera-signer.ts`) ve `gate:P4-C` kapısı, projenin kendi anahtar-izolasyon kanıtıdır; onu söküp yerine üçüncü tarafın kutusunu koymak bir kanıtı bir güven varsayımıyla değiştirir. İkisi yan yana durursa hikâye güçlenir: "anahtar izolasyonunu iki bağımsız yolla yapıyoruz."

### 3.4 Onchain OS (DEX aggregation, Analyze, Payments/x402, DApp Connect)

**Karar: KISMİ — sadece Payments (x402) alt bileşeni uyuyor. Diğer üçü uymuyor.**

**Payments / Agent Payments Protocol — UYGUN, yüksek değer.**
Proje zaten `@x402/core` 2.19.0 üzerine kurulu ve `PaymentBackend` arayüzü (`packages/payment/src/index.ts:76-102`) tam olarak *ray takılıp çıkarılabilsin diye* tasarlandı. Üçüncü bir ray eklemek, iki mevcut rayı bozmadan yapılabilecek en temiz iş. Bu oturumda yüklü olan `okx-agent-payments-protocol` skill'i x402'nin `exact`, `upto`, `aggr_deferred` şemalarını ve MPP kanal/voucher akışını kapsıyor — bizim `quote → authorize → settle` üçlememizle doğal olarak eşleşiyor.

Özel fırsat: projenin en sıkıntılı yeri, `intentHash`'in Hedera x402 payload'ına **kriptografik olarak bağlanamaması** (`hedera-x402.ts:14-16`'daki dürüst itiraf — "exact-Hedera şemasında memo/extra alanı yok"). OKX'in x402 uygulamasında bir `extra`/metadata alanı varsa, `intentHash` doğrudan ödeme payload'ına gömülebilir ve **projenin ana tezi ödeme katmanında ilk kez gerçekten sağlanmış olur.** Bu, kozmetik bir entegrasyon değil, tezi tamamlayan bir parça.

**DEX aggregation (500+ DEX) — UYGUN DEĞİL.** Projede takas edilecek bir şey yok. Ödeme tek bir varlıkta, tek bir alıcıya, sabit fiyattan yapılıyor.

**Analyze (gerçek zamanlı onchain veri) — UYGUN DEĞİL, ve tehlikeli.** Bob'un analiz ettiği veri Alice'in **gizli** çeyreklik tablolarıdır; kamuya açık onchain veri değil. Onchain veri beslemek, gizlilik tezini bizzat ortadan kaldırır (analiz edilecek şey zaten herkese açıksa neden enclave?). En fazla, keşif panelinde ajan adreslerinin bakiyesini göstermek için kullanılabilir — süs.

**DApp Connect (Aave, Polymarket, Hyperliquid…) — UYGUN DEĞİL.** Hiçbir DeFi protokolüyle etkileşim yok ve olması için bir sebep yok.

### 3.5 Agent Trade Kit (CEX, 82 araç, MCP/CLI)

**Karar: UYGUN DEĞİL. Net red.**

- Projede CEX yok, emir yok, portföy yok, bakiye takibi yok. 82 aracın sıfırı akışa dokunuyor.
- Tek yapay bağlantı: reasoning katmanına (`reasoning-claude.ts`) piyasa verisi aracı takıp "Alice fiyat kararını piyasa verisiyle veriyor" demek. Bu **tezi zayıflatır**: CLAUDE.md §11 açıkça "AI karar verdi, o hâlde güvenilir" iddiasını yasaklıyor ve beynin *hiçbir garantiyi genişletemeyeceğini* söylüyor. Beyne dış veri kaynağı eklemek, prompt injection yüzeyini büyütür ve karşılığında hiçbir kriptografik garanti kazandırmaz.
- Auth'suz market data araçları teknik olarak kolay entegre — ama "kolay" ile "anlamlı" aynı şey değil.

**Söylenecek şey:** "Bu proje bir hizmet pazarı, bir ticaret ajanı değil. Trade Kit'in 82 aracından hiçbiri bir işin gizli çalıştığını ya da sipariş edilen iş olduğunu kanıtlamaya katkı vermiyor."

### 3.6 Hazır skill dosyaları (onchainos-skills, agent-trade-kit)

**Karar: UYGUN — sınırlı ve seçici biçimde. Düşük efor, düşük risk.**

- Repo zaten skill/MCP toplama alışkanlığına sahip: `.mcp.json`, `skills-lock.json`, `.agents/skills/`, `.claude/`.
- Alınmaya değer olanlar: `okx-agent-payments-protocol` (x402 şemaları) ve `okx-agentic-wallet` (cüzdan işlemleri). Bunlar **geliştirme sırasında** doğru API'yi bulmak için değerli.
- Alınmaya değmez olanlar: trading, DeFi, prediction market skill'leri — kod yazma bağlamını gürültüyle doldurur.
- **Önemli sınır:** skill'ler geliştirici araçlarıdır, ürünün parçası değil. Bir skill dosyası eklemek "OKX entegre ettik" demek değildir; submission'da bunu entegrasyon diye saymak, projenin §11'deki dürüstlük çizgisini ihlal eder.

### 3.7 OKX.AI Marketplace / ASP kaydı

**Karar: UYGUN — ve muhtemelen en yüksek getiri/efor oranı.**

Bu bir kod entegrasyonu değil, bir **dağıtım hedefi** — ve proje tam olarak buna hazır:

- Bob **zaten** bir Agent Service Provider'dır. `/card` endpoint'i (`bob-agent/src/index.ts`) skill, fiyat, endpoint ve ECIES pubkey yayınlıyor; `/task` 402 ile ücret talep ediyor; `/settle` iş doğrulandıktan sonra parayı serbest bırakıyor. Bu, bir ASP'nin ihtiyaç duyduğu her şey.
- **ERC-8004 kaydı zaten var** (`packages/shared/src/identity.ts`, `METADATA_KEYS`). Bu oturumda yüklü `okx-ai` skill'i tam olarak ERC-8004 ajan kimliği kaydı + ASP listeleme + task marketplace akışını kapsıyor. Yani OKX.AI'nin kimlik modeli ile bu projenin kimlik modeli **aynı standart**.
- Bu, mevcut hiçbir kodu değiştirmeden yapılabilecek tek gerçek entegrasyondur.

Tek gereklilik: Bob'un `BOB_PUBLIC_URL`'i gerçekten kamuya açık olmalı (bugün boşsa localhost'a düşüyor — `.env.example:22`).

---

## 4. Uygun bileşenler için somut entegrasyon planı

### 4.1 OKX x402 rayı → `packages/payment/src/okx-x402.ts` (YENİ dosya, ~220 satır)

`hedera-x402.ts`'nin birebir kardeşi. `PaymentBackend` arayüzünü (`packages/payment/src/index.ts:76-102`) implemente eder: `quote / authorize / verifyAuthorization / settle / verify`.

Değişecek yerler:

| Dosya | Satır | Değişiklik |
|---|---|---|
| `packages/payment/src/index.ts` | 21 | `export type PaymentRail = 'base-stealth' \| 'hedera-x402' \| 'okx-x402';` |
| `packages/payment/src/index.ts` | 120-123 | `export * from './okx-x402.js';` eklenir |
| `packages/demo/src/index.ts` | 208-240 | `makePaymentBackend`'e üçüncü dal: `if (rail === 'okx') { ... }` |
| `packages/demo/src/index.ts` | 65-66, 332 | `DemoOptions.paymentRail` tipine `'okx'` eklenir |
| `packages/demo/src/index.ts` | 294 | `network:` seçimine `'x-layer-testnet'` dalı |
| `packages/bob-agent/src/index.ts` | 103-110 | `payment.network` alanı yeni rayı kabul eder |
| ~~`web/src/lib/run-types.ts`~~ | — | **DÜZELTME (ROADMAP.md §0):** dokunulmayacak — satır 90 zaten `rail: string`, union değil |
| `web/src/components/dashboard/FraudPanel.tsx` | 63-90 | **DÜZELTME (ROADMAP.md §0):** rail etiketi burada (`RAILS` dizisi + `railName()`), TimelinePanel'de değil |
| `.env.example` | yeni blok | `OKX_X402_FACILITATOR_URL`, `OKX_PAY_ACCOUNT` |
| `packages/shared/src/config.ts` | `LATER_KEYS` (72-91) | yeni anahtarlar eklenir (opsiyonel tier) |
| `tests/gates/` | yeni `P4-E.ts` | P4-A'nın kalıbıyla: quote→authorize→settle, `assertJobVerified` çağrıldığı doğrulanır |

**Zorunlu kural:** `settle()` içinde ilk satır `assertJobVerified(...)` olmalı (`payment/src/guard.ts`). `base-stealth.ts:305-311` ve `hedera-x402.ts:181-187` bunu yapıyor; yeni ray da yapmazsa fraud demosu sessizce delinir ve projenin en güçlü cümlesi ("ödeme hiç settle olmadı") yalan olur.

**Yüksek değerli ek:** OKX x402 payload'ı bir metadata/extra alanı taşıyorsa, `intentHash` oraya yazılmalı. Bu, `hedera-x402.ts:14-16`'da itiraf edilen boşluğu kapatan tek şeydir ve ayrı bir tez cümlesi kazandırır: *"intent yalnızca enclave'den değil, ödeme payload'ından da geçiyor."*

### 4.2 X Layer'a ikinci Verifier deploy'u

| Dosya | Satır | Değişiklik |
|---|---|---|
| `contracts/src/Verifier.sol` | — | **değişiklik yok.** Constructor zaten `chainId` alıyor (EIP-712 domain'i oradan kuruluyor) |
| `scripts/deploy-verifier.ts` | 18, 29-32 | `CHAIN_ID` sabiti kaldırılır; `--chain` argümanı veya `TARGET_CHAIN` env'inden okunur |
| `scripts/deploy-verifier.ts` | 41-50 | idempotency kontrolü chain başına anahtar kullanır (`VERIFIER_ADDRESS_XLAYER`) |
| `packages/demo/src/index.ts` | 42 | `CHAIN_ID` sabiti config'e taşınır |
| `web/src/lib/explorers.ts` | tümü (159 satır) | X Layer explorer URL şeması eklenir |
| `web/src/lib/server/networks.ts` | 96-170 | beşinci `NetworkEvidence` bloğu: `network: "xlayer"` |
| `web/src/components/SponsorLogo.tsx` | `SponsorId` tipi | `"okx"` eklenir + logo asset |
| `.env.example` | yeni blok | `XLAYER_RPC_URL`, `XLAYER_CHAIN_ID`, `VERIFIER_ADDRESS_XLAYER` |

**Kapsam dışı bırakılması gerekenler:** ödeme (stealth singleton'ları yok), keşif (registry + subgraph desteği belirsiz), HCS (Hedera'ya ait). Sadece verdict taşınır.

### 4.3 Agentic Wallet ile anahtar izolasyonu

Doğru yer `packages/payment/src/signer/` — bu dizin zaten "anahtar ajan bağlamına girmez" ilkesi için var (`hedera-signer.ts`, 108 satır).

| Dosya | Değişiklik |
|---|---|
| `packages/payment/src/signer/okx-signer.ts` | **YENİ.** `hedera-signer.ts`'nin kalıbında: handle döner, ham anahtar dışarı çıkmaz |
| `packages/shared/src/config.ts:73-78` | `PRIVATE_KEY_*` zorunluluğu gevşetilir — signer modu seçilebilir hâle gelir |
| `packages/demo/src/index.ts:208-240` | backend fabrikası signer handle'ı alır |
| `tests/gates/P4-C.ts` | genişletilir: yeni signer'ın da anahtarı sızdırmadığı runtime'da doğrulanır |
| `web/src/lib/server/networks.ts` | yeni fact: "ajan anahtarı nerede duruyor" |

**Dürüstlük notu:** entegre edilirse README'de "Bob'un binding'i hâlâ attested değil; TEE'li olan **anahtar saklama**, **hesaplama değil**" cümlesi mutlaka yer almalı. Aksi hâlde §11'in "iki TEE değil, bir tane" sınırı ihlal edilir ve bu, projenin en dikkatle korunan iddiası.

### 4.4 ASP kaydı (kod değişikliği yok)

Gerekli tek şey: `BOB_PUBLIC_URL` gerçek bir public URL olmalı (`.env.example:22`, bugün boş → localhost). Web zaten Vercel'de (`.vercel/project.json` var). Bob'un HTTP sunucusu (`packages/bob-agent/src/index.ts`, 538 satır) ayrıca host edilmeli — bu bir deploy işi, kod işi değil.

---

## 5. Mevcut kod ile OKX SDK'sının ilişkisi

### 5.1 Değişecek (opsiyonel, ikame)

| Mevcut | Konum | OKX karşılığı | Not |
|---|---|---|---|
| `.env`'den ham anahtar okuma | `config.ts:73-78` | Agentic Wallet TEE saklama | İkame **değil**, mod olarak eklenmeli; gate:P4-C korunmalı |
| `ethers.Wallet` ile doğrudan imzalama | `demo/src/index.ts:225,233` | Agentic Wallet signer handle | Aynı `signer/` kalıbıyla sarmalanır |

### 5.2 Yan yana çalışacak (dokunulmaz)

| Bileşen | Konum | Neden dokunulmaz |
|---|---|---|
| EIP-712 intent imzası | `shared/src/intent.ts` | Kontratın EIP-712 domain'ine bağlı; imza şeması değişirse `Verifier.sol` bozulur |
| 0G TEE imza doğrulama | `shared/src/compute-0g.ts`, `ogsig.ts` | 0G donanımına ait; hiçbir cüzdan bunu değiştiremez. **Projenin tek gerçek attestation'ı.** |
| Seal-key R‖S brute-v recover | `shared/src/sealsig.ts` | Kontratla birebir eşleşen kriptografik sınır |
| ECIES şifreleme | `shared/src/ecies.ts` | Gizlilik katmanı; ödeme rayından bağımsız |
| ERC-5564 stealth | `payment/src/stealth.ts`, `base-stealth.ts` | Base rayının gizlilik kanıtı — X Layer'a taşınamaz |
| Hedera x402 + HCS | `payment/src/hedera-x402.ts`, `hcs-timeline.ts` | Sponsor track teslimatı; kaldırılamaz |
| The Graph keşfi | `shared/src/discovery.ts` | Sponsor track teslimatı; hardcoded adres olmadığını gate grep ile test ediyor |
| Delegated Hedera signer | `payment/src/signer/hedera-signer.ts` | `gate:P4-C`'nin konusu; projenin kendi anahtar-izolasyon kanıtı |

### 5.3 Hiç dokunulmayacak

`contracts/src/Verifier.sol` ve `IntentLib.sol` — X Layer'a deploy edilseler bile **kaynak kod aynı kalır**. Constructor'ın chainId alması bunu zaten mümkün kılıyor.

---

## 6. Riskler ve açık sorular

### 6.1 API key ve secret yönetimi

- **R1.** OKX API key'leri muhtemelen `.env`'e girecek. Mevcut `config.ts` iki katmanlı (CORE zorunlu / LATER lazy) ve `HEDERA_OPERATOR_KEY` için özel bir redaksiyon mekanizması var (`config.ts:88-92`). Yeni secret'lar **aynı redaksiyon disiplinine** alınmazsa, `loadConfig()` onları döndürür ve her ajan bağlamına girerler — `gate:P4-C`'nin engellemek için yazıldığı şeyin tam olarak kendisi.
- **R2.** `reasoning-claude.ts`'deki `scrubbedEnv` listesi yeni anahtar isimlerini bilmiyor. Eklenmezse OKX key'leri spawn edilen Claude CLI'ye sızar. **Bu, entegrasyonun en somut güvenlik açığı.**
- **R3.** `.env` git-ignore'da ama `.env.local` de repo kökünde duruyor. Yeni anahtar eklerken hangi dosyaya gittiğini kontrol edin.
- **R4.** Ajan Trade Kit / CEX key'leri **hiçbir koşulda** bu repoya girmemeli — CEX anahtarı gerçek para demek, proje ise %100 testnet.

### 6.2 Testnet / mainnet

- **R5.** Proje mutlak biçimde %100 testnet (CLAUDE.md başlık satırı). OKX Agentic Wallet ~20 chain destekliyor ama testnet kapsamı chain başına değişiyor. **Açık soru: X Layer testnet (1952 mi 195 mi — doğrulanmalı) Agentic Wallet'ta destekleniyor mu?** Desteklenmiyorsa entegrasyon mainnet'e zorlar ve bu bir red sebebidir.
- **R6.** OKX x402 facilitator'ının testnet endpoint'i var mı? blocky402'nin `https://api.testnet.blocky402.com` karşılığı. Yoksa üçüncü ray demoda çalıştırılamaz, sadece kod olarak durur — ve çalışmayan kod submission'da sayılmaz.
- **R7.** X Layer testnet faucet'i, mevcut faucet darboğazına (0.1 OG/gün) dördüncü bir kalem ekler.

### 6.3 Mevcut sponsor entegrasyonlarıyla çakışma

- **R8 (en ciddi risk).** Projenin en güçlü mimari cümlesi: *"Base = verdict · Hedera = timeline · The Graph = okuma · 0G = compute. Hiçbir katman bir diğerini tekrarlamıyor."* (CLAUDE.md §2.1). **X Layer'ı ikinci bir verdict zinciri yapmak bu cümleyi kırar.** Jüri haklı olarak "hangisi doğruluk kaynağı?" diye sorar. Yanıt önceden hazırlanmalı ve tercihen X Layer'a farklı bir rol verilmeli — örneğin "gas-free tekrar zinciri: aynı verdict, ücretsiz doğrulanabilir" — ya da açıkça "iki zincir, aynı deterministik verdict, birbirinden bağımsız" denmeli.
- **R9.** Hedera x402 rayı bir sponsor teslimatıdır. OKX x402 rayı onun yerine geçemez; **ek** olmalı. Ödeme rayı sayısı 2→3 olunca demo dallanması, dashboard etiketleri ve fixture setleri de üçe çıkar.
- **R10.** OKX.AI'nin kendi Task Marketplace'i (`okx-ai` skill'i) bu projenin *tam olarak yaptığı işi* yapıyor — ajan işi yayınlama/kabul/teslim/uyuşmazlık. Bu bir çakışma **ve** bir fırsat: "bizim katkımız marketplace değil, marketplace'in altına giren intent-binding" konumlandırması net biçimde yapılmazsa proje bir OKX ürününün zayıf kopyası gibi görünür.
- **R11.** Sponsor sayısı zaten 4 (0G, Graph, Hedera, Base). Beşinci sponsor eklemek, video sürelerini (<3dk, 2-4dk, ≤5dk) ve README başına sponsor kuralını gerdirir.

### 6.4 Teknik açık sorular

1. X Layer testnet chainId **kesin olarak** kaç? (195 vs 1952 — deploy scripti bunu doğruluyor, yanlışsa hard fail.)
2. The Graph, X Layer'ı indeksliyor mu? İndekslemiyorsa keşif Base'de kalmak zorunda.
3. OKX x402 uygulaması `intentHash` taşıyabileceğimiz bir `extra`/metadata alanı sunuyor mu? **Evetse bu, tezi tamamlayan tek parça — hayırsa entegrasyon Hedera rayının bir kopyası olur.**
4. OKX x402 facilitator'ı `verify` ve `settle`'ı ayrı çağrılar olarak sunuyor mu? Ayırmıyorsa fraud demosu bu rayda çalışmaz (`settle` çağrılmadığını göstermek akışın kalbi).
5. Agentic Wallet imzalayabildiği şeylerle sınırlı mı, yoksa keyfi EIP-712 typed data imzalayabiliyor mu? EIP-712 intent imzası ona taşınacaksa şart.
6. ASP kaydı ERC-8004 agentId'sini mi kullanıyor, yoksa ayrı bir kayıt mı? Aynıysa Bob'un mevcut kaydı doğrudan listelenebilir.
7. X Layer'da EIP-3009 destekli bir USDC var mı? Yoksa ödeme oraya taşınamaz (zaten taşınması önerilmiyor).

---

## 7. Üç entegrasyon stratejisi

### Strateji A — Minimal ("dürüst ve ucuz")

**Kapsam:** ASP kaydı (3.7) + seçili skill dosyaları (3.6) + README/dashboard'da OKX.AI konumlandırması.

**Efor:** ~2-4 saat. Kod değişikliği yok; tek gereklilik Bob'un public URL'i.

**Kazanç:** Bitmiş proje OKX.AI'de listelenir. ERC-8004 kimliği zaten uyumlu olduğu için "aynı standardı konuşuyoruz" iddiası bedavaya gelir.

**Risk:** Neredeyse sıfır. Mevcut hiçbir kanıt, gate veya sponsor teslimatı etkilenmez.

**Ne zaman seçilir:** Hackathon teslim tarihi yakınsa veya mevcut 4 sponsor teslimatı henüz stabil değilse. **Varsayılan önerim bu.**

---

### Strateji B — Orta ("üçüncü ray + verdict aynası")

**Kapsam:** A'nın tamamı + OKX x402 ödeme rayı (4.1) + X Layer'a ikinci Verifier deploy'u (4.2).

**Efor:** ~2-3 gün.
- OKX x402 backend + gate: ~1 gün (kalıp `hedera-x402.ts`'de hazır, 218 satır)
- X Layer deploy parametrikleştirme + explorer + dashboard paneli: ~1 gün
- Fixture'lar, video, README güncellemeleri: ~0.5 gün

**Kazanç:** Gerçek, çalıştırılabilir kod entegrasyonu. `PaymentBackend`'in üç bağımsız ray taşıması, arayüzün tasarım iddiasını **kanıtlar** — "swappable" demek yerine göstermiş olursunuz. `intentHash` OKX payload'ına gömülebilirse, Hedera rayında itiraf edilen boşluk ilk kez kapanır.

**Risk:** R8 (verdict ayrımının bulanıklaşması) aktif olarak yönetilmeli. R6 (testnet facilitator) önceden doğrulanmazsa 1 gün boşa gider.

**Ne zaman seçilir:** En az 3 tam gün varsa ve açık sorular 3, 4, 6 önceden "evet" yanıtı almışsa. **Getiri/risk açısından en dengeli seçenek.**

---

### Strateji C — Kapsamlı ("ajan cüzdanı dahil")

**Kapsam:** B'nin tamamı + Agentic Wallet ile anahtar izolasyonu (4.3) + risk simülasyonunun `approvePrice` kararına bağlanması.

**Efor:** ~4-6 gün. Üstüne: 21 gate'in yeniden yeşile alınması, `gate:P4-C`'nin genişletilmesi, README §11 dürüstlük sınırlarının yeniden yazılması.

**Kazanç:** Projenin en zayıf noktası — anahtarların düz `.env`'de durması ve binding'in attested olmaması — kısmen kapanır. "Ajan otonomisi" iddiası, anahtarın bir enclave'de durmasıyla somutlaşır.

**Risk (yüksek):**
- §11'in "iki TEE değil, bir tane" sınırı ihlal edilmeye **çok** yatkın. Bu proje dürüstlük disiplini üzerine kurulu; bir aşırı-iddia, tüm submission'ın güvenilirliğine mal olur.
- 21 gate'lik test altyapısı anahtar yükleme kalıbına bağlı; signer değişimi geniş bir yüzeyi kırar.
- Açık soru 5 (keyfi EIP-712 imzalanabiliyor mu) "hayır" çıkarsa strateji ortada kalır.

**Ne zaman seçilir:** Hackathon sonrası, teslim baskısı olmadan devam edilecekse. **Teslim öncesi önermiyorum.**

---

## Özet tablo

| Bileşen | Karar | Nerede | Efor |
|---|---|---|---|
| 1. X Layer | ⚠️ Kısmi — sadece Verifier | `contracts/`, `scripts/deploy-verifier.ts`, `web/src/lib/` | ~1 gün |
| 2. OKX Wallet | ❌ Uymuyor — insan kullanıcı yok | — | — |
| 3. Agentic Wallet | ✅ En yüksek mimari değer, en yüksek risk | `packages/payment/src/signer/` | ~2-3 gün |
| 4. Onchain OS — Payments | ✅ Uyuyor, yüksek değer | `packages/payment/src/okx-x402.ts` (yeni) | ~1 gün |
| 4. Onchain OS — DEX/Analyze/DApp | ❌ Uymuyor | — | — |
| 5. Agent Trade Kit | ❌ Uymuyor — net red | — | — |
| 6. Skill dosyaları | ✅ Seçici, geliştirici aracı olarak | `.claude/`, `.mcp.json` | ~1 saat |
| 7. Marketplace / ASP | ✅ En yüksek getiri/efor | Kod değişikliği yok | ~2-4 saat |

---

# 8. Açık soruların çözümü (araştırma sonuçları)

**Yöntem:** Önce yerel kurulu OKX skill dosyaları (`~/.agents/skills/okx-*`, dokuzu da kurulu, toplam ~1.3 MB), sonra resmi GitHub repoları (`okx/payments` — **default branch `master`**, `okx/onchainos-skills`, `okx/agent-trade-kit`), sonra resmi dokümantasyon (web3.okx.com, thegraph.com, developers.circle.com).

**Kanıt seviyesi etiketleri:** `[KESİN]` birincil kaynaktan doğrudan okundu · `[GÜÇLÜ]` resmi dokümanda açık ama çapraz doğrulanmadı · `[AÇIK]` hâlâ belirsiz.

---

## S1 — X Layer testnet chainId kaç? 195 mi 1952 mi?

**Cevap: 1952. `[KESİN]`**

Yerel skill dosyası `okx-agentic-wallet/_shared/chain-support.md` yetkili tabloyu veriyor:

| Chain | CLI adı | chainIndex |
|---|---|---|
| XLayer | `xlayer` | **196** |
| XLayer Testnet | `xlayer_test` | **1952** |
| Base | `base` | 8453 |
| Ethereum | `ethereum` | 1 |

EVM chain'ler için `chainIndex == EVM chainId` (Base 8453 ve Ethereum 1 ile doğrulandı).

**195 eski/deprecated testnet'tir** — chainid.network hâlâ listeliyor, chainlist 1952'yi "active" gösteriyor. İkisini karıştırmak deploy'u sessizce yanlış zincire göndermez: `scripts/deploy-verifier.ts:29-32` zaten `provider.getNetwork()` ile chainId'i doğrulayıp hard fail veriyor. O kontrol korunmalı.

**Yan bulgular (deploy için kritik):**
- **Gas token OKB'dir, ETH değil.** `okx-ai/references/task-evaluator-staking.md:11` bunu açıkça uyarı olarak yazıyor: *"X Layer gas için ETH kullanmaz."* `deploy-verifier.ts:54` bakiyeyi `ethers.formatEther(...) + " ETH"` diye basıyor — X Layer'da bu etiket yanlış olur.
- Testnet RPC: `https://testrpc.xlayer.tech/terigon` (100 req/sn/IP limiti)
- Faucet: `https://web3.okx.com/xlayer/faucet` (skill dosyası `okx-agentic-wallet/references/wallet.md:81` de bu adresi veriyor)
- Explorer: `https://web3.okx.com/explorer/x-layer-testnet` · OKLink: `oklink.com/x-layer-testnet`
- X Layer artık **optimistic rollup** olarak dokümante ediliyor (eski "ZK-powered" ifadesi güncellenmiş).

---

## S2 — The Graph X Layer'ı indeksliyor mu?

**Cevap: Mainnet EVET, testnet HAYIR. `[KESİN]`**

- **X Layer Mainnet** desteklenen ağlar listesinde: `eip155:196`, native token OKB, Subgraph Studio quick-start rehberi mevcut.
- **X Layer Testnet (1952) desteklenen ağlar listesinde YOK.**

**Sonuç — bu, X Layer planını doğrudan sınırlıyor:** keşif katmanı (`subgraph/`, `packages/shared/src/discovery.ts`) X Layer **testnet**'e taşınamaz. §4.2'deki "sadece Verifier'ı taşı, keşfi Base'de bırak" tavsiyesi bu bulguyla teyit edildi — ama artık bir tercih değil, bir **zorunluluk**. X Layer testnet'e atılan `JobVerified` event'leri hiçbir subgraph tarafından indekslenemez, yani verified-delivery sayacı oradan beslenemez.

---

## S3 — x402 payload'ında `intentHash` taşıyacak `extra`/metadata alanı var mı?

**Cevap: EVET, `extra` alanı var ve serbest tipli — ama tek başına kriptografik bağlama SAĞLAMAZ. `[KESİN]`**

`okx/payments` reposundaki `typescript/SELLER.md`: her route'un `accepts` girdisi (`PaymentOption` tipi) bir **`extra: Record<string, unknown>`** alanı taşıyor. SDK bunu şema özel seçenekler için kullanıyor (`{ assetTransferMethod: "permit2" }`, `{ decimals }`), ama tip tamamen serbest — `{ intentHash }` koymak mümkün.

**Ama kritik uyarı `[KESİN]`:** `okx-agent-payments-protocol/references/accepts-schemes.md` §Security, `exact` şemasında imzanın **yalnızca `(from, to, value, nonce)`** alanlarına bağlandığını yazıyor. Yani `extra.intentHash` **taşınır ama imzalanmaz** — bir aracı onu değiştirebilir ve imza geçerli kalır. Bu, `hedera-x402.ts:14-16`'daki mevcut boşluğun aynısıdır, sadece farklı bir kılıkta.

### Beklenmedik bulgu: `nonce` alanı boşluğu bedavaya kapatıyor

`okx/payments` içindeki `app-x402-evm/src/constants.ts`, EIP-3009 tip tanımını şöyle veriyor:

```ts
export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;
```

Bu, `packages/payment/src/base-stealth.ts:59-68`'deki `TRANSFER_WITH_AUTHORIZATION_TYPES` ile **birebir aynı**.

EIP-3009'da `nonce` sıralı bir sayaç değil, ödeyenin seçtiği **serbest bir bytes32**'dir (yalnızca replay koruması için kullanılır — `authorizationState(authorizer, nonce)`). `base-stealth.ts:135` bugün onu `hexlify(randomBytes(32))` ile dolduruyor.

**`nonce`'u `intentHash`'e (ya da ondan türetilmiş bir taahhüde) eşitlemek, intent'i imzanın İÇİNE sokar** — zincir üstünde, kalıcı olarak, hiçbir protokol değişikliği olmadan. Alice zaten `intentHash`'i EIP-712 ile imzalıyor; onu EIP-3009 nonce'u yaparsa **aynı taahhüt iki bağımsız imzanın içinde** olur ve ödeme kaydı ile iş kaydı ayrılamaz hâle gelir.

Bu bulgu **OKX'ten bağımsızdır** — mevcut Base rayında tek satırlık bir değişiklik ve `hedera-x402.ts`'de itiraf edilen boşluğu Base tarafında kapatır.

**Gizlilik uyarısı — bu bedava değil:** stealth rayında `nonce = intentHash` yazmak, `intentHash`'i zincir üstünde açığa çıkarır ve ödemeyi işe bağlanabilir kılar; bu tam olarak stealth adresinin engellemek için var olduğu şeydir. Doğrusu ham hash değil bir **taahhüt** yazmaktır: `nonce = keccak256(intentHash ‖ salt)`, `salt` Alice ve Bob arasında ECIES zarfıyla paylaşılır. Böylece bağlama korunur, açığa çıkma olmaz.

---

## S4 — verify/settle ayrı çağrılar mı? Fraud demosu bu rayda çalışır mı?

**Cevap: EVET, ayrı — ve beklenenden çok daha iyi. `[KESİN]`**

İlk bakışta hayır görünüyordu: buyer-side CLI'de `onchainos payment pay --payment-id` imzalar **ve** replay eder, `a2a-pay pay` ise TEE ile imzalayıp krediyi tek adımda gönderir (`tx_hash` döner). Ama bunlar alıcı tarafı; bizim ihtiyacımız satıcı tarafı.

Satıcı tarafı `okx/payments` reposunda mevcut ve doğrudan kaynaktan okundu — `typescript/bu-payments/app-x402-core/src/server/x402ResourceServer.ts`:

```ts
export type BeforeSettleHook = (
  context: SettleContext,
) => Promise<void | { abort: true; reason: string; message?: string }>;
```

Altı yaşam döngüsü hook'u var: `onBeforeVerify` / `onAfterVerify` / `onVerifyFailure` / `onBeforeSettle` / `onAfterSettle` / `onSettleFailure`. `onBeforeVerify` ve `onBeforeSettle` **`{ abort: true, reason }` döndürerek akışı durdurabiliyor.**

**Bu, `assertJobVerified` gate'i için ideal bağlantı noktasıdır.** Bugün o kontrol `settle()`'ın ilk satırında elle çağrılıyor (`base-stealth.ts:305-311`, `hedera-x402.ts:181-187`); OKX SDK'sında aynı kural **SDK'nın kendi sözleşmesi olarak** ifade edilebilir:

```ts
resourceServer.onBeforeSettle(async (ctx) => {
  try { await assertJobVerified(provider, verifierAddress, jobVerifiedTx, intentHash); }
  catch (e) { return { abort: true, reason: 'JobVerified not found for this intentHash' }; }
});
```

Fraud demosu bu rayda **çalışır** — hatta daha okunaklı görünür: iptal `reason` alanıyla birlikte gelir.

### Daha büyük bulgu: OKX SDK'sı `@x402/core`'un kardeşi

`x402ResourceServer`'ın public metotları — `initialize()`, `buildPaymentRequirements()`, `verifyPayment()`, `settlePayment()`, `register(network, scheme)` — projenin `hedera-x402.ts:20,84-90,131,158,190`'da **zaten kullandığı isimlerin aynısı**. `HTTPFacilitatorClient` de aynı: `/verify`, `/settle`, `/supported` uçlarına giden, `url` alan bir sınıf (`app-x402-core/src/http/httpFacilitatorClient.ts:248-392`) — bizim `hedera-x402.ts:19`'da `@x402/core/http`'ten import ettiğimizin aynısı.

Yani `@okxweb3/app-x402-core` (v0.2.1), projenin kullandığı `@x402/core` 2.19.0'ın bir fork'u/kardeşidir. **`createHederaX402Backend`'in 218 satırı neredeyse yapısal değişiklik olmadan taşınır.**

---

## S5 — Agentic Wallet keyfi EIP-712 typed data imzalayabiliyor mu?

**Cevap: EVET, EVM'de. `[KESİN]`**

`okx-agentic-wallet/references/wallet-cli-reference.md:179-195`:

```bash
onchainos wallet sign-message --chain <chain> --from <address> \
  --message '<JSON typed-data>' --type eip712
```

- `--type`: `personal` (EIP-191, EVM+Solana) veya **`eip712`** (yalnızca EVM; Solana hata döner)
- `--message`: `eip712` için **serbest JSON typed-data string**
- Dönüş: `signature` (EVM'de hex)

Yani Alice'in EIP-712 intent imzası (`packages/shared/src/intent.ts`) teknik olarak bu cüzdana taşınabilir.

**Ama üç ciddi engel var:**

1. **Etkileşimli login. `[KESİN]`** `wallet.md:7-9`: kimlik doğrulama gerektiren komutlar (`sign-message` dahil) canlı oturum ister ve login **tarayıcıda sosyal giriş** açar — `login --phase init` bir URL döndürür, sonra `--phase poll` ile 5 dakikaya kadar bloklanır. Bu, 21 kapılık otomatik test altyapısıyla (`tests/gates/`) ve CI ile **uyumsuzdur**.
2. **`ak` (API Key) login tipi var `[GÜÇLÜ]`** (`wallet.md:37`'de `loginType: 'ak' → "API Key"` olarak listeleniyor) ve `onchainos-skills` README'si `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` istiyor. CLI ayrıca **MCP sunucusu olarak da çalışıyor** (`onchainos mcp`). Yani programatik bir yol muhtemelen var — ama `sign-message`'ın AK oturumuyla etkileşimsiz çalıştığı **doğrulanmadı `[AÇIK]`**.
3. **Base Sepolia desteklenmiyor. `[KESİN]`** Cüzdan adresi üretimi 7 chain'de: xlayer(196), xlayer_test(1952), solana, ethereum, base(**8453 — mainnet**), bsc, arbitrum. Testnet olarak **yalnızca X Layer testnet** var; tüm skill setinde geçen tek testnet referansı X Layer faucet'i. Projenin verdict zinciri Base Sepolia (84532) olduğu için **Alice'in intent imzası bu cüzdana taşınamaz** — cüzdan o zincirde yok.

**Sonuç:** S5 teknik olarak "evet", pratik olarak "bu proje için hayır". §3.3'teki Agentic Wallet değerlendirmesi ve Strateji C'nin riskli sayılması bu bulguyla doğrulandı; **Strateji C artık önerilmiyor değil, uygulanabilir değil** — mevcut mimari Base Sepolia'ya bağlı olduğu sürece.

---

## S6 — ASP kaydı mevcut ERC-8004 agentId'sini kullanıyor mu?

**Cevap: HAYIR. Ayrı bir kayıt, ayrı bir zincirde. `[KESİN]`**

`okx-ai/SKILL.md:99` kesin: *"**Chain-fixed** — agent identities live on XLayer only. Never pass `--chain` to any `agent` identity command."*

`okx-ai/references/task-core.md:5`: *"OKX AI Task Marketplace is a decentralized agent task delegation protocol **deployed on XLayer**"* — üç rol (User Agent / ASP / Evaluator), hepsi ERC-8004 on-chain kimliğiyle bağlanıyor.

`task-cli-reference.md:149` yetersiz bakiye çıktısını `chain:"XLayer", chainIndex:"196"` diye veriyor — yani **X Layer MAINNET**.

Bizim Bob'umuz Base Sepolia'daki ERC-8004 IdentityRegistry'de kayıtlı (`ERC8004_IDENTITY`, `packages/shared/src/identity.ts`). Farklı zincir ⇒ farklı kontrat ⇒ **farklı agentId uzayı**. `BOB_AGENT_ID` OKX.AI'ye taşınamaz; ikinci bir kayıt gerekir.

### ASP kaydının gerçek gereksinimleri `[KESİN]`

`okx-ai/references/identity-register.md` §1-3 ve `identity-invariants.md`:

| Gereksinim | Detay |
|---|---|
| Rol | `--role asp` (kanonik token; `provider`/`seller` reddedilir) |
| Cüzdan başına | **Rol başına tek kimlik.** İkinci ASP için başka adres gerekir |
| İsim | marka adı, EN 3-25 karakter |
| Açıklama | zorunlu, ≤500 karakter |
| **Avatar** | **ZORUNLU** — gerçek bir görsel dosyası |
| Servis tipi | `A2MCP` (API servisi) veya `A2A` (ajandan ajana) |
| Endpoint | `A2MCP` için zorunlu, **public `https://`** |
| Fiyat | düz sayı string (`"10"`), **para birimi daima USDT** |
| Onay | ilk kez için on-chain consent gate |

**Endpoint kuralı sert `[KESİN]`** (`identity-register.md:119`): `http://`, `localhost`, `127.0.0.1`, RFC-1918 özel IP'ler, `*.local`, mock URL'ler **reddediliyor**. Ve *"publicly-reachable `https://` URL is required and is permanent on-chain."* Bizim `BOB_PUBLIC_URL` bugün boş → localhost'a düşüyor (`.env.example:22`); bu hâliyle kayıt **başarısız olur.**

**Ödeme modu servis tipinden türüyor `[KESİN]`** (`task-cli-reference.md:373`): `A2A → escrow`, `A2MCP → x402`. `task-core.md:125`: `paymentMode: 0=unset / 1=escrow / 3=x402`. Bob bir A2MCP servisi olarak kaydedilirse ödeme yolu **x402** olur — projenin zaten konuştuğu protokol.

### Çakışma, düşünülenden daha derin

OKX.AI Task Marketplace ajanlar arası iletişimi **XMTP uçtan uca şifreli kanallar** üzerinden yapıyor (`task-core.md:5`). Bu, projenin ECIES mesajlaşma katmanının (`packages/shared/src/ecies.ts`) doğrudan muadili. §6 R10'daki uyarı bu bulguyla güçleniyor: OKX.AI yalnızca *pazar yerini* değil, **gizli mesajlaşma katmanını da** çözmüş durumda. Projenin farklılaştırıcısı olarak geriye kalan tek şey **intent-binding**'dir — ve konumlandırma tam olarak buna daraltılmalıdır: *"OKX.AI işi eşleştiriyor ve şifreli taşıyor; biz teslim edilen işin sipariş edilen iş olduğunu kanıtlıyoruz."*

---

## S7 — X Layer'da EIP-3009 destekli USDC var mı?

**Cevap: EVET, hem mainnet hem testnet'te native Circle USDC var. `[KESİN]`**

Circle'ın resmi kontrat adresleri dokümanı:

| Ağ | Native USDC adresi |
|---|---|
| X Layer mainnet | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` |
| X Layer testnet | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` |
| Base Sepolia (çapraz kontrol) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` ✓ `.env.example:13` ile birebir aynı |

Circle native USDC (v2) `transferWithAuthorization`'ı **natively** implemente ediyor. X Layer'da ayrıca `USDC.e` adında köprülenmiş bir temsil var — **Circle tarafından ihraç edilmemiş, EIP-3009 garantisi yok**; karıştırılmamalı.

**Uyumsuzluk uyarısı:** OKX'in kendi x402 yığını USDC değil **USDT0** kullanıyor — `SELLER.md` varsayılanı `0x779ded0c9e1022225f8e0630b35a9b54be713736` (6 ondalık), ve `okx-ai` kayıt akışında *"USDT is the implicit, only currency"*. Yani "X Layer'da USDC var" ile "OKX'in ödeme yolu USDC kabul eder" aynı şey değil. Kendi Verifier'ımızı ve kendi EIP-3009 rayımızı X Layer'da USDC ile çalıştırmak mümkün; OKX'in facilitator'ından geçmek USDT0 demek.

---

## 8.7-DÜZELTME 🔴 — §8.8'in ana sonucu YANLIŞTI

> **Uygulama sırasında (2026-08-20) çürütüldü. Aşağıdaki §8.8'i bu bölümü okumadan kullanma.**

§8.8, OKX'in x402 yığınının **mainnet-only** olduğunu söylüyor. Değil. OKX'in kendi canlı
mock merchant'ı X Layer **testnet** sunuyor:

```
$ curl -s https://www.okx.com/api/v1/pay/mock-merchant/resource | jq '.accepts[].network'
"eip155:1952"
"eip155:1952"
```

**Hatanın kaynağı:** `typescript/SELLER.md`'deki *"X Layer only — no other networks"*
ifadesini "testnet desteklenmiyor" diye okudum. İfade **"Base/Solana desteklenmiyor"**
demek — aynı repodaki Go `SELLER.md` testnet'leri açıkça listeliyor. Kinora projesi de aynı
hatayı yapıp zincir kanıtıyla düzeltmiş; playbook'u bunu ayrı bir doğrulama kuralı olarak
yazmış: *tek bir dokümanın kapsam ifadesinden genel sonuç çıkarma.*

**Sonuç planı bozmadı, iyileştirdi.** Blocky402'ye düşmeye gerek yok: üçüncü ray OKX'in
**gerçek** facilitator'ından geçiyor ve proje %100 testnet kalıyor. `okx-x402.ts` bu şekilde
uygulandı; `gate:P4-E` testnet desteğini her çalıştırmada yeniden doğruluyor.

**§8.8'de hâlâ doğru olanlar:** ASP kaydı ve görev pazarı gerçekten X Layer **mainnet**'te
(`okx-ai/SKILL.md:99`), The Graph gerçekten X Layer testnet'ini indekslemiyor, ve Agentic
Wallet'ta gerçekten Base Sepolia yok. Çürüyen tek şey **ödeme rayının** mainnet zorunluluğu.

---

## 8.8 — Tüm araştırmanın tek cümlelik sonucu

**OKX.AI'nin ajan ekonomisi yığını (kimlik + görev pazarı + x402 ödeme + facilitator) X Layer MAINNET üzerinde çalışıyor; bu proje ise %100 testnet.** Bu, tek ve merkezi kısıttır ve önceki bölümlerdeki risk maddelerinin çoğunu tek bir başlık altında toplar:

| Kanıt | Kaynak |
|---|---|
| Ajan kimlikleri yalnızca XLayer'da | `okx-ai/SKILL.md:99` `[KESİN]` |
| Görev pazarı XLayer'da deploy | `okx-ai/references/task-core.md:5` `[KESİN]` |
| Bakiye uyarıları `chainIndex:"196"` (mainnet) | `task-cli-reference.md:149,297,307` `[KESİN]` |
| ~~x402 SDK'sı yalnızca `eip155:196` / USDT0~~ | **ÇÜRÜDÜ — §8.7-DÜZELTME.** OKX `eip155:1952`'yi canlı sunuyor |
| The Graph X Layer **testnet**'i indekslemiyor | thegraph.com supported-networks `[KESİN]` |
| Agentic Wallet'ta Base Sepolia yok | `chain-support.md` `[KESİN]` |
| Evaluator stake'i gerçek OKB gerektiriyor | `task-evaluator-staking.md:7` `[KESİN]` |

### Ama bir kaçış yolu var — ve iyi bir tane `[KESİN]`

SDK'nın kendisi **zincir-agnostik**. `app-x402-evm/src/exact/{client,server}/register.ts`, ağ verilmediğinde `eip155:*` **joker** kaydı yapıyor; `OKXFacilitatorClient` chainIndex'i ağ string'inden parse ediyor (`parseChainIdFromNetwork`). Zincir kısıtı SDK'da değil, **facilitator'da** — hangi chainIndex'i settle edeceğine OKX SA API karar veriyor.

Ve `@okxweb3/app-x402-core` ayrıca standart bir **`HTTPFacilitatorClient`** ihraç ediyor (`url` parametresi alan, `/verify` `/settle` `/supported` konuşan) — projenin `hedera-x402.ts:19`'da `@x402/core/http`'ten import ettiğinin aynısı.

**Dolayısıyla mümkün olan şey:** OKX'in x402 SDK'sını **kütüphane katmanı** olarak benimseyip, facilitator olarak blocky402 testnet'i (`https://api.testnet.blocky402.com`) kullanmak. Bu:
- gerçek OKX kodudur (`@okxweb3/app-x402-*`), süs değil,
- `onBeforeSettle` abort hook'u sayesinde `assertJobVerified` gate'ini SDK'nın kendi sözleşmesine taşır — fraud demosu güçlenir,
- **%100 testnet kalır**, gerçek para gerektirmez,
- ve dürüstçe "OKX'in x402 uygulamasını kullanıyoruz, OKX'in facilitator'ını değil" diye etiketlenebilir — ki §11'in gerektirdiği türden bir cümledir.

---

## 8.9 — Stratejilerin revizyonu

| Strateji | §7'deki durum | Araştırma sonrası |
|---|---|---|
| **A — Minimal** | Önerilen varsayılan | **Kısmen geçersiz.** ASP kaydı X Layer *mainnet*'te, gerçek OKB gerektiriyor, avatar + public HTTPS endpoint şart, ve tek başına "%100 testnet" iddiasını bozar. Skill dosyaları kısmı geçerli kalıyor. |
| **B — Orta** | Dengeli seçenek | **Güçlendi ve şekli değişti.** OKX x402 rayı S3/S4 sayesinde beklenenden çok daha iyi oturuyor (aynı SDK ailesi, abort hook'u, aynı EIP-3009 tipleri). Ama X Layer ayağı zayıfladı: testnet'te subgraph yok, gas OKB, ERC-8004 registry yok. |
| **C — Kapsamlı** | Riskli, önerilmiyor | **Uygulanamaz.** Agentic Wallet'ta Base Sepolia yok; etkileşimli tarayıcı login'i 21 kapılık test altyapısıyla uyumsuz. |

### Revize öneri — Strateji B′ ("SDK katmanı, mainnet değil")

**Kapsam:**
1. `packages/payment/src/okx-x402.ts` — `@okxweb3/app-x402-core` + `@okxweb3/app-x402-evm` üzerine üçüncü `PaymentBackend`, facilitator olarak blocky402 testnet. `hedera-x402.ts`'nin yapısı korunur; `assertJobVerified` `onBeforeSettle` hook'una taşınır.
2. `base-stealth.ts:135` — `nonce`'u rastgeleden `keccak256(intentHash ‖ salt)`'a çevir. **OKX'ten bağımsız, tek satır, tezi tamamlıyor.** Yeni bir gate: nonce'un taahhüde çözüldüğü doğrulanır.
3. Skill dosyaları (`okx-agent-payments-protocol` zaten kurulu) — geliştirme aracı olarak, submission'da entegrasyon diye sayılmadan.
4. X Layer testnet'e Verifier deploy'u — **opsiyonel**, yalnızca zaman kalırsa, ve yalnızca "aynı verdict, gas-free ikinci zincirde" çerçevesiyle. Subgraph oraya kurulamayacağı için keşif kesinlikle Base'de kalır.

**Efor:** ~1.5-2 gün (madde 1: ~1 gün · madde 2: ~2 saat + gate · madde 3: ~1 saat · madde 4: ~0.5 gün).

**Neden bu:** gerçek OKX kodu çalışır, testnet saflığı bozulmaz, fraud demosu güçlenir ve `hedera-x402.ts`'de itiraf edilen bağlama boşluğu — OKX entegre edilsin ya da edilmesin — kapanır.

**Paket erişilebilirliği — doğrulandı `[KESİN]`:** `@okxweb3/app-x402-*` paketleri npm'de public olarak yayınlanmış durumda (registry sorgusu, 2026-08-20):

| Paket | latest | sürüm sayısı | son değişiklik |
|---|---|---|---|
| `@okxweb3/app-x402-core` | 0.2.1 | 3 | 2026-08-04 |
| `@okxweb3/app-x402-evm` | 0.2.0 | 2 | 2026-08-04 |
| `@okxweb3/app-x402-express` | 0.2.0 | 2 | 2026-08-04 |

Yani `pnpm add @okxweb3/app-x402-core @okxweb3/app-x402-evm` yeterli — submodule veya vendor'lama gerekmiyor, ek efor yok.

**Dikkat:** `0.x` sürüm ve toplam 3 yayın, API'nin henüz stabil sayılmadığını gösteriyor. Hackathon penceresi için sorun değil, ama sürümler `package.json`'da **tam olarak pinlenmeli** (projenin `@x402/core` için zaten yaptığı gibi: `"@x402/core": "2.19.0"`, caret'siz).
