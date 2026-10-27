"use server";

import { NextResponse } from "next/server";
import { resolveCliApiKey } from "../resolveApiKey.js";
import {
  applyZCodeProvider,
  getZCodePaths,
  isZCodeInstalled,
  parseZCodeProvider,
  readZCodeConfig,
  readZCodeProviderConfig,
  removeZCodeProvider,
  writeZCodeProvider,
  ZCODE_API_FORMATS,
} from "@/lib/zcodeConfig";

const errorResponse = (message, status = 400) =>
  NextResponse.json({ error: { message } }, { status });

export async function GET() {
  try {
    const paths = getZCodePaths();
    if (!isZCodeInstalled(paths)) {
      return NextResponse.json({
        installed: false,
        config: null,
        has9Router: false,
        message: "ZCode is not installed",
        formats: ZCODE_API_FORMATS,
      });
    }

    const config = readZCodeConfig(paths);
    const providerConfig = readZCodeProviderConfig(paths);
    const zcode = parseZCodeProvider({ config, providerConfig });

    return NextResponse.json({
      installed: true,
      // The card reads `config.provider["9router"]`; hand it the legacy shape
      // only, so a large provider_config.json never reaches the browser.
      config: { provider: { "9router": config?.provider?.["9router"] || null } },
      has9Router: zcode.wired,
      configPath: paths.legacyConfig,
      providerConfigPath: paths.providerConfig,
      zcode,
      formats: ZCODE_API_FORMATS,
    });
  } catch (error) {
    console.log("Error checking zcode settings:", error);
    return NextResponse.json({ error: "Failed to check ZCode settings" }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  try {
    const { baseUrl, apiKey, models, model, format } = body || {};
    const modelList = Array.isArray(models) && models.length > 0 ? models : model ? [model] : [];
    if (!baseUrl) return errorResponse("baseUrl is required");
    if (modelList.length === 0) return errorResponse("At least one model is required");

    const paths = getZCodePaths();
    const config = readZCodeConfig(paths);
    const providerConfig = readZCodeProviderConfig(paths);

    const next = applyZCodeProvider({
      config,
      providerConfig,
      baseUrl,
      apiKey: await resolveCliApiKey(apiKey),
      models: modelList,
      format,
    });

    writeZCodeProvider({ ...next, paths });

    return NextResponse.json({
      success: true,
      message:
        "ZCode settings applied. Restart ZCode to see the 9Router models in its model picker.",
      configPath: paths.legacyConfig,
      providerConfigPath: paths.providerConfig,
      models: modelList.length,
    });
  } catch (error) {
    // Validation errors from zcodeConfig are actionable; anything else is a
    // filesystem problem the user cannot fix from the dashboard.
    const message = error?.message || "Failed to apply ZCode settings";
    const isValidation = /required|must|Unsupported|At least one model/.test(message);
    return errorResponse(message, isValidation ? 400 : 500);
  }
}

export async function DELETE() {
  try {
    const paths = getZCodePaths();
    const config = readZCodeConfig(paths);
    const providerConfig = readZCodeProviderConfig(paths);

    if (!config && !providerConfig) {
      return NextResponse.json({ success: true, message: "No ZCode config file to reset" });
    }

    const next = removeZCodeProvider({ config, providerConfig });
    writeZCodeProvider({ ...next, paths });

    return NextResponse.json({
      success: true,
      message: "9Router removed from ZCode. Restart ZCode to apply.",
    });
  } catch (error) {
    console.log("Error resetting zcode settings:", error);
    return NextResponse.json({ error: "Failed to reset ZCode settings" }, { status: 500 });
  }
}
