import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandNotFoundError, run } from "../src/process.ts";

test("a command that is not installed is reported as such", async () => {
  await assert.rejects(run("note-taker-missing-command", []), CommandNotFoundError);
});
