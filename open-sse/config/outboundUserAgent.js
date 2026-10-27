import { createRequire } from "module";

// The User-Agent 9Router sends when a provider has not set its own.
//
// Node's fetch (undici) defaults to `User-Agent: node` when a request carries no
// UA. Some upstreams treat that bare token as a bot signature and answer 403
// while happily serving the same key from `curl`, `undici`, `node-fetch`, or a
// browser UA — the token, not the request, is what gets blocked.
//
// sakoo.biz.id is one of them. Measured against /v1/models and
// /v1/chat/completions with a valid key:
//
//   node, node/20.11.0, NODE        -> 403 client_router_denied
//   9Router, 9router/1.0.20, 9Router-MIBP, app/9Router -> 403   (matches /9router/i)
//   undici, node-fetch, curl/8.5.0, IzRouter/1.0.20, NodeJS -> 200
//
// So the default must avoid both the bare `node` token and the `9router`
// substring. `IzRouter/<version>` is this fork's product name, carries the
// version (useful for upstream logs), and passes both rules.
//
// A provider that sets its own User-Agent (registry transport headers, or a
// per-connection override) always wins — this only fills the gap that would
// otherwise be filled by undici's `node`.

const FALLBACK_PRODUCT = "IzRouter";

let cachedDefault = null;

function readPackageVersion() {
  try {
    const require = createRequire(import.meta.url);
    return require("../../package.json").version || "0.0.0";
  } catch {
    return process.env.npm_package_version || "0.0.0";
  }
}

/**
 * The default outbound User-Agent, e.g. `IzRouter/1.0.20`.
 * Override with OUTBOUND_USER_AGENT when an upstream needs something else.
 */
export function getOutboundUserAgent() {
  if (cachedDefault) return cachedDefault;
  const override = process.env.OUTBOUND_USER_AGENT?.trim();
  cachedDefault = override || `${FALLBACK_PRODUCT}/${readPackageVersion()}`;
  return cachedDefault;
}

/**
 * Add the default User-Agent to a request's headers unless one is already set
 * (case-insensitively — `user-agent`, `User-Agent` and `USER-AGENT` all count).
 * Returns the same header object shape it was given.
 */
export function withDefaultUserAgent(headers) {
  const ua = getOutboundUserAgent();

  if (!headers) return { "User-Agent": ua };

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    if (headers.has("user-agent")) return headers;
    const next = new Headers(headers);
    next.set("User-Agent", ua);
    return next;
  }

  if (Array.isArray(headers)) {
    const has = headers.some(([key]) => String(key).toLowerCase() === "user-agent");
    return has ? headers : [...headers, ["User-Agent", ua]];
  }

  const has = Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");
  return has ? headers : { ...headers, "User-Agent": ua };
}

// Test seam: reset the memoized value after changing the env var.
export function __resetOutboundUserAgentCache() {
  cachedDefault = null;
}
