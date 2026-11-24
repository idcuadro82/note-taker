import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./paths.ts";

export interface Config {
  /** Folder where each meeting gets its own subfolder. */
  meetingsDir: string;
  /** Spoken language code (es, en...) or "auto" to detect it. */
  language: string;
  /** Ollama model that writes the notes. */
  model: string;
  /** "on" to tell the other participants apart by their voices, "off" to group them. */
  separateSpeakers: string;
  /** "on" to write the notes after transcribing, "off" to stop at the transcript. */
  notes: string;
}

const DEFAULTS: Config = {
  meetingsDir: "~/Meetings",
  language: "auto",
  model: "gemma3:12b",
  separateSpeakers: "on",
  notes: "on",
};

const ALLOWED_VALUES: Partial<Record<keyof Config, string[]>> = {
  separateSpeakers: ["on", "off"],
  notes: ["on", "off"],
};

/** Per-machine settings; not committed. See config.example.json. */
export const configFile = path.join(repoRoot, "config.local.json");

/**
 * Settings, from lowest to highest priority: defaults, config.local.json,
 * environment variables (NOTES_DIR, NOTES_LANGUAGE, OLLAMA_MODEL).
 * Command-line options override all of them.
 */
export function loadConfig(file = configFile, env: NodeJS.ProcessEnv = process.env): Config {
  const fromFile = existsSync(file) ? parseConfig(readFileSync(file, "utf8"), file) : {};
  const fromEnv: Partial<Config> = {
    ...(env.NOTES_DIR && { meetingsDir: env.NOTES_DIR }),
    ...(env.NOTES_LANGUAGE && { language: env.NOTES_LANGUAGE }),
    ...(env.OLLAMA_MODEL && { model: env.OLLAMA_MODEL }),
  };
  const config = { ...DEFAULTS, ...fromFile, ...fromEnv };
  return { ...config, meetingsDir: expandHome(config.meetingsDir) };
}

function parseConfig(text: string, file: string): Partial<Config> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  const known = Object.keys(DEFAULTS);
  for (const [key, value] of Object.entries(parsed)) {
    if (!known.includes(key)) {
      throw new Error(`Unknown setting "${key}" in ${file}. Valid settings: ${known.join(", ")}.`);
    }
    if (typeof value !== "string" || value === "") {
      throw new Error(`Setting "${key}" in ${file} must be a non-empty string.`);
    }
    const allowed = ALLOWED_VALUES[key as keyof Config];
    if (allowed && !allowed.includes(value)) {
      throw new Error(`Setting "${key}" in ${file} must be one of: ${allowed.join(", ")}.`);
    }
  }
  return parsed as Partial<Config>;
}

function expandHome(dir: string): string {
  return path.resolve(dir === "~" || dir.startsWith("~/") ? path.join(os.homedir(), dir.slice(1)) : dir);
}

export const config = loadConfig();
