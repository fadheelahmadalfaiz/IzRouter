import { describe, it, expect } from "vitest";
import {
  ZCODE_API_FORMATS,
  applyZCodeProvider,
  normalizeBaseUrl,
  normalizeModels,
  parseZCodeProvider,
  readZCodeCodingPlanKey,
  removeZCodeProvider,
} from "../../src/lib/zcodeConfig.js";

// Mirrors ZCode 3.16.3's strict Zod shapes (out/host/index.js @52388). An
// unknown key anywhere makes ZCode reject the whole file, so these tests assert
// the generated objects key-by-key rather than merely "contains".
const PROVIDER_RULE_KEYS = ["providerId", "providerName", "enabled", "config"];
const PROVIDER_CONFIG_KEYS = [
  "group",
  "access",
  "api",
  "personalModelIds",
  "modelOrder",
];
const ACCESS_KEYS = ["type", "apiKey"];
const API_KEYS = ["type", "baseUrl"];
const MODEL_RULE_KEYS = ["providerId", "modelId", "config"];
const MODEL_CONFIG_KEYS = ["properties", "optionSpecs"];
const MODEL_PROPERTIES_KEYS = ["contextWindow", "inputFormat"];
const INPUT_FORMAT_KEYS = ["supportsImage"];
const OPTION_SPECS_KEYS = ["maxOutputTokens", "reasoningLevel"];

const assertOnlyKeys = (object, allowed, label) => {
  for (const key of Object.keys(object)) {
    expect(allowed, `${label} has unexpected key "${key}"`).toContain(key);
  }
};

const baseInput = {
  baseUrl: "http://127.0.0.1:20128",
  apiKey: "sk-test-key",
  models: ["cc/claude-sonnet-5", { id: "cx/gpt-6.1-sol", supportsImage: true }],
  format: "anthropic-messages",
};

describe("zcodeConfig / normalizeBaseUrl", () => {
  it("strips a trailing /v1 because ZCode appends /v1/messages itself", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:20128/v1")).toBe("http://127.0.0.1:20128");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://router.example.com/")).toBe("https://router.example.com");
  });

  it("rejects a value without a scheme", () => {
    expect(() => normalizeBaseUrl("127.0.0.1:20128")).toThrow(/absolute URL/);
  });

  it("rejects a non-http scheme", () => {
    expect(() => normalizeBaseUrl("ftp://router.example.com")).toThrow(/http or https/);
  });

  it("rejects an empty value", () => {
    expect(() => normalizeBaseUrl("   ")).toThrow(/required/);
  });
});

describe("zcodeConfig / normalizeModels", () => {
  it("accepts plain ids and objects, deduplicating by id", () => {
    const models = normalizeModels(["a/one", { id: "a/one" }, { id: "b/two", name: "Two" }]);
    expect(models.map((m) => m.id)).toEqual(["a/one", "b/two"]);
    expect(models[1].name).toBe("Two");
  });

  it("requires at least one model", () => {
    expect(() => normalizeModels([])).toThrow(/At least one model/);
  });

  it("rejects an empty model id", () => {
    expect(() => normalizeModels([{ id: "  " }])).toThrow(/must not be empty/);
  });
});

