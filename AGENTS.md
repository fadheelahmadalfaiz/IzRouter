# AGENTS.md — MIBP fork guardrails

> **READ THIS BEFORE EDITING.** This is the **MIBP fork** of `decolua/9router`
> (`github.com/mhiqrambg/9router-mibp-version`). Upstream is tracked as the
> `upstream` git remote. This file records hard-won fixes that are easy to
> silently delete or reintroduce. Each entry has a **DO NOT** and a **WHY**.
>
> If you are about to change something listed here, stop and read the whole
> entry first. If you believe an entry is obsolete, say so explicitly and get
> confirmation before removing it — do **not** quietly drop it.

---

## 1. `package-lock.json` MUST be generated with npm 10 (Docker's npm)

**DO NOT** regenerate `package-lock.json` with your global `npm` (npm 11+).
**DO NOT** delete `package-lock.json` or add it to `.gitignore`.

**WHY:** The Docker image pins `node:22-alpine` by digest (see `Dockerfile`
`ARG NODE_IMAGE`), which ships **npm 10.9.8**. The `Dockerfile` runs `npm ci`
against the committed lockfile. npm 11 **drops the top-level optional entries**
`@emnapi/core` and `@emnapi/runtime` that npm 10's platform-complete resolve
requires. The tag-triggered **"Build and Push Docker Image"** workflow then
fails at `npm ci`:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
npm error Missing: @emnapi/runtime@1.11.3 from lock file
npm error Missing: @emnapi/core@1.11.3 from lock file
```

This **already happened on tag `v1.0.14`** (run 35422006940) and on earlier
releases (`a2c6187a`, `470c8ca7`, `79294644`, `76b139b3`).

**Correct way to (re)generate the lockfile:**

```bash
npx -y npm@10.9.8 install --package-lock-only
node scripts/verify-lockfile-npm10.mjs   # must print ✅
```

**Enforcement:** `scripts/verify-lockfile-npm10.mjs` fails (exit 1) if the
top-level `@emnapi/core` / `@emnapi/runtime` entries are missing. Run it after
any dependency change; CI runs it before the Docker build.

---

## 2. Tests must NEVER write to the real database (`~/.9router`)

**DO NOT** remove `tests/setup/isolateDataDir.js` from `tests/vitest.config.js`
`setupFiles`. **DO NOT** delete `tests/unit/test-data-dir-isolation.test.js`.

**WHY:** Route-level tests (e.g. `zed-live-models.test.js`,
`zed-native-auth.test.js`) call the real `createProviderConnection`, which
persists to `$DATA_DIR/db/data.sqlite`. With `DATA_DIR` unset — the default for
`npx vitest run` — that resolved to the developer's **real** `~/.9router` DB and
appended fake connections on every run: `zed-live-*@example.com`,
`guard-*@example.com`, `zed "Account N"` (token `decrypted-token-xyz`), and the
fake provider `kimchi-nope`. These then showed up in the Usage dashboard. 42
such rows had to be cleaned out of the live DB once.

**Isolation contract:**
- Default: `DATA_DIR` → throwaway temp dir (auto-removed on exit).
- `RUN_REAL=1` or an explicit `DATA_DIR` → opt out (used by `*.real.test.js`
  suites that intentionally read live credentials).

**Verify a change is safe:** run the suite, then confirm the real DB is
untouched:

```bash
node -e 'const D=require("better-sqlite3");const db=new D(process.env.HOME+"/.9router/db/data.sqlite",{readonly:true});console.log(db.prepare("SELECT COUNT(*) c FROM providerConnections").get().c)'
```

The count must be identical before and after `npx vitest run`.

---

## 3. Hidden providers must not leak into the Usage page

**DO NOT** remove the `!p.hidden` filter in `src/shared/utils/usageProviders.js`
(`buildUsageProviderList`). **DO NOT** inline the old unfiltered
`Object.values(FREE_PROVIDERS).filter(p => p.noAuth && ...)` logic back into
`src/shared/components/UsageStats.js`.

**WHY:** The Usage page auto-adds every `noAuth` free provider so connectionless
providers (e.g. `opencode`) still appear. It must also honor the registry
`hidden` flag, matching the Providers page (`providers/page.js` filters
`!info.hidden`). Without it, `devin-cli` and `mimo-free` (both
`category:"free"`, `noAuth:true`, `hidden:true`) appear in Usage with zero
connections and zero traffic.

**Covered by:** `tests/unit/usage-provider-list.test.js`.

---

## 4. `codebuddy-intl` connection test + OAuth identity

**DO NOT** remove the `"codebuddy-intl"` entry from `OAUTH_TEST_CONFIG` in
`src/app/api/providers/[id]/test/testUtils.js`.
**DO NOT** remove `email` / `displayName` from `codebuddy-intl`'s `mapTokens`
(`src/lib/oauth/providers/codebuddy-intl.js`).
**DO NOT** remove `backfillCodeBuddyIntlIdentity` or its calls in
`GET /api/providers` and `/api/providers/client`.

**WHY (two bugs, both fixed 2026-09-19):**
1. **Test Connection** returned `"Provider test not supported"` because
   `codebuddy-intl` was missing from `OAUTH_TEST_CONFIG`, so
   `testOAuthConnection` bailed before probing. It now probes the Keycloak
   realm's `userinfo` endpoint (URL derived from the token's `iss` claim).
2. **OAuth logins** were named `"Account N"` with no email. The access token is
   a Keycloak JWT carrying `email`/`name`; `mapTokens` now extracts them, and a
   run-once backfill self-heals pre-existing rows.

**Covered by:** `tests/unit/codebuddy-intl-connection.test.js`,
`tests/unit/codebuddy-intl-backfill.test.js`.

---

## 5. Fork-only features — NEVER drop during an upstream sync

When merging `upstream/master`, these fork additions must survive conflict
resolution. If a merge conflict touches them, **resolve fork-priority** and
re-verify after.

| Area | Key files / markers |
|---|---|
| **Freebuff provider** | `open-sse/executors/freebuff.js`, `open-sse/providers/registry/freebuff.js`, `open-sse/services/usage/freebuff.js`, `src/lib/oauth/providers/freebuff.js`, `public/providers/freebuff.png`, and its entries in `open-sse/executors/index.js` + `open-sse/providers/registry/index.js` |
| **Proxy-pool fitness** | `open-sse/services/proxyPoolFitness.js`, `open-sse/services/poolGeo.js`, `src/lib/network/poolEgressProbe.js`, `src/lib/network/stateSweeper.js`, `src/app/(dashboard)/dashboard/proxy-fitness/`, `src/app/api/proxy-pools/**` |
| **Docker hardening** | `Dockerfile`: digest-pinned `NODE_IMAGE`, tracked `package-lock.json`, `npm ci`, `HEALTHCHECK`. `.github/workflows/docker-publish.yml`. |
| **dompurify security override** | `package.json` `overrides.dompurify` + the direct `dompurify` dependency |
| **MIBP branding** | `README.md`, `docker-compose.yml`, `.env.example`, the `MIBP Edition` link in `src/app/(dashboard)/dashboard/profile/page.js` |
| **Cline free-tier models** | `open-sse/providers/registry/cline.js` `authModes: ["oauth","apikey"]` + `cline-free/*` models; `open-sse/shared/clineAuth.js` product headers |
| **ZCode integration** | `src/lib/zcodeConfig.js`, `src/app/api/cli-tools/zcode-settings/**`, `src/app/(dashboard)/dashboard/cli-tools/components/ZCodeToolCard.js`, `public/providers/zcode.png`, and its wiring in `cliTools.js` + `components/index.js` + `ToolDetailClient.js` + `all-statuses/route.js`. Guarded by `scripts/guard-fork-features.mjs` (detect-only). |
| **Outbound User-Agent** | `open-sse/config/outboundUserAgent.js` + its use in `open-sse/utils/proxyFetch.js`. Sends `IzRouter/<version>` instead of undici's bare `node`, which some upstreams 403 (sakoo). Guarded by `scripts/guard-fork-features.mjs` (detect-only). See `docs/OUTBOUND-USER-AGENT.md`. |

---

## 6. Upstream sync procedure

- Remote layout: `origin` = this fork, `upstream` = `decolua/9router`.
- **Merge, do not rebase** — the fork already has merge-based history; rebasing
  rewrites public history.
- Work on a branch (`sync/upstream-<ver>`), tag a rollback point
  (`backup/pre-sync-<ver>`), then fast-forward `master`.
- After resolving conflicts: `npm run build`, `npx vitest run`, and the
  baseline scripts (`tests/__baseline__/verify-providers.mjs`,
  `verify-oauth-urls.mjs`, `verify-alias.mjs`).
- The suite is **not** expected to be all-green (see `CLAUDE.md`). Judge only
  for **new** regressions vs. a pre-merge run; a handful of upstream test-drift
  failures are known.
- Bump `package.json` version (fork cadence `1.0.x`); `CHANGELOG.md` mirrors
  upstream and is **not** edited by the fork.
- Regenerate the lockfile with npm 10 (see §1) after any dependency change.

---

## 7. Do not re-add `package-lock.json` to `.gitignore`

**WHY:** Upstream does not track a lockfile, but this fork **must** — the
Docker build depends on `npm ci` against a committed, npm-10-compatible
lockfile. The fork explicitly removed `package-lock.json` from `.gitignore`
(commit `76b139b3`).

---

## 8. Undefined identifiers must never reach the Docker build (`verify-no-undef.mjs`)

**DO NOT** remove `RUN node scripts/verify-no-undef.mjs` from the Dockerfile
builder stage (after `COPY . ./`, before `npm run build`). **DO NOT** delete
`scripts/verify-no-undef.mjs`.

**WHY:** webpack/SWC compiles files that USE undeclared identifiers - no build
error - and the shipped bundle then `ReferenceError`s at runtime ("This page
couldn't load"). The fork's own sweep found nine such identifiers after an
upstream merge:

- `ConnectionsCard.js` - `useNotificationStore` used, never imported (Providers page crash)
- `testUtils.js` - `provider` used outside its scope in the qoder branch
- `stt.js` - `getApiKeyAuthResult` used, never imported
- `auth.js` - three `recordAntigravity*` helpers used, never imported
- `gemini-web.js` - `hasTools` dead branch referencing an undeclared identifier
- `opencode.js` - `IP_LIMIT_BODY` used, constant never defined
- `chatCore.js` - `resolveProxyConfig` used in `tryNextPool` but missing from the
  `handleChatCore` signature, so pool rotation would throw

`node --check` does NOT catch these (top-level `return` is legal under the CJS
wrap) and `next build` does not either. ESLint `no-undef` is the only reliable
catch.

**Correct procedure after merging upstream / editing code:**

```bash
node scripts/verify-no-undef.mjs   # must print OK (0 across src + open-sse)
```

CI enforces it inside the Docker builder stage, where `npm ci` has already
installed `eslint`/`globals`.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
