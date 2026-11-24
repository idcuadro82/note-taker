import AppKit

/// Everything the menu shows at one moment.
struct MenuContent {
    let state: RecorderState
    /// What the recording being stopped is turned into.
    let stopMode: StopMode
    /// The last line reported by the command that is running.
    let progress: String
    /// True while a command started from the menu is running.
    let busy: Bool
    /// Shown instead of the recording controls when the command line tool cannot be used.
    let error: String?
    /// False when the settings turn the notes off: stopping only transcribes.
    let notesEnabled: Bool
    let canOpenLastNotes: Bool
    let canOpenMeetingsFolder: Bool
    let startsAtLogin: Bool
}

/// Builds the menu and the menu bar icon from the state of the app.
enum StatusMenu {
    static func menu(showing content: MenuContent, target: AppDelegate) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        @discardableResult
        func add(_ title: String, _ action: Selector?, enabled: Bool = true) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = target
            item.isEnabled = enabled && action != nil
            menu.addItem(item)
            return item
        }
        let ready = !content.busy

        if let error = content.error {
            add(error, nil)
        } else {
            switch content.state {
            case .idle:
                add(content.busy ? content.progress : "Not recording", nil)
                menu.addItem(.separator())
                add("Start Recording", #selector(AppDelegate.startRecording), enabled: ready)
                add("Start Recording with Live Captions", #selector(AppDelegate.startRecordingWithCaptions), enabled: ready)
                add("Start Recording with Title…", #selector(AppDelegate.startRecordingWithTitle), enabled: ready)
            case .recording(_, let directory, let captions):
                add("Recording: " + (directory as NSString).lastPathComponent, nil)
                menu.addItem(.separator())
                if captions != nil { add("Show Live Captions", #selector(AppDelegate.showCaptions)) }
                if content.notesEnabled { add("Stop and Write Notes", #selector(AppDelegate.stopAndWriteNotes), enabled: ready) }
                add("Stop and Transcribe Only", #selector(AppDelegate.stopAndTranscribeOnly), enabled: ready)
                add("Stop without Processing", #selector(AppDelegate.stopWithoutNotes), enabled: ready)
            case .interrupted(let directory):
                add("Interrupted: " + (directory as NSString).lastPathComponent, nil)
                menu.addItem(.separator())
                if content.notesEnabled { add("Recover and Write Notes", #selector(AppDelegate.stopAndWriteNotes), enabled: ready) }
                add("Recover and Transcribe Only", #selector(AppDelegate.stopAndTranscribeOnly), enabled: ready)
                add("Recover without Processing", #selector(AppDelegate.stopWithoutNotes), enabled: ready)
            case .writingNotes:
                switch content.stopMode {
                case .notes: add("Writing notes…", nil)
                case .transcriptOnly: add("Transcribing…", nil)
                case .audioOnly: add("Saving…", nil)
                }
                if !content.progress.isEmpty { add(content.progress, nil) }
            }
        }

        menu.addItem(.separator())
        add("Open Last Notes", #selector(AppDelegate.openLastNotes), enabled: content.canOpenLastNotes)
        add("Open Meetings Folder", #selector(AppDelegate.openMeetingsFolder), enabled: content.canOpenMeetingsFolder)
        menu.addItem(.separator())
        add("Start at Login", #selector(AppDelegate.toggleStartAtLogin)).state = content.startsAtLogin ? .on : .off
        add("Quit NoteTaker", #selector(NSApplication.terminate(_:))).target = NSApp
        return menu
    }

    /// Icon and, while recording, the elapsed time next to it.
    static func update(_ button: NSStatusBarButton, state: RecorderState, hasError: Bool) {
        let symbol: String
        var title = ""
        switch state {
        case _ where hasError: symbol = "exclamationmark.triangle"
        case .idle: symbol = "mic"
        case .recording(let since, _, _):
            symbol = "record.circle.fill"
            title = " " + elapsed(since: since)
        case .interrupted: symbol = "exclamationmark.triangle"
        case .writingNotes: symbol = "ellipsis.circle"
        }
        var image = NSImage(systemSymbolName: symbol, accessibilityDescription: "NoteTaker")
        if case .recording = state {
            // A red dot, like the system's own recording indicators. The other
            // icons are templates, so they follow the menu bar's colour.
            image = image?.withSymbolConfiguration(.init(paletteColors: [.systemRed]))
            image?.isTemplate = false
        } else {
            image?.isTemplate = true
        }
        button.image = image
        button.title = title
    }

    private static func elapsed(since: Date) -> String {
        let total = max(0, Int(Date().timeIntervalSince(since)))
        let (hours, minutes, seconds) = (total / 3600, total / 60 % 60, total % 60)
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }
}