describe("zcodeConfig / applyZCodeProvider schema conformance", () => {
  const { providerConfig } = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput });
  const rule = providerConfig.config.providerConfigRules.providerRules[0];

  it("writes schemaVersion 1", () => {
    expect(providerConfig.schemaVersion).toBe(1);
  });

  it("uses only declared keys on the provider rule", () => {
    assertOnlyKeys(rule, PROVIDER_RULE_KEYS, "providerRule");
    assertOnlyKeys(rule.config, PROVIDER_CONFIG_KEYS, "providerRule.config");
    assertOnlyKeys(rule.config.access, ACCESS_KEYS, "providerRule.config.access");
    assertOnlyKeys(rule.config.api, API_KEYS, "providerRule.config.api");
  });

  it("uses the standard-personal group required for a personal-only provider", () => {
    expect(rule.config.group).toBe("standard-personal");
  });

  it("stores a bare origin, not a /v1 base", () => {
    expect(rule.config.api.baseUrl).toBe("http://127.0.0.1:20128");
  });

  it("uses a supported api type", () => {
    expect(ZCODE_API_FORMATS).toContain(rule.config.api.type);
  });

  it("lists every model in both personalModelIds and modelOrder", () => {
    expect(rule.config.personalModelIds).toEqual(["cc/claude-sonnet-5", "cx/gpt-6.1-sol"]);
    expect(rule.config.modelOrder).toEqual(rule.config.personalModelIds);
  });

  it("uses only declared keys on each model rule", () => {
    const modelRules = providerConfig.config.modelConfigRules.providerModelRules;
    expect(modelRules).toHaveLength(2);
    for (const modelRule of modelRules) {
      assertOnlyKeys(modelRule, MODEL_RULE_KEYS, "modelRule");
      assertOnlyKeys(modelRule.config, MODEL_CONFIG_KEYS, "modelRule.config");
      assertOnlyKeys(modelRule.config.properties, MODEL_PROPERTIES_KEYS, "modelRule.config.properties");
      assertOnlyKeys(
        modelRule.config.properties.inputFormat,
        INPUT_FORMAT_KEYS,
        "modelRule.config.properties.inputFormat",
      );
      if (modelRule.config.optionSpecs) {
        assertOnlyKeys(modelRule.config.optionSpecs, OPTION_SPECS_KEYS, "modelRule.config.optionSpecs");
      }
    }
  });

  it("marks image support per model", () => {
    const modelRules = providerConfig.config.modelConfigRules.providerModelRules;
    expect(modelRules[0].config.properties.inputFormat.supportsImage).toBe(false);
    expect(modelRules[1].config.properties.inputFormat.supportsImage).toBe(true);
  });

  it("writes the legacy config.json mirror too", () => {
    const { config } = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput });
    const legacy = config.provider["9router"];
    expect(legacy.kind).toBe("anthropic");
    expect(legacy.source).toBe("custom");
    expect(legacy.options.baseURL).toBe("http://127.0.0.1:20128");
    expect(Object.keys(legacy.models)).toEqual(["cc/claude-sonnet-5", "cx/gpt-6.1-sol"]);
  });

  it("always gives each legacy model a display name", () => {
    // A missing `name` renders as a blank row in ZCode's picker.
    const { config } = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput });
    for (const [id, entry] of Object.entries(config.provider["9router"].models)) {
      expect(entry.name, `legacy model ${id} has no name`).toBeTruthy();
    }
  });
});

describe("zcodeConfig / model rule duplication guard", () => {
  it("does not emit an intelligent rule for a model configured by hand in ZCode", () => {
    const providerConfig = {
      schemaVersion: 1,
      config: {
        providerConfigRules: { providerRules: [] },
        modelConfigRules: {
          providerModelRules: [],
          manualProviderModelRules: [
            { providerId: "9router", modelId: "cc/claude-sonnet-5", config: { enabled: true } },
          ],
        },
      },
    };
    const next = applyZCodeProvider({ config: null, providerConfig, ...baseInput });
    const rules = next.providerConfig.config.modelConfigRules.providerModelRules;
    expect(rules.map((r) => r.modelId)).toEqual(["cx/gpt-6.1-sol"]);
    // The manual rule survives untouched.
    expect(next.providerConfig.config.modelConfigRules.manualProviderModelRules).toHaveLength(1);
  });
});

