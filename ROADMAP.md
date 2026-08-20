# OKX Entegrasyon Roadmap'i

> ## ⚠️ UYGULAMA SONRASI DURUM (2026-08-20)
>
> **Faz 0, A, B (kod), C, D uygulandı.** Branch: `feat/okx-integration`, commit yok.
> Kanıtlar: [`docs/EVIDENCE.md`](docs/EVIDENCE.md).
>
> **İki şey bu roadmap'te yazandan farklı çıktı:**
>
> 1. **§A.1'deki "blocky402 facilitator" kararı geçersiz.** `ANALYSIS.md` §8.8'in
>    "OKX mainnet-only" sonucu yanlıştı (bkz. §8.7-DÜZELTME). OKX'in gerçek facilitator'ı
>    X Layer **testnet**'i sunuyor, dolayısıyla ray **OKX'in kendi facilitator'ından**
>    geçiyor ve testnet saflığı korunuyor. Daha iyi bir sonuç.
> 2. **§0'daki `run-types.ts` düzeltmem yarı yanlıştı.** Satır 90 gerçekten `rail: string`,
>    **ama** satır 20'de `PaymentRail` union'ı var ve genişletilmesi gerekti. Ayrıca
>    `web/src/lib/server/runner.ts:25`'te İKİNCİ bir `PaymentRail` daha var.
>
> **Faz 0.1 gerçekleşmedi:** `@okxweb3/app-x402-*` kurulmadı. Yerine `@x402/evm@2.19.0`
> (mevcut `@x402/core` ile aynı sürüm) + elle yazılmış facilitator istemcisi — Kinora'nın
> kanıtlanmış deseni. Sebep: `HTTPFacilitatorClient`'ın `createAuthHeaders` hook'u argümansız
> çağrılıyor, OKX ise gövdeyi de imzalıyor; ve OKX'in paket ailesini almak 0.2.x'te ikinci
> bir `x402ResourceServer` demek olurdu.
>
> **Kalan:** Faz B'nin deploy'u (faucet), canlı OKX ödemesi (API anahtarı), Faz E (ayrı onay).



**Dayanak:** `ANALYSIS.md` §1-§7 (mimari analiz) + §8 (S1-S7 araştırma bulguları)
**Tarih:** 2026-08-20 · **Durum:** hiçbir adım uygulanmadı (`git status`: yalnızca `ANALYSIS.md` untracked)
**Kapsam kararı:** Önce testnet (Faz A-D), sonra ayrı onayla mainnet (Faz E).

---

## 0. Roadmap'i yazarken bulunan yeni gerçekler

Bu roadmap'i hazırlarken kodu tekrar okudum ve `ANALYSIS.md` §4'teki üç satırın yanlış, iki
şeyin ise eksik olduğu ortaya çıktı. Roadmap bunların **düzeltilmiş** hâline dayanıyor.

