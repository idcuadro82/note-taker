import Foundation

/// Writes 16-bit mono PCM to a WAV file.
///
/// The header is rewritten every few seconds, so a recording stays playable
/// (minus the last few seconds) even if the process is killed.
final class WavWriter {
    private let handle: FileHandle
    private let sampleRate: Int
    private(set) var frames: Int64 = 0
    private var framesAtLastHeader: Int64 = 0

    init(url: URL, sampleRate: Int) throws {
        self.sampleRate = sampleRate
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path])
        }
        handle = try FileHandle(forWritingTo: url)
        try handle.write(contentsOf: header())
    }

    func append(_ pcm: Data) throws {
        guard !pcm.isEmpty else { return }
        try handle.write(contentsOf: pcm)
        frames += Int64(pcm.count / 2)
        if frames - framesAtLastHeader >= Int64(sampleRate * 5) {
            try writeHeader()
        }
    }

    func appendSilence(frames count: Int64) throws {
        var remaining = count
        let chunk = Data(count: sampleRate * 2)  // one second of zeros
        while remaining > 0 {
            let n = min(remaining, Int64(sampleRate))
            try append(n == Int64(sampleRate) ? chunk : Data(count: Int(n) * 2))
            remaining -= n
        }
    }

    func close() throws {
        try writeHeader()
        try handle.close()
    }

    private func writeHeader() throws {
        try handle.seek(toOffset: 0)
        try handle.write(contentsOf: header())
        try handle.seekToEnd()
        framesAtLastHeader = frames
    }

    private func header() -> Data {
        let dataBytes = UInt32(clamping: frames * 2)
        var data = Data()
        func put<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: Array("RIFF".utf8))
        put(UInt32(clamping: UInt64(dataBytes) + 36))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        put(UInt32(16))                 // fmt chunk size
        put(UInt16(1))                  // PCM
        put(UInt16(1))                  // mono
        put(UInt32(sampleRate))
        put(UInt32(sampleRate * 2))     // byte rate
        put(UInt16(2))                  // block align
        put(UInt16(16))                 // bits per sample
        data.append(contentsOf: Array("data".utf8))
        put(dataBytes)
        return data
    }
}
