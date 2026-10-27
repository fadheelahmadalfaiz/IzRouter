import fs from "fs";
import os from "os";
import path from "path";

// ZCode (Zhipu's desktop coding app) keeps its model providers in two files
// under <dataDir>/.zcode/v2:
//
//   config.json            - legacy shape, read by ZCode <= 3.13 and imported
//                            once by newer builds.
//   provider_config.json   - rule-based shape, authoritative from 3.14 on.
//
// Both are parsed with strict Zod objects, so an unknown key makes ZCode
// reject the WHOLE file. Every object written here therefore uses only the
// keys its schema declares (verified against ZCode 3.16.3 out/host/index.js):
//
//   providerRule   { providerId, providerName?, enabled?, config: {
//                      group: "standard-personal" | null,
//                      access: { type: "api-key", apiKey },
//                      api: { type: <format>, baseUrl },
//                      personalModelIds: string[], modelOrder: string[] } }
//   modelRule      { providerId, modelId, config: {
//                      properties: { contextWindow?, inputFormat?: { supportsImage? } },
//                      optionSpecs?: { maxOutputTokens?: { max }, reasoningLevel?: { values } } } }
//
// A personal-only provider (one ZCode did not ship) MUST use the
// "standard-personal" group; ZCode throws "Personal-only Provider 必须使用
// standard-personal group" otherwise.
//
// ZCode appends the API path itself (/v1/messages, /v1/chat/completions,
// /v1/responses), so `api.baseUrl` is the bare origin.

export const ZCODE_PROVIDER_ID = "9router";
export const ZCODE_PROVIDER_NAME = "9Router";

export const ZCODE_API_FORMATS = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
];

// config.json's `kind` for each api.type, as ZCode maps one to the other.
const LEGACY_KIND_BY_FORMAT = {
  "anthropic-messages": "anthropic",
  "openai-chat-completions": "openai-compatible",
  "openai-responses": "openai",
};

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_OUTPUT = 32000;
// ZCode caps a model's advertised output; vendors that report their context
// window in the output field (grok's 500000) would otherwise offer that much.
const MAX_ADVERTISED_OUTPUT = 128000;

const isWindows = () => process.platform === "win32";

// ZCode resolves `~` against $HOME first, on Windows too.
export function resolveZCodeHome(env = process.env) {
  const candidates = [env.ZCODE_HOME, env.HOME, os.homedir()].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return os.homedir();
}

// ZCode lets the user move its data folder (`dataBaseDir` in setting.json).
// Setting.json lives inside the default location, so read it from there.
export function resolveZCodeDataDir(home = resolveZCodeHome()) {
  const defaultDir = path.join(home, ".zcode");
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(defaultDir, "setting.json"), "utf-8"));
    const moved = typeof settings?.dataBaseDir === "string" ? settings.dataBaseDir.trim() : "";
    if (moved) return expandHome(moved, home);
  } catch {
    /* no settings file, or unreadable: keep the default */
  }
  return defaultDir;
}

function expandHome(value, home) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return value;
}

