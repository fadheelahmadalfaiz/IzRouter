"use server";

import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections } from "@/models";
import {
  getZCodePaths,
  readZCodeCodingPlanKey,
  readZCodeConfig,
  readZCodeProviderConfig,
} from "@/lib/zcodeConfig";

const CONNECTION_NAME = "ZCode";

/**
 * Import the coding-plan API key ZCode already minted for its Z.ai account, so
 * a user signed in to ZCode does not have to run the GLM OAuth flow again.
 *
 * Only the key is copied; the returned payload never echoes it.
 */
export async function GET() {
  try {
    const paths = getZCodePaths();
    const found = readZCodeCodingPlanKey({
      config: readZCodeConfig(paths),
      providerConfig: readZCodeProviderConfig(paths),
    });
    return NextResponse.json({
      available: Boolean(found),
      sourceProviderId: found?.providerId || null,
    });
  } catch (error) {
    console.log("Error reading ZCode credentials:", error);
    return NextResponse.json({ available: false, sourceProviderId: null });
  }
}

export async function POST() {
  try {
    const paths = getZCodePaths();
    const found = readZCodeCodingPlanKey({
      config: readZCodeConfig(paths),
      providerConfig: readZCodeProviderConfig(paths),
    });

    if (!found?.apiKey) {
      return NextResponse.json(
        { error: { message: "No coding-plan API key found in ZCode. Sign in to ZCode first, or add a GLM key manually." } },
        { status: 404 },
      );
    }

    // Reuse the row this importer created last time instead of piling up
    // duplicates; never touch a key the user added by hand under another name.
    const existing = (await getProviderConnections()).find(
      (connection) =>
        connection.provider === "glm" &&
        connection.authType === "apikey" &&
        connection.name === CONNECTION_NAME,
    );

    const connection = await createProviderConnection({
      provider: "glm",
      authType: "apikey",
      name: CONNECTION_NAME,
      apiKey: found.apiKey,
      priority: existing?.priority,
      isActive: true,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "zcode-import",
        zcodeProviderId: found.providerId,
      },
      allowOverwrite: true,
    });

    return NextResponse.json({
      success: true,
      message: "GLM coding-plan key imported from ZCode.",
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
      },
    });
  } catch (error) {
    console.log("Error importing ZCode key:", error);
    return NextResponse.json(
      { error: { message: error?.message || "Failed to import the ZCode key" } },
      { status: 500 },
    );
  }
}
