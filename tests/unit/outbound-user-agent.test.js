import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __resetOutboundUserAgentCache,
  getOutboundUserAgent,
  withDefaultUserAgent,
} from "../../open-sse/config/outboundUserAgent.js";

// Node's fetch sends `User-Agent: node` when a request sets none. Some upstreams
// 403 that bare token while serving the same key from any other UA. Measured
// against sakoo.biz.id with a valid key:
//
//   node, node/20.11.0, NODE                             -> 403 client_router_denied
//   9Router, 9router/1.0.20, 9Router-MIBP, app/9Router    -> 403
//   undici, node-fetch, curl/8.5.0, IzRouter/1.0.20       -> 200
//
// These tests pin the two rules the default must satisfy, so a future rename
// cannot silently reintroduce the 403.

const originalEnv = process.env.OUTBOUND_USER_AGENT;

beforeEach(() => {
  delete process.env.OUTBOUND_USER_AGENT;
  __resetOutboundUserAgentCache();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OUTBOUND_USER_AGENT;
  else process.env.OUTBOUND_USER_AGENT = originalEnv;
  __resetOutboundUserAgentCache();
});

describe("outboundUserAgent / default value", () => {
  it("is not the bare `node` token undici would send", () => {
    expect(getOutboundUserAgent().toLowerCase()).not.toBe("node");
  });

  it("does not contain the `9router` substring some upstreams block", () => {
    // sakoo denies anything matching /9router/i, including "9Router-MIBP".
    expect(getOutboundUserAgent().toLowerCase()).not.toContain("9router");
  });

  it("carries a product name and a version", () => {
    expect(getOutboundUserAgent()).toMatch(/^[A-Za-z][\w.-]*\/\d+\.\d+\.\d+/);
  });

  it("honors OUTBOUND_USER_AGENT when set", () => {
    process.env.OUTBOUND_USER_AGENT = "custom-agent/9.9.9";
    __resetOutboundUserAgentCache();
    expect(getOutboundUserAgent()).toBe("custom-agent/9.9.9");
  });

  it("ignores a blank OUTBOUND_USER_AGENT", () => {
    process.env.OUTBOUND_USER_AGENT = "   ";
    __resetOutboundUserAgentCache();
    expect(getOutboundUserAgent()).toMatch(/^[A-Za-z]/);
  });
});

describe("outboundUserAgent / withDefaultUserAgent", () => {
  it("adds a UA to a plain header object that has none", () => {
    const headers = withDefaultUserAgent({ "Content-Type": "application/json" });
    expect(headers["User-Agent"]).toBe(getOutboundUserAgent());
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("keeps an existing `User-Agent` (provider-supplied wins)", () => {
    const headers = withDefaultUserAgent({ "User-Agent": "codex_cli_rs/1.0.0" });
    expect(headers["User-Agent"]).toBe("codex_cli_rs/1.0.0");
  });

  it("detects a lowercase `user-agent` too", () => {
    const headers = withDefaultUserAgent({ "user-agent": "kiro-cli/1.0.0" });
    expect(headers["user-agent"]).toBe("kiro-cli/1.0.0");
    expect(headers["User-Agent"]).toBeUndefined();
  });

  it("does not mutate the caller's object", () => {
    const original = { "Content-Type": "application/json" };
    withDefaultUserAgent(original);
    expect(original["User-Agent"]).toBeUndefined();
  });

  it("builds headers when none were given", () => {
    expect(withDefaultUserAgent(undefined)["User-Agent"]).toBe(getOutboundUserAgent());
    expect(withDefaultUserAgent(null)["User-Agent"]).toBe(getOutboundUserAgent());
  });

  it("handles a Headers instance", () => {
    const headers = withDefaultUserAgent(new Headers({ "Content-Type": "application/json" }));
    expect(headers.get("user-agent")).toBe(getOutboundUserAgent());
  });

  it("keeps a UA already set on a Headers instance", () => {
    const headers = withDefaultUserAgent(new Headers({ "User-Agent": "kept/1.0" }));
    expect(headers.get("user-agent")).toBe("kept/1.0");
  });
});
