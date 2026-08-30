/**
 * tau provider — the model-selection command family.
 * list (key source / active model / catalog age), set-key (store + immediate
 * catalog refresh), models (cached or live catalog), use (interactive or
 * explicit provider+model selection; never hangs on stdin in CI).
 */

import type { Command } from "commander";
import { theme } from "../ui/theme.js";
import { selectFromList, promptHidden } from "../ui/picker.js";
import { loadConfig, maskSecret, setConfigValue } from "../config/store.js";
import { configPath } from "../config/paths.js";
import { getProvider, providerNames } from "../ai/registry.js";
import {
  apiKeySource,
  cachedModels,
  providerEnvKey,
  refreshProviderModels,
  type ModelCatalog,
} from "../ai/models.js";
import { globalOptions } from "./util.js";

/**
 * tau provider — the model-selection mode.
 *
 * After an API key is configured (`set-key`), Tau immediately refreshes the
 * provider's live model catalog and caches it, so `use`/`models` always pick
 * from real, current models instead of a hardcoded list.
 */
export function registerProviderCommands(program: Command): void {
  const provider = program
    .command("provider")
    .description("Manage AI providers: API keys, live model discovery and model selection");

  provider
    .command("list")
    .description("Show every registered provider (key source, active model, cached catalog)")
    .action((_opts, command) => {
      const { json } = globalOptions(command);
      printProviderList(json);
    });

  provider
    .command("set-key")
    .description("Store a provider API key, then auto-refresh its model catalog")
    .argument("<provider>", "provider name (see: tau provider list)")
    .argument("[key]", "API key (omit on a TTY for a hidden prompt, or pipe with --stdin)")
    .option("--stdin", "read the key from standard input instead of the argument")
    .option("--no-refresh", "store the key without refreshing the model catalog")
    .action(
      async (
        name: string,
        key: string | undefined,
        options: { stdin?: boolean; refresh?: boolean },
      ) => {
        try {
          await setKey(name, key, options);
        } catch (error) {
          console.error(theme.error(error instanceof Error ? error.message : String(error)));
          process.exitCode = 1;
        }
      },
    );

  provider
    .command("models")
    .description("Show the model catalog (auto-refreshes when the cache is stale)")
    .argument("[provider]", "default: the configured provider")
    .option("--refresh", "force a live refresh even if the cache is fresh")
    .option("--offline", "only show the cached catalog — never touch the network")
    .action(
      async (
        name: string | undefined,
        options: { refresh?: boolean; offline?: boolean },
        command,
      ) => {
        try {
          await printModels(name, options, globalOptions(command).json);
        } catch (error) {
          console.error(theme.error(error instanceof Error ? error.message : String(error)));
          process.exitCode = 1;
        }
      },
    );

  provider
    .command("use")
    .description("Select a provider (and optionally a model) as the default")
    .argument("<provider>", "provider name (see: tau provider list)")
    .argument("[model]", "model id — omitted: pick interactively from the refreshed catalog")
    .action(async (name: string, model: string | undefined) => {
      try {
        await use(name, model);
      } catch (error) {
        console.error(theme.error(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function requireProvider(name: string): NonNullable<ReturnType<typeof getProvider>> {
  const provider = getProvider(name);
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Registered providers: ${providerNames().join(", ")}`,
    );
  }
  return provider;
}

/** Providers that do not use an API key, with the reason. */
const KEYLESS: Record<string, string> = {
  mock: "The mock provider runs offline — no key needed.",
  ollama: "Ollama runs locally — no key needed (host: providers.ollama.host).",
  zai: "The zai provider authenticates through z-ai-web-dev-sdk — no API key is used.",
};

function currentModel(name: string): string {
  const entry = loadConfig().providers[name] ?? {};
  return typeof entry["model"] === "string" && entry["model"].length > 0
    ? entry["model"]
    : "(auto)";
}

function humanAge(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatCatalog(catalog: ModelCatalog, limit: number, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          provider: catalog.provider,
          source: catalog.source,
          ...(catalog.refreshedAt ? { refreshedAt: catalog.refreshedAt } : {}),
          ...(catalog.warning ? { warning: catalog.warning } : {}),
          models: catalog.models,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (catalog.warning) console.log(theme.warn(catalog.warning));
  if (catalog.source === "unsupported") return;

  const label =
    catalog.source === "live"
      ? `live catalog, ${catalog.models.length} model(s)`
      : `cached catalog, ${catalog.models.length} model(s), refreshed ${humanAge(catalog.refreshedAt)}`;
  console.log(theme.muted(`${catalog.provider}: ${label}`));

  const current = currentModel(catalog.provider);
  const shown = catalog.models.slice(0, limit);
  for (const model of shown) {
    const marker = model.id === current ? theme.ok(" ← current") : "";
    const owner = model.ownedBy ? theme.muted(`  (${model.ownedBy})`) : "";
    console.log(`  ${model.id}${owner}${marker}`);
  }
  if (catalog.models.length > shown.length) {
    console.log(theme.muted(`  … +${catalog.models.length - shown.length} more`));
  }
}

/** Run the auto-refresh cycle and print its outcome. Returns the catalog. */
async function refreshAndReport(
  name: string,
  force: boolean,
  quiet = false,
): Promise<ModelCatalog | null> {
  try {
    const catalog = await refreshProviderModels(name, { force });
    if (quiet) return catalog; // JSON mode: warnings ride in the payload
    if (catalog.source === "unsupported") {
      console.log(theme.muted(`  ${catalog.warning ?? ""}`));
      return catalog;
    }
    if (catalog.warning) {
      console.log(theme.warn(catalog.warning));
    }
    const verb = force ? "refreshed" : "verified";
    console.log(theme.ok(`  Model catalog ${verb}: ${catalog.models.length} model(s).`));
    return catalog;
  } catch (error) {
    if (quiet) throw error instanceof Error ? error : new Error(String(error));
    console.log(
      theme.warn(
        `  Model catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    console.log(theme.muted(`  Inspect later with: tau provider models ${name}`));
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Subcommands
 * ------------------------------------------------------------------ */

function printProviderList(json: boolean): void {
  const config = loadConfig();
  const rows = providerNames().map((name) => {
    const label = getProvider(name)?.label ?? name;
    const key = KEYLESS[name] ? "-" : apiKeySource(name);
    const cache = cachedModels(name);
    return {
      provider: name,
      label,
      default: config.provider === name,
      keySource: key,
      envVar: providerEnvKey(name),
      model: currentModel(name),
      cachedModels: cache.models.length,
      refreshedAt: cache.refreshedAt,
    };
  });

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const width = Math.max(...rows.map((row) => row.provider.length)) + 2;
  for (const row of rows) {
    const marker = row.default ? theme.ok("*") : " ";
    const key =
      row.keySource === "-"
        ? theme.muted("no key needed")
        : row.keySource === "none"
          ? theme.warn(`no key (env ${row.envVar ?? "n/a"} / tau provider set-key)`)
          : theme.muted(`key: ${row.keySource}`);
    const catalog =
      row.cachedModels > 0
        ? theme.muted(`models: ${row.cachedModels}, ${humanAge(row.refreshedAt)}`)
        : theme.muted("models: not cached yet (set a key or run tau provider models <name>)");
    console.log(
      `${marker} ${row.provider.padEnd(width)} ${key}  ${theme.muted(`model: ${row.model}`)}  ${catalog}`,
    );
  }
  console.log(
    theme.muted(
      "\nConfigure a key: tau provider set-key <provider> [key] — models auto-refresh afterwards.",
    ),
  );
}

async function setKey(
  name: string,
  key: string | undefined,
  options: { stdin?: boolean; refresh?: boolean },
): Promise<void> {
  requireProvider(name);
  if (KEYLESS[name]) {
    throw new Error(KEYLESS[name] ?? "This provider needs no API key.");
  }

  let resolved = key;
  if (options.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    resolved = Buffer.concat(chunks).toString("utf8").trim();
  } else if (resolved === undefined && process.stdin.isTTY) {
    resolved = await promptHidden(`API key for "${name}" (input hidden): `);
  }
  if (resolved === undefined || resolved.trim().length === 0) {
    throw new Error(
      "No API key provided. Pass it as an argument, pipe it with --stdin, or run on a TTY for a hidden prompt.",
    );
  }
  resolved = resolved.trim();

  setConfigValue(`providers.${name}.apiKey`, resolved);
  console.log(
    theme.ok(`API key for "${name}" saved to ${configPath()} (${maskSecret(resolved)}).`),
  );
  console.log(theme.muted("The file is chmod 600; environment variables still work as fallback."));

  if (options.refresh === false) {
    console.log(theme.muted("Catalog refresh skipped (--no-refresh)."));
    return;
  }
  console.log(theme.muted(`Auto-refreshing the ${name} model catalog…`));
  const catalog = await refreshAndReport(name, true);
  if (catalog && catalog.source !== "unsupported") {
    formatCatalog(catalog, 15, false);
  }
}

async function printModels(
  name: string | undefined,
  options: { refresh?: boolean; offline?: boolean },
  json: boolean,
): Promise<void> {
  const target = name ?? loadConfig().provider;
  requireProvider(target);

  if (options.offline) {
    const cache = cachedModels(target);
    if (cache.models.length === 0) {
      console.log(
        theme.warn(`No cached catalog for "${target}" yet — run: tau provider models ${target}`),
      );
      return;
    }
    formatCatalog(
      {
        provider: target,
        models: cache.models,
        source: "cache",
        ...(cache.refreshedAt ? { refreshedAt: cache.refreshedAt } : {}),
      },
      30,
      json,
    );
    return;
  }

  try {
    const catalog = await refreshAndReport(target, options.refresh === true, json);
    if (!catalog) return; // refresh failure already reported
    formatCatalog(catalog, 30, json);
  } catch (error) {
    // quiet refresh failure without cache: report as a CLI error
    console.error(theme.error(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

async function use(name: string, model: string | undefined): Promise<void> {
  requireProvider(name);
  setConfigValue("provider", name);
  console.log(theme.ok(`Default provider set to "${name}".`));

  const catalog = await refreshAndReport(name, false);

  if (model !== undefined) {
    setConfigValue(`providers.${name}.model`, model);
    const ids = new Set((catalog?.models ?? []).map((entry) => entry.id));
    if (catalog && catalog.source !== "unsupported" && ids.size > 0 && !ids.has(model)) {
      console.log(
        theme.warn(
          `"${model}" is not in the current ${name} catalog — kept it anyway (custom deployments are allowed).`,
        ),
      );
    }
    console.log(theme.ok(`Model set to "${model}".`));
    return;
  }

  if (!catalog || catalog.source === "unsupported" || catalog.models.length === 0) {
    console.log(
      theme.muted(
        `No catalog to pick from — set a model explicitly: tau config set providers.${name}.model <model>`,
      ),
    );
    return;
  }

  // Non-interactive sessions (CI, pipes) never enter the picker — they would
  // hang on stdin; ask for an explicit model instead.
  if (!process.stdin.isTTY) {
    console.log(
      theme.muted(
        `Non-interactive session — pass a model explicitly: tau provider use ${name} <model>` +
          ` (or run on a TTY to pick from the refreshed list).`,
      ),
    );
    return;
  }

  const activeEntry = loadConfig().providers[name]?.["model"];
  const activeIndex = catalog.models.findIndex((entry) => entry.id === activeEntry);
  const labels = catalog.models.map((entry) =>
    entry.ownedBy ? `${entry.id} ${theme.muted(`(${entry.ownedBy})`)}` : entry.id,
  );
  const picked = await selectFromList({
    title: `Pick a model for "${name}" (enter selects, esc keeps the current one):`,
    items: labels,
    ...(activeIndex >= 0 ? { activeIndex } : {}),
  });
  if (picked === null) {
    console.log(theme.muted(`Kept model "${currentModel(name)}".`));
    return;
  }
  const chosen = catalog.models[picked]?.id;
  if (!chosen) {
    console.log(theme.muted(`Kept model "${currentModel(name)}".`));
    return;
  }
  setConfigValue(`providers.${name}.model`, chosen);
  console.log(theme.ok(`Model set to "${chosen}".`));
}
