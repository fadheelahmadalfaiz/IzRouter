#!/usr/bin/env node
/**
 * guard-fork-features.mjs — keep the MIBP fork a true UNION after an upstream merge.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sync-mibp` is the union of two upstreams:
 *   - mhiqrambg/9router-mibp-version@master  (fork base; carries fork features)
 *   - decolua/9router@master                 (original upstream; carries new features)
 *
 * The hourly workflow merges the fork base first (-X ours) and decolua second
 * (-X theirs). For files BOTH sides edited, `-X theirs` takes decolua's WHOLE
 * blob, silently dropping fork-only additions in that file. A naive merge still
 * exits 0 with no conflict markers — so nothing fails, and the fork feature just
 * disappears.
 *
 * This script re-inserts each known fork-only snippet when it is missing. It is
 * deliberately LINE-LEVEL (not whole-file restore) so decolua's new additions in
 * the same file survive too.
 *
 * USAGE
 *   node scripts/guard-fork-features.mjs            # patch in place, exit 0
 *   node scripts/guard-fork-features.mjs --check    # report only; exit 1 if missing
 *
 * Exit codes: 0 = all present (or successfully re-inserted), 1 = missing anchor
 * that could not be repaired (fail loud — never push a broken union).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

/**
 * Each guard is a file with one or more "parts". Every part describes a snippet
 * that MUST be present. When it is missing, the part is re-inserted after its
 * anchor line. `-X theirs` merges can drop a snippet while leaving code that
 * depends on it (e.g. a `useState` declaration gone but its JSX kept), so parts
 * are checked independently and repaired independently.
 *
 * Part fields:
 *   label        human-readable description
 *   requires     substrings; the part is satisfied if ANY is present
 *   snippet      lines to insert when missing
 *   insertAfter  anchor line; snippet goes right after the first matching line
 *   noBlankBefore  default false (blank line separates); true for arrays/imports
 *   matchIndent    copy the anchor line's leading whitespace onto the snippet
 *   requireAnchor  if true, never fall back to appending at file end when the
 *                anchor is gone (use for snippets that are only valid in-place,
 *                e.g. a `switch` case). Fail loudly instead.
 *   detectOnly   structural, multi-site feature that CANNOT be repaired
 *                line-level (e.g. a `switch` case with a big body, or a feature
 *                spread over several hooks + JSX sites). Checked in both modes;
 *                never auto-repaired — fails loudly so a human redoes the union.
 */