export function getZCodePaths(home = resolveZCodeHome()) {
  const dir = path.join(resolveZCodeDataDir(home), "v2");
  return {
    dir,
    legacyConfig: path.join(dir, "config.json"),
    providerConfig: path.join(dir, "provider_config.json"),
  };
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readZCodeConfig(paths = getZCodePaths()) {
  return readJson(paths.legacyConfig);
}

export function readZCodeProviderConfig(paths = getZCodePaths()) {
  return readJson(paths.providerConfig);
}

export function isZCodeInstalled(paths = getZCodePaths()) {
  if (fs.existsSync(paths.dir)) return true;
  if (!isWindows()) return false;
  const localAppData = process.env.LOCALAPPDATA;
  return Boolean(localAppData && fs.existsSync(path.join(localAppData, "Z Code")));
}

// --- validation ------------------------------------------------------------

export function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("baseUrl is required");
  // ZCode appends /v1/... itself; a stored /v1 would produce /v1/v1/messages.
  const withoutV1 = trimmed.replace(/\/v1$/, "");
  let url;
  try {
    url = new URL(withoutV1);
  } catch {
    throw new Error(`baseUrl must be an absolute URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`baseUrl must use http or https: ${value}`);
  }
  return withoutV1;
}

export function normalizeFormat(value) {
  if (value === undefined || value === null || value === "") return "anthropic-messages";
  if (!ZCODE_API_FORMATS.includes(value)) {
    throw new Error(`Unsupported api format: ${value}`);
  }
  return value;
}

function normalizeModelEntry(entry) {
  if (typeof entry === "string") {
    const id = entry.trim();
    if (!id) throw new Error("model id must not be empty");
    // `name` is what ZCode shows in its picker; omitting it leaves the row
    // blank because the legacy writer emits `name: undefined`.
    return { id, name: id };
  }
  const id = String(entry?.id || "").trim();
  if (!id) throw new Error("model id must not be empty");
  return {
    id,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
    contextWindow: positiveInt(entry.contextWindow),
    maxOutputTokens: positiveInt(entry.maxOutputTokens),
    supportsImage: entry.supportsImage === true,
    reasoningLevels: Array.isArray(entry.reasoningLevels)
      ? entry.reasoningLevels.filter((level) => typeof level === "string" && level.trim()).map((level) => level.trim())
      : null,
  };
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export function normalizeModels(models) {
  const list = Array.isArray(models) ? models : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const model = normalizeModelEntry(entry);
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  if (out.length === 0) throw new Error("At least one model is required");
  return out;
}

// --- builders --------------------------------------------------------------

function buildProviderRule({ baseUrl, apiKey, models, format }) {
  const ids = models.map((model) => model.id);
  return {
    providerId: ZCODE_PROVIDER_ID,
    providerName: ZCODE_PROVIDER_NAME,
    enabled: true,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey },
      api: { type: format, baseUrl },
      personalModelIds: ids,
      modelOrder: ids,
    },
  };
}

function buildModelRule(model) {
  const properties = {
    inputFormat: { supportsImage: model.supportsImage === true },
  };
  const contextWindow = model.contextWindow || DEFAULT_CONTEXT_WINDOW;
  if (contextWindow > 0) properties.contextWindow = contextWindow;

  const optionSpecs = {};
  const maxOutput = Math.min(model.maxOutputTokens || DEFAULT_MAX_OUTPUT, MAX_ADVERTISED_OUTPUT);
  if (maxOutput > 0) optionSpecs.maxOutputTokens = { max: maxOutput };
  if (model.reasoningLevels?.length) {
    optionSpecs.reasoningLevel = { values: model.reasoningLevels };
  }

  const config = { properties };
  if (Object.keys(optionSpecs).length > 0) config.optionSpecs = optionSpecs;

  return { providerId: ZCODE_PROVIDER_ID, modelId: model.id, config };
}

function buildLegacyProvider({ baseUrl, apiKey, models, format }) {
  const legacyModels = {};
  for (const model of models) {
    const limit = { context: model.contextWindow || DEFAULT_CONTEXT_WINDOW };
    const output = Math.min(model.maxOutputTokens || DEFAULT_MAX_OUTPUT, MAX_ADVERTISED_OUTPUT);
    if (output > 0) limit.output = output;
    const entry = {
      name: model.name,
      limit,
      modalities: {
        input: model.supportsImage ? ["text", "image"] : ["text"],
        output: ["text"],
      },
    };
    if (model.reasoningLevels?.length) {
      entry.reasoning = {
        enabled: true,
        variants: model.reasoningLevels,
        defaultVariant: pickDefaultReasoningLevel(model.reasoningLevels),
      };
    }
    legacyModels[model.id] = entry;
  }

  return {
    name: ZCODE_PROVIDER_NAME,
    kind: LEGACY_KIND_BY_FORMAT[format] || "anthropic",
    enabled: true,
    source: "custom",
    options: { apiKey, baseURL: baseUrl, apiKeyRequired: true },
    models: legacyModels,
  };
}

function pickDefaultReasoningLevel(levels) {
  if (levels.includes("medium")) return "medium";
  const thinking = levels.filter((level) => level !== "disabled" && level !== "none");
  return thinking.length ? thinking[Math.floor(thinking.length / 2)] : levels[0];
}

// --- public API ------------------------------------------------------------

/**
 * Merge 9Router's provider into both ZCode files without touching any other
 * provider, model rule, provider order or default selection.
 */
export function applyZCodeProvider({
  config,
  providerConfig,
  baseUrl,
  apiKey,
  models,
  format,
  providerId = ZCODE_PROVIDER_ID,
}) {
  const safeBaseUrl = normalizeBaseUrl(baseUrl);
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("apiKey is required");
  const safeFormat = normalizeFormat(format);
  const modelList = normalizeModels(models);

  // --- legacy config.json
  const nextConfig = clone(config) || {};
  if (!nextConfig.provider || typeof nextConfig.provider !== "object") nextConfig.provider = {};
  nextConfig.provider[providerId] = buildLegacyProvider({
    baseUrl: safeBaseUrl,
    apiKey: key,
    models: modelList,
    format: safeFormat,
  });

  // --- provider_config.json
  const nextProviderConfig = clone(providerConfig) || { schemaVersion: 1, config: {} };
  if (nextProviderConfig.schemaVersion === undefined) nextProviderConfig.schemaVersion = 1;
  if (!nextProviderConfig.config || typeof nextProviderConfig.config !== "object") {
    nextProviderConfig.config = {};
  }
  const cfg = nextProviderConfig.config;

  cfg.providerConfigRules = cfg.providerConfigRules || {};
  cfg.providerConfigRules.providerRules = mergeProviderRule(
    cfg.providerConfigRules.providerRules,
    buildProviderRule({ baseUrl: safeBaseUrl, apiKey: key, models: modelList, format: safeFormat }),
    providerId,
  );

  cfg.modelConfigRules = cfg.modelConfigRules || {};
  const previousModelRules = Array.isArray(cfg.modelConfigRules.providerModelRules)
    ? cfg.modelConfigRules.providerModelRules
    : [];
  const manualRules = Array.isArray(cfg.modelConfigRules.manualProviderModelRules)
    ? cfg.modelConfigRules.manualProviderModelRules
    : [];

  // A model the user configured by hand in ZCode keeps that manual rule, and
  // must not also get an intelligent rule: ZCode rejects the duplicate.
  const manualIds = new Set(
    manualRules
      .filter((rule) => rule?.providerId === providerId)
      .map((rule) => rule?.modelId),
  );
  const keptRules = previousModelRules.filter((rule) => rule?.providerId !== providerId);
  const newRules = modelList
    .filter((model) => !manualIds.has(model.id))
    .map((model) => buildModelRule(model));

  cfg.modelConfigRules.providerModelRules = [...keptRules, ...newRules];
  cfg.modelConfigRules.manualProviderModelRules = manualRules;

  return { config: nextConfig, providerConfig: nextProviderConfig };
}

function mergeProviderRule(rules, nextRule, providerId) {
  const list = Array.isArray(rules) ? rules.slice() : [];
  const index = list.findIndex((rule) => rule?.providerId === providerId);
  if (index === -1) return [...list, nextRule];
  // Keep what ZCode itself wrote on this provider (a renamed label, a
  // visibility toggle), replace only the fields 9Router owns.
  const previous = list[index] || {};
  const merged = { ...previous, ...nextRule };
  if (previous.config && typeof previous.config === "object") {
    merged.config = {
      ...previous.config,
      ...nextRule.config,
    };
    if (previous.config.visibility !== undefined) {
      merged.config.visibility = previous.config.visibility;
    }
    if (previous.config.logo !== undefined) {
      merged.config.logo = previous.config.logo;
    }
  }
  list[index] = merged;
  return list;
}

export function removeZCodeProvider({
  config,
  providerConfig,
  providerId = ZCODE_PROVIDER_ID,
}) {
  const nextConfig = clone(config);
  if (nextConfig?.provider && typeof nextConfig.provider === "object") {
    delete nextConfig.provider[providerId];
  }

  const nextProviderConfig = clone(providerConfig);
  const cfg = nextProviderConfig?.config;
  if (cfg) {
    if (Array.isArray(cfg.providerConfigRules?.providerRules)) {
      cfg.providerConfigRules.providerRules = cfg.providerConfigRules.providerRules.filter(
        (rule) => rule?.providerId !== providerId,
      );
    }
    if (Array.isArray(cfg.modelConfigRules?.providerModelRules)) {
      cfg.modelConfigRules.providerModelRules = cfg.modelConfigRules.providerModelRules.filter(
        (rule) => rule?.providerId !== providerId,
      );
    }
    if (Array.isArray(cfg.modelConfigRules?.manualProviderModelRules)) {
      cfg.modelConfigRules.manualProviderModelRules =
        cfg.modelConfigRules.manualProviderModelRules.filter(
          (rule) => rule?.providerId !== providerId,
        );
    }
  }

  return { config: nextConfig, providerConfig: nextProviderConfig };
}

/**
 * Read back what 9Router has wired into ZCode, preferring the rule-based file
 * (authoritative from ZCode 3.14 on) and falling back to the legacy one.
 */
export function parseZCodeProvider({
  config,
  providerConfig,
  providerId = ZCODE_PROVIDER_ID,
}) {
  const rules = providerConfig?.config?.providerConfigRules?.providerRules;
  const rule = Array.isArray(rules) ? rules.find((item) => item?.providerId === providerId) : null;

  if (rule) {
    const cfg = rule.config || {};
    return {
      wired: true,
      source: "provider_config",
      enabled: rule.enabled !== false,
      providerName: rule.providerName || ZCODE_PROVIDER_NAME,
      baseUrl: cfg.api?.baseUrl || "",
      apiKey: cfg.access?.apiKey || "",
      format: cfg.api?.type || "anthropic-messages",
      models: Array.isArray(cfg.personalModelIds) ? cfg.personalModelIds : [],
    };
  }

  const legacy = config?.provider?.[providerId];
  if (legacy) {
    const models = legacy.models && typeof legacy.models === "object" ? Object.keys(legacy.models) : [];
    return {
      wired: true,
      source: "config",
      enabled: legacy.enabled !== false,
      providerName: legacy.name || ZCODE_PROVIDER_NAME,
      baseUrl: legacy.options?.baseURL || "",
      apiKey: legacy.options?.apiKey || "",
      format: legacyKindToFormat(legacy.kind),
      models,
    };
  }

  return {
    wired: false,
    source: null,
    enabled: false,
    providerName: ZCODE_PROVIDER_NAME,
    baseUrl: "",
    apiKey: "",
    format: "anthropic-messages",
    models: [],
  };
}

function legacyKindToFormat(kind) {
  for (const [format, legacyKind] of Object.entries(LEGACY_KIND_BY_FORMAT)) {
    if (legacyKind === kind) return format;
  }
  return "anthropic-messages";
}

/**
 * Write both files. Each write goes through a temp file + rename so a crash
 * mid-write cannot leave ZCode with a half-written, unparseable config.
 */
export function writeZCodeProvider({ config, providerConfig, paths = getZCodePaths() }) {
  fs.mkdirSync(paths.dir, { recursive: true });
  if (config) writeJsonAtomic(paths.legacyConfig, config);
  if (providerConfig) writeJsonAtomic(paths.providerConfig, providerConfig);
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.9router-tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * The coding-plan API key ZCode already minted for its Z.ai account, so a user
 * signed in to ZCode does not have to run the GLM OAuth flow again.
 *
 * ZCode keeps the long-lived credential in config.json's builtin provider
 * options (a `zai` coding-plan key looks like `<apiKeyId>.<secret>`).
 */
export function readZCodeCodingPlanKey({
  config,
  providerConfig,
} = {}) {
  const candidates = [];

  const rules = providerConfig?.config?.providerConfigRules?.providerRules;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const type = rule?.config?.access?.type;
      const apiKey = rule?.config?.access?.apiKey;
      if (apiKey && (type === "zhipu-coding-plan-api-key" || type === "api-key")) {
        candidates.push({ id: rule.providerId, apiKey });
      }
    }
  }

  const providers = config?.provider;
  if (providers && typeof providers === "object") {
    for (const [id, provider] of Object.entries(providers)) {
      const apiKey = provider?.options?.apiKey;
      if (!apiKey) continue;
      candidates.push({ id, apiKey, baseUrl: provider?.options?.baseURL || "" });
    }
  }

  // Rank, don't "first match": `builtin:zai` also contains "zai", so a plain
  // substring test would pick the plain Z.ai provider over the coding plan the
  // `glm` provider can actually use.
  let best = null;
  for (const candidate of candidates) {
    const score = scoreCodingPlanCandidate(candidate);
    if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
  }
  const chosen = best || candidates[0] || null;
  return chosen ? { apiKey: chosen.apiKey, providerId: chosen.id } : null;
}

function scoreCodingPlanCandidate({ id, baseUrl, apiKey }) {
  const haystack = `${id} ${baseUrl}`.toLowerCase();
  let score = 0;
  if (haystack.includes("coding-plan")) score += 100;
  if (haystack.includes("start-plan")) score += 60;
  if (/api\.z\.ai|open\.bigmodel\.cn|zcode\.z\.ai/.test(haystack)) score += 30;
  // A key already in `<id>.<secret>` form is a minted coding-plan key.
  if (typeof apiKey === "string" && apiKey.includes(".")) score += 10;
  return score;
}

function clone(value) {
  return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
}
