import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkTurns, contextSizeFor, renderNotes, useNames } from "../src/summarize.ts";
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
  participants: [],
};

test("numbered speakers are replaced by their names where known", () => {
  const renamed = useNames({
    ...notes,
    summary: "Participante 1 pidió un informe a Participante 2 y a Participante 12.",
    actionItems: [
      { owner: "Participante 2", task: "Enviar el informe a Participante 1", due: "" },
      { owner: "Participante 3", task: "Revisar", due: "" },
    ],
    participants: [
      { speaker: "Participante 1", names: ["Laura"] },
      { speaker: "Participante 2", names: ["Andrés"] },
      { speaker: "Participante 3", names: [] },
    ],
  });
  assert.equal(renamed.summary, "Laura pidió un informe a Andrés y a Participante 12.");
  assert.deepEqual(renamed.actionItems, [
    { owner: "Andrés", task: "Enviar el informe a Laura", due: "" },
    { owner: "Participante 3", task: "Revisar", due: "" },
  ]);
});

test("a speaker with two names keeps its number: two voices were confused", () => {
  const renamed = useNames({
    ...notes,
    actionItems: [{ owner: "Participante 2", task: "Consultar con dirección", due: "" }],
    participants: [{ speaker: "Participante 2", names: ["Andrés", "Carlos"] }],
  });
  assert.equal(renamed.actionItems[0].owner, "Participante 2");
});

test("the participants are listed in the notes", () => {
  const markdown = renderNotes(
    {
      ...notes,
      participants: [
        { speaker: "Participante 1", names: ["Laura"] },
        { speaker: "Participante 2", names: ["Andrés", "Carlos"] },
        { speaker: "Participante 3", names: [] },
      ],
    },
    transcript,
  );
  assert.match(
    markdown,
    /## Participantes\n\n- Participante 1: Laura\n- Participante 2: Andrés \/ Carlos\n- Participante 3: \?\n/,
  );
});

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
