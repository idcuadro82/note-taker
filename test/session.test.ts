import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { currentRecording, meetingDirName, slugify, startRecording, stopRecording } from "../src/session.ts";

test("slugify keeps letters and digits and strips accents", () => {
  assert.equal(slugify("Revisión Q4 / Planning"), "revision-q4-planning");
  assert.equal(slugify("  ¿Qué tal?  "), "que-tal");
  assert.equal(slugify("../../etc"), "etc");
  assert.equal(slugify(""), "");
  assert.equal(slugify("!!!"), "");
});

test("slugify limits the length without a trailing dash", () => {
  const slug = slugify(`${"a".repeat(49)} b c d`);
  assert.ok(slug.length <= 50);
  assert.doesNotMatch(slug, /-$/);
});

test("meeting folder is named after the local date and time", () => {
  const date = new Date(2026, 10, 3, 9, 5);
  assert.equal(meetingDirName(date), "2026-11-03-0905");
  assert.equal(meetingDirName(date, "Weekly sync"), "2026-11-03-0905-weekly-sync");
});

/** A meetings folder holding the state of a recording whose recorder is gone. */
function interruptedRecording(): { meetingsDir: string; dir: string } {
  const meetingsDir = mkdtempSync(path.join(os.tmpdir(), "note-taker-test-"));
  const dir = path.join(meetingsDir, "2026-11-03-0905");
  // Above the highest pid macOS hands out, so no process has it.
  const recording = { pid: 9_999_999, dir, startedAt: "2026-11-03T09:05:00.000Z" };
  writeFileSync(path.join(meetingsDir, ".recording.json"), JSON.stringify(recording));
  return { meetingsDir, dir };
}

test("there is no recording in an empty meetings folder", async () => {
  const meetingsDir = mkdtempSync(path.join(os.tmpdir(), "note-taker-test-"));
  assert.equal(await currentRecording(meetingsDir), undefined);
  await assert.rejects(stopRecording(meetingsDir), /Not recording/);
});

test("a recording whose recorder died is reported as interrupted", async () => {
  const { meetingsDir, dir } = interruptedRecording();
  const recording = await currentRecording(meetingsDir);
  assert.equal(recording?.dir, dir);
  assert.equal(recording?.interrupted, true);
});

test("a new recording does not start over an interrupted one", async () => {
  const { meetingsDir } = interruptedRecording();
  await assert.rejects(startRecording(meetingsDir, "Next meeting"), /previous recording was interrupted/);
});

test("stopping recovers an interrupted recording and forgets it", async () => {
  const { meetingsDir, dir } = interruptedRecording();
  const recording = await stopRecording(meetingsDir);
  assert.equal(recording.dir, dir);
  assert.equal(recording.interrupted, true);
  assert.equal(existsSync(path.join(meetingsDir, ".recording.json")), false);
  assert.equal(await currentRecording(meetingsDir), undefined);
});
