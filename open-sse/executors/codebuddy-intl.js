import { createHash, randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */

// Deterministic RFC-4122-v5-shaped UUID derived from a session key, mirroring
// the official client's per-conversation id (uuid5 over the session key).
function stableUuidFrom(key) {
  const hash = createHash("sha1").update(key).digest("hex");
  const timeHigh = ((parseInt(hash.slice(12, 16), 16) & 0x0fff) | 0x5000)
    .toString(16)
    .padStart(4, "0");
  const clockSeq = ((parseInt(hash.slice(16, 20), 16) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    timeHigh,
    clockSeq,
    hash.slice(20, 32),
  ].join("-");
}

const CODEBUDDY_CLI_VERSION = "2.108.1";
const CODEBUDDY_SDK_VERSION = "6.25.0";
const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";

const STAINLESS_OS =
  process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "MacOS" : "Linux";

// Third-party client identities the gateway treats as "not an official
// client". Long agent histories (Claude Code, Cursor, Hermes) carry these in
// the system prompt and in tool-call transcripts, which is why only heavy
// payloads trip the check: short requests never contain the markers.
const CHANNEL_MARKERS = [
  "You are Claude Code, Anthropic's CLI for Claude.",
  "x-anthropic-billing-header",
  "Main branch (usually the base for PRs):",
];

const CHANNEL_MARKER_REGEX =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode/gi;

function sanitizeChannelMarkers(text) {
  if (typeof text !== "string" || !text) return text;
  let result = text;
  for (const marker of CHANNEL_MARKERS) {
    if (result.includes(marker)) {
      result = result.split(marker).join("[external-client-identity]");
    }
  }
  return result
    .replace(CHANNEL_MARKER_REGEX, "[external-client-identity]")
    .replace(/(?:\[external-client-identity\][\s,]*){2,}/g, "[external-client-identity]");
}

function hostFromUrl(url) {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  // Upstream "channel verification" (HTTP 400 code 11128 "conversation id
  // missing", 9router #4892): the intl gateway now rejects any request that
  // does not carry the X-Conversation-* header family the official IDE sends
  // on every turn — a conversation id derived stably from the session key,
  // plus fresh UUIDs for the request and the message. Verified A/B against
  // the live upstream: same credentials and body, headers absent -> 11128,
  // headers present -> 200 SSE. codebuddy-cn (copilot.tencent.com) is not
  // gated yet, so only the intl executor grows these headers.
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    // Stable per-conversation id: prefer whatever session key the client sent,
    // else derive from the opening user message (stable across retries of the
    // same turn and across accounts), else fall back to a random UUID.
    const sessionKey =
      (typeof body?.session_id === "string" && body.session_id) ||
      (typeof body?.prompt_cache_key === "string" && body.prompt_cache_key) ||
      (typeof body?.conversation_id === "string" && body.conversation_id) ||
      null;
    const firstUser = Array.isArray(body?.messages)
      ? body.messages.find((m) => m?.role === "user")
      : null;
    const userText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content
              .map((b) => (b && typeof b.text === "string" ? b.text : ""))
              .join("\n")
          : "";
    const conversationKey = sessionKey || (userText ? `cbai:${userText}` : null);

    // One id per HTTP request, shared by the request and conversation families:
    // the official plugin reuses a single value (the codebuddyHeaders hook does
    // the same), and upstream's channel test locks that contract.
    const requestId = randomUUID();
    headers["X-Conversation-ID"] = conversationKey
      ? stableUuidFrom(conversationKey)
      : randomUUID();
    headers["X-Conversation-Request-ID"] = requestId;
    headers["X-Conversation-Message-ID"] = requestId;

    // The gateway fingerprints the official CLI as a whole: the conversation
    // headers alone still fail (#5143) because the request advertises the IDE
    // identity and carries none of the Stainless SDK headers the CLI emits.
    // The conversation ids above stay untouched: they were verified A/B against
    // the live upstream (#4892) and are stable across retries of one turn.
    delete headers["x-requested-with"];
    delete headers["x-codebuddy-request"];
    Object.assign(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
      "X-Product": "SaaS",
      "X-App": "cli",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": CODEBUDDY_CLI_VERSION,
      "X-Private-Data": "false",
      "X-Requested-With": "XMLHttpRequest",
      "X-CodeBuddy-Request": "1",
      "X-Domain": credentials?.providerSpecificData?.domain || hostFromUrl(url) || "www.codebuddy.ai",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": process.version || "v24.11.1",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": process.arch || "x64",
      "X-Stainless-Os": STAINLESS_OS,
      "X-Stainless-Package-Version": CODEBUDDY_SDK_VERSION,
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Request-ID": requestId,
      "X-Agent-Intent": "craft",
      "X-Agent-Purpose": "conversation",
    });

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // Two upstream gates, in order: the body must open with a system message,
    // and third-party client identities must not be visible inside it. The old
    // implementation satisfied the first gate by throwing every caller
    // system/developer message away, which stripped the agent's tool-use rules
    // out of long tool-call histories. Consolidate instead: keep the required
    // CodeBuddy prompt first, append the sanitized caller instructions after
    // it, and scrub identity markers from assistant turns too.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const systemParts = [CODEBUDDY_SYSTEM_PROMPT];
    const otherMessages = [];

    for (const message of source) {
      if (!message || typeof message !== "object") continue;

      if (message.role === "system" || message.role === "developer") {
        const rawText =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map((block) =>
                    typeof block === "string"
                      ? block
                      : block && typeof block.text === "string"
                        ? block.text
                        : "",
                  )
                  .join("\n")
              : "";
        const cleaned = sanitizeChannelMarkers(rawText).trim();
        if (cleaned && cleaned !== CODEBUDDY_SYSTEM_PROMPT) systemParts.push(cleaned);
        continue;
      }

      if (message.role === "user" && typeof message.content === "string") {
        otherMessages.push({ ...message, content: [{ type: "text", text: message.content }] });
        continue;
      }

      if (message.role === "assistant") {
        const next = { ...message };
        if (typeof next.content === "string") {
          next.content = sanitizeChannelMarkers(next.content);
        } else if (Array.isArray(next.content)) {
          next.content = next.content.map((block) =>
            block && typeof block === "object" && typeof block.text === "string"
              ? { ...block, text: sanitizeChannelMarkers(block.text) }
              : block,
          );
        }
        otherMessages.push(next);
        continue;
      }

      otherMessages.push({ ...message });
    }

    transformed.messages = [
      { role: "system", content: systemParts.join("\n\n") },
      ...otherMessages,
    ];

    return transformed;
  }
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";

        // Once the channel-verification gate is passed, a flagged account is
        // answered with code 11140 and msg "request illegal" — the same text as
        // 11128 — but the display fields say the account itself was restricted
        // for unusual activity. That is not a request-shape problem: retrying
        // the same credential (or reporting "insufficient quota") only hides the
        // real cause, so surface it as a permission error and let the cooldown
        // rule in errorConfig take the account out of rotation for a while.
        const display = [
          data?.displayMsg?.en,
          data?.displayMsg?.zh,
          data?.displayTips?.en,
          data?.displayTips?.zh,
        ]
          .filter(Boolean)
          .join(" ");
        const restricted =
          data?.code === 11140 ||
          /restricted due to unusual activity|account has been restricted|账号存在异常行为/i.test(
            `${msg} ${display}`,
          );
        if (restricted) {
          return {
            status: 403,
            message:
              "CodeBuddy account restricted for unusual activity — appeal in the official client or use another account.",
          };
        }

        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
