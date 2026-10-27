# Outbound User-Agent

9Router sends `IzRouter/<version>` as the `User-Agent` for every outbound
request that does not set one.

## Why

Node's built-in `fetch` (undici) sends `User-Agent: node` when a request carries
no UA header. Some upstreams treat that bare token as a bot signature and answer
`403` — while serving the exact same request and key from any other UA.

`sakoo.biz.id` is one of them. Measured against `/v1/models` and
`/v1/chat/completions` with a valid key:

| User-Agent | Result |
|---|---|
| `node` | **403** `client_router_denied` |
| `node/20.11.0` | **403** |
| `NODE` | **403** |
| `9Router`, `9router/1.0.20`, `9Router-MIBP`, `app/9Router` | **403** |
| `undici` | 200 |
| `node-fetch` | 200 |
| `curl/8.5.0` | 200 |
| `python-requests` | 200 |
| `IzRouter/1.0.20` | 200 |

Two rules fall out of that table:

1. The bare token `node` is denied.
2. Anything matching `/9router/i` is denied — which is why the fork's own name
   `9Router` cannot be used either.

`IzRouter` (this fork's product name) satisfies both and carries the version for
upstream logs.

## Where it is applied

`open-sse/utils/proxyFetch.js` → `proxyAwareFetch()` — the single choke point
every outbound request passes through (direct, proxied, and MITM DNS-bypass
paths). A provider that already sets its own `User-Agent` (registry transport
headers, or a per-connection override) always wins; this only fills the gap
undici would otherwise fill with `node`.

## Override

```bash
OUTBOUND_USER_AGENT="my-gateway/1.0" npm start
```

Blank values are ignored. The header is matched case-insensitively, so a
provider sending `user-agent` is respected.

## Notes

- This is a **fork-only** addition. Upstream `decolua/9router` has no default UA,
  so `scripts/guard-fork-features.mjs` guards both the module and its use in
  `proxyFetch.js` against being dropped by an hourly `-X theirs` merge.
- Changing the UA is not a substitute for a relay, and no relay is needed: the
  request goes straight to the upstream.
