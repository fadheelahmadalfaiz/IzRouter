// #5143 — the intl gateway still answers 400 code 11128 "request illegal"
// ("not sent from an official client") even when the X-Conversation-* family
// is present, and only for heavy payloads (long history + tool calls). Two
// gaps: the outbound identity advertised the IDE instead of the CLI, and the
// Stainless SDK fingerprint the official CLI emits was missing entirely.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import codebuddyIntlRegistry from "../../open-sse/providers/registry/codebuddy-intl.js";

const CHAT_URL = "https://www.codebuddy.ai/v2/chat/completions";
const MODEL = "deepseek-v4.1-flash";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function headersFor(body) {
  return new CodeBuddyIntlExecutor().buildHeaders(
    { accessToken: "t" },
    true,
    CHAT_URL,
    MODEL,
    body,
  );
}

describe("codebuddy-intl outbound identity (#5143)", () => {
  it("advertises the CLI identity, not the IDE one", () => {
    const h = headersFor({ messages: [{ role: "user", content: "hi" }] });
    expect(h["User-Agent"]).toBe("CLI/2.108.1 CodeBuddy/2.108.1");
    expect(h["X-App"]).toBe("cli");
    expect(h["X-IDE-Type"]).toBe("CLI");
    expect(h["X-IDE-Name"]).toBe("CLI");
    expect(h["X-IDE-Version"]).toBe("2.108.1");
    expect(h["X-Product"]).toBe("SaaS");
    expect(h["X-Private-Data"]).toBe("false");
  });

  it("sends the Stainless SDK fingerprint", () => {
    const h = headersFor({ messages: [{ role: "user", content: "hi" }] });
    expect(h["X-Stainless-Runtime"]).toBe("node");
    expect(h["X-Stainless-Lang"]).toBe("js");
    expect(h["X-Stainless-Package-Version"]).toBe("6.25.0");
    expect(h["X-Stainless-Helper-Method"]).toBe("stream");
    expect(h["X-Stainless-Retry-Count"]).toBe("0");
    expect(h["X-Stainless-Runtime-Version"]).toMatch(/^v\d+\./);
    expect(["Windows", "MacOS", "Linux"]).toContain(h["X-Stainless-Os"]);
    expect(h["X-Stainless-Arch"]).toBeTruthy();
  });

  it("sends request/agent metadata and derives X-Domain from the URL", () => {
    const h = headersFor({ messages: [{ role: "user", content: "hi" }] });
    expect(h["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Domain"]).toBe("www.codebuddy.ai");
  });

  it("keeps the X-Conversation-* family verified A/B in #4892", () => {
    const h = headersFor({ messages: [{ role: "user", content: "hi" }] });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });

  it("does not leave legacy lowercase header duplicates", () => {
    const h = headersFor({ messages: [{ role: "user", content: "hi" }] });
    expect(h["x-requested-with"]).toBeUndefined();
    expect(h["x-codebuddy-request"]).toBeUndefined();
  });
});

describe("codebuddy-intl body gates (#5143)", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("opens with a system message even when the client sent none", () => {
    const out = exec.transformRequest(MODEL, { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toContain("You are CodeBuddy Code.");
  });

  it("preserves caller system instructions instead of dropping them", () => {
    const out = exec.transformRequest(
      MODEL,
      {
        messages: [
          { role: "system", content: "Always answer in JSON. Use the weather tool." },
          { role: "user", content: "hi" },
        ],
      },
      true,
      {},
    );
    expect(out.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(out.messages[0].content).toContain("You are CodeBuddy Code.");
    expect(out.messages[0].content).toContain("Always answer in JSON");
  });

  it("scrubs third-party client identities from the system prompt", () => {
    const out = exec.transformRequest(
      MODEL,
      {
        messages: [
          { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
          { role: "user", content: "hi" },
        ],
      },
      true,
      {},
    );
    expect(out.messages[0].content).not.toMatch(/claude code/i);
    expect(out.messages[0].content).toContain("[external-client-identity]");
  });

  it("scrubs identity markers from assistant turns in tool histories", () => {
    const out = exec.transformRequest(
      MODEL,
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "You are Claude Code, the official CLI." },
          { role: "tool", tool_call_id: "t1", content: "ok" },
        ],
      },
      true,
      {},
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).not.toMatch(/claude code/i);
    expect(out.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("keeps tool_calls and tool messages intact", () => {
    const toolCalls = [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }];
    const out = exec.transformRequest(
      MODEL,
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "ok", tool_calls: toolCalls },
          { role: "tool", tool_call_id: "t1", content: "result" },
        ],
      },
      true,
      {},
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.tool_calls).toEqual(toolCalls);
    expect(out.messages.find((m) => m.role === "tool").tool_call_id).toBe("t1");
  });

  it("still converts string user content to typed blocks", () => {
    const out = exec.transformRequest(MODEL, { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(out.messages[1].content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("codebuddy-intl registry identity (#5143)", () => {
  it("does not advertise the IDE identity in static headers", () => {
    const headers = codebuddyIntlRegistry.transport.headers;
    expect(headers["X-IDE-Type"]).toBe("CLI");
    expect(headers["X-IDE-Name"]).toBe("CLI");
    expect(headers["User-Agent"]).toContain("CLI/");
    expect(headers["X-App"]).toBe("cli");
  });
});
