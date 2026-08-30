import { loadConfig } from "../../config/store.js";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import type { AIProvider, Plan, PlanningContext } from "../../types.js";

/**
 * Z.ai provider via the optional `z-ai-web-dev-sdk` package.
 * The SDK is an optional peer dependency: it is never bundled, and this
 * provider degrades gracefully (unavailable + reason) when it is missing.
 */
interface ZaiSDK {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ role: string; content: string }>;
      }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    };
  };
}

let cached: ZaiSDK | null | undefined;

async function loadSDK(): Promise<ZaiSDK | null> {
  if (cached !== undefined) return cached;
  try {
    // Dynamic, variable-specifier import: the SDK is an OPTIONAL peer that is
    // not installed in this repo (kept in tsup external). A static import
    // would hard-fail typecheck/bundle for everyone who does not have it.
    const specifier = "z-ai-web-dev-sdk";
    const mod = (await import(specifier)) as unknown as {
      default?: { create?: () => Promise<ZaiSDK> };
      create?: () => Promise<ZaiSDK>;
    };
    const factory = mod.default?.create ?? mod.create;
    cached = factory ? await factory() : null;
  } catch {
    cached = null;
  }
  return cached;
}

export class ZaiProvider implements AIProvider {
  readonly name = "zai";
  readonly label = "Z.ai (GLM)";

  async isAvailable(): Promise<boolean> {
    return (await loadSDK()) !== null;
  }

  unavailableReason(): string {
    return 'Optional package "z-ai-web-dev-sdk" is not installed. Install it with: npm install -D z-ai-web-dev-sdk';
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    const sdk = await loadSDK();
    if (!sdk) throw new Error(this.unavailableReason());
    const model = String(loadConfig().providers["zai"]?.["model"] ?? "glm-4-flash");
    const response = await sdk.chat.completions.create({
      messages: [
        { role: "system", content: `${buildSystemPrompt(ctx)} (model: ${model})` },
        { role: "user", content: ctx.intent },
      ],
    });
    const content = response.choices?.[0]?.message?.content ?? "";
    return validatePlanResponse(content);
  }
}
