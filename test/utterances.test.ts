import assert from "node:assert/strict";
import { test } from "node:test";
import { UtteranceTracker } from "../src/utterances.ts";

const RATE = 16_000;

function tone(seconds: number, amplitude: number): Int16Array {
  const samples = new Int16Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(amplitude * Math.sin(i / 5));
  return samples;
}

function noise(seconds: number, amplitude: number): Int16Array {
  const samples = new Int16Array(Math.round(seconds * RATE));
  let seed = 7;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    samples[i] = Math.round((seed / 2 ** 31 - 0.5) * 2 * amplitude);
  }
  return samples;
}

function feedAll(tracker: UtteranceTracker, ...parts: Int16Array[]): void {
  for (const part of parts) {
    // In uneven chunks, like audio read from a file that is still growing.
    for (let offset = 0; offset < part.length; offset += 1234) {
      tracker.feed(part.subarray(offset, offset + 1234));
    }
  }
}

test("silence produces no utterances", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, new Int16Array(5 * RATE));
  assert.equal(tracker.current, undefined);
  assert.deepEqual(tracker.takeClosed(), []);
});

test("speech between silences becomes one closed utterance with its start time", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, new Int16Array(2 * RATE), tone(1.5, 5000), new Int16Array(1 * RATE));
  const closed = tracker.takeClosed();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].index, 1);
  assert.equal(closed[0].closed, true);
  // Starts slightly before the speech (pre-roll) and never after it.
  assert.ok(closed[0].start > 1.5 && closed[0].start <= 2, `start ${closed[0].start}`);
  const seconds = closed[0].samples.length / RATE;
  assert.ok(seconds >= 1.5 && seconds < 3, `length ${seconds}`);
  assert.deepEqual(tracker.takeClosed(), []);
});

test("an utterance in progress is visible before it ends", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, new Int16Array(RATE), tone(1, 5000));
  assert.equal(tracker.current?.closed, false);
  assert.equal(tracker.takeClosed().length, 0);
  feedAll(tracker, new Int16Array(RATE));
  assert.equal(tracker.current, undefined);
  assert.equal(tracker.takeClosed().length, 1);
});

test("a short pause does not split an utterance, a long one does", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, tone(1, 5000), new Int16Array(0.3 * RATE), tone(1, 5000), new Int16Array(RATE), tone(1, 5000), new Int16Array(RATE));
  assert.deepEqual(tracker.takeClosed().map((utterance) => utterance.index), [1, 2]);
});

test("a long monologue is cut into pieces", () => {
  const tracker = new UtteranceTracker();
  // Words with the short gaps of continuous speech, for 30 seconds.
  const words = Array.from({ length: 60 }, () => [tone(0.4, 5000), new Int16Array(0.1 * RATE)]).flat();
  feedAll(tracker, ...words, new Int16Array(RATE));
  const closed = tracker.takeClosed();
  assert.equal(closed.length, 3);
  for (const utterance of closed) assert.ok(utterance.samples.length / RATE <= 12.01);
});

test("steady background noise is not speech, but a voice over it is", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, noise(12, 800));
  tracker.takeClosed(); // the noise level is unknown during the first second
  feedAll(tracker, noise(5, 800));
  assert.equal(tracker.current, undefined);
  assert.deepEqual(tracker.takeClosed(), []);

  const voice = noise(1.5, 800).map((sample, i) => sample + Math.round(6000 * Math.sin(i / 5)));
  feedAll(tracker, voice, noise(1.5, 800));
  assert.equal(tracker.takeClosed().length, 1);
});

test("flush closes the utterance in progress", () => {
  const tracker = new UtteranceTracker();
  feedAll(tracker, tone(1, 5000));
  tracker.flush();
  assert.equal(tracker.takeClosed().length, 1);
  assert.equal(tracker.current, undefined);
});
