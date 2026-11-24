import { existsSync } from "node:fs";
import { embeddingModelPath, segmentationModelPath } from "./paths.ts";
import type { Range } from "./vad.ts";

/** A stretch of audio spoken by one person; people are numbered from 1. */
export interface Voice extends Range {
  person: number;
}

/**
 * How different two voices must be to count as two people (0 to 1). Lower
 * splits one person into several more easily; higher merges similar voices.
 */
const VOICE_DISTANCE_THRESHOLD = 0.5;
/** Shorter overlaps between speech and a voice are ignored as noise. */
const MIN_OVERLAP_SECONDS = 0.3;
/** A stretch of speech is not cut into pieces shorter than this. */
const MIN_PIECE_SECONDS = 0.5;

/**
 * Tells apart the people talking in a track by their voices.
 *
 * It does not know who anyone is: it only groups the audio by similar voices
 * and numbers the groups.
 */
export async function findVoices(samples: Int16Array): Promise<Voice[]> {
  for (const model of [segmentationModelPath, embeddingModelPath]) {
    if (!existsSync(model)) {
      throw new Error(`Model not found: ${model}\nRun ./scripts/setup.sh to download it.`);
    }
  }
  let sherpa;
  try {
    // Loaded on demand: the rest of the tool works without this dependency.
    sherpa = (await import("sherpa-onnx-node")).default;
  } catch {
    throw new Error("sherpa-onnx-node is not installed. Run ./scripts/setup.sh to install it.");
  }

  const diarization = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationModelPath } },
    embedding: { model: embeddingModelPath },
    // -1: the number of people is unknown and comes from the threshold.
    clustering: { numClusters: -1, threshold: VOICE_DISTANCE_THRESHOLD },
    minDurationOn: 0.3,
    minDurationOff: 0.5,
  });
  const audio = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) audio[i] = samples[i] / 32768;

  const segments = diarization.process(audio) as { start: number; end: number; speaker: number }[];
  return segments.map((segment) => ({ start: segment.start, end: segment.end, person: segment.speaker + 1 }));
}

/**
 * Says who is talking in each stretch of speech, cutting a stretch in two
 * where one person takes over from another without a pause. People are
 * renumbered in the order they first speak.
 */
export function assignPeople(speech: Range[], voices: Voice[]): Voice[] {
  if (voices.length === 0) return [];
  const sorted = [...voices].sort((a, b) => a.start - b.start);

  const pieces: Voice[] = [];
  for (const range of speech) {
    // The voices heard during this stretch, joining consecutive ones of the same person.
    const heard: Voice[] = [];
    for (const voice of sorted) {
      if (overlap(voice, range) < MIN_OVERLAP_SECONDS) continue;
      const last = heard.at(-1);
      if (last && last.person === voice.person) last.end = voice.end;
      else heard.push({ ...voice });
    }

    if (heard.length === 0) {
      // Too short to have a voice of its own: whoever spoke closest in time.
      pieces.push({ ...range, person: nearest(sorted, range).person });
      continue;
    }

    let start = range.start;
    let person = heard[0].person;
    for (let i = 1; i < heard.length; i++) {
      const cut = Math.min(Math.max((heard[i - 1].end + heard[i].start) / 2, range.start), range.end);
      if (cut - start < MIN_PIECE_SECONDS || range.end - cut < MIN_PIECE_SECONDS) continue;
      pieces.push({ start, end: cut, person });
      start = cut;
      person = heard[i].person;
    }
    pieces.push({ start, end: range.end, person });
  }

  const order = new Map<number, number>();
  return pieces.map((piece) => {
    if (!order.has(piece.person)) order.set(piece.person, order.size + 1);
    return { ...piece, person: order.get(piece.person)! };
  });
}

function overlap(a: Range, b: Range): number {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

function nearest(voices: Voice[], range: Range): Voice {
  const distance = (voice: Voice) => Math.max(voice.start - range.end, range.start - voice.end, 0);
  return voices.reduce((best, voice) => (distance(voice) < distance(best) ? voice : best));
}
