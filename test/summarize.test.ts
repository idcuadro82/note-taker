import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkTurns, contextSizeFor, renderNotes } from "../src/summarize.ts";
import type { Notes } from "../src/summarize.ts";
import type { Transcript, Turn } from "../src/transcript.ts";

const turn = (text: string, index = 0): Turn => ({ speaker: "others", start: index, end: index + 1, text });

test("a short conversation is a single chunk", () => {
  const turns = [turn("Hello."), turn("Hi.")];
  assert.deepEqual(chunkTurns(turns, 1000), [turns]);
});

test("no turns gives no chunks", () => {
  assert.deepEqual(chunkTurns([], 1000), []);
});

test("splits a long conversation without losing or reordering turns", () => {
  const turns = Array.from({ length: 50 }, (_, index) => turn("x".repeat(90), index));
  const chunks = chunkTurns(turns, 1000);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), turns);
  for (const chunk of chunks) {
    assert.ok(chunk.reduce((total, item) => total + item.text.length + 10, 0) <= 1000);
  }
});

test("a turn longer than the limit still gets its own chunk", () => {
  const turns = [turn("short"), turn("x".repeat(5000)), turn("short")];
  const chunks = chunkTurns(turns, 1000);
  assert.deepEqual(chunks.flat(), turns);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
});

test("context size grows with the prompt and is capped", () => {
  assert.equal(contextSizeFor(0), 4096);
  assert.ok(contextSizeFor(30_000) > contextSizeFor(3_000));
  assert.equal(contextSizeFor(30_000) % 1024, 0);
  assert.equal(contextSizeFor(10_000_000), 32_768);
});

const transcript: Transcript = {
  language: "es",
  turns: [{ speaker: "me", start: 5, end: 7, text: "Hola." }],
};

const notes: Notes = {
  title: "Estado del proyecto",
  summary: "Se revisó el estado.",
  keyPoints: ["La integración está lista."],
  decisions: [],
  actionItems: [
    { owner: "Marta", task: "Hacer las pruebas", due: "jueves" },
    { owner: "", task: "Avisar a soporte", due: "" },
  ],
  openQuestions: [],
};

test("renders notes in the meeting language and skips empty sections", () => {
  const markdown = renderNotes(notes, transcript);
  assert.match(markdown, /^# Estado del proyecto\n/);
  assert.match(markdown, /## Resumen\n\nSe revisó el estado\./);
  assert.match(markdown, /## Tareas\n\n- \[ \] \*\*Marta:\*\* Hacer las pruebas \(fecha: jueves\)\n- \[ \] Avisar a soporte\n/);
  assert.doesNotMatch(markdown, /## Decisiones/);
  assert.doesNotMatch(markdown, /## Preguntas abiertas/);
  assert.match(markdown, /## Transcripción\n\n\*\*\[00:00:05\] Yo:\*\* Hola\.\n$/);
});

test("falls back to English labels for other languages", () => {
  const markdown = renderNotes({ ...notes, title: "" }, { ...transcript, language: "fr" });
  assert.match(markdown, /^# Summary\n/);
  assert.match(markdown, /## Action items/);
});
