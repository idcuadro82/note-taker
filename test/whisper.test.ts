import assert from "node:assert/strict";
import { test } from "node:test";
import { isNotSpeech } from "../src/whisper.ts";

test("drops non-speech markers", () => {
  for (const text of ["", "[BLANK_AUDIO]", "(music)", "*laughs*"]) {
    assert.equal(isNotSpeech(text), true, text);
  }
});

test("drops well-known hallucinated credits", () => {
  for (const text of [
    "¡Gracias por ver el video!",
    "Gracias por ver.",
    "Subtítulos realizados por la comunidad de Amara.org",
    "CC por Antarctica Films Argentina",
    "Thanks for watching!",
    "Thank you for watching.",
  ]) {
    assert.equal(isNotSpeech(text), true, text);
  }
});

test("keeps real speech, including short answers", () => {
  for (const text of [
    "Gracias.",
    "Sí.",
    "Gracias por ver el informe antes de la reunión.",
    "Los subtítulos del vídeo están listos.",
    "Thanks for watching the demo with me, any questions?",
  ]) {
    assert.equal(isNotSpeech(text), false, text);
  }
});
