/** The part of sherpa-onnx-node this project uses; the package ships no types. */
declare module "sherpa-onnx-node" {
  interface OfflineSpeakerDiarizationConfig {
    segmentation: { pyannote: { model: string } };
    embedding: { model: string };
    clustering: { numClusters: number; threshold: number };
    minDurationOn: number;
    minDurationOff: number;
  }

  class OfflineSpeakerDiarization {
    constructor(config: OfflineSpeakerDiarizationConfig);
    /** `samples` are mono, 16 kHz, between -1 and 1. Speakers are numbered from 0. */
    process(samples: Float32Array): { start: number; end: number; speaker: number }[];
  }

  const sherpa: { OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization };
  export default sherpa;
}
