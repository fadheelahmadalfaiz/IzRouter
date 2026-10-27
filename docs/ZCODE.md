# ZCode Integration

Route the ZCode desktop app (Zhipu's coding app) through 9Router, so ZCode's
model picker lists every model 9Router serves — Claude, GPT, Gemini, Kimi,
DeepSeek, local Ollama, and the rest.

This is the same shape [`yetone/magpie`](https://github.com/yetone/magpie) uses:
write a provider into ZCode's own config, let ZCode pick models from it.

## How it works

ZCode keeps providers in two files under `~/.zcode/v2/`:

| File | Read by | Shape |
|---|---|---|
| `config.json` | ZCode ≤ 3.13; imported once by newer builds | `{ provider: { <id>: { name, kind, options, models } } }` |
| `provider_config.json` | ZCode 3.14+ (authoritative) | `{ schemaVersion: 1, config: { providerConfigRules, modelConfigRules } }` |

9Router writes **both**, so an older ZCode sees the models too.

Both files are parsed with **strict** Zod objects: an unknown key makes ZCode
reject the whole file. `src/lib/zcodeConfig.js` therefore emits only the keys
each schema declares, and every builder is covered by
`tests/unit/zcode-config.test.js`.

## Usage

Dashboard → **CLI Tools → ZCode**:

1. **Select Endpoint** — the 9Router URL (local, tunnel, Tailscale, cloud, or custom).
2. **API Key** — a 9Router dashboard key.
3. **API Format** — one of:
   - `anthropic-messages` (default) — ZCode calls `/v1/messages`
   - `openai-chat-completions` — `/v1/chat/completions`
   - `openai-responses` — `/v1/responses`
4. **Models** — pick the models ZCode should offer.
5. **Apply**, then **restart ZCode**.

`Reset` removes only the `9router` entries and leaves every other provider,
model rule, provider order, and default selection byte-identical.

## Importing an existing ZCode key

If ZCode is already signed in to a Z.ai coding plan, the card offers **Import
key**. It copies the already-minted key into 9Router's `glm` provider
(`POST /api/cli-tools/zcode-settings/import-key`), so you don't run the GLM
OAuth flow a second time. The key is never echoed back in a response.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cli-tools/zcode-settings` | install state, current wiring, available formats |
| `POST` | `/api/cli-tools/zcode-settings` | write the provider into both files |
| `DELETE` | `/api/cli-tools/zcode-settings` | remove only the `9router` entries |
| `GET` | `/api/cli-tools/zcode-settings/import-key` | whether ZCode holds a usable key |
| `POST` | `/api/cli-tools/zcode-settings/import-key` | import that key into the `glm` provider |

## Notes and limits

- **Restart ZCode after Apply.** It reads its provider list at startup.
- `api.baseUrl` is stored **without** `/v1`; ZCode appends `/v1/messages` itself.
  A stored `/v1` would produce `/v1/v1/messages`.
- A personal-only provider must use the `standard-personal` group. ZCode throws
  `Personal-only Provider 必须使用 standard-personal group` otherwise.
- A model the user configured **by hand** in ZCode keeps its manual rule and gets
  no intelligent rule — ZCode rejects the same `providerId`+`modelId` in both
  arrays.
- `dataBaseDir` in ZCode's `setting.json` is honored when the user moved its data
  folder.
- This integration is a **client-side** wiring only: no `open-sse/` provider was
  added, because the existing `glm` provider already covers Z.ai as an upstream.

## Files

```
src/lib/zcodeConfig.js                                        schema-safe read/write
src/app/api/cli-tools/zcode-settings/route.js                 GET/POST/DELETE
src/app/api/cli-tools/zcode-settings/import-key/route.js      credential import
src/app/(dashboard)/dashboard/cli-tools/components/ZCodeToolCard.js
public/providers/zcode.png
tests/unit/zcode-config.test.js
```
