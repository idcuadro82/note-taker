import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTime, mergeTracks, renderTranscript } from "../src/transcript.ts";

test("interleaves both tracks by start time", () => {
  const turns = mergeTracks({
    others: [
      { start: 0, end: 2, text: "Hi." },
      { start: 10, end: 12, text: "Great." },
    ],
    me: [{ start: 4, end: 6, text: "Hello." }],
  });
  assert.deepEqual(
    turns.map((turn) => [turn.speaker, turn.text]),
    [["others", "Hi."], ["me", "Hello."], ["others", "Great."]],
  );
});

test("joins consecutive segments of one speaker into a turn", () => {
  const turns = mergeTracks({
    others: [
      { start: 0, end: 2, text: "First." },
      { start: 3, end: 5, text: "Second." },
    ],
    me: [],
  });
  assert.deepEqual(turns, [{ speaker: "others", start: 0, end: 5, text: "First. Second." }]);
});

test("a long pause starts a new turn", () => {
  const turns = mergeTracks({
    others: [
      { start: 0, end: 2, text: "First." },
      { start: 10, end: 12, text: "Later." },
    ],
    me: [],
  });
  assert.equal(turns.length, 2);
});

test("does not modify the input segments", () => {
  const others = [
    { start: 0, end: 2, text: "First." },
    { start: 3, end: 5, text: "Second." },
  ];
  mergeTracks({ others, me: [] });
  assert.deepEqual(others[0], { start: 0, end: 2, text: "First." });
});

test("renders turns with timestamp and speaker", () => {
  const markdown = renderTranscript({
    language: "en",
    turns: [{ speaker: "me", start: 3725, end: 3730, text: "Hello." }],
  });
  assert.match(markdown, /\*\*\[01:02:05\] Me:\*\* Hello\./);
});

test("formats seconds as hh:mm:ss", () => {
  assert.equal(formatTime(0), "00:00:00");
  assert.equal(formatTime(59.9), "00:00:59");
  assert.equal(formatTime(3661), "01:01:01");
});
