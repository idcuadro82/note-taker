import assert from "node:assert/strict";
import { test } from "node:test";
import { dropEcho, formatTime, mergeTracks, renderTranscript } from "../src/transcript.ts";

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

test("drops microphone speech that repeats what the others are saying", () => {
  const others = [
    { start: 0, end: 2.5, text: "Hola. Hemos decidido publicar la nueva versión el viernes." },
    { start: 4, end: 6, text: "Marta revisará las pruebas mañana." },
  ];
  const me = [
    { start: 2, end: 4, text: "decidido publicar la nueva versión del viernes." },
    { start: 6, end: 6.8, text: "más mañana." },
  ];
  assert.deepEqual(dropEcho(me, others, [{ start: 0.3, end: 6.9 }]), []);
});

test("keeps what the user says, even while the others talk", () => {
  const others = [{ start: 0, end: 6, text: "Hemos decidido publicar la nueva versión el viernes." }];
  const me = [
    { start: 2, end: 5, text: "Perdona que te interrumpa, pero creo que eso no es correcto." },
    { start: 7, end: 9, text: "Yo prefiero publicar el lunes." },
  ];
  assert.deepEqual(dropEcho(me, others, [{ start: 0, end: 6 }]), me);
});

test("keeps an answer that repeats words of the question", () => {
  const others = [{ start: 0, end: 3, text: "¿Lo tendrás listo el viernes?" }];
  const me = [{ start: 3.4, end: 4.2, text: "El viernes." }];
  assert.deepEqual(dropEcho(me, others, [{ start: 0, end: 3.1 }]), me);
});

test("the same words far apart in time are not echo", () => {
  const others = [{ start: 0, end: 3, text: "Publicamos el viernes." }];
  const me = [{ start: 60, end: 62, text: "Publicamos el viernes." }];
  assert.deepEqual(dropEcho(me, others, [{ start: 0, end: 3 }]), me);
});