const GUARDS = [
  {
    file: "src/lib/oauth/constants/oauth.js",
    parts: [
      {
        label: "FREEBUFF_CONFIG export",
        requires: ["FREEBUFF_CONFIG"],
        snippet: [
          "// Freebuff OAuth Configuration (Device Code Flow)",
          'export const FREEBUFF_CONFIG = { ...PROVIDER_OAUTH["freebuff"] };',
        ],
        // fork keeps freebuff right after the grok-cli config line
        insertAfter: 'export const GROK_CLI_CONFIG = { ...PROVIDER_OAUTH["grok-cli"] };',
      },
    ],
  },
  {
    file: "src/app/api/oauth/[provider]/[action]/route.js",
    parts: [
      {
        label: "freebuff in OAuth provider route list",
        requires: ["freebuff"],
        snippet: ['"freebuff",'],
        insertAfter: '"grok-cli",',
        noBlankBefore: true,
        matchIndent: true,
      },
    ],
  },
  {
    file: "src/shared/components/Header.js",
    parts: [
      {
        label: "DonateModal import (decolua donation UI)",
        requires: ["DonateModal"],
        snippet: ['import DonateModal from "@/shared/components/DonateModal";'],
        insertAfter: 'import ThemeToggle from "@/shared/components/ThemeToggle";',
        noBlankBefore: true,
      },
      {
        // Consistency guard: if the donate JSX survives but its state hook was
        // dropped by the merge, the file will not compile. Re-add the hook.
        label: "donateOpen state hook",
        requires: ["const [donateOpen, setDonateOpen] = useState"],
        snippet: ["const [donateOpen, setDonateOpen] = useState(false);"],
        insertAfter: 'const [loginMethod, setLoginMethod] = useState("");',
        noBlankBefore: true,
        matchIndent: true,
      },
      {
        // The right-actions cluster differs STRUCTURALLY between the two sides:
        //   mibp    : <a href="...mhiqrambg...">code / MIBP Edition</a>
        //   decolua : <button onClick={setDonateOpen}>volunteer_activism / Donate</button> + <DonateModal/>
        // -X ours/-X theirs can interleave the two into a tag-mismatched mess
        // (<a ...> ... </button>), which fails the JSX parse. When that happens,
        // replace the whole cluster with the canonical UNION of both sides.
        label: "right-actions cluster (MIBP link + Donate button + modal)",
        requires: [
          'aria-label="MIBP Edition"',
          'aria-label="Donate"',
          "<DonateModal isOpen={donateOpen}",
        ],
        // Detect the corruption precisely: an <a ...> element whose body
        // contains volunteer_activism, or an <a ...> closed by </button>.
        // In the correct union the <a> body holds only `code`/`MIBP Edition`.
        detectCorrupt: /<a\b(?:(?!<\/a>)[^])*?(?:volunteer_activism|<\/button>)/,
        replaceBetween: {
          start: "        <HeaderSearch />\n",
          end: "\n      <DonateModal isOpen={donateOpen}",
        },
        snippet: [
          "        <HeaderSearch />",
          '        <a',
          '          href="https://github.com/mhiqrambg/9router-mibp-version"',
          '          target="_blank"',
          '          rel="noreferrer"',
          '          className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"',
          '          aria-label="MIBP Edition"',
          "        >",
          '          <span className="material-symbols-outlined text-[18px]">code</span>',
          '          <span className="hidden sm:inline">MIBP Edition</span>',
          "        </a>",
          "        <button",
          "          onClick={() => setDonateOpen(true)}",
          '          className="hidden sm:flex items-center gap-1.5 px-3 h-8 rounded-lg border border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20 transition-colors text-sm font-medium"',
          '          aria-label="Donate"',
          "        >",
          '          <span className="material-symbols-outlined text-[18px]">volunteer_activism</span>',
          '          <span className="hidden sm:inline">Donate</span>',
          "        </button>",
          "        <ThemeToggle />",
          "        <HeaderLanguage />",
          "        <HeaderMenu onLogout={handleLogout} />",
          "      </div>",
        ],
      },
    ],
  },
  {
    // Fork-only `switch` case in the quota normalizer. decolua has no
    // `case "freebuff":` at all, so a `-X theirs` merge of this file drops the
    // whole case. It is self-contained, so it CAN be re-inserted line-level
    // right before the next stable case (`case "cursor":`).
    file: "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js",
    parts: [
      {
        label: 'freebuff quota normalizer case',
        requiresAll: ['case "freebuff":', "priceNote"],
        // Full literal indentation (no matchIndent) because the snippet is a
        // nested block: matchIndent would flatten the inner indentation.
        snippet: [
          '      case "freebuff":',
          "        // Session quotas keyed by model id - label rows with the friendly",
          "        // displayName (from the registry) and keep modelKey for ordering.",
          "        // Metered rows carry the live Freebucks price (price) + promo tagline",
          "        // (priceNote), both server-authoritative.",
          "        if (data.quotas) {",
          "          Object.entries(data.quotas).forEach(([modelKey, quota]) => {",
          "            normalizedQuotas.push({",
          "              name: quota.displayName || modelKey,",
          "              modelKey,",
          "              used: quota.used || 0,",
          "              total: quota.total || 0,",
          "              resetAt: quota.resetAt || null,",
          "              recurring: quota.recurring !== false,",
          "              price: quota.price,",
          "              priceNote: quota.priceNote,",
          "            });",
          "          });",
          "        }",
          "        break;",
        ],
        insertBeforeAnchor: 'case "cursor":',
        // Never append a switch case at file end: it would land outside the switch.
        requireAnchor: true,
      },
    ],
  },
  {
    // Fork-only multi-proxy-selection UI. decolua still uses the single
    // `boundProxyPoolId` model, so `-X theirs` reverts this file to upstream and
    // drops the whole multi-select feature. It spans many hooks + JSX sites, so
    // it cannot be repaired line-level — detect-and-fail only.
    file: "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js",
    parts: [
      {
        label: "multi-proxy-pool selection (selectedProxyIds + rotation strategy)",
        detectOnly: true,
        requiresAll: [
          "selectedProxyIds",
          "setSelectedProxyIds",
          "handleToggleProxySelection",
          "handleApplyProxyChanges",
          "rotationStrategy",
        ],
        // Partial drops keep some usages; require the bulk of them.
        minCount: { needle: "selectedProxyIds", min: 20 },
      },
    ],
  },
  {
    // Fork-only device-code provider list + egress proxy-pool picker. decolua
    // keeps a local `deviceCodeProviders` array without the fork's device-code
    // UX (proxy pool picker, persisted choice), so a merge reverts the file.
    file: "src/shared/components/OAuthModal.js",
    parts: [
      {
        label: "DEVICE_CODE_PROVIDERS list + device-code egress picker",
        detectOnly: true,
        requiresAll: [
          "DEVICE_CODE_PROVIDERS",
          "oauthProxyPoolStorageKey",
          "OAuthProxyPoolSelect",
        ],
        minCount: { needle: "DEVICE_CODE_PROVIDERS", min: 4 },
      },
    ],
  },
  {
    // Fork-only "reveal stored key" modal. decolua has no RevealKeyModal import,
    // state, or JSX, so a merge drops all three sites.
    file: "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js",
    parts: [
      {
        label: "RevealKeyModal (import + revealTarget state + JSX)",
        detectOnly: true,
        requiresAll: ["RevealKeyModal", "revealTarget", "setRevealTarget"],
        minCount: { needle: "RevealKeyModal", min: 2 },
      },
    ],
  },
  {
    // Fork-only bulk activate/deactivate for the selected connections. decolua's
    // provider page has per-row toggles only, so `-X theirs` reverts the file and
    // drops the bulk handler + its two buttons. Structural (state hook + handler
    // + JSX), so detect-and-fail only: a line-level repair would leave a
    // half-wired button that silently does nothing.
    file: "src/app/(dashboard)/dashboard/providers/[id]/page.js",
    parts: [
      {
        label: "bulk activate/deactivate selected connections",
        detectOnly: true,
        requiresAll: [
          "handleBulkUpdateStatus",
          "setBulkUpdatingStatus",
          "bulkUpdatingStatus",
        ],
        minCount: { needle: "handleBulkUpdateStatus", min: 3 },
      },
    ],
  },
  {
    // Fork-only Qoder fixes (upstream decolua/9router#5051, still open). Three
    // independent behaviours, all absent from upstream, so a `-X theirs` merge
    // silently reverts them:
    //   1. code 10605 is a model-queue throttle, not a billing block -- the
    //      executor polls queue/status and replays instead of returning 403
    //      (which chatCore reads as insufficient_quota and locks for minutes);
    //   2. Sonus (`smodel`) / Cantus (`cmodel`) get a static model_config so
    //      they route even when the per-account catalog omits them;
    //   3. the `qoder` capability table exists, so images are not stripped.
    // `detectCorrupt` catches the specific regression of re-adding 10605 to the
    // billing branch, which would look "fine" but restore the 403 bug.
    file: "open-sse/executors/qoder.js",
    parts: [
      {
        label: "qoder model-queue wait (10605 is capacity, not billing)",
        detectOnly: true,
        requiresAll: [
          "parseQoderQueueInfo",
          "computeQoderQueueDelayMs",
          "qoderQueueStatusUrl",
          "peekFirstQoderFrame",
        ],
        detectCorrupt: /code === "110" \|\| code === "112" \|\| code === "10605"/,
      },
      {
        label: "qoder static model_config fallback (Sonus/Cantus)",
        detectOnly: true,
        requiresAll: ["getQoderStaticModelConfig", "sendOnce"],
      },
      {
        label: "qoder stable machineId (deriveMachineId)",
        detectOnly: true,
        requires: ["deriveMachineId"],
      },
    ],
  },
  {
    // The queue helpers the executor depends on. A whole new file, so a merge
    // that reverts the executor would also leave this orphaned -- guard it
    // separately so the failure names the real cause.
    file: "open-sse/shared/qoder/queue.js",
    parts: [
      {
        label: "queue payload parsing + status polling helpers",
        detectOnly: true,
        requiresAll: [
          "QODER_QUEUE_CODE",
          "parseQoderQueueInfo",
          "parseQoderQueueStatus",
          "qoderQueueStatusUrl",
          "qoderQueueMaxWaitMs",
        ],
      },
    ],
  },
  {
    // Static blocks for the frontier pair, plus the capability table that keeps
    // Qoder models vision-capable. Without the table every id is reported
    // text-only and a client image is swapped for a placeholder before it ever
    // reaches the model.
    file: "open-sse/shared/qoder/constants.js",
    parts: [
      {
        label: "QODER_STATIC_MODEL_CONFIGS + getQoderStaticModelConfig",
        detectOnly: true,
        requiresAll: ["QODER_STATIC_MODEL_CONFIGS", "getQoderStaticModelConfig", "smodel", "cmodel"],
        minCount: { needle: "smodel", min: 3 },
      },
    ],
  },
  {
    file: "open-sse/providers/capabilities.js",
    parts: [
      {
        label: "qoder capability table (vision/reasoning per model id)",
        detectOnly: true,
        requiresAll: ['PROVIDER_CAPABILITIES["qoder"] =', "smodel", "cmodel", "qmodel_38max"],
      },
    ],
  },
  {
    file: "open-sse/providers/registry/qoder.js",
    parts: [
      {
        label: "Sonus / Cantus advertised in the picker",
        detectOnly: true,
        requiresAll: ["smodel", "cmodel"],
      },
    ],
  },
  {
    file: "open-sse/services/qoderModels.js",
    parts: [
      {
        label: "static-only keys kept in /v1/models",
        detectOnly: true,
        requiresAll: ["QODER_STATIC_MODEL_CONFIGS"],
        minCount: { needle: "QODER_STATIC_MODEL_CONFIGS", min: 2 },
      },
    ],
  },
  {
    // Fork-only ZCode integration. Upstream decolua has no ZCode support, so a
    // `-X theirs` merge silently drops every wiring point while leaving the new
    // files (src/lib/zcodeConfig.js, the zcode-settings route, ZCodeToolCard)
    // orphaned -- the card would exist but never render.
    // Detect-only: re-inserting a JSX/switch branch from a snippet is how you
    // get a case outside its switch, so fail loudly and repair by hand.
    file: "src/shared/constants/cliTools.js",
    parts: [
      {
        label: "ZCode CLI tool entry",
        detectOnly: true,
        requiresAll: ["zcode: {"],
      },
    ],
  },
  {
    file: "src/app/(dashboard)/dashboard/cli-tools/components/index.js",
    parts: [
      {
        label: "ZCodeToolCard export",
        detectOnly: true,
        requires: ["ZCodeToolCard"],
      },
    ],
  },
  {
    file: "src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js",
    parts: [
      {
        label: "ZCodeToolCard import + switch case",
        detectOnly: true,
        requiresAll: ["ZCodeToolCard"],
        minCount: { needle: "ZCodeToolCard", min: 2 },
      },
    ],
  },
  {
    file: "src/app/api/cli-tools/all-statuses/route.js",
    parts: [
      {
        label: "zcode status getter registration",
        detectOnly: true,
        requiresAll: ["zcodeGet"],
        minCount: { needle: "zcodeGet", min: 2 },
      },
    ],
  },
  {
    // Fork-only outbound User-Agent default. Node's fetch sends `User-Agent:
    // node`, and some upstreams 403 that bare token while serving the same key
    // from any other UA (sakoo.biz.id does). Upstream decolua has no such
    // default, so a `-X theirs` merge drops the file and every non-OpenAI
    // provider silently goes back to 403.
    file: "open-sse/config/outboundUserAgent.js",
    parts: [
      {
        label: "default outbound User-Agent (avoids bare `node`)",
        detectOnly: true,
        requiresAll: ["getOutboundUserAgent", "withDefaultUserAgent"],
      },
    ],
  },
  {
    file: "open-sse/utils/proxyFetch.js",
    parts: [
      {
        label: "default User-Agent applied at the fetch choke point",
        detectOnly: true,
        requiresAll: ["withDefaultUserAgent"],
      },
    ],
  },
];

function readFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return { abs, text: fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") };
}

function writeFile(abs, text) {
  fs.writeFileSync(abs, text);
}

function hasAny(text, needles) {
  return needles.some((n) => text.includes(n));
}

/**
 * Is a guard part satisfied? `-X theirs` can drop a file's fork lines PARTIALLY
 * (it keeps whole hunks, so a feature spread over several hunks survives in
 * pieces — e.g. 24 `selectedProxyIds` usages reduced to 13). So a part can
 * assert three things:
 *   requires     at least one of these substrings is present (any-of)
 *   requiresAll  every one of these substrings is present (all-of)
 *   minCount     `needle` occurs at least `min` times (catches partial drops)
 *   detectCorrupt  a regex that must NOT match (structural corruption)
 */
function isPartSatisfied(text, part) {
  if (part.detectCorrupt && part.detectCorrupt.test(text)) return false;
  if (part.requiresAll && !part.requiresAll.every((n) => text.includes(n))) return false;
  if (part.minCount) {
    const { needle, min } = part.minCount;
    const count = text.split(needle).length - 1;
    if (count < min) return false;
  }
  if (part.requires && !hasAny(text, part.requires)) return false;
  return true;
}

function insertAfterLine(text, anchorLine, snippetLines, noBlankBefore = false, matchIndent = false) {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === anchorLine.trim());
  if (idx === -1) return null;
  let block = [...snippetLines];
  if (matchIndent) {
    const indent = lines[idx].match(/^\s*/)[0];
    block = block.map((l) => (l.trim() ? indent + l.trim() : l));
  }
  if (!noBlankBefore) block = ["", ...block];
  lines.splice(idx + 1, 0, ...block);
  return lines.join("\n");
}

