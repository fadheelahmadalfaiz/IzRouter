import { describe, it, expect } from "vitest";

// testUtils.js imports Next.js request plumbing and the provider registry, so it
// cannot be imported in a unit test. This mirrors describeUpstreamRejection()
// exactly; tests/unit/providers-test-error-message.test.js asserts the two stay
// in sync by checking the source text.

function parseProviderErrorMessage(bodyText, fallback) {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    // fall through
  }
  return bodyText.trim() || fallback;
}

function describeUpstreamRejection(status, bodyText, probe = "models") {
  const detail = parseProviderErrorMessage(bodyText, "");
  const suffix = detail ? `: ${detail}` : "";

  if (status === 401) {
    return `HTTP 401 from /${probe} — the upstream rejected the API key${suffix}`;
  }
  if (status === 403) {
    return (
      `HTTP 403 from /${probe} — access denied. The key may be valid; ` +
      `upstreams commonly gate this on User-Agent or client IP${suffix}`
    );
  }
  if (status === 404) {
    return (
      `HTTP 404 from /${probe} — check the Base URL. It must be the API root ` +
      `(e.g. https://host/v1), not a full endpoint like …/v1/chat/completions${suffix}`
    );
  }
  if (status === 429) {
    return `HTTP 429 from /${probe} — rate limited or every account is cooling down${suffix}`;
  }
  if (status >= 500) {
    return `HTTP ${status} from /${probe} — the upstream is failing, not your key${suffix}`;
  }
  return `HTTP ${status} from /${probe}${suffix}`;
}

describe("provider test error message", () => {
  it("names the key for a 401", () => {
    expect(describeUpstreamRejection(401, "")).toContain("rejected the API key");
  });

  it("does NOT blame the key for a 403 — that is a UA/IP gate", () => {
    const message = describeUpstreamRejection(403, "");
    expect(message).toContain("HTTP 403");
    expect(message).toContain("User-Agent or client IP");
    expect(message).toContain("key may be valid");
    expect(message).not.toMatch(/invalid api key/i);
  });

  it("points at the Base URL for a 404", () => {
    const message = describeUpstreamRejection(404, "");
    expect(message).toContain("Base URL");
    expect(message).toContain("/v1/chat/completions");
  });

  it("explains a 429 as rate limiting, not a key problem", () => {
    const message = describeUpstreamRejection(429, "");
    expect(message).toContain("rate limited");
    expect(message).not.toMatch(/invalid api key/i);
  });

  it("says the upstream is failing on 5xx", () => {
    const message = describeUpstreamRejection(503, "");
    expect(message).toContain("upstream is failing, not your key");
  });

  it("includes the upstream's own error text when present", () => {
    const body = JSON.stringify({ error: { message: "client_router_denied" } });
    expect(describeUpstreamRejection(403, body)).toContain("client_router_denied");
  });

  it("keeps the probe path so the failing endpoint is obvious", () => {
    expect(describeUpstreamRejection(403, "", "messages")).toContain("/messages");
  });

  it("never returns the old blanket message", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      expect(describeUpstreamRejection(status, "")).not.toBe("Invalid API key or base URL");
    }
  });
});
