import AVFoundation
import Foundation

// audiocap <output-directory>
//
// Records system audio to system.wav and the microphone to mic.wav
// (16 kHz, mono, 16-bit) until it receives Ctrl+C or SIGTERM.

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 1, !arguments[0].hasPrefix("-") else {
    log("Usage: audiocap <output-directory>")
    exit(64)
}

let outputDirectory = URL(fileURLWithPath: arguments[0], isDirectory: true)
let recorder: Recorder
do {
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    recorder = try Recorder(outputDirectory: outputDirectory)
} catch {
    log("Cannot write to \(outputDirectory.path): \(error.localizedDescription)")
    exit(73)
}

recorder.onFailure = { error in
    log("Recording stopped unexpectedly: \(error.localizedDescription)")
    exit(1)
}

// Stop cleanly on Ctrl+C / SIGTERM so the WAV files are finalized.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let signalSources = [SIGINT, SIGTERM].map { signalNumber in
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler {
        Task {
            await recorder.stop()
            exit(0)
        }
    }
    source.resume()
    return source
}

Task {
    guard await AVCaptureDevice.requestAccess(for: .audio) else {
        log("""
            Microphone access denied.
            Allow your terminal app in System Settings > Privacy & Security > Microphone, then restart it.
            """)
        exit(77)
    }
    do {
        try await recorder.start()
        log("Recording to \(outputDirectory.path) - press Ctrl+C to stop")
    } catch {
        // Nothing was recorded: do not leave empty files behind.
        for name in ["system.wav", "mic.wav"] {
            try? FileManager.default.removeItem(at: outputDirectory.appendingPathComponent(name))
        }
        log("""
            Could not start recording: \(error.localizedDescription)
            Allow your terminal app in System Settings > Privacy & Security > \
            Screen & System Audio Recording, then restart it.
            """)
        exit(77)
    }
}

withExtendedLifetime(signalSources) {
    dispatchMain()
}
