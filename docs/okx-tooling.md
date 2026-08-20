# OKX geliştirici araçları — ürünün parçası DEĞİL

> **Bu dosyanın varlık sebebi bir sınır çizmek.** Aşağıdakiler kod yazarken doğru API'yi
> bulmak için kullanılan araçlar. Hiçbiri çalışma zamanında yüklenmiyor, hiçbiri deploy
> edilen şeye girmiyor ve **hiçbiri submission'da "OKX entegrasyonu" diye sayılmaz.**
> CLAUDE.md §11'in dürüstlük sınırı bunu gerektiriyor: bir skill dosyası eklemek entegrasyon
> değildir.
>
> Bu projenin gerçek OKX entegrasyonu tek bir şey: **üçüncü ödeme rayı**
> (`packages/payment/src/okx-x402.ts` + `okx-facilitator.ts`, gate `P4-E`) ve Verifier'ın
> X Layer testnet aynası. Kanıtlar `docs/EVIDENCE.md`'de.

## Kurulu skill'ler

Kullanıcı hesabında zaten kurulu (`~/.claude/skills/okx-*` → `~/.agents/skills/`), bu repoya
kopyalanmadı — dokuzu da mevcut. Bu iş sırasında fiilen kullanılan ikisi:

| Skill | Neye yaradı |
|---|---|
| `okx-agent-payments-protocol` | x402 şemaları (`exact` / `upto` / `aggr_deferred` / `period`), `accepts[].extra` sözleşmesi, ve **imzanın `(from,to,value,validAfter,validBefore,nonce)` ile sınırlı olduğu** bilgisi — `okx-x402.ts`'in başındaki dürüstlük kuralı buradan çıktı |
| `okx-agentic-wallet` | `_shared/chain-support.md` — X Layer testnet'in **1952** olduğunun yetkili kaynağı (195 emekli), ve `wallet sign-message --type eip712` yüzeyi |

Kullanılmayanlar ve sebebi: `okx-dex-market`, `okx-defi`, `okx-dapp-discovery`,
`okx-growth-competition`, `okx-activity` — bu proje trading/DeFi yapmıyor
(`ANALYSIS.md` §2). `okx-ai` yalnızca Faz E (ASP kaydı) için gerekecek.

## MCP

`onchainos` CLI aynı zamanda bir MCP sunucusu:

```bash
claude mcp add --scope user onchainos-cli onchainos mcp
```

**`.mcp.json`'a EKLENMEDİ.** O dosya proje kapsamlı ve `pnpm gate:*` çalıştıran herkese
dayatılır; OKX CLI'si ise hesap kimlik doğrulaması (tarayıcı üzerinden sosyal giriş ya da
`OKX_API_KEY`) istiyor. Gate'lerin hiçbiri ona ihtiyaç duymuyor ve duymamalı — çıktısı bir
üçüncü tarafın API anahtarına bağlı olan şey gate değildir. İsteyen yukarıdaki komutla
kendi kullanıcı kapsamına ekler.

## Kaynaklar

| | |
|---|---|
| x402 SDK kaynağı | `github.com/okx/payments` — **default branch `master`**, `typescript/SELLER.md` + `typescript/bu-payments/app-x402-core/` |
| Skill'ler | `github.com/okx/onchainos-skills` |
| Onchain OS docs | `web3.okx.com/onchainos/dev-docs/payments/` |
| API anahtarı | `web3.okx.com/onchainos/dev-portal` |
| X Layer testnet faucet | `web3.okx.com/xlayer/faucet` (gas **OKB**, ETH değil) |
| X Layer testnet explorer | `oklink.com/xlayer-test` |

## Bir uyarı: tek dokümandan genel sonuç çıkarma

`typescript/SELLER.md` "X Layer only — no other networks" diyor. Bu **"Base/Solana değil"**
demek, **"testnet değil"** demek değil. Bu ayrımı kaçırmak bu projede bir kez yapıldı ve
`ANALYSIS.md` §8.8'de yanlış bir "mainnet-only" sonucuna yol açtı; OKX'in kendi canlı mock
merchant'ı `eip155:1952` sunuyor:

```bash
curl -s https://www.okx.com/api/v1/pay/mock-merchant/resource | jq '.accepts[].network'
# → "eip155:1952"   (X Layer TESTNET)
```

`gate:P4-E` bunu her çalıştırmada yeniden doğruluyor, tam olarak bu sonucun sessizce eskimemesi için.
