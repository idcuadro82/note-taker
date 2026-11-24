import { readFile, writeFile } from "node:fs/promises";

export const SAMPLE_RATE = 16_000;

/** Reads a 16 kHz, mono, 16-bit PCM WAV file (the format the recorder writes). */
export async function readWav(filePath: string): Promise<Int16Array> {
  const file = await readFile(filePath);
  if (file.toString("latin1", 0, 4) !== "RIFF" || file.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${filePath}`);
  }

  let offset = 12;
  let formatOk = false;
  while (offset + 8 <= file.length) {
    const id = file.toString("latin1", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const [format, channels, rate, bits] = [
        file.readUInt16LE(body),
        file.readUInt16LE(body + 2),
        file.readUInt32LE(body + 4),
        file.readUInt16LE(body + 14),
      ];
      if (format !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
        throw new Error(`Expected 16 kHz mono 16-bit PCM, got ${rate} Hz, ${channels} ch, ${bits} bit: ${filePath}`);
      }
      formatOk = true;
    } else if (id === "data") {
      if (!formatOk) break;
      // Trust the file length over the header: an interrupted recording
      // can have a stale size field.
      const end = Math.min(file.length, body + Math.max(size, file.length - body));
      const sampleCount = Math.floor((end - body) / 2);
      const samples = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) samples[i] = file.readInt16LE(body + i * 2);
      return samples;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`Unsupported WAV file: ${filePath}`);
}

export async function writeWav(filePath: string, samples: Int16Array): Promise<void> {
  const dataBytes = samples.length * 2;
  const file = Buffer.alloc(44 + dataBytes);
  file.write("RIFF", 0, "latin1");
  file.writeUInt32LE(36 + dataBytes, 4);
  file.write("WAVEfmt ", 8, "latin1");
  file.writeUInt32LE(16, 16); // fmt chunk size
  file.writeUInt16LE(1, 20); // PCM
  file.writeUInt16LE(1, 22); // mono
  file.writeUInt32LE(SAMPLE_RATE, 24);
  file.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  file.writeUInt16LE(2, 32); // block align
  file.writeUInt16LE(16, 34); // bits per sample
  file.write("data", 36, "latin1");
  file.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) file.writeInt16LE(samples[i], 44 + i * 2);
  await writeFile(filePath, file);
}