| Bulgu | Etki | Kaynak |
|---|---|---|
| **`web/src/lib/run-types.ts:90` zaten `rail: string`** — union değil | §4.1'deki "rail union genişletilir" satırı **gereksiz**; dosyaya dokunulmayacak | doğrulandı |
| **Rail etiketi `TimelinePanel`'de değil, `FraudPanel.tsx:63-90`'da** (`RAILS` dizisi + `railName()`) | §4.1'deki hedef dosya **yanlıştı**; doğru dosya FraudPanel | doğrulandı |
| **Gate sayısı 21, 22 değil** | `ANALYSIS.md` §1.2'deki "22 faz kapısı" hatalı; regresyon kanıtı 21 üzerinden verilecek | `ls tests/gates/*.ts \| grep -v /_` = 21 |
| **`bob-agent` `127.0.0.1`'e bind ediyor** (`src/index.ts:503`) | Railway/PaaS'ta **çalışmaz**. Faz E için zorunlu tek kod değişikliği | doğrulandı |
| **`bob-agent`'ın Dockerfile'ı yok** (`bob-binding`'in var) | Faz E'de deploy konfigürasyonu sıfırdan yazılacak | doğrulandı |
| **`BOB_PUBLIC_URL` boş → zincire `localhost` yazılmış** (`tests/gates/P2-A.ts:53,269-271`) | ERC-8004 kaydındaki endpoint şu an localhost. Faz E'de hem Base hem OKX tarafı güncellenmeli | gate zaten uyarıyor |
| **`@okxweb3/app-x402-*` npm'de yayınlı** (core 0.2.1, evm 0.2.0) | Faz A'da submodule/vendor gerekmiyor | registry sorgusu |
| **Bob'un fiyatı `1000000` / USDC 6dp = 1.00 USDC** (`bob-agent/src/index.ts:529`) | Faz E'de USDT'ye dönüşüm tabanı | doğrulandı |

---

## 1. Faz haritası ve bağımlılıklar

```
Faz 0  Ön koşullar (pin, faucet, baseline)          ~1 saat
  │
  ├──▶ Faz A  OKX x402 rayı (Strateji B′)           ~1-1.5 gün   ← testnet, ana değer
  │      │
  ├──▶ Faz B  X Layer Verifier deploy               ~0.5-1 gün   ← testnet, A'dan bağımsız
  │      │
  ├──▶ Faz C  Skill dosyaları                       ~1 saat      ← bağımsız, her an
  │      │
  │      ▼
  └──▶ Faz D  Kanıt + dürüstlük güncellemeleri      ~0.5 gün     ← A ve B'yi bekler
         │
         ▼
       Faz E  ASP kaydı (X LAYER MAINNET)           ~0.5-1 gün   ← AYRI ONAY GEREKLİ
```

**A ve B paralel yürütülebilir** — ortak dosyaları yok. C her an yapılabilir.
**D, A ve B bitmeden başlamamalı** (kanıt üretilmemiş olur).
**E, D'den sonra ve yalnızca açık onayla.**

---

## Faz 0 — Ön koşullar

| # | İş | Çıktı |
|---|---|---|
| 0.1 | `pnpm add @okxweb3/app-x402-core@0.2.1 @okxweb3/app-x402-evm@0.2.0` — **caret'siz, tam pin** (`@x402/core: "2.19.0"` kalıbı; 0.x API stabil değil) | `package.json` |
| 0.2 | **Baseline kanıtı:** 21 gate'i şu anki hâliyle çalıştır, çıktıyı sakla | `docs/EVIDENCE.md` §baseline |
| 0.3 | X Layer testnet faucet'ten **OKB** al (`web3.okx.com/xlayer/faucet`) — gas ETH değil | deployer bakiyesi > 0 OKB |
| 0.4 | RPC erişimini doğrula: `testrpc.xlayer.tech/terigon`, `eth_chainId` → **`0x7a0` (1952)** | terminal çıktısı |

**Çıkış kriteri:** 21 gate'in kaç tanesinin şu an yeşil olduğu **yazılı** (regresyon ancak bilinen bir tabana göre kanıtlanır) + X Layer testnet'te bakiye var.

> **Not:** Bazı gate'ler canlı ağ/faucet gerektiriyor ve baseline'da da kırmızı olabilir. Amaç
> "hepsi yeşil" değil, **"A ve B sonrası aynı tablo"** — eklenen, çıkarılan değil.

---

## Faz A — OKX x402 rayı (Strateji B′)

**Tez:** OKX'in x402 SDK'sını **kütüphane katmanı** olarak kullan, facilitator olarak
blocky402 testnet'i koru. Gerçek OKX kodu çalışır, testnet saflığı bozulmaz.

### A.1 — `packages/payment/src/okx-x402.ts` (yeni, ~220 satır)

`hedera-x402.ts`'nin kardeşi. `PaymentBackend` arayüzünü implemente eder.

**Dosya başı yorumunda yazılacak üç şey (zorunlu):**

1. **Neden OKX facilitator'ı değil blocky402:** S6 — OKX'in resmi facilitator zinciri
   (`OKXFacilitatorClient`, OKX SA API) **yalnızca X Layer mainnet / USDT0**. Bu proje %100
   testnet olduğu için SDK'nın standart `HTTPFacilitatorClient`'ı blocky402 testnet'e
   yönlendiriliyor. Bu bir eksiklik değil, **bilinçli bir tercih** — ve SDK bunu destekliyor
   çünkü şema kaydı `eip155:*` joker.

2. **`extra.intentHash` KRİPTOGRAFİK BAĞLAMA DEĞİLDİR.** (aşağıda A.3)

3. **`settle()` gate'i:** ilk satır `assertJobVerified(...)`.

**API eşlemesi (S4'te doğrulandı — isimler `hedera-x402.ts` ile birebir aynı):**

| Bizim metot | OKX SDK karşılığı |
|---|---|
| `quote()` | `resourceServer.buildPaymentRequirements()` |
| `authorize()` | client scheme `createPaymentPayload()` + `verifyPayment()` |
| `verifyAuthorization()` | `resourceServer.verifyPayment()` |
| `settle()` | `assertJobVerified()` → `resourceServer.settlePayment()` |
| `verify()` | facilitator / explorer okuması |

### A.2 — Lifecycle hook'ları (S4)

Altı hook var; ikisi `{ abort: true, reason }` döndürebiliyor:

```ts
resourceServer.onBeforeSettle(async (ctx) => {
  try { await assertJobVerified(provider, verifierAddress, jobVerifiedTx, intentHash); }
  catch { return { abort: true, reason: 'JobVerified not found for this intentHash' }; }
});
```

**Bu, `settle()` içindeki elle kontrolün YERİNE GEÇMEZ — ona EK'tir.** İki katman:
`settle()`'ın ilk satırı bizim sözleşmemiz (gate onu test ediyor), hook ise SDK'nın kendi
sözleşmesi. Birini diğerine feda etmek, kanıtlanmış bir kuralı bir kütüphanenin davranışına
devretmek olur.

### A.3 — `extra.intentHash` — DÜRÜSTLÜK KURALI

`extra` alanına `intentHash` yazılacak, **ama şu cümlelerle belgelenecek:**

> `extra.intentHash` **taşınır, imzalanmaz.** `exact` şemasında EIP-3009 imzası yalnızca
> `(from, to, value, nonce)` alanlarını kapsar. Bu alanın değeri **gözlemlenebilirlik ve
> hata ayıklama** içindir: bir aracı onu değiştirebilir ve imza geçerli kalır. Ödemeyi işe
> bağlayan şey bu alan **değildir**.

**Yasak cümleler** (README, kod yorumu, dashboard, sunum — hiçbir yerde):
- ~~"intentHash ödeme payload'ına gömülü ve imzayla korunuyor"~~
- ~~"ödeme kriptografik olarak işe bağlı"~~ (bu rayda)

**İzinli cümle:** *"intentHash ödeme isteğinde taşınıyor; bağlama enclave ve kontrat
tarafında, ödeme imzasında değil."*

### A.4 — `nonce` bağlaması (ayrı iş, A'dan bağımsız — ama asıl kazanç burada)

`ANALYSIS.md` §8 S3'teki bulgu. `base-stealth.ts:135` bugün `nonce: hexlify(randomBytes(32))`.

```
nonce = keccak256(intentHash ‖ salt)
```

Bu, intent'i **imzanın içine** sokar — `extra`'nın yapamadığı şeyi yapar. `salt` ECIES
zarfıyla paylaşılır; ham `intentHash` yazmak stealth adresinin gizliliğini bozardı.

> **Bu adım OKX'ten tamamen bağımsızdır ve mevcut Base rayını iyileştirir.** OKX entegrasyonu
> iptal edilse bile yapılmaya değer. Ayrı bir gate ister (nonce'un taahhüde çözüldüğü).
> **Kapsam kararı:** A ile aynı PR'da olmalı mı, yoksa ayrı mı — senin çağrın. Ayrı tutmayı
> öneririm: farklı rayı, farklı riski, farklı tezi var.

### A.5 — Dokunulacak dosyalar (düzeltilmiş)

| Dosya | Satır | Değişiklik |
|---|---|---|
| `packages/payment/src/okx-x402.ts` | yeni | ~220 satır |
| `packages/payment/src/index.ts` | 21 | `PaymentRail`'e `'okx-x402'` |
| `packages/payment/src/index.ts` | 120-123 | `export * from './okx-x402.js'` |
| `packages/demo/src/index.ts` | 208-240 | `makePaymentBackend`'e üçüncü dal |
| `packages/demo/src/index.ts` | 65-66, 332 | `paymentRail` tipine `'okx'` |
| `packages/demo/src/index.ts` | 294 | `network:` dalı |
| `packages/bob-agent/src/index.ts` | 103-110 | `payment.network` yeni rayı kabul eder |
| `web/src/components/dashboard/FraudPanel.tsx` | 63-90 | `RAILS` dizisi + `railName()` — **§4.1'de yanlış dosya yazılıydı** |
| `.env.example` | yeni blok | `OKX_X402_FACILITATOR_URL`, `OKX_PAY_ACCOUNT` |
| `packages/shared/src/config.ts` | 72-91 | `LATER_KEYS`'e yeni anahtarlar |
| `tests/gates/P4-E.ts` | yeni | P4-A kalıbı |
| `package.json` | scripts | `"gate:P4-E"` |
| ~~`web/src/lib/run-types.ts`~~ | — | **DOKUNULMAYACAK** — zaten `rail: string` |

### A.6 — Gate P4-E

P4-A kalıbında: `quote → authorize → settle`, ve **`assertJobVerified`'in gerçekten
çağrıldığı runtime'da doğrulanır** (P4-A bunu nasıl yapıyorsa aynısı). Fraud senaryosunda
`settle()` çağrılmadığı da test edilir — bu rayın demoya girebilmesinin şartı.

**Faz A çıkış kriteri:**
- `pnpm gate:P4-E` yeşil, **canlı testnet çalıştırmasıyla** (fixture değil)
- Gerçek bir Hedera testnet tx hash'i + explorer linki
- Fraud modunda `settle()` çağrılmadığı kanıtlı
- 21 gate Faz 0 baseline'ıyla **aynı** (regresyon yok)

---

## Faz B — X Layer testnet'e Verifier deploy'u

**Rol tanımı (R8'e karşı, S2 gereği):**

> **X Layer = aynı verdict'in gas-free tekrar zinciri. Doğruluk kaynağı hâlâ Base.**
> Keşif Base'de kalmak **zorunda**, çünkü The Graph X Layer testnet'i indekslemiyor (S2).

Bu cümle README'de ve dashboard'da **birebir** geçmeli. "İki verdict zinciri" demek §2.1'in
temiz ayrımını bozar; "tekrar zinciri" demek bozmaz.

| # | İş | Not |
|---|---|---|
| B.1 | `contracts/src/Verifier.sol` | **değişiklik yok** — constructor zaten `chainId` alıyor |
| B.2 | `scripts/deploy-verifier.ts:18,29-32` | `CHAIN_ID` sabiti kalkar → `TARGET_CHAIN` env / `--chain` arg |
| B.3 | `scripts/deploy-verifier.ts:41-50` | idempotency chain başına: `VERIFIER_ADDRESS_XLAYER` |
| B.4 | `scripts/deploy-verifier.ts:54` | **`formatEther(...) + " ETH"` → gas token adı chain'e göre.** X Layer'da **OKB** (S1) |
| B.5 | **Gerçek deploy** — X Layer testnet 1952 | gerçek adres + tx hash |
| B.6 | `web/src/lib/explorers.ts` | X Layer explorer şeması (`web3.okx.com/explorer/x-layer-testnet` / OKLink) |
| B.7 | `web/src/lib/server/networks.ts:96-170` | beşinci `NetworkEvidence` bloğu |
| B.8 | `web/src/components/SponsorLogo.tsx` | `SponsorId`'ye `"okx"` + logo |

**Kapsam dışı (kesin):** ödeme (ERC-5564 singleton'ları X Layer'da yok), keşif (S2), HCS.

**Faz B çıkış kriteri:**
- X Layer testnet'te canlı contract adresi, explorer'da açılıyor
- `setEnclaveSigner` + `setRegisteredClient` X Layer'da da kurulu
- Base deploy'u **bozulmadı** (aynı script, iki chain, ikisi de idempotent)
- Dashboard'da "tekrar zinciri" ifadesi görünüyor

---

## Faz C — Skill dosyaları

Zaten kurulu (`~/.agents/skills/okx-*`, dokuzu da). Yapılacak: projeye **referans** eklemek.

| # | İş |
|---|---|
| C.1 | `.claude/` altına `okx-agent-payments-protocol` ve `okx-agentic-wallet` referansı |
| C.2 | Gerekirse `.mcp.json`'a `onchainos mcp` girdisi |
| C.3 | **README'de "entegrasyon" diye SAYILMAYACAK** — geliştirici aracı olarak etiketlenecek |

C.3 bir formalite değil: §11 dürüstlük sınırı, bir skill dosyasını ürün entegrasyonu gibi
göstermeyi yasaklar.

---

## Faz D — Kanıt + dürüstlük güncellemeleri

| # | İş |
|---|---|
| D.1 | **`docs/EVIDENCE.md` (yeni)** — baseline, üçüncü ray tx'leri, X Layer adres + tx, 21 gate öncesi/sonrası tablosu |
| D.2 | README: üçüncü ray + X Layer rolü + **A.3 dürüstlük kuralı** |
| D.3 | `CLAUDE.md` §11'e yeni madde: *"**Not** 'ödeme intent'e kriptografik olarak bağlı' — OKX rayında `extra` imzalanmıyor; bağlama enclave ve kontratta."* |
| D.4 | `ANALYSIS.md` düzeltmeleri: §1.2 "22 → 21 gate", §4.1 tablosunda `run-types.ts` ve `TimelinePanel` satırları |
| D.5 | Dashboard: X Layer "tekrar zinciri" ifadesi + keşfin neden Base'de kaldığı (S2) |

**Faz D çıkış kriteri:** Bir jüri `docs/EVIDENCE.md`'yi açıp her iddiayı bir explorer
linkiyle doğrulayabiliyor; hiçbir yerde A.3'ün yasak cümlelerinden biri geçmiyor.

---

## Faz E — ASP kaydı · ⚠️ X LAYER MAINNET · AYRI ONAY GEREKLİ

**Bu faz onaylanmadan başlamayacak.** Aşağıdakiler karar için gereken tam tablo.

### E.0 — Ne demek olduğu

| Boyut | Gerçek |
|---|---|
| Zincir | X Layer **mainnet** (chainIndex 196) — testnet değil |
| Geri alınabilir mi | **Hayır.** Kalıcı on-chain kayıt |
| Para hareketi | Kayıt bir ödeme değil — ama **gas için gerçek OKB** gerekiyor |
| Cüzdan başına | **Rol başına tek ASP.** İkincisi için başka adres |
| Endpoint | Public `https://`, kalıcı olarak zincire yazılıyor; değiştirmek yeni tx |

### E.1 — Bilinen blokerler (roadmap yazılırken bulundu)

| # | Bloker | Çözüm | Kod değişikliği? |
|---|---|---|---|
| 1 | `bob-agent` **`127.0.0.1`'e bind ediyor** (`src/index.ts:503`) — PaaS'ta erişilemez | `0.0.0.0` + `process.env.PORT` | **EVET** — tek satır. "İş mantığına dokunma" kuralının zorunlu istisnası; bind adresi iş mantığı değil |
| 2 | `bob-agent`'ın **Dockerfile'ı / deploy konfigürasyonu yok** | pnpm workspace'i build eden bir Dockerfile veya Railway nixpacks konfigü | Yeni dosya (iş mantığı dışı) |
| 3 | `BOB_PUBLIC_URL` boş → **zincire localhost yazılmış** (`P2-A.ts:53,269-271`) | Deploy sonrası hem Base ERC-8004 `setMetadata` hem OKX kaydı gerçek URL ile | Hayır — env + tx |
| 4 | Bob'un fiyatı **USDC**, OKX.AI **USDT** (tek para birimi) | 1.00 USDC → USDT karşılığı belirlenecek (Kinora: 0.1 USDT) | Hayır — kayıt parametresi |
| 5 | **Avatar zorunlu** | Görsel hazırlanacak | Hayır |
| 6 | `/card` çıktısının okunabilirliği | Kayıt öncesi gözden geçirilecek — OKX.AI'deki "yüz" | Hayır |

### E.2 — Sıra

1. Blokerler 1-2 çözülür → `bob-agent` deploy edilir (Railway; Kinora'nın kanıtlanmış yolu)
2. **Üç kez doğrula:** `curl https://<url>/card` dışarıdan, farklı ağdan, kayıt anında
3. `BOB_PUBLIC_URL` set edilir, `.env.example`'daki localhost varsayılanı kapatılır
4. Base ERC-8004 endpoint metadata'sı gerçek URL'e güncellenir (P2-A tekrar)
5. `onchainos agent create --role asp`, servis tipi **A2MCP** (HTTP endpoint → x402)
6. `/agents/[id]` URL'i → `ANALYSIS.md` + `docs/EVIDENCE.md`

### E.3 — Karar verilmesi gereken şey (teknik değil, konumlandırma)

`CLAUDE.md` başlığı: **"100% testnet"**. Bir mainnet kaydı bunu **yanlış** yapar.

Üç seçenek — biri seçilmeli, sessizce geçilmemeli:

| Seçenek | Sonuç |
|---|---|
| **(a)** Başlığı düzelt: *"100% testnet — ASP kimlik kaydı hariç (X Layer mainnet, para hareketi yok)"* | Dürüst, biraz uzun. **Önerim bu.** |
| **(b)** ASP kaydını yapma | "100% testnet" korunur, OKX.AI listelemesi olmaz |
| **(c)** Kaydı yap, başlığı değiştirme | **Kabul edilemez** — §11'in tam olarak yasakladığı şey |

### E.4 — Kinora emsali

Kinora'nın canlı listelemesi (`okx.ai/agents/11036`) süreci kanıtlıyor: Railway deploy'u
yeterli, karmaşık altyapı gerekmiyor, format (Service Description / Parameter Specification /
Request Method / Request Example / Endpoint / USDT fiyat) belli.

> **Kaynak notu:** Kinora'ya dair bilgiler senin verdiğin bilgiler; ben o listelemeyi
> bağımsız olarak doğrulamadım. Faz E'ye başlarken bir kez açıp formatı teyit ederiz.

---

## 2. Toplam efor ve sıralama önerisi

| Faz | Efor | Testnet güvenli? | Önerilen sıra |
|---|---|---|---|
| 0 — Ön koşullar | ~1 saat | ✅ | 1 |
| A — OKX x402 rayı | ~1-1.5 gün | ✅ | 2 (paralel) |
| B — X Layer Verifier | ~0.5-1 gün | ✅ | 2 (paralel) |
| C — Skill'ler | ~1 saat | ✅ | 3 (her an) |
| A.4 — nonce bağlaması | ~2 saat + gate | ✅ | 4 (ayrı PR) |
| D — Kanıt + dürüstlük | ~0.5 gün | ✅ | 5 |
| **E — ASP kaydı** | ~0.5-1 gün | ❌ **MAINNET** | 6 — **ayrı onay** |

**Testnet toplamı (0+A+B+C+D+A.4): ~3-4 gün.**

---

## 3. Bu roadmap'in taşıdığı üç kırmızı çizgi

1. **`extra.intentHash` imzalanmıyor.** Hiçbir belgede, kodda, sunumda aksi ima edilmeyecek
   (A.3).
2. **X Layer verdict zinciri değil, tekrar zinciri.** Doğruluk kaynağı Base; keşif S2 gereği
   orada kalmak zorunda (Faz B).
3. **Mainnet'e geçiş sessizce olmayacak.** Faz E onaylanırsa `CLAUDE.md`'nin "100% testnet"
   başlığı aynı commit'te düzeltilecek (E.3).
