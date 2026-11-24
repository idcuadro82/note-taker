import assert from "node:assert/strict";
import { test } from "node:test";
import { assignPeople } from "../src/diarize.ts";

test("without voices nobody is assigned", () => {
  assert.deepEqual(assignPeople([{ start: 0, end: 2 }], []), []);
});

test("each stretch of speech gets the person whose voice it overlaps", () => {
  const people = assignPeople(
    [
      { start: 0, end: 4 },
      { start: 6, end: 9 },
      { start: 11, end: 14 },
    ],
    [
      { start: 0.1, end: 3.9, person: 1 },
      { start: 6.2, end: 8.8, person: 2 },
      { start: 11, end: 14, person: 1 },
    ],
  );
  assert.deepEqual(people.map((piece) => piece.person), [1, 2, 1]);
});

test("people are numbered in the order they first speak", () => {
  const people = assignPeople(
    [
      { start: 0, end: 3 },
      { start: 5, end: 8 },
      { start: 10, end: 13 },
    ],
    [
      { start: 0, end: 3, person: 7 },
      { start: 5, end: 8, person: 2 },
      { start: 10, end: 13, person: 7 },
    ],
  );
  assert.deepEqual(people.map((piece) => piece.person), [1, 2, 1]);
});

test("a stretch where one person takes over from another is cut in two", () => {
  const people = assignPeople(
    [{ start: 0, end: 10 }],
    [
      { start: 0, end: 4.8, person: 1 },
      { start: 5.2, end: 10, person: 2 },
    ],
  );
  assert.deepEqual(people, [
    { start: 0, end: 5, person: 1 },
    { start: 5, end: 10, person: 2 },
  ]);
});

test("several voice segments of the same person do not cut the speech", () => {
  const people = assignPeople(
    [{ start: 0, end: 10 }],
    [
      { start: 0, end: 4, person: 1 },
      { start: 4.5, end: 10, person: 1 },
    ],
  );
  assert.deepEqual(people, [{ start: 0, end: 10, person: 1 }]);
});

test("no tiny pieces are cut off at the edges", () => {
  const people = assignPeople(
    [{ start: 0, end: 10 }],
    [
      { start: 0, end: 9.6, person: 1 },
      { start: 9.65, end: 10, person: 2 },
    ],
  );
  assert.deepEqual(people, [{ start: 0, end: 10, person: 1 }]);
});

test("a short remark without a voice of its own goes to whoever spoke closest", () => {
  const people = assignPeople(
    [
      { start: 0, end: 4 },
      { start: 4.5, end: 4.7 },
      { start: 20, end: 24 },
    ],
    [
      { start: 0, end: 4, person: 1 },
      { start: 20, end: 24, person: 2 },
    ],
  );
  assert.deepEqual(people.map((piece) => piece.person), [1, 1, 2]);
});
