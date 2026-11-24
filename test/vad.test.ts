import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpeechSegments, planClips } from "../src/vad.ts";

test("parses speech segments from centiseconds to seconds", () => {
  const output = [
    "Detected 2 speech segments:",
    "Speech segment 0: start = 199.00, end = 269.00",
    "Speech segment 1: start = 1299.00, end = 1357.50",
  ].join("\n");
  assert.deepEqual(parseSpeechSegments(output), [
    { start: 1.99, end: 2.69 },
    { start: 12.99, end: 13.575 },
  ]);
});

test("no speech gives no clips", () => {
  assert.deepEqual(parseSpeechSegments("Detected 0 speech segments:\n"), []);
  assert.deepEqual(planClips([], 60), []);
});

test("joins speech separated by a short pause", () => {
  const clips = planClips(
    [
      { start: 2, end: 3 },
      { start: 3.4, end: 5 },
    ],
    60,
  );
  assert.equal(clips.length, 1);
  assert.ok(clips[0].start < 2 && clips[0].end > 5);
});

test("a long pause starts a new clip", () => {
  const clips = planClips(
    [
      { start: 2, end: 3 },
      { start: 10, end: 12 },
    ],
    60,
  );
  assert.equal(clips.length, 2);
  assert.ok(clips[1].start > 9.8 && clips[1].start <= 10);
});

test("clips never exceed one Whisper window", () => {
  const speech = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8 }));
  const clips = planClips(speech, 100);
  assert.ok(clips.length > 1);
  for (const clip of clips) assert.ok(clip.end - clip.start <= 28.3 + 1e-9);
});

test("splits a single stretch longer than one window", () => {
  const clips = planClips([{ start: 0, end: 70 }], 70);
  assert.equal(clips.length, 3);
});

test("padding stays inside the recording and clips do not overlap", () => {
  const clips = planClips(
    [
      { start: 0.05, end: 1 },
      { start: 1.9, end: 3 },
      { start: 9, end: 9.98 },
    ],
    10,
  );
  assert.ok(clips[0].start >= 0);
  assert.ok(clips.at(-1)!.end <= 10);
  for (let i = 1; i < clips.length; i++) assert.ok(clips[i].start >= clips[i - 1].end);
});
