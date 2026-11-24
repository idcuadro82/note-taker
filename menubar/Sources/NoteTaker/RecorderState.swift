import Foundation

/// What the app is doing, as shown in the menu bar.
enum RecorderState: Equatable {
    case idle
    /// `captions` is the live captions file, when the recording has them.
    case recording(since: Date, directory: String, captions: String?)
    /// A recording whose recorder died; `notes stop` recovers its audio.
    case interrupted(directory: String)
    case writingNotes(directory: String)
}

/// What to do with a recording when it stops.
enum StopMode {
    case notes
    /// The transcript without the notes: far lighter, the model is never loaded.
    case transcriptOnly
    case audioOnly

    var arguments: [String] {
        switch self {
        case .notes: return ["stop"]
        case .transcriptOnly: return ["stop", "--transcript-only"]
        case .audioOnly: return ["stop", "--no-notes"]
        }
    }
}

/// The answer of `notes status --json`.
struct CLIStatus: Decodable {
    let state: String
    let meetingsDir: String
    let notes: Bool?
    let dir: String?
    let startedAt: String?
    let captions: String?

    var recorderState: RecorderState {
        switch (state, dir) {
        case ("recording", let directory?):
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let since = startedAt.flatMap(formatter.date(from:)) ?? Date()
            return .recording(since: since, directory: directory, captions: captions)
        case ("interrupted", let directory?):
            return .interrupted(directory: directory)
        default:
            return .idle
        }
    }
}