describe("zcodeConfig / idempotency and isolation", () => {
  const otherProvider = {
    providerId: "other-provider",
    providerName: "Other",
    enabled: true,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "other-key" },
      api: { type: "anthropic-messages", baseUrl: "https://other.example.com" },
      personalModelIds: ["x/y"],
      modelOrder: ["x/y"],
    },
  };
  const existing = {
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: [otherProvider] },
      modelConfigRules: {
        providerModelRules: [{ providerId: "other-provider", modelId: "x/y", config: { properties: {} } }],
        manualProviderModelRules: [],
      },
      providerOrder: ["other-provider"],
    },
  };

  it("applying twice yields the same document", () => {
    const first = applyZCodeProvider({ config: null, providerConfig: existing, ...baseInput });
    const second = applyZCodeProvider({
      config: first.config,
      providerConfig: first.providerConfig,
      ...baseInput,
    });
    expect(second.providerConfig).toEqual(first.providerConfig);
    expect(second.config).toEqual(first.config);
  });

  it("leaves other providers and providerOrder untouched", () => {
    const next = applyZCodeProvider({ config: null, providerConfig: existing, ...baseInput });
    const rules = next.providerConfig.config.providerConfigRules.providerRules;
    expect(rules[0]).toEqual(otherProvider);
    expect(next.providerConfig.config.providerOrder).toEqual(["other-provider"]);
  });

  it("remove restores the original document", () => {
    const applied = applyZCodeProvider({ config: null, providerConfig: existing, ...baseInput });
    const removed = removeZCodeProvider({
      config: applied.config,
      providerConfig: applied.providerConfig,
    });
    expect(removed.providerConfig).toEqual(existing);
    expect(removed.config.provider["9router"]).toBeUndefined();
  });

  it("remove is a no-op on a document that never had the provider", () => {
    const removed = removeZCodeProvider({ config: { provider: {} }, providerConfig: existing });
    expect(removed.providerConfig).toEqual(existing);
  });
});

describe("zcodeConfig / parseZCodeProvider", () => {
  it("reports not wired for empty input", () => {
    const parsed = parseZCodeProvider({ config: null, providerConfig: null });
    expect(parsed.wired).toBe(false);
    expect(parsed.models).toEqual([]);
  });

  it("round-trips what apply wrote", () => {
    const applied = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput });
    const parsed = parseZCodeProvider(applied);
    expect(parsed.wired).toBe(true);
    expect(parsed.source).toBe("provider_config");
    expect(parsed.baseUrl).toBe("http://127.0.0.1:20128");
    expect(parsed.apiKey).toBe("sk-test-key");
    expect(parsed.format).toBe("anthropic-messages");
    expect(parsed.models).toEqual(["cc/claude-sonnet-5", "cx/gpt-6.1-sol"]);
  });

  it("falls back to the legacy file when no rule exists", () => {
    const applied = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput });
    const parsed = parseZCodeProvider({ config: applied.config, providerConfig: null });
    expect(parsed.source).toBe("config");
    expect(parsed.format).toBe("anthropic-messages");
    expect(parsed.models).toEqual(["cc/claude-sonnet-5", "cx/gpt-6.1-sol"]);
  });
});

describe("zcodeConfig / format selection", () => {
  it("maps each api type to the legacy kind ZCode expects", () => {
    const cases = [
      ["anthropic-messages", "anthropic"],
      ["openai-chat-completions", "openai-compatible"],
      ["openai-responses", "openai"],
    ];
    for (const [format, kind] of cases) {
      const next = applyZCodeProvider({ config: null, providerConfig: null, ...baseInput, format });
      expect(next.config.provider["9router"].kind).toBe(kind);
      expect(
        next.providerConfig.config.providerConfigRules.providerRules[0].config.api.type,
      ).toBe(format);
    }
  });

  it("rejects an unsupported format", () => {
    expect(() =>
      applyZCodeProvider({ config: null, providerConfig: null, ...baseInput, format: "gemini" }),
    ).toThrow(/Unsupported api format/);
  });
});

describe("zcodeConfig / readZCodeCodingPlanKey", () => {
  it("prefers a zai coding-plan provider", () => {
    const config = {
      provider: {
        "builtin:zai": {
          name: "Z.ai",
          options: { apiKey: "other-key", baseURL: "https://api.z.ai/api/anthropic" },
        },
        "builtin:zai-coding-plan": {
          name: "Z.ai - Coding Plan",
          options: { apiKey: "abc.def", baseURL: "https://api.z.ai/api/anthropic" },
        },
      },
    };
    expect(readZCodeCodingPlanKey({ config, providerConfig: null })).toEqual({
      apiKey: "abc.def",
      providerId: "builtin:zai-coding-plan",
    });
  });

  it("returns null when ZCode has no key", () => {
    expect(readZCodeCodingPlanKey({ config: { provider: {} }, providerConfig: null })).toBeNull();
  });
});
