import Foundation

struct CLIResult {
    let exitCode: Int32
    let output: String
    let errorOutput: String

    var succeeded: Bool { exitCode == 0 }

    /// Why the command failed. It logs its progress to the same stream before
    /// failing, so only what follows its "Error: " line is the failure.
    var failure: String {
        let lines = errorOutput.split(separator: "\n", omittingEmptySubsequences: false)
        guard let first = lines.firstIndex(where: { $0.hasPrefix("Error: ") }) else { return errorOutput }
        return String(lines[first...].joined(separator: "\n").dropFirst("Error: ".count))
    }
}

/// Runs the `notes` command line tool of this repository.
///
/// The app does not record or transcribe by itself: it drives the same
/// commands as the terminal, so both always behave the same.
final class NotesCLI {
    /// Written into the app bundle by scripts/build-menubar.sh. An app started
    /// from the Finder does not get the shell's PATH, so the paths are fixed
    /// when the app is built.
    private struct Paths: Decodable {
        let node: String
        let repo: String
        let extraPath: String
    }

    private let paths: Paths

    init() throws {
        guard let url = Bundle.main.url(forResource: "paths", withExtension: "json") else {
            throw CLIError("paths.json is missing from the app. Rebuild it with scripts/build-menubar.sh.")
        }
        paths = try JSONDecoder().decode(Paths.self, from: Data(contentsOf: url))
        guard FileManager.default.isExecutableFile(atPath: paths.node) else {
            throw CLIError("Node was not found at \(paths.node). Rebuild the app with scripts/build-menubar.sh.")
        }
    }

    /// Runs `notes <arguments>`. `onProgress` receives each line the command
    /// logs while it runs; both callbacks are called on the main queue.
    func run(
        _ arguments: [String],
        onProgress: ((String) -> Void)? = nil,
        completion: @escaping (CLIResult) -> Void
    ) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: paths.node)
        process.arguments = [paths.repo + "/bin/notes.js"] + arguments

        var environment = ProcessInfo.processInfo.environment
        let nodeDirectory = (paths.node as NSString).deletingLastPathComponent
        environment["PATH"] = [nodeDirectory, paths.extraPath, environment["PATH"] ?? "/usr/bin:/bin"]
            .joined(separator: ":")
        process.environment = environment

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        // The command logs its progress to stderr, one line per step.
        let buffer = DispatchQueue(label: "notes-cli.stderr")
        var errorData = Data()
        errorPipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { return }
            buffer.sync { errorData.append(chunk) }
            guard let onProgress,
                  let line = String(data: chunk, encoding: .utf8)?
                      .split(whereSeparator: \.isNewline).last
            else { return }
            DispatchQueue.main.async { onProgress(line.trimmingCharacters(in: .whitespaces)) }
        }

        process.terminationHandler = { process in
            errorPipe.fileHandleForReading.readabilityHandler = nil
            let rest = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let output = outputPipe.fileHandleForReading.readDataToEndOfFile()
            let allErrors = buffer.sync { errorData + rest }
            let result = CLIResult(
                exitCode: process.terminationStatus,
                output: String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines),
                errorOutput: String(decoding: allErrors, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            )
            DispatchQueue.main.async { completion(result) }
        }

        do {
            try process.run()
        } catch {
            errorPipe.fileHandleForReading.readabilityHandler = nil
            completion(CLIResult(exitCode: -1, output: "", errorOutput: error.localizedDescription))
        }
    }
}

struct CLIError: LocalizedError {
    let errorDescription: String?

    init(_ message: String) {
        errorDescription = message
    }
}