function insertBeforeLine(text, anchorLine, snippetLines, noBlankBefore = false, matchIndent = false) {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === anchorLine.trim());
  if (idx === -1) return null;
  let block = [...snippetLines];
  if (matchIndent) {
    const indent = lines[idx].match(/^\s*/)[0];
    block = block.map((l) => (l.trim() ? indent + l.trim() : l));
  }
  if (!noBlankBefore) block = [...block, ""];
  lines.splice(idx, 0, ...block);
  return lines.join("\n");
}

/**
 * Replace everything from the first `start` anchor (INCLUSIVE) up to (exclusive)
 * the first `end` anchor that follows it, with `snippetLines`. Used to rebuild a
 * whole JSX cluster when a merge interleaves two incompatible structures.
 */
function replaceBetweenAnchors(text, startAnchor, endAnchor, snippetLines) {
  const startIdx = text.indexOf(startAnchor);
  if (startIdx === -1) return null;
  const afterStart = startIdx + startAnchor.length;
  const endIdx = text.indexOf(endAnchor, afterStart);
  if (endIdx === -1) return null;
  return text.slice(0, startIdx) + snippetLines.join("\n") + text.slice(endIdx);
}

let failed = 0;
let patched = 0;

for (const g of GUARDS) {
  const f = readFile(g.file);
  if (!f) {
    console.error(`::error::guard: file missing: ${g.file}`);
    failed++;
    continue;
  }
  let text = f.text;
  let filePatched = false;

  for (const part of g.parts) {
    // A part is satisfied when every assertion passes: any `requires`, all
    // `requiresAll`, `minCount` occurrence, and no `detectCorrupt` match.
    const corrupt = part.detectCorrupt ? part.detectCorrupt.test(text) : false;
    if (isPartSatisfied(text, part)) {
      console.log(`OK    ${g.file}: ${part.label}`);
      continue;
    }
    // `detectOnly` parts (structural, multi-site fork features) cannot be
    // re-inserted line-level: a partial repair would leave orphaned usages and
    // a file that does not compile. Report and fail loudly instead — in BOTH
    // modes — so the workflow's hard `--check` gate can never push a union that
    // silently dropped them.
    if (CHECK_ONLY || part.detectOnly) {
      console.error(
        `::error::guard(${corrupt ? "CORRUPT" : "MISSING"}) ${g.file}: ${part.label}` +
          (part.detectOnly ? " [detect-only: needs manual union repair]" : ""),
      );
      failed++;
      continue;
    }
    let repaired = null;
    if (part.replaceBetween) {
      repaired = replaceBetweenAnchors(
        text,
        part.replaceBetween.start,
        part.replaceBetween.end,
        part.snippet,
      );
    } else if (part.insertBeforeAnchor) {
      repaired = insertBeforeLine(
        text,
        part.insertBeforeAnchor,
        part.snippet,
        part.noBlankBefore,
        part.matchIndent,
      );
    } else {
      repaired = insertAfterLine(
        text,
        part.insertAfter,
        part.snippet,
        part.noBlankBefore,
        part.matchIndent,
      );
    }
    // If the anchor line itself is gone, fall back to appending at file end —
    // but NEVER for parts flagged `requireAnchor` (e.g. a `switch` case): an
    // appended case would land outside the switch and produce dead/broken code.
    // Those fail loudly instead.
    if (repaired === null && !part.requireAnchor) {
      repaired = text.replace(/\n?$/, "\n") + "\n" + part.snippet.join("\n") + "\n";
    }
    const stillCorrupt = part.detectCorrupt ? part.detectCorrupt.test(repaired) : false;
    if (repaired === null || stillCorrupt || !isPartSatisfied(repaired, part)) {
      console.error(`::error::guard(UNREPAIRABLE) ${g.file}: ${part.label}`);
      failed++;
      continue;
    }
    text = repaired;
    filePatched = true;
    console.log(`FIXED ${g.file}: repaired ${part.label}`);
  }

  if (filePatched) {
    writeFile(f.abs, text);
    patched++;
  }
}

if (failed > 0) {
  console.error(`\nguard-fork-features: ${failed} fork feature(s) missing and not repaired.`);
  process.exit(1);
}
console.log(`\nguard-fork-features: all fork features present${patched ? ` (${patched} files repaired)` : ""}.`);
