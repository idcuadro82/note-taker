import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

function fileWith(content: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "note-taker-test-")), "config.local.json");
  writeFileSync(file, content);
  return file;
}

test("uses the defaults when there is no config file", () => {
  const config = loadConfig("/nonexistent/config.local.json", {});
  assert.deepEqual(config, {
    meetingsDir: path.join(os.homedir(), "Meetings"),
    language: "auto",
    model: "gemma3:12b",
    separateSpeakers: "on",
    notes: "on",
  });
});

test("the file overrides defaults and the environment overrides the file", () => {
  const file = fileWith(JSON.stringify({ language: "es", model: "from-file", meetingsDir: "~/Notes" }));
  const config = loadConfig(file, { OLLAMA_MODEL: "from-env" });
  assert.equal(config.language, "es");
  assert.equal(config.model, "from-env");
  assert.equal(config.meetingsDir, path.join(os.homedir(), "Notes"));
});

test("rejects unknown settings, so typos do not go unnoticed", () => {
  assert.throws(() => loadConfig(fileWith('{"lenguage": "es"}'), {}), /Unknown setting "lenguage"/);
});

test("rejects invalid JSON and wrong value types", () => {
  assert.throws(() => loadConfig(fileWith("{ not json"), {}), /Invalid JSON/);
  assert.throws(() => loadConfig(fileWith('{"language": 5}'), {}), /must be a non-empty string/);
  assert.throws(() => loadConfig(fileWith("[]"), {}), /must contain a JSON object/);
  assert.throws(() => loadConfig(fileWith('{"separateSpeakers": "yes"}'), {}), /must be one of: on, off/);
  assert.throws(() => loadConfig(fileWith('{"notes": "no"}'), {}), /must be one of: on, off/);
});
