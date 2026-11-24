import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText } from "../src/whisper-server.ts";

test("joins Whisper segments, including words split across them", () => {
  assert.equal(cleanText(" Empecemos con el estado del proyecto de factur\nación.\n"), "Empecemos con el estado del proyecto de facturación.");
  assert.equal(cleanText(" Claro, faltan las pruebas.\n El jueves de esta semana.\n"), "Claro, faltan las pruebas. El jueves de esta semana.");
  assert.equal(cleanText("\n"), "");
});
