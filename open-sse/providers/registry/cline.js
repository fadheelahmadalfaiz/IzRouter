export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  authHint: "API key dari app.cline.bot → Settings > API Keys, atau login OAuth via browser.",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    // Non-stream chat completions come back wrapped in {"success":true,"data":{...}}
    quirks: { clineEnvelope: true },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      // Hook owns Authorization: workos:-prefixed OAuth vs plain API key
      // (a merged token can't express both) — see applyAuth.
      preserveHookAuth: true,
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "kwaipilot/kat-coder-pro", name: "KAT Coder Pro" },
    // Free tier: the ids Cline's free[] feed publishes AND that actually answer
    // on a free account. Verified live against
    // GET /api/v1/ai/cline/recommended-models, then exercised end-to-end.
    //
    // Only solar-mini4 answered 200. The other free[] entries
    // (nemotron-3.5-super-vl, reflection/beam-free, nvidia/...-lightning-free,
    // poolside/laguna-s-2.1-free) are listed upstream but return
    // "empty response content" from a free account, so they stay out until
    // they work — a listed model that always fails reads as a broken provider.
    //
    // Do NOT re-add ids from another fork without checking this feed:
    // cline-free/deepseek-v4.1-flash, gemini-3.8-flash, stealth/pixel-canary and
    // stealth/space-bunny-alpha are NOT in it (they are cline-pass/*, which
    // needs a paid ClinePass subscription and answers 403 ENTITLEMENT_ERROR).
    { id: "cline-free/solar-mini4", name: "Solar Mini 4 (Free)" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
