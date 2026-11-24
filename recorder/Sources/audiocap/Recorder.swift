import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

let outputSampleRate = 16_000

/// One output file: converts incoming audio to 16 kHz mono and keeps it
/// aligned to the shared recording clock by filling gaps with silence.
final class Track {
    let name: String
    let writer: WavWriter
    private(set) var peak: Int16 = 0
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Double(outputSampleRate),
        channels: 1,
        interleaved: true
    )!

    init(name: String, url: URL) throws {
        self.name = name
        writer = try WavWriter(url: url, sampleRate: outputSampleRate)
    }

    func takePeak() -> Int16 {
        defer { peak = 0 }
        return peak
    }

    func write(_ sampleBuffer: CMSampleBuffer, clockStart: Double) throws {
        guard let input = pcmBuffer(from: sampleBuffer) else { return }

        if converter == nil || input.format != inputFormat {
            // First buffer, or the device changed (e.g. headphones connected).
            inputFormat = input.format
            converter = AVAudioConverter(from: input.format, to: outputFormat)
        }
        guard let converter else { return }

        // Fill dropouts so both tracks share one timeline.
        let elapsed = sampleBuffer.presentationTimeStamp.seconds - clockStart
        let expectedFrames = Int64(elapsed * Double(outputSampleRate))
        let gap = expectedFrames - writer.frames
        if gap > Int64(outputSampleRate / 10), gap < Int64(outputSampleRate) * 3600 {
            try writer.appendSilence(frames: gap)
        }

        let ratio = Double(outputSampleRate) / input.format.sampleRate
        let capacity = AVAudioFrameCount(Double(input.frameLength) * ratio) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }

        var consumed = false
        var conversionError: NSError?
        converter.convert(to: output, error: &conversionError) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return input
        }
        if let conversionError { throw conversionError }

        guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
        let count = Int(output.frameLength)
        for i in 0..<count {
            let magnitude = samples[i] == .min ? .max : abs(samples[i])
            if magnitude > peak { peak = magnitude }
        }
        try writer.append(Data(bytes: samples, count: count * 2))
    }

    private func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard var description = sampleBuffer.formatDescription?.audioStreamBasicDescription,
              let format = AVAudioFormat(streamDescription: &description)
        else { return nil }
        let frameCount = AVAudioFrameCount(sampleBuffer.numSamples)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return nil }
        buffer.frameLength = frameCount
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(frameCount), into: buffer.mutableAudioBufferList
        )
        return status == noErr ? buffer : nil
    }
}

/// Records system audio and the microphone into two aligned WAV files.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "audiocap.samples")
    private let system: Track
    private let mic: Track
    private var stream: SCStream?
    private var clockStart: Double?
    private var finished = false
    private var statusTimer: DispatchSourceTimer?
    private let startedAt = Date()

    /// Called on an unexpected stop (not on `stop()`).
    var onFailure: ((Error) -> Void)?

    init(outputDirectory: URL) throws {
        system = try Track(name: "system", url: outputDirectory.appendingPathComponent("system.wav"))
        mic = try Track(name: "mic", url: outputDirectory.appendingPathComponent("mic.wav"))
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "audiocap", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 1
        configuration.captureMicrophone = true
        // Video is required by the API but unused: keep it as cheap as possible.
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.showsCursor = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
        startStatusLine()
    }

    func stop() async {
        try? await stream?.stopCapture()
        queue.sync { finish() }
    }

    // MARK: SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !finished, sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }
        let track: Track
        switch type {
        case .audio: track = system
        case .microphone: track = mic
        default: return
        }
        if clockStart == nil { clockStart = sampleBuffer.presentationTimeStamp.seconds }
        do {
            try track.write(sampleBuffer, clockStart: clockStart!)
        } catch {
            log("\(track.name): write failed: \(error.localizedDescription)")
        }
    }

    // MARK: SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.sync { finish() }
        onFailure?(error)
    }

    // MARK: Private

    private func finish() {
        guard !finished else { return }
        finished = true
        statusTimer?.cancel()
        do {
            // Pad the shorter track so both files have the same length.
            let length = max(system.writer.frames, mic.writer.frames)
            for track in [system, mic] {
                try track.writer.appendSilence(frames: length - track.writer.frames)
                try track.writer.close()
            }
            let seconds = Double(length) / Double(outputSampleRate)
            log(String(format: "\nSaved %.1f s to system.wav and mic.wav", seconds))
        } catch {
            log("\nFailed to finalize files: \(error.localizedDescription)")
        }
    }

    private func startStatusLine() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self, !self.finished else { return }
            let elapsed = Int(Date().timeIntervalSince(self.startedAt))
            let line = String(
                format: "REC %02d:%02d:%02d | system %@ | mic %@",
                elapsed / 3600, elapsed / 60 % 60, elapsed % 60,
                Self.level(self.system.takePeak()), Self.level(self.mic.takePeak())
            )
            let interactive = isatty(STDERR_FILENO) == 1
            log(interactive ? "\r\(line)   " : line, newline: !interactive)
        }
        timer.resume()
        statusTimer = timer
    }

    private static func level(_ peak: Int16) -> String {
        guard peak > 0 else { return "silent " }
        return String(format: "%4.0f dB", 20 * log10(Double(peak) / 32768))
    }
}

func log(_ message: String, newline: Bool = true) {
    FileHandle.standardError.write(Data((message + (newline ? "\n" : "")).utf8))
}
