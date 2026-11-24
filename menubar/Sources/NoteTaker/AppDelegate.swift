import AppKit
import ServiceManagement

/// What the app is doing, as shown in the menu bar.
enum RecorderState: Equatable {
    case idle
    /// `captions` is the live captions file, when the recording has them.
    case recording(since: Date, directory: String, captions: String?)
    /// A recording whose recorder died; `notes stop` recovers its audio.
    case interrupted(directory: String)
    case writingNotes(directory: String)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var cli: NotesCLI?
    private var startupError: String?
    private var state: RecorderState = .idle
    private var progress = ""
    private var meetingsDirectory: String?
    /// True while a command started from the menu is running.
    private var busy = false
    private var clock: Timer?
    private var poll: Timer?
    private let captionsPanel = CaptionsPanel()

    private var lastNotes: String? {
        get { UserDefaults.standard.string(forKey: "lastNotes") }
        set { UserDefaults.standard.set(newValue, forKey: "lastNotes") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            cli = try NotesCLI()
        } catch {
            startupError = error.localizedDescription
        }
        render()
        refresh()
        // A recording can also be started or stopped from the terminal.
        poll = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.renderTitle() }
    }

    // MARK: State

    private struct Status: Decodable {
        let state: String
        let meetingsDir: String
        let dir: String?
        let startedAt: String?
        let captions: String?
    }

    /// Asks the command line tool what is going on.
    private func refresh() {
        guard let cli, !busy else { return }
        cli.run(["status", "--json"]) { [weak self] result in
            guard let self, !self.busy else { return }
            guard result.succeeded,
                  let status = try? JSONDecoder().decode(Status.self, from: Data(result.output.utf8))
            else {
                self.startupError = result.errorOutput.isEmpty ? "Could not read the status." : result.errorOutput
                self.render()
                return
            }
            self.startupError = nil
            self.meetingsDirectory = status.meetingsDir
            switch (status.state, status.dir) {
            case ("recording", let directory?):
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let since = status.startedAt.flatMap(formatter.date(from:)) ?? Date()
                self.state = .recording(since: since, directory: directory, captions: status.captions)
            case ("interrupted", let directory?):
                self.state = .interrupted(directory: directory)
            default:
                self.state = .idle
            }
            if case .recording(_, _, let captions?) = self.state {
                // Also when the recording was started from the terminal.
                self.captionsPanel.follow(file: captions)
            } else {
                self.captionsPanel.close()
            }
            self.render()
        }
    }

    // MARK: Actions

    @objc private func startRecording() {
        start(title: "", live: false)
    }

    @objc private func startRecordingWithCaptions() {
        start(title: "", live: true)
    }

    @objc private func showCaptions() {
        captionsPanel.show()
    }

    @objc private func startRecordingWithTitle() {
        let alert = NSAlert()
        alert.messageText = "Meeting title"
        alert.informativeText = "Used to name the meeting folder."
        let field = NSTextField(frame: NSRect(x: 0, y: 28, width: 260, height: 24))
        let live = NSButton(checkboxWithTitle: "Live captions", target: nil, action: nil)
        live.frame = NSRect(x: 0, y: 0, width: 260, height: 20)
        let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 260, height: 52))
        accessory.addSubview(field)
        accessory.addSubview(live)
        alert.accessoryView = accessory
        alert.addButton(withTitle: "Start Recording")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        start(title: field.stringValue, live: live.state == .on)
    }

    private func start(title: String, live: Bool) {
        guard let cli, !busy else { return }
        busy = true
        progress = "Starting…"
        render()
        let arguments = ["start"] + (title.isEmpty ? [] : [title]) + (live ? ["--live"] : [])
        cli.run(arguments) { [weak self] result in
            guard let self else { return }
            self.busy = false
            self.progress = ""
            if !result.succeeded { self.showError("Could not start recording", result.errorOutput) }
            self.refresh()
            self.render()
        }
    }

    @objc private func stopAndWriteNotes() {
        stop(writeNotes: true)
    }

    @objc private func stopWithoutNotes() {
        stop(writeNotes: false)
    }

    private func stop(writeNotes: Bool) {
        guard let cli, !busy else { return }
        let directory: String
        switch state {
        case .recording(_, let dir, _), .interrupted(let dir): directory = dir
        default: return
        }
        busy = true
        captionsPanel.close()
        state = .writingNotes(directory: directory)
        progress = writeNotes ? "Stopping…" : "Saving…"
        render()

        cli.run(
            writeNotes ? ["stop"] : ["stop", "--no-notes"],
            onProgress: { [weak self] line in
                self?.progress = line
                self?.render()
            },
            completion: { [weak self] result in
                guard let self else { return }
                self.busy = false
                self.progress = ""
                self.state = .idle
                let notes = directory + "/notes.md"
                if !result.succeeded {
                    self.showError("Could not write the notes", result.errorOutput)
                } else if writeNotes, FileManager.default.fileExists(atPath: notes) {
                    self.lastNotes = notes
                }
                self.refresh()
                self.render()
            }
        )
    }

    @objc private func openLastNotes() {
        guard let lastNotes else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: lastNotes))
    }

    @objc private func openMeetingsFolder() {
        guard let meetingsDirectory else { return }
        let url = URL(fileURLWithPath: meetingsDirectory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    @objc private func toggleStartAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            showError("Could not change the login setting", error.localizedDescription)
        }
        render()
    }

    @objc private func openPrivacySettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
    }

    private func showError(_ title: String, _ detail: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail.isEmpty ? "The command failed without a message." : detail
        alert.addButton(withTitle: "OK")
        let isPermissionProblem = detail.contains("Privacy & Security")
        if isPermissionProblem {
            alert.informativeText += "\n\nThe app to allow is NoteTaker. Quit and reopen it afterwards."
            alert.addButton(withTitle: "Open Privacy Settings")
        }
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn, isPermissionProblem {
            openPrivacySettings()
        }
    }

    // MARK: Rendering

    private func render() {
        renderTitle()

        let menu = NSMenu()
        menu.autoenablesItems = false
        func add(_ title: String, _ action: Selector?, enabled: Bool = true) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            item.isEnabled = enabled && action != nil
            menu.addItem(item)
        }

        if let startupError {
            add(startupError, nil)
        } else {
            switch state {
            case .idle:
                add(busy ? progress : "Not recording", nil)
                menu.addItem(.separator())
                add("Start Recording", #selector(startRecording), enabled: !busy)
                add("Start Recording with Live Captions", #selector(startRecordingWithCaptions), enabled: !busy)
                add("Start Recording with Title…", #selector(startRecordingWithTitle), enabled: !busy)
            case .recording(_, let directory, let captions):
                add("Recording: " + (directory as NSString).lastPathComponent, nil)
                menu.addItem(.separator())
                if captions != nil { add("Show Live Captions", #selector(showCaptions)) }
                add("Stop and Write Notes", #selector(stopAndWriteNotes), enabled: !busy)
                add("Stop without Notes", #selector(stopWithoutNotes), enabled: !busy)
            case .interrupted(let directory):
                add("Interrupted: " + (directory as NSString).lastPathComponent, nil)
                menu.addItem(.separator())
                add("Recover and Write Notes", #selector(stopAndWriteNotes), enabled: !busy)
                add("Recover without Notes", #selector(stopWithoutNotes), enabled: !busy)
            case .writingNotes:
                add("Writing notes…", nil)
                if !progress.isEmpty { add(progress, nil) }
            }
        }

        menu.addItem(.separator())
        add("Open Last Notes", #selector(openLastNotes), enabled: lastNotes.map(FileManager.default.fileExists(atPath:)) ?? false)
        add("Open Meetings Folder", #selector(openMeetingsFolder), enabled: meetingsDirectory != nil)
        menu.addItem(.separator())
        let login = NSMenuItem(title: "Start at Login", action: #selector(toggleStartAtLogin), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        add("Quit NoteTaker", #selector(NSApplication.terminate(_:)))
        menu.items.last?.target = NSApp

        statusItem.menu = menu
    }

    /// Icon and, while recording, the elapsed time next to it.
    private func renderTitle() {
        guard let button = statusItem.button else { return }
        let symbol: String
        var title = ""
        switch state {
        case _ where startupError != nil: symbol = "exclamationmark.triangle"
        case .idle: symbol = "mic"
        case .recording(let since, _, _):
            symbol = "record.circle.fill"
            title = " " + Self.elapsed(since: since)
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
