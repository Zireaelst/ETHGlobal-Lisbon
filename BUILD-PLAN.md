# Confidential Agents — Uygulama Yol Haritası (BUILD PLAN v1)

> **Kaynak doküman:** `Confidential-Agents-Roadmap-v3.pdf` (TECHNICALLY LOCKED)
> **Ek kaynaklar:** `Confidential-Agents-Mimari.pdf` (v2), `Confidential-Agents-Hedera-Mentor-Brief.pdf`
> **Bağlam:** ETHGlobal Lisbon 2026 · 2 kişi · TypeScript · %100 testnet
> **Bu dokümanın işi:** v3'ün *ne* dediğini *nasıl* yapacağımıza çevirmek. v3'te bilinçli olarak ertelenmiş üç şeyi (iş bölümü, saat çizelgesi, submission checklist) burada kapatıyor.

---

## 0 — BU DOKÜMAN NASIL KULLANILIR

**Tek kural: kapıyı geçmeden ilerlemek yok.**

Her adım şu formatta:

| Alan | Anlamı |
|---|---|
| **Sahip** | Dev A / Dev B / Ortak |
| **Süre** | Hedef süre. 1.5× aşarsan dur ve fallback'e bak. |
| **Ön koşul** | Hangi kapılar geçilmiş olmalı |
| **Yapılacak** | Somut iş |
| **Çıktı** | Elimizde ne kalıyor |
| **🚦 GEÇİŞ TESTİ** | İkili (geçti/geçmedi) kriter. Ölçülebilir olmayan kriter yazılmadı. |
| **⛔ Geçmezse** | Fallback. v3 §12'deki risk tablosuyla uyumlu. |

**Disiplin kuralları:**

1. Bir kapı kırmızıysa, o dalın **üstüne** bir şey inşa etme. Yatayda başka bir dala geç.
2. Kapı testleri `tests/gates/` altında script olarak yaşar. "Bende çalıştı" kapı geçmez; `pnpm gate:P0-B` yeşil olacak.
3. Her kapı geçtiğinde: `git tag gate/P0-B` + Discord/Telegram'a tek satır not. Tag'ler geri dönüş noktalarımız.
4. **0G faucet günde 0.1 OG.** Bu projedeki en sert kısıt. Her gerçek 0G çağrısı fixture'a kaydedilir; UI/kontrat işi fixture ile yapılır (bkz. P0-D).
5. Dürüstlük sınırı v3 §12'de yazılı. Kodda ve videoda o sınırın dışına çıkan tek cümle kurmuyoruz.

**Sembol:** 🔴 kritik yol (bu gecikirse demo gecikir) · 🟡 track'e puan katan · 🟢 bonus, düşürülebilir

---

## 1 — BAŞLAMADAN ÖNCE: BİLİNMEYENLER LİSTESİ

v3 "technically locked" ama şu beş şey **kaynaktan doğrulanmadan** koda girmeyecek. Her biri P0'da bir doğrulama görevi:

