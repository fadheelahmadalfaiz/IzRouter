"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

const ENDPOINT = "/api/cli-tools/zcode-settings";
const IMPORT_ENDPOINT = "/api/cli-tools/zcode-settings/import-key";

const FORMAT_OPTIONS = [
  {
    value: "anthropic-messages",
    label: "Anthropic Messages",
    hint: "ZCode calls /v1/messages. Best fidelity for Claude-family models.",
  },
  {
    value: "openai-chat-completions",
    label: "OpenAI Chat Completions",
    hint: "ZCode calls /v1/chat/completions.",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    hint: "ZCode calls /v1/responses. Best for GPT-5+ and Codex models.",
  },
];

const normalizeOrigin = (url) => (url || "").replace(/\/+$/, "").replace(/\/v1$/, "");

export default function ZCodeToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders = [],
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [status, setStatus] = useState(() => initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState(() => apiKeys?.[0]?.key || "");
  const [selectedModels, setSelectedModels] = useState([]);
  const [format, setFormat] = useState("anthropic-messages");
  const [modalOpen, setModalOpen] = useState(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [importAvailable, setImportAvailable] = useState(false);
  const modelAliases = useMemo(() => ({}), []);
  const hydrated = useRef(false);

  const zcode = status?.zcode || null;
  const currentBaseUrl = zcode?.baseUrl || "";

  const hydrateFromStatus = useCallback((data) => {
    const parsed = data?.zcode;
    if (!parsed || hydrated.current) return;
    hydrated.current = true;
    if (Array.isArray(parsed.models) && parsed.models.length > 0) {
      setSelectedModels(parsed.models);
    }
    if (parsed.format) setFormat(parsed.format);
    if (parsed.apiKey) setSelectedApiKey(parsed.apiKey);
  }, []);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setStatus(data);
      hydrateFromStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, [hydrateFromStatus]);

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
      hydrateFromStatus(initialStatus);
    }
  }, [initialStatus, hydrateFromStatus]);

  useEffect(() => {
    if (!isExpanded) return;
    if (!status) checkStatus();
    let active = true;
    fetch(IMPORT_ENDPOINT)
      .then((res) => res.json())
      .then((data) => {
        if (active) setImportAvailable(Boolean(data?.available));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isExpanded, status, checkStatus]);

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}`;
    return normalizeOrigin(url.endsWith("/v1") ? url : `${url}/v1`);
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const configStatus = () => {
    if (!status?.installed) return null;
    if (!status?.has9Router) return "not_configured";
    return matchKnownEndpoint(currentBaseUrl, { tunnelPublicUrl, tailscaleUrl })
      ? "configured"
      : "other";
  };
  const configState = configStatus();

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: selectedApiKey,
          models: selectedModels,
          format,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error?.message || data.error || "Failed to apply settings." });
        return;
      }
      rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
      setMessage({ type: "success", text: data.message || "Settings applied." });
      hydrated.current = false;
      await checkStatus();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error?.message || data.error || "Failed to reset." });
        return;
      }
      setMessage({ type: "success", text: data.message || "Removed from ZCode." });
      hydrated.current = false;
      await checkStatus();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleImportKey = async () => {
    setImporting(true);
    setMessage(null);
    try {
      const res = await fetch(IMPORT_ENDPOINT, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error?.message || data.error || "Import failed." });
        return;
      }
      setMessage({ type: "success", text: data.message || "Key imported into the GLM provider." });
      setImportAvailable(false);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setImporting(false);
    }
  };

  const handleAddModel = (model) => {
    setSelectedModels((prev) => (prev.includes(model.value) ? prev : [...prev, model.value]));
  };

  const handleRemoveModel = (modelValue) => {
    setSelectedModels((prev) => prev.filter((value) => value !== modelValue));
  };

  const handleAddAllActiveModels = () => {
    const all = [];
    for (const connection of activeProviders) {
      const alias = PROVIDER_ID_TO_ALIAS[connection.provider] || connection.provider;
      for (const model of getModelsByProviderId(connection.provider)) {
        all.push(`${alias}/${model.id}`);
      }
      if (getModelsByProviderId(connection.provider).length === 0) {
        const prefix = connection.providerSpecificData?.prefix || alias;
        if (connection.defaultModel) all.push(`${prefix}/${connection.defaultModel}`);
        for (const model of connection.providerSpecificData?.customModels || []) {
          if (model?.id) all.push(`${prefix}/${model.id}`);
        }
      }
    }
    setSelectedModels((prev) => Array.from(new Set([...prev, ...all])));
  };

  const getManualConfigs = () => {
    const origin = getEffectiveBaseUrl();
    const key = selectedApiKey || "<API_KEY_FROM_DASHBOARD>";
    const models = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

    const providerRule = {
      providerId: "9router",
      providerName: "9Router",
      enabled: true,
      config: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: key },
        api: { type: format, baseUrl: origin },
        personalModelIds: models,
        modelOrder: models,
      },
    };

    return [
      {
        filename: "~/.zcode/v2/provider_config.json",
        content: JSON.stringify(
          {
            schemaVersion: 1,
            config: {
              providerConfigRules: { providerRules: [providerRule] },
              modelConfigRules: {
                providerModelRules: models.map((id) => ({
                  providerId: "9router",
                  modelId: id,
                  config: {
                    properties: { contextWindow: 128000, inputFormat: { supportsImage: false } },
                    optionSpecs: { maxOutputTokens: { max: 32000 } },
                  },
                })),
                manualProviderModelRules: [],
              },
            },
          },
          null,
          2,
        ),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div
        className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center"
        onClick={onToggle}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center">
            <Image
              src="/providers/zcode.png"
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 rounded-lg object-contain"
              sizes="32px"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{tool.name}</h3>
              {configState === "configured" && (
                <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                  Connected
                </span>
              )}
              {configState === "not_configured" && (
                <span className="rounded-full bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                  Not configured
                </span>
              )}
              {configState === "other" && (
                <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  Other endpoint
                </span>
              )}
            </div>
            <p className="truncate text-xs text-text-muted">{tool.description}</p>
          </div>
        </div>
        <span
          className={`material-symbols-outlined text-[20px] text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}
        >
          expand_more
        </span>
      </div>

      {isExpanded && (
        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking ZCode…</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-yellow-500">warning</span>
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">
                    ZCode not detected on this machine
                  </p>
                  <p className="text-sm text-text-muted">
                    Install ZCode, or use Manual Config when 9Router runs on another host.
                  </p>
                </div>
              </div>
              <div className="pl-9">
                <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined mr-1 text-[18px]">content_copy</span>
                  Manual Config
                </Button>
              </div>
            </div>
          )}

          {!checking && status?.installed && (
            <>
              {importAvailable && (
                <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-text-muted">
                    <span className="font-medium text-text-main">ZCode has a Z.ai coding-plan key.</span>{" "}
                    Import it into 9Router&apos;s GLM provider instead of signing in again.
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleImportKey}
                    loading={importing}
                    className="shrink-0"
                  >
                    <span className="material-symbols-outlined mr-1 text-[16px]">download</span>
                    Import key
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    Select Endpoint
                  </span>
                  <span className="material-symbols-outlined hidden text-[14px] text-text-muted sm:inline">
                    arrow_forward
                  </span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    currentUrl={currentBaseUrl}
                  />
                </div>

                {currentBaseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                      Current
                    </span>
                    <span className="material-symbols-outlined hidden text-[14px] text-text-muted sm:inline">
                      arrow_forward
                    </span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {currentBaseUrl}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    API Key
                  </span>
                  <span className="material-symbols-outlined hidden text-[14px] text-text-muted sm:inline">
                    arrow_forward
                  </span>
                  <ApiKeySelect
                    value={selectedApiKey}
                    onChange={setSelectedApiKey}
                    apiKeys={apiKeys}
                    cloudEnabled={cloudEnabled}
                  />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    API Format
                  </span>
                  <span className="material-symbols-outlined hidden text-[14px] text-text-muted sm:inline">
                    arrow_forward
                  </span>
                  <div className="flex flex-col gap-1">
                    <select
                      value={format}
                      onChange={(event) => setFormat(event.target.value)}
                      className="w-full rounded border border-border bg-surface px-2 py-2 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                    >
                      {FORMAT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-text-muted">
                      {FORMAT_OPTIONS.find((option) => option.value === format)?.hint}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 pt-1 text-right text-sm font-semibold text-text-main">
                    Models
                  </span>
                  <span className="material-symbols-outlined mt-1.5 text-[14px] text-text-muted">
                    arrow_forward
                  </span>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex min-h-[28px] flex-wrap gap-1.5 rounded border border-border bg-surface px-2 py-1.5">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            className="inline-flex items-center gap-1 rounded border border-transparent bg-black/5 px-2 py-0.5 text-xs text-text-muted dark:bg-white/5"
                          >
                            {model}
                            <button
                              type="button"
                              onClick={() => handleRemoveModel(model)}
                              className="ml-0.5 hover:text-red-500"
                              aria-label={`Remove ${model}`}
                            >
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        disabled={activeProviders.length === 0}
                        className={`rounded border px-2 py-1 text-xs transition-colors ${
                          activeProviders.length
                            ? "cursor-pointer border-border bg-surface text-text-main hover:border-primary"
                            : "cursor-not-allowed border-border opacity-50"
                        }`}
                      >
                        Add Model
                      </button>
                      <button
                        type="button"
                        onClick={handleAddAllActiveModels}
                        disabled={activeProviders.length === 0}
                        className={`rounded border px-2 py-1 text-xs transition-colors ${
                          activeProviders.length
                            ? "cursor-pointer border-border bg-surface text-text-main hover:border-primary"
                            : "cursor-not-allowed border-border opacity-50"
                        }`}
                      >
                        Add all active
                      </button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0
                          ? `${selectedModels.length} model${selectedModels.length === 1 ? "" : "s"}`
                          : "Select models to add"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-[11px] text-blue-600 dark:text-blue-400">
                <span className="material-symbols-outlined text-[14px]">info</span>
                <span>Restart ZCode after applying — it reads its provider list at startup.</span>
              </div>

              {message && (
                <div
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                    message.type === "success"
                      ? "bg-green-500/10 text-green-600"
                      : "bg-red-500/10 text-red-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {message.type === "success" ? "check_circle" : "error"}
                  </span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApply}
                  disabled={selectedModels.length === 0}
                  loading={applying}
                >
                  <span className="material-symbols-outlined mr-1 text-[14px]">save</span>
                  Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={!status.has9Router}
                  loading={restoring}
                >
                  <span className="material-symbols-outlined mr-1 text-[14px]">restore</span>
                  Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined mr-1 text-[14px]">content_copy</span>
                  Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleAddModel}
          onDeselect={(model) => handleRemoveModel(model.value)}
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add models for ZCode"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="ZCode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
