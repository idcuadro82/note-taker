import { SAMPLE_RATE } from "./wav.ts";

/** Loudness is measured in frames of 20 ms. */
const FRAME_SAMPLES = SAMPLE_RATE / 50;
const FRAMES_PER_SECOND = SAMPLE_RATE / FRAME_SAMPLES;

/**
 * The background noise level is the quiet end of the last 30 seconds: even
 * someone talking non-stop leaves that share of quiet frames between words.
 */
const NOISE_WINDOW_FRAMES = 30 * FRAMES_PER_SECOND;
const NOISE_PERCENTILE = 0.1;
/** With less history than this the noise level is unknown and taken as zero. */
const MIN_NOISE_HISTORY_FRAMES = 1 * FRAMES_PER_SECOND;
/** The noise level is recomputed this often (0.5 s), not on every frame. */
const NOISE_UPDATE_FRAMES = 25;
/** A frame is voiced when it is this much louder than the background noise... */
const VOICE_OVER_NOISE = 2.5;
/** ...and louder than this, so digital silence plus a click is not speech. */
const MIN_VOICE_LEVEL = 120;

/** Voiced frames in a row needed to start an utterance (60 ms). */
const FRAMES_TO_START = 3;
/** Audio kept from before the first voiced frame, so the first word is not cut. */
const PRE_ROLL_FRAMES = 0.3 * FRAMES_PER_SECOND;
/** A pause this long ends the utterance. */
const END_PAUSE_FRAMES = 0.7 * FRAMES_PER_SECOND;
/** Longer speech is cut here so captions keep appearing during a monologue. */
const MAX_UTTERANCE_FRAMES = 12 * FRAMES_PER_SECOND;

/** A stretch of speech being captured from one audio track. */
export interface Utterance {
  /** Counts up from 1 within the track. */
  index: number;
  /** Seconds from the start of the recording. */
  start: number;
  samples: Int16Array;
  /** False while the speaker is still talking. */
  closed: boolean;
}

/**
 * Splits a live audio track into utterances as the samples arrive.
 *
 * It only decides where speech might be, by loudness; whether an utterance
 * really contains words is left to the speech model.
 */
export class UtteranceTracker {
  private pending = new Int16Array(0);
  private frameCount = 0;
  private noiseWindow: number[] = [];
  private noise = 0;
  private preRoll: Int16Array[] = [];
  private voicedRun = 0;
  private silentRun = 0;
  private frames: Int16Array[] = [];
  private startFrame = 0;
  private index = 0;
  private closedUtterances: Utterance[] = [];

  /** Adds new audio. */
  feed(samples: Int16Array): void {
    const all = new Int16Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let offset = 0;
    for (; offset + FRAME_SAMPLES <= all.length; offset += FRAME_SAMPLES) {
      this.addFrame(all.slice(offset, offset + FRAME_SAMPLES));
    }
    this.pending = all.slice(offset);
  }

  /** The utterance in progress, if someone is talking right now. */
  get current(): Utterance | undefined {
    if (this.frames.length === 0) return undefined;
    return this.build(false);
  }

  /** Utterances that ended since the last call. */
  takeClosed(): Utterance[] {
    const closed = this.closedUtterances;
    this.closedUtterances = [];
    return closed;
  }

  /** Ends the utterance in progress, e.g. when the recording stops. */
  flush(): void {
    if (this.frames.length > 0) this.close();
  }

  private addFrame(frame: Int16Array): void {
    const level = rms(frame);
    const voiced = level > Math.max(MIN_VOICE_LEVEL, this.noise * VOICE_OVER_NOISE);
    this.noiseWindow.push(level);
    if (this.noiseWindow.length > NOISE_WINDOW_FRAMES) this.noiseWindow.shift();
    if (this.frameCount % NOISE_UPDATE_FRAMES === 0) this.updateNoise();

    if (this.frames.length === 0) {
      this.preRoll.push(frame);
      if (this.preRoll.length > PRE_ROLL_FRAMES + FRAMES_TO_START) this.preRoll.shift();
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      if (this.voicedRun >= FRAMES_TO_START) {
        this.frames = this.preRoll;
        this.startFrame = this.frameCount + 1 - this.frames.length;
        this.preRoll = [];
        this.voicedRun = 0;
        this.silentRun = 0;
        this.index++;
      }
    } else {
      this.frames.push(frame);
      this.silentRun = voiced ? 0 : this.silentRun + 1;
      if (this.silentRun >= END_PAUSE_FRAMES || this.frames.length >= MAX_UTTERANCE_FRAMES) this.close();
    }
    this.frameCount++;
  }

  private close(): void {
    this.closedUtterances.push(this.build(true));
    this.frames = [];
    this.silentRun = 0;
  }

  private build(closed: boolean): Utterance {
    const samples = new Int16Array(this.frames.length * FRAME_SAMPLES);
    this.frames.forEach((frame, i) => samples.set(frame, i * FRAME_SAMPLES));
    return { index: this.index, start: this.startFrame / FRAMES_PER_SECOND, samples, closed };
  }

  private updateNoise(): void {
    if (this.noiseWindow.length < MIN_NOISE_HISTORY_FRAMES) return;
    const sorted = [...this.noiseWindow].sort((a, b) => a - b);
    this.noise = sorted[Math.floor(sorted.length * NOISE_PERCENTILE)];
  }
}

function rms(frame: Int16Array): number {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  return Math.sqrt(energy / frame.length);
}