| # | Bilinmeyen | Nerede kapanıyor | Yanlış çıkarsa etkisi |
|---|---|---|---|
| U1 | `agent-wrapper` seal imzasının **tam preimage formatı** (hex büyük/küçük harf, `0x` öneki, timestamp'in string gösterimi) | P0-C | Verifier.sol on-chain doğrulama yapamaz → tez çöker |
| U2 | Seal imzasının kapsadığı **body byte'larının tam serileştirmesi** | P0-C | Aynı |
| U3 | Base Sepolia'da **ERC-8004 registry'nin canlı adresi ve ABI'si** (on-chain metadata var mı, yoksa sadece URI mi) | P0-F | Subgraph'ın ne indeksleyeceği değişir |
| U4 | 0G Sealed Inference'ın **çağrı başı gerçek maliyeti** | P0-D | Storage bonusu düşer, dev bütçesi değişir |
| U5 | **Uçtan uca gecikme** (Alice → Tapp → 0G → imza → dönüş) | P0-G | Model küçültme / brief kısaltma gerekir |

Kural: bir bilinmeyen kapanana kadar ona bağlı kod **interface seviyesinde** yazılır, implementasyon boş bırakılır.

---

## 2 — REPO YAPISI VE SÖZLEŞMELER

### 2.1 Klasör düzeni

```
confidential-agents/
├─ packages/
│  ├─ shared/                 # HER İKİ AGENT'IN DE KULLANDIĞI TEK GERÇEK KAYNAK
│  │  ├─ src/canonical.ts     # canonicalJson, hashUtf8 — hash uyuşmazlığının panzehiri
│  │  ├─ src/schema.ts        # zod şemaları: Intent, TaskEnvelope, TappBody, ResultEnvelope
│  │  ├─ src/intent.ts        # EIP-712 domain/types, buildIntentHash, signIntent, recoverIntent
│  │  ├─ src/ecies.ts         # eth-crypto sarmalayıcı (encrypt/decrypt + string paketleme)
│  │  ├─ src/sealsig.ts       # Tapp seal imzası: preimage kurma + recover (v=27/28 brute)
│  │  ├─ src/ogsig.ts         # 0G EIP-191 çıktı imzası doğrulama
│  │  └─ src/config.ts        # env okuma + zod validation (eksik env'de erken patla)
│  ├─ alice-agent/            # istemci agent (Express + CLI)
│  ├─ bob-agent/              # işçi agent — DIŞ katman (402 sunar, Tapp'i çağırır)
│  ├─ bob-binding/            # ENCLAVE İÇİ kod — agent-wrapper Tapp image'ı
│  ├─ payment/                # PaymentBackend interface + 2 backend
│  └─ web/                    # demo-dApp (Next.js veya Vite+React)
├─ contracts/                 # Foundry
│  ├─ src/Verifier.sol
│  ├─ test/Verifier.t.sol
│  └─ test/fixtures/          # CANLI yakalanmış imzalar — kutsal, elle düzenlenmez
├─ subgraph/                  # agent0lab fork
├─ fixtures/
│  ├─ og/                     # kaydedilmiş 0G yanıtları (faucet koruması)
│  └─ seal/                   # kaydedilmiş Tapp imzaları
├─ tests/gates/               # P0-A.ts … P5-C.ts — kapı testleri
└─ scripts/                   # recover.js, capture-seal.ts, fund-check.ts
```

**Neden `bob-agent` ve `bob-binding` ayrı:** Tapp içindeki kod ölçülüyor (`imageHash`). Ne kadar küçük ve sabitse o kadar iyi. HTTP sunucusu, ödeme, loglama enclave dışında kalır. Enclave sadece: çöz → recompute → 0G çağır → imzayı doğrula → body imzala.

### 2.2 Stack kararları (tartışma kapandı)

| Karar | Seçim | Gerekçe |
|---|---|---|
| Dil | TypeScript, Node 20 LTS | v3 kilidi |
| Paket yöneticisi | pnpm workspaces | monorepo, hızlı |
| Zincir kütüphanesi | **ethers v6** (bizim kodumuz) | `verifyMessage`, `recoverAddress`, EIP-712 tek satır. SDK'lar viem isterse yerel olarak kullan, dışarı sızdırma |
| Kontrat | **Foundry** | fixture tabanlı imza testi için en hızlısı; `vm.parseJson` ile canlı imzayı teste sokarız |
| Şema doğrulama | zod | wire format disiplini; iki agent arasındaki sessiz uyuşmazlığı öldürür |
| Sunucu | Express | x402 middleware ekosistemi burada |

### 2.3 Kanonik veri şemaları — **ÖNCE BUNU ANLAŞIN**

İki geliştiricinin en çok zaman kaybettiği yer hash uyuşmazlığıdır. Bu yüzden şemalar P1'den önce donuyor.

**Kanonik JSON kuralı** (`shared/src/canonical.ts`):
```ts
// Anahtarlar sıralı, boşluk yok, undefined alanlar atılır.
export function canonicalJson(v: unknown): string { /* sorted-key stringify */ }
export const hashUtf8 = (s: string) => keccak256(toUtf8Bytes(s));
```
Brief ve data **ham string** olarak hash'lenir (`hashUtf8`). Constraints obje olduğu için `hashUtf8(canonicalJson(constraints))`.

**intentHash** (v3 §03'e birebir sadık, 5 alan):
```ts
intentHash = keccak256(abi.encode(
  bytes32 briefHash,        // hashUtf8(brief)
  bytes32 dataHash,         // hashUtf8(data)
  bytes32 constraintsHash,  // hashUtf8(canonicalJson(constraints))
  uint256 price,            // en küçük birim (USDC: 6 hane, HBAR: tinybar)
  uint256 nonce
))
```

**Intent (EIP-712 — Alice'in imzaladığı yapı):**
```ts
domain = { name: "ConfidentialAgents", version: "1", chainId: 84532, verifyingContract: VERIFIER }
Intent {
  bytes32 intentHash;   // yukarıdaki taahhüt
  address client;       // Alice
  bytes32 agentId;      // Bob'un ERC-8004 kimliği
  uint256 price;
  uint256 deadline;
}
```
*Tasarım notu:* Alice içeriği doğrudan değil, `intentHash` taahhüdü üzerinden imzalar. `agentId` yapının içinde çünkü aksi halde aynı imza başka bir worker'a replay edilebilir. `price` içinde çünkü settlement onu okuyor. `deadline` içinde çünkü süresi geçmiş intent kabul edilmemeli.

**TaskEnvelope** (Alice → Bob `/task`, ECIES ile şifrelenen içerik):
```ts
{
  v: 1,
  intent: { intentHash, client, agentId, price, deadline },
  aliceSig: "0x…",              // EIP-712 imzası
  brief: string,
  data: string,
  constraints: { model, maxTokens, temperature },
  nonce: string,                 // decimal string
  replyPubKey: "0x04…"           // Alice'in ECIES pubkey'i (sonuç için)
}
```
Tel üzerindeki gövde: `POST /task  { "to": "<agentId>", "cipher": "<eth-crypto cipher string>" }`

**TappBody** (enclave'in imzaladığı byte'lar) — **JSON DEĞİL, deterministik abi-encode:**
```ts
body = abi.encode(
  bytes32 intentHash,
  bytes32 outputHash,     // hashUtf8(outputText)
  bool    match,
  bytes32 ogSigHash       // keccak256(ogSig) — imzanın kendisi değil, taahhüdü
)
```
*Tasarım notu — bu doküman içindeki en önemli teknik karar:* Eğer Tapp bir JSON imzalasaydı, `Verifier.sol` on-chain JSON parse etmek zorunda kalırdı (kırılgan + pahalı). Alan-önce-hash yaklaşımı ise başka bir açık bırakır: gövdeyi görmeyen kontrat, iddia edilen alanların gerçekten imzalanan gövdede olduğunu bilemez. abi-encode ile kontrat gövdeyi **alanlardan yeniden üretir** ve `sha256`'sını karşılaştırır. Parse yok, açık da yok. `agent-wrapper` gövdeyi zorunlu olarak JSON/string alıyorsa: gövde = `hexlify(abi.encode(...))` string'i, kontrat da aynı hex string'i üretir. Hangisi olduğu **P0-C'de kaynağa bakarak** kesinleşir.

**ResultEnvelope** (Bob → Alice, Alice'in `replyPubKey`'ine ECIES):
```ts
{ v:1, output: string, bodyHex: "0x…", seal: { agentId, sealId, timestamp, r, s },
  ogSig: "0x…", ogSigner: "0x…", storageRoot?: "0x…" }
```

**🚦 KAPI ŞEMA-LOCK:** `pnpm gate:schema` — `shared`'daki zod şemaları üzerinde round-trip testi geçer; `buildIntentHash` aynı girdi için Alice ve Bob tarafında **byte-identik** çıktı verir. İki dev ayrı makinede çalıştırıp aynı hash'i görmeden P1 başlamaz.

---

# FAZ 0 — DE-RISK SPIKE 🔴

> **Amaç:** Ölecekse şimdi ölsün. Toplam hedef **4 saat**, iki dev paralel.
> v3 kuralı: *"bir P0 bacağı düşerse üstüne inşa etmeden önce pivot et."*

---

### P0-A · Repo iskeleti + env + faucet'ler 🔴
**Sahip:** Ortak · **Süre:** 30 dk · **Ön koşul:** yok

**Yapılacak:**
1. `pnpm init` + workspace; yukarıdaki klasör ağacını boş dosyalarla kur.
2. `.env.example` — her iki dev de aynı isimleri kullanacak:
   ```
   # Base Sepolia
   BASE_RPC_URL=            PRIVATE_KEY_ALICE=       PRIVATE_KEY_BOB=
   VERIFIER_ADDRESS=        ERC8004_IDENTITY=        USDC_BASE_SEPOLIA=
   # 0G
   OG_RPC_URL=              OG_PRIVATE_KEY=          OG_PROVIDER_ADDRESS=
   OG_TAPP_ENDPOINT=        OG_AGENT_ID=
   # Hedera
   HEDERA_OPERATOR_ID=      HEDERA_OPERATOR_KEY=     HEDERA_TOPIC_ID=
   BLOCKY402_URL=https://api.testnet.blocky402.com
   BLOCKY402_FEE_PAYER=0.0.7162784
   # Graph
   GRAPH_DEPLOY_KEY=        SUBGRAPH_SLUG=
   # Anahtarlar
   ALICE_ECIES_PRIV=        BOB_ECIES_PRIV=
   # Mod anahtarları
   MOCK_0G=0                FRAUD_MODE=none
   ```
3. **Faucet'leri ŞİMDİ tetikle** (hepsi paralel, bekleme süresi maskeleniyor):
   - 0G faucet (0.1/gün — **ilk iş bu**, gün sınırı yüzünden geciktirilemez)
   - Base Sepolia ETH (Coinbase/Alchemy faucet)
   - Base Sepolia USDC (Circle faucet)
   - Hedera testnet portal hesabı (HBAR)
4. `shared/src/config.ts` — zod ile env doğrulama, eksikse anlamlı hata.

**Çıktı:** derlenen boş monorepo + fonlanmış 4 cüzdan.

**🚦 GEÇİŞ TESTİ `gate:P0-A`**
- [ ] `pnpm -r build` hatasız
- [ ] Script her 4 hesabın bakiyesini basar; **hepsi > 0**
- [ ] `.env` eksik alanla çalıştırıldığında hangi alanın eksik olduğunu söyleyerek patlar

**⛔ Geçmezse:** 0G faucet vermiyorsa → 0G Discord'da faucet talebi + **P0-B'yi mock imza ile ilerlet**, ama `MOCK_0G` bayrağını asla demo yoluna sokma.

---

### P0-B · 0G Sealed Inference: tek çağrı + imza yakalama 🔴 HERO RİSKİ
**Sahip:** Dev A · **Süre:** 60 dk · **Ön koşul:** P0-A

**Yapılacak:**
1. `@0glabs/0g-serving-broker` kur. `scripts/og-spike.ts`:
   ```ts
   const broker = await createZGComputeNetworkBroker(wallet);
   await broker.ledger.addLedger(0.01);                        // ledger fonla
   const services = await broker.inference.listService();       // TeeML olanları filtrele
   await broker.inference.acknowledgeProviderSigner(provider);  // BİR KEZ
   const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
   const headers = await broker.inference.getRequestHeaders(provider, content); // TEK KULLANIMLIK
   const res  = await fetch(`${endpoint}/chat/completions`, { method:"POST", headers, body });
   const valid = await broker.inference.processResponse(provider, chatID);
   ```
2. **Sağlayıcı seçimi:** listede `verifiability === "TeeML"` olanı seç. TeeTLS-proxy sağlayıcı **kabul edilmez** — "operatör veriyi göremez" iddiası ona dayanmıyor (v2 §10'daki uyarı).
3. `teeSignerAddress`'i yakala ve `fixtures/og/signer.json`'a yaz.
4. Çıktı imzasını bağımsız doğrula:
   ```ts
   ethers.verifyMessage(outputText, ogSig) === teeSignerAddress   // EIP-191
   ```
5. **Tüm ham yanıtı** `fixtures/og/run-<n>.json`'a kaydet (istek, yanıt, imza, signer, süre).

**Çıktı:** doğrulanmış TEE imzası + gerçek `teeSignerAddress` + 1 fixture.

**🚦 GEÇİŞ TESTİ `gate:P0-B`**
- [ ] Sağlayıcı `TeeML` olarak listeleniyor (ekran görüntüsü al — jüri sorabilir)
- [ ] `processResponse` → `valid === true`
- [ ] `ethers.verifyMessage(output, ogSig)` **broker'ın verdiği signer'a eşit** (SDK'ya değil, kendi kodumuza güveniyoruz)
- [ ] Fixture dosyası diskte, `MOCK_0G=1` ile aynı akış ağa çıkmadan replay ediliyor
- [ ] Tek çağrının duvar-saati süresi kaydedildi (P0-G bütçesi bu)

**⛔ Geçmezse:** TeeML sağlayıcı yoksa → 0G Discord + farklı model. `processResponse` false dönüyorsa → tek kullanımlık header'ı tekrar kullanmış olabilirsin, taze header ile tekrar dene. Bacak tamamen ölürse → v3 §12: imzayı **açıkça "MOCKED" etiketiyle** mock'la, tezi değiştirme.

---

### P0-C · Tapp seal imzası: formatı kırma 🔴 **TEZİN DAYANDIĞI ADIM**
**Sahip:** Dev A · **Süre:** 75 dk · **Ön koşul:** P0-A

Bu adım U1+U2'yi kapatıyor. Yanlış giderse `Verifier.sol` yazılamaz.

**Yapılacak:**
1. `agent-wrapper` kaynağında `sign()` fonksiyonunu bul. v3 §05'in iddiası:
   ```
   digest   = keccak256("agentId|sealId|timestamp|hex(sha256(body))")
   imza     = secp256k1, 64-byte R‖S, v ATILMIŞ, EIP-191 YOK
   ```
2. Bob'un Tapp'ini demo penceresi için **ayağa kaldır ve bir daha restart etme** (seal key konteyner ömrüne bağlı, v3 §06).
3. Bilinen bir `body` ile canlı imzalı yanıt al → `fixtures/seal/live-1.json`.
4. `scripts/recover.js` — **preimage varyant matrisini brute-force et.** Bilinmeyen serbestlik dereceleri:
   - hex büyük/küçük harf
   - `0x` öneki var/yok
   - timestamp: saniye mi ms mi, string mi decimal mi
   - ayırıcı gerçekten `|` mi
   - body: ham byte mı, hex string mi, JSON string mi
   - `v`: 27 ve 28 ayrı ayrı denenir

   Her kombinasyon için `ecrecover` çalıştır; **iki farklı imzada aynı adresi veren** kombinasyon doğru olandır. (Tek imza yeterli değil — tesadüfen tutarlı görünebilir. En az iki numune al.)
5. Kazanan formatı `shared/src/sealsig.ts`'e sabitle, kaynağı yorumla belgele.
6. Kurtarılan adres = **gerçek seal signer**. `fixtures/seal/signer.json`'a yaz.
7. **`imageHash` kontrolü (v3 §06 — güven çıpası):** Attestor'ın seal key'i bağladığı `imageHash`'i oku, yayınladığımız Bob image'ının hash'iyle karşılaştır. Eşleşmiyorsa "enclave bizim recompute kodumuzu çalıştırdı" cümlesi **yanlış** olur.

**Çıktı:** kanıtlanmış preimage formülü + `sealsig.ts` + 2 fixture + doğrulanmış `imageHash`.

**🚦 GEÇİŞ TESTİ `gate:P0-C`**
- [ ] `recover.js` **aynı** adresi ≥2 bağımsız canlı imzadan kurtarıyor
- [ ] Kurtarılan adres iki çalıştırmada da sabit
- [ ] `v=27` ve `v=28` denemesi kodda deterministik (önce 27, tutmazsa 28)
- [ ] `imageHash` == yayınlanan Bob image hash'i (eşitlik ekran görüntüsüyle kayıt altında)
- [ ] Fixture'lar `contracts/test/fixtures/`'a kopyalandı — Solidity testi bunları okuyacak

**⛔ Geçmezse:**
- Format kırılamıyorsa: gövdeyi **kontrolümüzdeki bir alt-alan** yap (bkz. §2.3 abi-encode). Yeniden üretilebilirlik bizde olsun.
- Seal key hiç kurtarılamıyorsa: Tapp'in dışında, Bob'un sunucusunda tutulan bir imza anahtarıyla devam et ve **"attested enclave" iddiasını videodan çıkar** — kalan tez (intent-binding) hâlâ ayakta ama zayıflar. Bu bir Faz-0 pivot kararıdır, Faz-3'te alınmaz.

---

### P0-D · 0G bütçe ölçümü + fixture cache disiplini 🔴
**Sahip:** Dev A · **Süre:** 20 dk · **Ön koşul:** P0-B

Faucet **günde 0.1 OG**. Bu proje boyunca en sert kısıt.

**Yapılacak:**
1. P0-B'deki çağrının öncesi/sonrası ledger bakiyesini oku → **çağrı başı gerçek maliyet**.
2. Hesapla: `kalan_bakiye / maliyet` = elimizdeki toplam çağrı sayısı.
3. Bütçeyi böl ve **yaz**:
   - P3 geliştirme: en fazla N/2
   - Prova (dry-run): 3 çağrı
   - Demo + 3 video çekimi: 6 çağrı (yedekli)
   - Rezerv: kalan
4. `MOCK_0G=1` modunu zorunlu kıl: **her** gerçek çağrı otomatik fixture'a yazılır, mock modda `intentHash`'e göre replay edilir. UI, kontrat ve subgraph işi mock ile yapılır.
5. 0G Storage bonusu için ayrı maliyet ölç (yükleme + indirme). Bütçe kaldırmıyorsa **P3 bonusunu şimdi düşür**, P3'ün ortasında değil.

**Çıktı:** yazılı bütçe tablosu + çalışan fixture cache.

**🚦 GEÇİŞ TESTİ `gate:P0-D`**
- [ ] Çağrı başı maliyet sayı olarak biliniyor
- [ ] Kalan çağrı sayısı ≥ 12 (demo+video için asgari). Değilse → ek faucet / ikinci cüzdan
- [ ] `MOCK_0G=1` ile 20 ardışık çağrı **sıfır ağ trafiği** üretiyor (ağ kesikken çalıştırarak kanıtla)
- [ ] Storage bonusu kararı verildi ve dokümana işlendi: **[ ] var / [ ] yok**

**⛔ Geçmezse:** ikinci cüzdanla ikinci faucet talebi; olmuyorsa modeli küçült ve `maxTokens`'ı düşür (çıktı kısalınca maliyet düşer, imza mantığı değişmez).

---

### P0-E · Hedera x402 uçtan uca 🟡
**Sahip:** Dev B · **Süre:** 60 dk · **Ön koşul:** P0-A

**Yapılacak:**
1. `x402-hedera-example`'ı klonla, olduğu gibi çalıştır — **kendi kodumuzu yazmadan önce referansın yeşil olduğunu gör.**
2. blocky402 testnet facilitator: `api.testnet.blocky402.com` (API key yok), `feePayer 0.0.7162784`, `@x402/hedera` **exact** şeması, tutar **tinybar**.
3. Akış: sunucu `402` döner → istemci kısmi imzalı `TransferTransaction` kurar → facilitator gas'ı öder ve gönderir.
4. HashScan'de transaction'ı bul, linki kaydet.
5. Bir HCS topic aç (`TopicCreateTransaction`), topic ID'yi `.env`'e yaz, tek test mesajı gönder.

**Çıktı:** Hedera testnet'te settle olmuş gerçek ödeme + canlı HCS topic.

**🚦 GEÇİŞ TESTİ `gate:P0-E`**
- [ ] HashScan'de görünen, **başarılı** transfer transaction'ı (link kaydedildi)
- [ ] Ödeyen gas'ı **facilitator** (feePayer alanı `0.0.7162784`)
- [ ] HCS topic'e yazılan mesaj mirror node'dan okunabiliyor, consensus timestamp'i var
- [ ] Uçtan uca süre < 10 sn

**⛔ Geçmezse:** facilitator ayaktaysa ama şema reddediyorsa → tutar birimini kontrol et (tinybar, HBAR değil). Facilitator down ise → v3 §12: **Base backend tüm demoyu taşır**, Hedera submission'ı HCS timeline + kimlik köprüsü üzerine kurulur, ödeme bacağı sonra eklenir.

---

### P0-F · ERC-8004 kayıt + okuma (Base Sepolia) 🟡
**Sahip:** Dev B · **Süre:** 45 dk · **Ön koşul:** P0-A

U3'ü kapatıyor.

**Yapılacak:**
1. Base Sepolia'daki ERC-8004 `IdentityRegistry` adresini **doğrula** (Basescan'de kod var mı, event'ler akıyor mu). Adres ölüyse: referans kontratları kendimiz deploy ederiz — **bu bir kayıp değil**, subgraph yine gerçek veri indeksler ama README'de dürüstçe yazılır.
2. ABI'ye bak ve karar ver:
   - **(a)** On-chain key/value metadata destekliyorsa → `endpoint`, `skill`, `eciesPubKey`, `stealthMetaAddress` doğrudan on-chain → subgraph hepsini indeksler. **Tercih edilen.**
   - **(b)** Sadece URI varsa → URI Bob'un agent card'ını gösterir; subgraph kimlik + sayaçları indeksler, pubkey HTTP'den çekilir.
3. Alice ve Bob'u kaydet, `agentId`'leri `.env`'e yaz.
4. Kayıtları geri oku ve doğrula.

**Çıktı:** iki kayıtlı agent + (a)/(b) kararı yazılı.

**🚦 GEÇİŞ TESTİ `gate:P0-F`**
- [ ] `register` tx'i Basescan'de başarılı, `agentId` döndü
- [ ] Bağımsız bir okuma scripti kayıtlı `endpoint`'i geri veriyor
- [ ] (a)/(b) kararı verildi ve `subgraph/DECISION.md`'ye yazıldı
- [ ] Kayıt event'inin **blok numarası** not edildi (subgraph `startBlock`'u bu olacak — yanlışsa subgraph boş indeksler)

**⛔ Geçmezse:** registry ölüyse referans kontratı kendin deploy et (15 dk), README'de belirt.

---

### P0-G · Uçtan uca gecikme ölçümü 🔴 **v3'ün tek açık kapısı**
**Sahip:** Dev A · **Süre:** 20 dk · **Ön koşul:** P0-B, P0-C

**Yapılacak:** Alice → Tapp → 0G SI → seal imzası → dönüş yolunu (henüz binding mantığı olmadan, düz geçiş olarak) 5 kez ölç. p50 ve p95 raporla.

**🚦 GEÇİŞ TESTİ `gate:P0-G`**
- [ ] p95 latency **< 60 sn**
- [ ] Zaman dağılımı biliniyor: ECIES / 0G çağrısı / seal imzası / ağ — hangisi baskın?

**⛔ Geçmezse (v3 §12 fallback'i):** daha küçük model → `maxTokens` düşür → brief'i kısalt → sağlayıcıyı demo öncesi **pre-warm** et (video çekiminden 2 dk önce boş bir çağrı at).

---

## 🚩 FAZ 0 KAPISI — PİVOT KARARI

| Bacak | Durum | Düşerse aksiyon |
|---|---|---|
| P0-B 0G TeeML | ☐ | mock imza + dürüst etiket |
| P0-C seal format | ☐ | kontrolümüzdeki gövde / Tapp-dışı imza + iddia daraltma |
| P0-D bütçe | ☐ | Storage bonusunu düşür |
| P0-E Hedera | ☐ | Base tek başına taşır |
| P0-F 8004 | ☐ | referans kontratı kendimiz deploy |
| P0-G latency | ☐ | model/brief küçült |

**5/6 yeşil değilse Faz 1'e geçilmez.** P0-B ve P0-C ikisi birden kırmızıysa proje kapsamı yeniden yazılır.

---

# FAZ 1 — GİZLİ MESAJLAŞMA + INTENT 🔴

> **Hedef:** 3 saat. Bu fazın sonunda iki agent şifreli konuşuyor ve Alice imzalı bir intent üretiyor.

---

### P1-A · shared paketi: canonical + şema + intent
**Sahip:** Dev A · **Süre:** 45 dk · **Ön koşul:** Faz 0 kapısı

**Yapılacak:** §2.3'teki her şeyi kodla — `canonical.ts`, `schema.ts` (zod), `intent.ts` (EIP-712 domain/types, `buildIntentHash`, `signIntent`, `recoverIntentSigner`).

**🚦 GEÇİŞ TESTİ `gate:P1-A`**
- [ ] `buildIntentHash` aynı girdi için 100 çalıştırmada aynı sonuç
- [ ] Anahtar sırası karışık verilen constraints objesi **aynı** `constraintsHash`'i üretiyor
- [ ] `recoverIntentSigner(intent, signIntent(intent, wallet))` === `wallet.address`
- [ ] Intent'in **tek bir byte'ı** değişince hash değişiyor (5 alanın her biri için ayrı test — kopyala-yapıştır hatasıyla bir alanın hash'e girmemesi klasik bug)
- [ ] Aynı hash Solidity tarafında da üretiliyor: `forge test --match-test testIntentHashMatchesTS` (TS'ten üretilmiş fixture'a karşı)

**⛔ Geçmezse:** TS ve Solidity hash'i uyuşmuyorsa neredeyse her zaman `abi.encode` vs `abi.encodePacked` karışıklığıdır. **`abi.encode` kullanıyoruz** — packed değil.

---

### P1-B · ECIES katmanı
**Sahip:** Dev B · **Süre:** 30 dk · **Ön koşul:** P0-A

**Yapılacak:** `eth-crypto` sarmalayıcı: `encryptFor(pubKey, obj) → string`, `decryptWith(privKey, cipher) → obj`. Cipher `eth-crypto`'nun `cipher.stringify` formatında taşınır. Anahtar üretimi + `.env`'e yazma scripti.

**🚦 GEÇİŞ TESTİ `gate:P1-B`**
- [ ] 200 KB'lık bir payload round-trip ediyor (gerçek dataset boyutu — küçük string ile test etmek yanıltıcı)
- [ ] Yanlış private key ile çözme **hata fırlatıyor**, sessizce bozuk veri dönmüyor
- [ ] Ciphertext düz metnin hiçbir alt-dizesini içermiyor (basit substring taraması)
- [ ] Şifreleme+çözme süresi < 500 ms (latency bütçesine girecek)

---

### P1-C · alice-agent ve bob-agent iskeletleri
**Sahip:** Dev B · **Süre:** 60 dk · **Ön koşul:** P1-A, P1-B

**Yapılacak:**
- `bob-agent`: `GET /.well-known/agent-card.json` (skills, endpoint, `eciesPubKey`, price, `stealthMetaAddress`, `agentId`), `POST /task`, `GET /result/:intentHash`.
- `alice-agent`: CLI — brief + data dosyası al, intent kur, imzala, ECIES ile şifrele, gönder, sonucu çöz.
- Bu fazda Bob **echo** yapıyor: paketi çözer, `intentHash`'i recompute eder, `match`'i döner. 0G yok, imza yok.

**🚦 GEÇİŞ TESTİ `gate:P1-C`**
- [ ] Uçtan uca: Alice gizli brief gönderir, Bob **düz metni doğru çözer**
- [ ] Bob'un recompute ettiği `intentHash` === Alice'in imzaladığı
- [ ] Alice tek karakter değiştirip gönderdiğinde Bob `match: false` döner
- [ ] **Ağ dinlemesi kanıtı:** `tcpdump`/proxy loglarında brief metni geçmiyor (bu ekran görüntüsü videoya girecek)
- [ ] Bozuk zod şeması olan istek `400` ile reddediliyor, 500 ile çökmüyor

**⛔ Geçmezse:** `match` false çıkıyorsa hata %90 serileştirmededir — Alice'in hash'lediği string ile Bob'un aldığı string birebir aynı mı, JSON transport'ta değişmiş mi kontrol et.

---

### P1-D · Fraud modu altyapısı (şimdi kur, sonra bedava)
**Sahip:** Dev B · **Süre:** 20 dk · **Ön koşul:** P1-C

v3 §09: *"fraud yolunu şimdi kur — burada ucuz."* Doğru. Faz 3'te kurmaya kalkarsak pahalı olur.

**Yapılacak:** `FRAUD_MODE` env'i Bob'un **enclave dışı** katmanında etkili olacak (enclave içi kod hep dürüst — tezin özü bu):
| Mod | Bob ne yapıyor | Beklenen sonuç |
|---|---|---|
| `none` | normal | `JobVerified` |
| `substitute` | enclave'e **farklı bir brief** besler | `match:false` → kontrat reddeder |
| `tamper` | data'nın bir byte'ını değiştirir | `match:false` → kontrat reddeder |
| `forge` | gövdeyi enclave-dışı bir anahtarla imzalar | `BadEnclaveSig` |
| `selfintent` | kendi intent'ini uydurur, Alice imzası yok | `BadClientSig` |

**🚦 GEÇİŞ TESTİ `gate:P1-D`**
- [ ] 5 modun her biri `/task` yanıtında beklenen `match` / imza durumunu üretiyor (kontrat henüz yok, çıktı seviyesinde doğrula)
- [ ] `FRAUD_MODE` **runtime'da** değişebiliyor (yeniden başlatma gerekmiyor) — demo sırasında restart yapmak seal key'i kaybettirir, v3 §06

---

# FAZ 2 — KİMLİK + KEŞİF 🟡 (The Graph'i açar)

> **Hedef:** 4 saat.

---

### P2-A · Agent card + 8004 kaydı üretime alma
**Sahip:** Dev B · **Süre:** 45 dk · **Ön koşul:** P0-F, P1-C

**Yapılacak:** P0-F'teki (a)/(b) kararına göre Bob'un kimliğini `skill: "market-analysis"`, endpoint, ECIES pubkey, stealth meta-address ile kaydet. Alice'i de kaydet (client tarafı da 8004'te olmalı — `registeredClient` kontrolü buna bakacak).

**🚦 GEÇİŞ TESTİ `gate:P2-A`**
- [ ] Agent card canlı URL'den çekiliyor, zod şemasından geçiyor
- [ ] Card'daki `eciesPubKey` ile şifrelenen paket Bob tarafından çözülüyor (kayıt ile çalışan anahtar aynı — kopyala-yapıştır hatası burada yakalanır)
- [ ] On-chain kayıt ile card içeriği tutarlı

---

### P2-B · Subgraph fork + deploy
**Sahip:** Dev B · **Süre:** 90 dk · **Ön koşul:** P2-A

**Yapılacak:**
1. `agent0lab` subgraph'ini fork'la.
2. `subgraph.yaml`: network `base-sepolia`, IdentityRegistry adresi, **`startBlock` = P0-F'te not edilen blok**.
3. Şema:
   ```graphql
   type Agent @entity {
     id: Bytes!  owner: Bytes!  skills: [String!]!  endpoint: String
     eciesPubKey: String  registeredAt: BigInt!
     verifiedDeliveries: Int!   # P3'te dolacak
     rejectedAttempts: Int!     # fraud yolu da indeksleniyor
     jobs: [Job!]! @derivedFrom(field: "agent")
   }
   type Job @entity {
     id: Bytes!  # intentHash
     agent: Agent!  client: Bytes!  outputHash: Bytes
     status: String!  # VERIFIED | REJECTED
     price: BigInt!  timestamp: BigInt!
   }
   ```
4. `graph codegen && graph build && graph deploy --studio <slug>`.

**🚦 GEÇİŞ TESTİ `gate:P2-B`**
- [ ] Subgraph Studio'da senkron **%100**, `fatalError` yok
- [ ] `{ agents { id skills endpoint } }` sorgusu **gerçek** Bob'u döndürüyor
- [ ] Alice'in `discovery.ts`'i skill ile arayıp Bob'un endpoint'ini buluyor ve **hard-coded adres kodda hiçbir yerde yok** (`grep` ile kanıtla)

**⛔ Geçmezse:** subgraph boş indeksliyorsa `startBlock` çok ileridedir; ağ adı yanlışsa `graph build` sessiz geçer ama veri gelmez. Studio deploy tıkanırsa yerel `graph-node` ile devam et, deploy'u sonra tekrarla.

---

### P2-C · Keşif entegrasyonu (Alice, Bob'u gerçekten bulur) 🟡
**Sahip:** Dev B · **Süre:** 30 dk · **Ön koşul:** P2-B

**🚦 GEÇİŞ TESTİ `gate:P2-C`**
- [ ] Alice'i `.env`'de Bob adresi olmadan çalıştır → **yine de çalışıyor** (tam olarak bu, The Graph'ın load-bearing olduğunun kanıtı)
- [ ] İkinci bir sahte agent kaydet → arama iki sonuç döner → sıralama `verifiedDeliveries`'e göre

---

### P2-D · 🟢 BONUS: Subgraph MCP + SKILL
**Sahip:** Dev B · **Süre:** 30 dk · **Ön koşul:** P2-C · **Düşürülebilir**

Subgraph'ı MCP server olarak sun + tekrar kullanılabilir bir SKILL dosyası yaz. **Sadece P3 kritik yolu yeşilse yapılır.**

**🚦 GEÇİŞ TESTİ:** MCP client'ından "market-analysis yapan en yüksek teslimatlı agent" sorusu doğru cevaplanıyor.

---

# FAZ 3 — GİZLİ COMPUTE + INTENT-BOUND VERIFICATION 🔴 HERO · TEZ

> **Hedef:** 8 saat. Projenin var oluş sebebi bu faz. Her şey buraya bütçe açmak için sıkıştırıldı.

---

### P3-A · Verifier.sol 🔴
**Sahip:** Dev A · **Süre:** 120 dk · **Ön koşul:** P0-C (format kırılmış olmalı), P1-A

**Yapılacak:**
```solidity
struct Intent   { bytes32 intentHash; address client; bytes32 agentId; uint256 price; uint256 deadline; }
struct SealSig  { string agentId; string sealId; string timestamp; bytes32 r; bytes32 s; }

mapping(bytes32 => address) public enclaveSignerOf;   // agentId => seal key (§06)
mapping(address => bool)    public registeredClient;
mapping(bytes32 => bool)    public verified;

error Expired(); error AlreadyVerified(); error BadClientSig();
error BadEnclaveSig(); error BodyMismatch(); error MatchFalse();

function setEnclaveSigner(bytes32 agentId, address signer) external onlyOwner;  // 36 saat mutable
function verifyJob(Intent calldata i, bytes calldata aliceSig,
                   bytes32 outputHash, bool matchFlag, bytes32 ogSigHash,
                   SealSig calldata seal) external;
function verifyJobLenient(...) external returns (bool ok, uint8 code);          // demo için
```

`verifyJob` sırası:
1. `block.timestamp <= i.deadline` yoksa `Expired`
2. `!verified[i.intentHash]` yoksa `AlreadyVerified`
3. EIP-712 digest'i **struct alanlarından yeniden üret** → `ecrecover` → `signer == i.client` ve `registeredClient[i.client]`; yoksa `BadClientSig`
   *Bu adım v3 §03'ün "anchor the client signature" kuralı: imza çiftini Bob'un verdiğine güvenmiyoruz.*
4. Gövdeyi alanlardan yeniden üret: `body = abi.encode(i.intentHash, outputHash, matchFlag, ogSigHash)`
5. Seal digest'i kur: `keccak256(bytes(concat(seal.agentId,"|",seal.sealId,"|",seal.timestamp,"|",_hex(sha256(body)))))` — **hex formatı P0-C'de kanıtlanan format**
6. `ecrecover(digest, 27, r, s)`, tutmazsa `28`; sonuç `enclaveSignerOf[i.agentId]` değilse `BadEnclaveSig`
7. `matchFlag` false ise `MatchFalse`
8. `verified[i.intentHash] = true; emit JobVerified(i.intentHash, outputHash, i.client, i.agentId, i.price)`

`verifyJobLenient` aynı kontrolleri yapar ama revert etmek yerine `emit JobRejected(intentHash, code)` basar.

*Neden ikinci fonksiyon var:* revert eden bir tx jüriye Basescan'de güzel görünmez ve subgraph onu indeksleyemez. Fraud butonu lenient yolu çağırır → **on-chain, indekslenebilir, ekran görüntüsü alınabilir bir RED**. Settlement yolu ise her zaman katı `verifyJob`'u kullanır.

**🚦 GEÇİŞ TESTİ `gate:P3-A` (Foundry, hepsi geçecek)**
- [ ] `testHappyPath` — **P0-C'den gelen canlı fixture** ile `JobVerified` çıkıyor (uydurma imza ile test **sayılmaz**)
- [ ] `testRejectsWrongClientSig` — Bob'un uydurduğu intent+output çifti `BadClientSig`
- [ ] `testRejectsNonEnclaveSigner` — kayıtsız anahtarla imzalı gövde `BadEnclaveSig`
- [ ] `testRejectsMatchFalse`
- [ ] `testRejectsTamperedBody` — `outputHash` değişince seal digest'i tutmuyor
- [ ] `testReplay` — aynı `intentHash` ikinci kez `AlreadyVerified`
- [ ] `testExpired`
- [ ] `testLenientEmitsRejected` — her hata kodu için doğru `code`
- [ ] `testBothVParities` — hem 27 hem 28 ile üretilmiş fixture geçiyor
- [ ] Gas: `verifyJob` < 200k

**⛔ Geçmezse:** `testHappyPath` canlı fixture'la geçmiyorsa preimage formatı yanlıştır → **P0-C'ye geri dön**, Verifier'ı zorlamaya çalışma.

---

### P3-B · Bob'un binding agent'ı (enclave içi) 🔴
**Sahip:** Dev A · **Süre:** 150 dk · **Ön koşul:** P0-B, P0-C, P1-A

Bu, `imageHash` ile ölçülen kod. **Minimal tut.**

**Akış (v3 §04):**
```
1. ECIES ile çöz                          → { intent, aliceSig, brief, data, constraints }
2. recompute: buildIntentHash(...)        → match = (recomputed === intent.intentHash)
3. 0G Sealed Inference çağır              → { output, ogSig, chatId }
4. ogSig'i doğrula: verifyMessage(output, ogSig) === teeSigner   (İÇERİDE, kontrat bu bayrağa güveniyor)
5. body = abi.encode(intentHash, outputHash, match, keccak256(ogSig))
6. Tapp seal key ile imzala
7. dön: { output, bodyHex, seal, ogSig, ogSigner }
```

**Kritik kurallar:**
- `match === false` olsa bile **akış devam eder ve imzalanır**. Enclave yalan söylemez, sadece raporlar. Reddi kontrat yapar. (Fraud demosu bu davranışa dayanıyor.)
- 0G imzası içeride doğrulanamıyorsa gövdeye `ogVerified:false` girer — sessizce `true` yazılmaz.
- Enclave'de `FRAUD_MODE` **yok**. Fraud dış katmanda.

**🚦 GEÇİŞ TESTİ `gate:P3-B`**
- [ ] Dürüst iş: `match === true`, `ogSig` doğrulanıyor, gövde imzalanıyor
- [ ] `substitute` modu: `match === false` dönüyor ve **yine de imzalanıyor** (enclave dürüstlüğü kanıtı)
- [ ] Gövde byte'ları `abi.decode` ile geri çözülüyor ve alanlar birebir eşleşiyor
- [ ] `MOCK_0G=1` ile çalışıyor (faucet yakmadan iterasyon)
- [ ] Enclave kodunun bağımlılık ağacında ağ çıkışı sadece 0G endpoint'i (`imageHash` iddiasını kirletmemek için)
- [ ] Tek çağrı p95 < 60 sn (P0-G bütçesi hâlâ geçerli)

---

### P3-C · Seal key kaydı + trust anchor 🔴
**Sahip:** Dev A · **Süre:** 30 dk · **Ön koşul:** P3-A deploy edilmiş, P3-B ayakta

v3 §06'nın birebir uygulaması.

**Yapılacak:**
1. Bob'un Tapp'ini demo penceresi için başlat. **Restart etme.**
2. Bir canlı imzalı yanıt yakala → `recover.js` → gerçek signer adresi.
3. `setEnclaveSigner(agentId, addr)` (owner-only). Setter'ı 36 saat mutable bırak.
4. `imageHash == yayınlanan image hash` kontrolünü **tekrar** yap ve ekran görüntüsünü README'ye koy.

**🚦 GEÇİŞ TESTİ `gate:P3-C`**
- [ ] `enclaveSignerOf[agentId]` on-chain doğru adresi gösteriyor
- [ ] Canlı bir iş `verifyJob`'tan geçiyor (**testnet'te, gerçek tx**)
- [ ] `imageHash` eşleşmesi kayıt altında
- [ ] **Kurtarma provası:** Tapp'i bilerek restart et → yeni signer'ı yakala → `setEnclaveSigner` ile güncelle → iş yine geçiyor. Süre ölçüldü ve **< 5 dk**. (Demo sırasında konteyner ölürse bu prova hayat kurtarır.)

---

### P3-D · Uçtan uca hero akışı 🔴
**Sahip:** Ortak · **Süre:** 60 dk · **Ön koşul:** P3-A, P3-B, P3-C

Alice → keşif → intent → ECIES → Bob → Tapp → 0G → seal → Alice → `verifyJob` → `JobVerified`.

**🚦 GEÇİŞ TESTİ `gate:P3-D` — PROJENİN ANA KAPISI**
- [ ] Tek komut (`pnpm demo:base`) baştan sona çalışıyor
- [ ] `JobVerified` event'i Basescan'de görünüyor
- [ ] Alice çıktıyı çözüyor ve okuyor
- [ ] Toplam süre < 60 sn
- [ ] `FRAUD_MODE=substitute` → `JobRejected` (kod: `MatchFalse`) on-chain
- [ ] `FRAUD_MODE=forge` → `JobRejected` (kod: `BadEnclaveSig`)
- [ ] `FRAUD_MODE=selfintent` → `JobRejected` (kod: `BadClientSig`)
- [ ] 3 ardışık dürüst çalıştırma, 3'ü de başarılı (tek seferlik şans değil)

**⛔ Geçmezse:** BURADA DURULUR. P4 ve P5 bu kapı yeşil olmadan başlamaz. Tez bu kapıdır.

---

### P3-E · 🟢 BONUS: 0G Storage
**Sahip:** Dev A · **Süre:** 45 dk · **Ön koşul:** P3-D yeşil **ve** P0-D bütçe onayı · **Düşürülebilir**

Şifreli brief + sonucu (AES-256) 0G Storage'a yaz, root hash'i `ResultEnvelope`'a koy. Böylece on-chain `outputHash` gerçekten **erişilebilir** bir şeyi işaret eder.

**🚦 GEÇİŞ TESTİ:** root hash ile indirilen blob, AES anahtarıyla çözülüyor ve `keccak256`'sı on-chain `outputHash` ile eşleşiyor.
**⛔ Bütçe yetmezse:** düşür. v3 §12 bunu açıkça izin veriyor. Hero etkilenmiyor.

---

# FAZ 4 — ÖDEME KATMANI 🟡 (Hedera'yı açar)

> **Hedef:** 5 saat. Kural: **settlement `JobVerified`'tan SONRA** (x402 verify/settle ayrımı).

---

### P4-A · PaymentBackend interface
**Sahip:** Dev A · **Süre:** 20 dk · **Ön koşul:** P3-D

```ts
interface PaymentBackend {
  quote(intent: Intent): Promise<Http402>;              // 402 gövdesi
  authorize(q: Http402): Promise<AuthProof>;            // Alice imzalar, para HAREKET ETMEZ
  settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt>;  // JobVerified'tan SONRA
}
```

**🚦 GEÇİŞ TESTİ:** iki backend de interface'i karşılıyor; Alice'in orkestrasyon kodunda **hiçbir `if (chain === ...)` yok** (grep ile kanıtla).

---

### P4-B · BaseStealthBackend (gizlilik koşusu) 🟡
**Sahip:** Dev A · **Süre:** 90 dk · **Ön koşul:** P4-A

1. Bob 402 döner (USDC, Base Sepolia).
2. Alice Bob'un card'ındaki stealth meta-address'ten ERC-5564 türetimi yapar → taze `stealthAddress`.
3. x402 `exact` şeması: EIP-3009 `transferWithAuthorization` → `payTo = stealthAddress`. Alice gas ödemez.
4. `JobVerified` sonrası facilitator settle eder.
5. Ephemeral pubkey + view tag: ERC-5564 `Announcer` Base Sepolia'da canlıysa oraya, değilse `/result` yanıtında **bant-dışı** Bob'a iletilir (dürüstçe belirtilir, bonus olarak işaretlenir).

**🚦 GEÇİŞ TESTİ `gate:P4-B`**
- [ ] Basescan'de stealth adrese gerçek USDC transferi
- [ ] Bob türettiği private key ile o adresi **harcayabiliyor** (kanıt: fonu çekip başka adrese gönder — türetme doğruluğunun tek gerçek testi)
- [ ] Stealth adres Bob'un kayıtlı 8004 adresiyle on-chain **bağlantısız**
- [ ] Settlement `JobVerified` blok numarasından **sonra** gerçekleşti (sıra kanıtı)
- [ ] `FRAUD_MODE=substitute` → `JobVerified` yok → **settle çağrısı hiç yapılmadı** (bu, demonun en güçlü tek cümlesi: "ödeme asla settle olmadı")

---

### P4-C · HederaX402Backend 🟡
**Sahip:** Dev B · **Süre:** 75 dk · **Ön koşul:** P4-A, P0-E

1. Bob 402 döner (HBAR, tinybar).
2. Alice kısmi imzalı `TransferTransaction` kurar — **delegated signing**: anahtar `signer` modülünde, agent/LLM bağlamına girmiyor.
3. blocky402 gas'ı öder ve gönderir.
4. `JobVerified` sonrası settle.

**🚦 GEÇİŞ TESTİ `gate:P4-C`**
- [ ] HashScan'de başarılı transfer
- [ ] Anahtarın agent bağlamına girmediği kanıtlanıyor: agent sürecinin loglarında/bellek dökümünde private key **yok**; `signer` ayrı modül (kod incelemesi + log grep)
- [ ] Aynı iş akışı sadece `PAYMENT_BACKEND=hedera` ile çalışıyor, başka kod değişikliği yok

---

### P4-D · HCS iş zaman çizelgesi 🟡 **Hedera farklılaştırıcısı**
**Sahip:** Dev B · **Süre:** 60 dk · **Ön koşul:** P4-C

Beş taahhüt, her biri consensus timestamp'li. İçerik şifreli kalır, topic'e sadece taahhütler gider:
```
1. 402_ISSUED     { intentHash, price, currency }
2. INTENT_COMMIT  { intentHash, client }
3. ENCLAVE_INVOKED{ intentHash, agentId, imageHash }
4. OUTPUT_COMMIT  { intentHash, outputHash, match }
5. SETTLED        { intentHash, txId }
```

**🚦 GEÇİŞ TESTİ `gate:P4-D`**
- [ ] 5 mesaj da mirror node'dan okunuyor, sıralı consensus timestamp'ler
- [ ] Hiçbir mesajda düz metin brief/data/output yok (grep ile kanıtla)
- [ ] Fraud koşusunda `SETTLED` **yok**, ama `OUTPUT_COMMIT match:false` **var** → red de zaman çizelgesine yazılı, tamper-evident
- [ ] Zaman çizelgesi demo dApp'te render ediliyor

---

### P4-E · 🟢 BONUS: HCS-14 UAID köprüsü
**Sahip:** Dev B · **Süre:** 30 dk · **Düşürülebilir**

Mevcut ERC-8004 kimliğini UAID olarak sar. **İkinci bir registry değil** — bunu README'de açıkça yaz.

**🚦 GEÇİŞ TESTİ:** UAID → ERC-8004 `agentId` çözümlemesi çift yönlü çalışıyor.

---

# FAZ 5 — ÜRÜN YÜZEYİ + SUBMISSION 🔴

> **Hedef:** 6 saat. v3'ün uyarısı doğru: *"iki kişi için bu yarım günden fazla — cila değil, faz olarak planla."*

---

### P5-A · demo-dApp (5 panel) 🔴
**Sahip:** Dev B · **Süre:** 150 dk · **Ön koşul:** P3-D, P4-B

v3 §12'deki beş panel:

| Panel | İçerik | Kime hitap ediyor |
|---|---|---|
| **Discovery** | Subgraph'tan canlı agent kartları, skill araması, `verifiedDeliveries`'e göre sıralama | The Graph |
| **Split-screen "spy"** | Sol: gerçekte ne oldu. Sağ: zincir gözlemcisinin gördüğü | 0G · anlatı |
| **Job timeline** | brief → ödeme → TEE → verified → settled, HCS timestamp'leriyle | Hedera |
| **Independent verify** | 0G'nin forwardable imzası — jüri linke tıklar, düz `ethers` ile doğrular | 0G · güven |
| **Fraud attempt** | Tek buton. Bob farklı işi cevaplar. Kontrat canlı reddeder, ödeme settle olmaz | **TEZ** |

**Kural:** dört panel durum gösterir, bir panel **bir şey yaptırır**. Fraud butonu gerçek tx atar.

**🚦 GEÇİŞ TESTİ `gate:P5-A`**
- [ ] Discovery paneli canlı subgraph'tan besleniyor (mock JSON yok)
- [ ] Fraud butonu gerçek `JobRejected` tx'i üretiyor ve linkini gösteriyor
- [ ] Independent verify: **temiz bir tarayıcıda**, sadece indirilen dosya + `ethers` ile 0G imzası doğrulanıyor (bunu bilmeyen birine yaptır — jüri simülasyonu)
- [ ] Timeline paneli gerçek HCS consensus timestamp'lerini gösteriyor
- [ ] Tüm akış **public URL**'de çalışıyor (localhost demo submission değil)
- [ ] Mobilde okunabiliyor (jüri telefondan bakabilir)

---

### P5-B · Provalar + videolar 🔴
**Sahip:** Ortak · **Süre:** 120 dk · **Ön koşul:** P5-A

**Önce iki tam prova, sonra kayıt.** Kayıt sırasında keşfedilen bug pahalıdır.

Video süre limitleri farklı, **tek video üç yere gönderilmez**:
| Track | Limit | Açılış 60 sn |
|---|---|---|
| 0G | < 3 dk | fraud reddi → sealed inference → independent verify |
| The Graph | 2–4 dk | fraud reddi → discovery + verified-delivery sıralaması |
| Hedera | ≤ 5 dk | fraud reddi → x402 settle → HCS timeline |

**Her videonun ilk 60 saniyesinde fraud reddi var.** v3 §12: ekran görüntüsünün anlatamayacağı tek şey o.

**🚦 GEÇİŞ TESTİ `gate:P5-B`**
- [ ] 2 tam prova, ikisi de sıfır müdahaleyle geçti
- [ ] 3 video kaydedildi, hepsi limit **altında**
- [ ] Her videoda: 0G çağrısı öncesi pre-warm yapıldı (latency riski)
- [ ] Videolarda "solves prompt injection" / "first confidential agent payments" / "Sybil-proof" **geçmiyor** (v3 §12 yasak listesi — transkripti grep'le)
- [ ] Ses anlaşılır, ekran metni 720p'de okunabiliyor

---

### P5-C · 3 submission 🔴
**Sahip:** Ortak · **Süre:** 90 dk

Sponsor başına ayrı README. Her biri **tam adres ve endpoint** içerecek — jürinin en çok değer verdiği şey tıklanabilir kanıttır.

**Ortak README çekirdeği:** problem → tez (intent-bound verification) → mimari şeması → prior art tablosu (v3 §02, dürüstlük puanı buradan geliyor) → yapmadığımız iddialar listesi (v3 §12).

| Submission | Vurgu | Zorunlu içerik |
|---|---|---|
| **0G — Best AI Product** | Sealed Inference + intent-binding | provider adresi, model adı, `teeSignerAddress`, `imageHash`, independent-verify linki, Storage root hash (yapıldıysa) |
| **The Graph — AI Use Case** | verified-delivery indeksi | subgraph Studio URL'i, sorgu örnekleri, "kontratsız, review-UI'siz, sahtelenemez itibar" argümanı, MCP/SKILL (yapıldıysa) |
| **Hedera — Agentic Payments** | x402 + tam yaşam döngüsü HCS attestation | HashScan tx linkleri, topic ID, mirror node sorgusu, delegated signing açıklaması, UAID (yapıldıysa) |

**🚦 GEÇİŞ TESTİ `gate:P5-C`**
- [ ] 3 submission gönderildi, **deadline'dan ≥ 60 dk önce**
- [ ] Her README'deki her link **temiz tarayıcıda** tıklanıp doğrulandı
- [ ] Kontrat adresleri Basescan'de doğrulanmış kaynak koduyla eşleşiyor
- [ ] Demo URL'i başka bir ağdan (telefon hotspot) açılıyor
- [ ] "Claims we will NOT make" bölümü üç README'de de var

---

## 3 — İŞ BÖLÜMÜ

| | **Dev A — Kontrat · Enclave · Ödeme** | **Dev B — Agent · Keşif · Ürün** |
|---|---|---|
| Faz 0 | P0-B, P0-C, P0-D, P0-G | P0-E, P0-F |
| Faz 1 | P1-A (shared/intent) | P1-B, P1-C, P1-D |
| Faz 2 | *P3-A'ya erken başlar* | P2-A, P2-B, P2-C, P2-D |
| Faz 3 | P3-A, P3-B, P3-C, P3-E | P3-D'de birleşir · dApp iskeleti |
| Faz 4 | P4-A, P4-B | P4-C, P4-D, P4-E |
| Faz 5 | README'ler + kontrat doğrulama | P5-A dApp + videolar |

**Senkron noktaları (kısa, ayakta):** Faz 0 kapısı · şema-lock (P1-A sonu) · P3-D · P5-B provası. Bunların dışında birbirinizi beklemeyin.

**Kritik yol:** P0-C → P3-A → P3-B → P3-C → P3-D → P5-A → P5-B. Dev A bu zincirin sahibi; başka hiçbir şey bu zincirin önüne geçmez.

---

## 4 — SAAT ÇİZELGESİ (36 saatlik pencere)

Kendi kalan sürenize göre ölçekleyin. Oranlar korunmalı: **Faz 3 toplam sürenin ~%25'i, Faz 5 ~%17'si.**

| Saat | Dev A | Dev B | Kapı |
|---|---|---|---|
| T+0–1 | P0-A ortak, faucet'ler tetiklendi | P0-A | `gate:P0-A` |
| T+1–3 | P0-B, P0-C | P0-E, P0-F | |
| T+3–4 | P0-D, P0-G | P0-F bitir | **FAZ 0 KAPISI** |
| T+4–6 | P1-A | P1-B, P1-C | `gate:P1-*` · şema-lock |
| T+6–7 | P3-A başla | P1-D | |
| T+7–11 | P3-A bitir | P2-A, P2-B | `gate:P3-A`, `gate:P2-B` |
| T+11–15 | P3-B | P2-C, dApp iskeleti | `gate:P3-B` |
| T+15–16 | P3-C | dApp | `gate:P3-C` |
| T+16–17 | **P3-D ortak** | **P3-D ortak** | **🚩 ANA KAPI** |
| T+17–18 | *uyku dönüşümlü* | | |
| T+18–21 | P4-A, P4-B | P4-C | `gate:P4-B`, `gate:P4-C` |
| T+21–23 | P3-E bonus | P4-D, P4-E | `gate:P4-D` |
| T+23–27 | README'ler | P5-A dApp | `gate:P5-A` |
| T+27–30 | kontrat doğrulama, provalar | P5-A bitir | |
| T+30–33 | **provalar + 3 video ortak** | | `gate:P5-B` |
| T+33–35 | **3 submission ortak** | | `gate:P5-C` |
| T+35–36 | tampon | | |

**Sert kurallar:**
- **T+17'de P3-D yeşil değilse** → P4'ün tamamını (Hedera) kes, tüm gücü hero'ya ver. İki track kaybetmek, tezi kaybetmekten iyidir.
- **T+27'de dApp ayakta değilse** → panel sayısını 5'ten 2'ye indir: fraud + split-screen. Kalanı videoda anlat.
- Video ve submission saatine dokunulmaz. Kod kesilir, submission kesilmez.

---

## 5 — RİSK → FALLBACK KARAR TABLOSU

v3 §12'nin uygulanabilir hali. Karar kriteri önceden yazıldı ki gece 3'te tartışılmasın.

| Risk | Tetik (ölçülebilir) | Aksiyon | Kim karar verir |
|---|---|---|---|
| Latency > 60 sn | P0-G p95 > 60s | model küçült → `maxTokens` düşür → brief kısalt → pre-warm | Dev A |
| Faucet compute+storage taşımıyor | P0-D kalan çağrı < 12 | **Storage bonusunu düşür**, hero'yu koru | Dev A |
| Seal key demo ortasında döndü | doğrulama `BadEnclaveSig` veriyor | `recover.js` → `setEnclaveSigner` (setter canlı) · prova P3-C'de yapıldı, < 5 dk | Dev A |
| Hedera facilitator down | P0-E veya P4-C kırmızı | Base backend demoyu taşır; Hedera submission HCS + kimlik üzerine kurulur | Dev B |
| Tam attestation yok | zaten böyle | `ecrecover` + off-chain `imageHash`, **açıkça söylenir** | Ortak |
| Subgraph senkron olmuyor | `gate:P2-B` kırmızı | yerel `graph-node`, deploy sonra tekrarlanır | Dev B |
| Stealth türetme hatalı | Bob fonu harcayamıyor | düz x402'ye düş (gizlilik bir tık azalır, ödeme çalışır) | Dev A |
| ERC-8004 registry ölü | P0-F kırmızı | referans kontratı kendimiz deploy, README'de belirt | Dev B |

---

## 6 — DEMONUN İLK 60 SANİYESİ (senaryo)

Üç videonun da açılışı. Ezberlenecek.

```
0:00  "İki AI agent. Alice bir iş sipariş ediyor, Bob yapıyor.
       Ödeme çözülmüş. Execution çözülmüş. Reputation çözülmüş.
       Ama kimse, ödediğin işin gerçekten çalışan iş olduğunu kanıtlamıyor."

0:12  [Discovery paneli] Alice Bob'u The Graph'ten buluyor — skill ile,
      doğrulanmış teslimat sayısına göre sıralı.

0:22  [Split-screen] Solda: gizli brief, gizli veri, 6 sayfalık analiz.
      Sağda gözlemcinin gördüğü: bir stealth adrese ödeme, bir şifreli blob,
      bir JobVerified event'i. Alice yok, iş yok, sonuç yok.

0:38  [FRAUD BUTONU] "Şimdi Bob hile yapsın — sipariş edilen işi değil,
      başka bir işi cevaplasın."
      → enclave dürüstçe match:false raporluyor
      → kontrat reddediyor           [canlı tx linki]
      → ödeme asla settle olmuyor    [boş settlement]

0:58  "İşte fark bu: TEE'nin çalıştığını değil, DOĞRU işin çalıştığını kanıtlıyoruz."
```

---

## 7 — YAPMAYACAĞIMIZ İDDİALAR (koda ve metne kopyalanacak)

v3 §12'den değiştirmeden:

- ❌ "Sybil-proof reputation" — geri bildirim ödenmiş ve doğrulanmış işlere bağlı; şişirmek **pahalı**, imkânsız değil.
- ❌ "Solves prompt injection" — sadece **task substitution + tampering**.
- ❌ "First confidential agent payments" — ProwlFi / TACEO önce geldi.
- ❌ "Private on Hedera" — o koşu **otonomi** kazandırıyor, gizlilik değil.
- ❌ "We built the TEE" — 0G yaptı; biz onu **intent'e bağlıyoruz**.

Ve dürüstlük sınırı, sorulmadan söylenecek: *imzaları on-chain, attestation'ı kurulumda off-chain doğruluyoruz; 0G Attestor'ın seal key'i yalnızca ölçülmüş image'ımızı çalıştıran gerçek bir enclave'e verdiğine güveniyoruz. Ham on-chain TDX quote değil.*

---

## 8 — KAPI KONTROL LİSTESİ (tek bakışta)

```
FAZ 0  ☐ P0-A repo+faucet   ☐ P0-B 0G imza    ☐ P0-C seal format
       ☐ P0-D bütçe         ☐ P0-E Hedera     ☐ P0-F 8004
       ☐ P0-G latency       ☐ 🚩 FAZ 0 PİVOT KARARI
FAZ 1  ☐ P1-A intent/hash   ☐ P1-B ECIES      ☐ P1-C agentlar
       ☐ P1-D fraud modları ☐ ŞEMA-LOCK
FAZ 2  ☐ P2-A kayıt         ☐ P2-B subgraph   ☐ P2-C keşif
       ☐ P2-D MCP/SKILL 🟢
FAZ 3  ☐ P3-A Verifier.sol  ☐ P3-B binding    ☐ P3-C seal kaydı
       ☐ 🚩 P3-D ANA KAPI   ☐ P3-E Storage 🟢
FAZ 4  ☐ P4-A interface     ☐ P4-B Base       ☐ P4-C Hedera
       ☐ P4-D HCS timeline  ☐ P4-E UAID 🟢
FAZ 5  ☐ P5-A dApp          ☐ P5-B videolar   ☐ P5-C submissionlar
```

---

*Confidential Agents · Build Plan v1 · Roadmap v3'ün uygulama karşılığı · ETHGlobal Lisbon 2026*
