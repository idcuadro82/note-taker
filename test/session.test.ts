import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingDirName, slugify } from "../src/session.ts";

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
