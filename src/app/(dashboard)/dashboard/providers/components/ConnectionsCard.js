"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Card, Badge, Button, Modal, Select, Toggle, EditConnectionModal, ConfirmModal } from "@/shared/components";
import WebLoginButton from "./WebLoginButton";

// ── CooldownTimer ──────────────────────────────────────────────
function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) { setRemaining(""); return; }
      const s = Math.floor(diff / 1000);
      if (s < 60) setRemaining(`${s}s`);
      else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!remaining) return null;
  return <span className="text-xs text-orange-500 font-mono">⏱ {remaining}</span>;
}

CooldownTimer.propTypes = { until: PropTypes.string.isRequired };

// ── ConnectionRow ──────────────────────────────────────────────
function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, isSelected, onToggleSelect, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onCopyKey, onEdit, onDelete }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((p) => [p.id, p]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId ? `Pool: ${boundProxyPoolId} (inactive/missing)`
    : hasLegacyProxy ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}` : "";

  let maskedProxyUrl = "";
  const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
  if (rawProxyUrl) {
    try {
      const p = new URL(rawProxyUrl);
      maskedProxyUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
    } catch { maskedProxyUrl = rawProxyUrl; }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";
  const proxyBadgeVariant = boundProxyPool?.isActive === true ? "success" : (boundProxyPoolId || hasLegacyProxy) ? "error" : "default";

  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v).filter(Boolean).sort()[0] || null;

  useEffect(() => {
    const check = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v).filter(v => v && new Date(v).getTime() > Date.now()).sort()[0] || null;
      setIsCooldown(!!until);
    };
    check();
    const t = modelLockUntil ? setInterval(check, 1000) : null;
    return () => { if (t) clearInterval(t); };
  }, [modelLockUntil]);

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus = connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try { await onUpdateProxy(poolId === "__none__" ? null : poolId); }
    finally { setUpdatingProxy(false); setShowProxyDropdown(false); }
  };

  return (
    <div className={`group flex flex-col gap-3 p-2 rounded-lg sm:flex-row sm:items-center sm:justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex w-full min-w-0 flex-1 items-start gap-3 sm:items-center">
        <Checkbox
          checked={!!isSelected}
          onChange={onToggleSelect}
          size="sm"
          ariaLabel={`Select ${displayName}`}
          className="mt-1"
        />
        <div className="flex flex-col">
          <button onClick={onMoveUp} disabled={isFirst} className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}>
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button onClick={onMoveDown} disabled={isLast} className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}>
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <span className="material-symbols-outlined text-base text-text-muted">{isOAuth ? "lock" : "key"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            {hasAnyProxy && <Badge variant={proxyBadgeVariant} size="sm">Proxy</Badge>}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>{connection.lastError}</span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-text-muted truncate max-w-[420px]" title={proxyDisplayText}>{proxyDisplayText}</span>
              {maskedProxyUrl && <code className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-text-muted">{maskedProxyUrl}</code>}
              {noProxyText && <span className="text-[11px] text-text-muted truncate max-w-[320px]" title={noProxyText}>no_proxy: {noProxyText}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-wrap gap-1">
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">{updatingProxy ? "progress_activity" : "lan"}</span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                  <button onClick={() => handleSelectProxy("__none__")} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}>None</button>
                  {(proxyPools || []).map((pool) => (
                    <button key={pool.id} onClick={() => handleSelectProxy(pool.id)} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}>{pool.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={onEdit} className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          {onCopyKey && (
            <button
              onClick={onCopyKey}
              title="Reveal & copy API key"
              aria-label={`Reveal and copy API key for ${displayName}`}
              className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-[18px]">content_copy</span>
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
          )}
          <button onClick={onDelete} className="flex flex-col items-center px-2 py-1 rounded hover:bg-red-500/10 text-red-500">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle size="sm" checked={connection.isActive ?? true} onChange={onToggleActive} title={(connection.isActive ?? true) ? "Disable" : "Enable"} />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.array,
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  isSelected: PropTypes.bool,
  onToggleSelect: PropTypes.func,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onCopyKey: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

// ── AddApiKeyModal ─────────────────────────────────────────────
function AddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: NONE });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch { setValidationResult("failed"); }
    finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); }
      finally { setValidating(false); }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Name</label>
          <input className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Key" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">API Key</label>
            <input type="password" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} />
          </div>
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div>
          <label className="text-xs text-text-muted mb-1 block">Priority</label>
          <input type="number" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })} />
        </div>
        <Select label="Proxy Pool" value={formData.proxyPoolId} onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[{ value: NONE, label: "None" }, ...(proxyPools || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  proxyPools: PropTypes.array,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── RevealKeyModal ─────────────────────────────────────────────
// Re-authenticated reveal of a single connection's API key. Two phases:
//   1. Password entry — verify the dashboard password
//   2. Revealed — display the secret in a read-only field with a mask toggle
//      and an explicit "Copy to clipboard" button. The user decides when to
//      copy; we never auto-copy.
//
// The secret lives in component state only; closing the modal clears it.
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("Clipboard copy failed");
}

function RevealKeyModal({ isOpen, connection, onClose, onSuccess, onError }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revealedValue, setRevealedValue] = useState(null);
  const [showKey, setShowKey] = useState(true);
  const [copied, setCopied] = useState(false);
  const pwdInputRef = useRef(null);
  const keyInputRef = useRef(null);

  // Reset everything when the modal closes/reopens so secrets never linger.
  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setError("");
      setBusy(false);
      setRevealedValue(null);
      setShowKey(true);
      setCopied(false);
      queueMicrotask(() => pwdInputRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen || !connection) return null;

  const fieldHint = connection.authType === "cookie"
    ? "Cookie access token"
    : "API key";

  const handleReveal = async (e) => {
    e?.preventDefault?.();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/providers/${connection.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "Failed to reveal credential";
        setError(msg);
        onError?.(msg);
        return;
      }
      if (!data?.value) {
        setError("No secret stored for this connection");
        return;
      }
      setRevealedValue(data.value);
      setPassword("");
      // Auto-select the value so a quick Cmd-C copies it without clicking.
      queueMicrotask(() => keyInputRef.current?.select());
    } catch (err) {
      setError(err?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedValue) return;
    try {
      await copyTextToClipboard(revealedValue);
      setCopied(true);
      onSuccess?.(`${fieldHint} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError?.("Clipboard write failed — select the text and copy manually");
    }
  };

  // Phase 2: secret is on screen. Show field with optional mask + copy button.
  if (revealedValue !== null) {
    const displayValue = showKey ? revealedValue : "•".repeat(Math.min(revealedValue.length, 32));
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`${fieldHint}: ${connection.name || connection.email || connection.id}`}
        size="md"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={keyInputRef}
              type="text"
              readOnly
              value={displayValue}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              aria-label={`${fieldHint} value`}
              className="flex-1 px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary select-all"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide value" : "Show value"}
              aria-label={showKey ? "Hide value" : "Show value"}
              className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">
                {showKey ? "visibility_off" : "visibility"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
              className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">
                {copied ? "check" : "content_copy"}
              </span>
            </button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            <span className="material-symbols-outlined text-[14px] align-middle mr-1">warning</span>
            Treat this like a password. Don't paste it in public channels.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleCopy} disabled={!revealedValue} fullWidth>
              {copied ? "Copied!" : "Copy to Clipboard"}
            </Button>
            <Button variant="ghost" fullWidth onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Phase 1: ask for the dashboard password before revealing.
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={`Reveal ${fieldHint}`}
      size="sm"
    >
      <form onSubmit={handleReveal} className="flex flex-col gap-4">
        <p className="text-xs text-text-muted leading-relaxed">
          Enter your dashboard password to display the {fieldHint.toLowerCase()} for
          <span className="font-medium text-text-main"> {connection.name || connection.email || connection.id}</span>.
          The value stays in this dialog until you close it.
        </p>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Dashboard password</label>
          <input
            ref={pwdInputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoComplete="current-password"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary disabled:opacity-50"
          />
        </div>
        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            fullWidth
            disabled={!password || busy}
          >
            {busy ? "Revealing…" : "Reveal"}
          </Button>
          <Button type="button" variant="ghost" fullWidth onClick={() => !busy && onClose()} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

RevealKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    authType: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  onError: PropTypes.func,
};

// ── ConnectionsCard ────────────────────────────────────────────
// Self-contained card: fetches, displays and manages all connections for a provider.
export default function ConnectionsCard({ providerId, isOAuth, loginProviderId = null }) {
  const [connections, setConnections] = useState([]);
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("1");
  const [confirmState, setConfirmState] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [revealTarget, setRevealTarget] = useState(null);
  const notify = useNotificationStore();

  const fetch_ = useCallback(async () => {
    try {
      const [connRes, proxyRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connData = await connRes.json();
      const proxyData = await proxyRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connRes.ok) setConnections((connData.connections || []).filter((c) => c.provider === providerId));
      if (proxyRes.ok) setProxyPools(proxyData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
    } catch (e) { console.log("ConnectionsCard fetch error:", e); }
    finally { setLoading(false); }
  }, [providerId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const saveStrategy = async (strategy, stickyLimit) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (e) { console.log("saveStrategy error:", e); }
  };

  const handleSwapPriority = async (i1, i2) => {
    const next = [...connections];
    [next[i1], next[i2]] = [next[i2], next[i1]];
    setConnections(next);
    try {
      await Promise.all([
        fetch(`/api/providers/${next[i1].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i1 }) }),
        fetch(`/api/providers/${next[i2].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i2 }) }),
      ]);
    } catch { await fetch_(); }
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
        } catch (e) { console.log("delete error:", e); }
      }
    });
  };

  const handleToggleActive = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
    } catch (e) { console.log("toggle error:", e); }
  };

  const handleUpdateProxy = async (connId, proxyPoolId) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: proxyPoolId || null }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === connId ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } } : c));
    } catch (e) { console.log("proxy error:", e); }
  };

  const handleSaveApiKey = async (formData) => {
    try {
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, ...formData }) });
      if (res.ok) { await fetch_(); setShowAddModal(false); }
    } catch (e) { console.log("save apikey error:", e); }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { await fetch_(); setShowEditModal(false); }
    } catch (e) { console.log("update connection error:", e); }
  };

  // ── Bulk actions ──
  const connectionIds = new Set(connections.map((c) => c.id));
  const validSelectedIds = selectedIds.filter((id) => connectionIds.has(id));
  const allSelected = connections.length > 0 && validSelectedIds.length === connections.length;

  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : connections.map((c) => c.id));
  const clearSelection = () => setSelectedIds([]);

  useEffect(() => {
    const ids = new Set(connections.map((c) => c.id));
    queueMicrotask(() => {
      setSelectedIds((prev) => prev.filter((id) => ids.has(id)));
    });
  }, [connections]);

  const bulkSetActive = async (isActive) => {
    if (validSelectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      await Promise.all(validSelectedIds.map(async (id) => {
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }));
      await fetch_();
      notify.success(`${isActive ? "Enabled" : "Disabled"} ${ok}${failed ? `, ${failed} failed` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = () => {
    if (validSelectedIds.length === 0) return;
    const count = validSelectedIds.length;
    setConfirmState({
      title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
      message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        const idsToDelete = [...validSelectedIds];
        let ok = 0; let failed = 0;
        try {
          await Promise.all(idsToDelete.map(async (id) => {
            try {
              const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
              if (res.ok) ok += 1; else failed += 1;
            } catch { failed += 1; }
          }));
          await fetch_();
          setSelectedIds((prev) => prev.filter((id) => !idsToDelete.includes(id)));
          notify.success(`Deleted ${ok}${failed ? `, ${failed} failed` : ""}`);
        } finally {
          setBulkBusy(false);
        }
      }
    });
  };

  const applyProxyBulk = async (proxyPoolId) => {
    if (validSelectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      await Promise.all(validSelectedIds.map(async (id) => {
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId }) });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }));
      await fetch_();
      setShowBulkProxyModal(false);
      const label = proxyPoolId ? "proxy updated" : "proxy unbound";
      notify.success(`${label}: ${ok}${failed ? `, ${failed} failed` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const applyProxyRotate = async () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      notify.warning("No active proxy pools available");
      return;
    }
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      await Promise.all(validSelectedIds.map(async (id, idx) => {
        const pool = activePools[idx % activePools.length];
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: pool.id }) });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }));
      await fetch_();
      setShowBulkProxyModal(false);
      notify.success(`Rotated ${ok} connection${ok > 1 ? "s" : ""} across ${activePools.length} pool${activePools.length > 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const openRevealModal = (connection) => {
    setRevealTarget(connection);
  };
  const closeRevealModal = () => {
    setRevealTarget(null);
  };

  if (loading) return <Card><div className="h-20 animate-pulse bg-black/5 rounded-lg" /></Card>;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold">Connections</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle
              checked={providerStrategy === "round-robin"}
              onChange={(enabled) => {
                const strategy = enabled ? "round-robin" : null;
                setProviderStrategy(strategy);
                if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
                saveStrategy(strategy, enabled ? (providerStickyLimit || "1") : providerStickyLimit);
              }}
            />
            {providerStrategy === "round-robin" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">Sticky:</span>
                <input
                  type="number" min={1} value={providerStickyLimit}
                  onChange={(e) => { setProviderStickyLimit(e.target.value); saveStrategy("round-robin", e.target.value); }}
                  className="w-16 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">No connections yet</p>
            <div className="flex flex-wrap gap-2">
              {loginProviderId && (
                <WebLoginButton providerId={loginProviderId} onConnected={fetch_} />
              )}
              <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>Add Connection</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-black/[0.03] pb-2 dark:border-white/[0.03]">
              <Checkbox
                checked={allSelected}
                onChange={toggleSelectAll}
                size="sm"
                label={allSelected ? "Unselect All" : "Select All"}
                className="text-xs text-text-muted hover:text-primary"
              />
              <span className="text-[11px] text-text-muted">{connections.length} total</span>
            </div>

            {validSelectedIds.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
                <span className="text-xs font-medium text-primary">{validSelectedIds.length} selected</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy}>
                    Enable
                  </Button>
                  <Button size="sm" variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy}>
                    Disable
                  </Button>
                  {proxyPools.length > 0 && (
                    <Button size="sm" variant="secondary" icon="lan" onClick={() => setShowBulkProxyModal(true)} disabled={bulkBusy}>
                      Apply Proxy
                    </Button>
                  )}
                  <Button size="sm" variant="danger" icon="delete" onClick={bulkDelete} disabled={bulkBusy}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03] max-h-[500px] overflow-y-auto pr-1">
              {connections.map((conn, idx) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  proxyPools={proxyPools}
                  isOAuth={isOAuth}
                  isFirst={idx === 0}
                  isLast={idx === connections.length - 1}
                  isSelected={validSelectedIds.includes(conn.id)}
                  onToggleSelect={() => toggleSelect(conn.id)}
                  onMoveUp={() => handleSwapPriority(idx, idx - 1)}
                  onMoveDown={() => handleSwapPriority(idx, idx + 1)}
                  onToggleActive={(isActive) => handleToggleActive(conn.id, isActive)}
                  onUpdateProxy={(poolId) => handleUpdateProxy(conn.id, poolId)}
                  onCopyKey={() => openRevealModal(conn)}
                  onEdit={() => { setSelectedConnection(conn); setShowEditModal(true); }}
                  onDelete={() => handleDelete(conn.id)}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-stretch gap-2 sm:justify-start">
              <Button size="sm" icon="add" onClick={() => setShowAddModal(true)}>Add</Button>
              {loginProviderId && (
                <WebLoginButton providerId={loginProviderId} onConnected={fetch_} />
              )}
            </div>
          </>
        )}
      </Card>

      <AddApiKeyModal
        isOpen={showAddModal}
        provider={providerId}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />

      {/* Bulk Proxy Modal */}
      <Modal
        isOpen={showBulkProxyModal}
        onClose={() => !bulkBusy && setShowBulkProxyModal(false)}
        title={`Apply Proxy to ${validSelectedIds.length} Connection${validSelectedIds.length > 1 ? "s" : ""}`}
      >
        <div className="flex flex-col gap-1">
          <button
            onClick={applyProxyRotate}
            disabled={bulkBusy || proxyPools.filter((p) => p.isActive === true).length === 0}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-[18px]">sync_alt</span>
            <span className="text-sm text-text-main">Rotate across active pools</span>
          </button>
          <button
            onClick={() => applyProxyBulk(null)}
            disabled={bulkBusy}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-[18px]">link_off</span>
            <span className="text-sm text-text-main">None (unbind all)</span>
          </button>
          {proxyPools.length > 0 && (
            <div className="my-1 border-t border-black/[0.05] dark:border-white/[0.05]" />
          )}
          {proxyPools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => applyProxyBulk(pool.id)}
              disabled={bulkBusy || pool.isActive !== true}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-text-muted text-[18px]">lan</span>
              <span className="truncate text-sm text-text-main">{pool.name}</span>
              {pool.isActive !== true && (
                <span className="text-[10px] text-text-muted">(inactive)</span>
              )}
            </button>
          ))}
          {bulkBusy && <p className="text-xs text-text-muted px-3 py-2">Applying…</p>}
          <Button onClick={() => setShowBulkProxyModal(false)} variant="ghost" fullWidth disabled={bulkBusy} className="mt-2">
            Cancel
          </Button>
        </div>
      </Modal>

      {/* Reveal & Copy API Key Modal */}
      <RevealKeyModal
        isOpen={!!revealTarget}
        connection={revealTarget}
        onClose={closeRevealModal}
        onSuccess={(message) => notify.success(message)}
        onError={(message) => notify.error(message)}
      />
    </>
  );
}

ConnectionsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  isOAuth: PropTypes.bool,
  loginProviderId: PropTypes.string,
};
