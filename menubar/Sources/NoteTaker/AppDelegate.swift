import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var cli: NotesCLI?
    private var startupError: String?
    private var state: RecorderState = .idle
    private var progress = ""
    private var meetingsDirectory: String?
    /// False when the settings turn the notes off: stopping only transcribes.
    private var notesEnabled = true
    private var stopMode = StopMode.notes
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

    /// Asks the command line tool what is going on.
    private func refresh() {
        guard let cli, !busy else { return }
        cli.run(["status", "--json"]) { [weak self] result in
            guard let self, !self.busy else { return }
            guard result.succeeded,
                  let status = try? JSONDecoder().decode(CLIStatus.self, from: Data(result.output.utf8))
            else {
                self.startupError = result.errorOutput.isEmpty ? "Could not read the status." : result.errorOutput
                self.render()
                return
            }
            self.startupError = nil
            self.meetingsDirectory = status.meetingsDir
            self.notesEnabled = status.notes ?? true
            self.state = status.recorderState
            if case .recording(_, _, let captions?) = self.state {
                // Also when the recording was started from the terminal.
                self.captionsPanel.follow(file: captions)
            } else {
                self.captionsPanel.close()
            }
            self.render()
        }
    }

    // MARK: Actions (the menu items call these)

    @objc func startRecording() {
        start(title: "", live: false)
    }

    @objc func startRecordingWithCaptions() {
        start(title: "", live: true)
    }

    @objc func showCaptions() {
        captionsPanel.show()
    }

    @objc func startRecordingWithTitle() {
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

    @objc func stopAndWriteNotes() {
        stop(notesEnabled ? .notes : .transcriptOnly)
    }

    @objc func stopAndTranscribeOnly() {
        stop(.transcriptOnly)
    }

    @objc func stopWithoutNotes() {
        stop(.audioOnly)
    }

    private func stop(_ mode: StopMode) {
        guard let cli, !busy else { return }
        let directory: String
        switch state {
        case .recording(_, let dir, _), .interrupted(let dir): directory = dir
        default: return
        }
        busy = true
        captionsPanel.close()
        state = .writingNotes(directory: directory)
        stopMode = mode
        progress = mode == .audioOnly ? "Saving…" : "Stopping…"
        render()

        cli.run(
            mode.arguments,
            onProgress: { [weak self] line in
                self?.progress = line
                self?.render()
            },
            completion: { [weak self] result in
                guard let self else { return }
                self.busy = false
                self.progress = ""
                self.state = .idle
                // What "Open Last Notes" opens: the transcript when there are no notes.
                let written = directory + (mode == .notes ? "/notes.md" : "/transcript.md")
                if !result.succeeded {
                    let what = mode == .notes ? "write the notes" : "process the recording"
                    self.showError("Could not " + what, result.errorOutput)
                } else if mode != .audioOnly, FileManager.default.fileExists(atPath: written) {
                    self.lastNotes = written
                }
                self.refresh()
                self.render()
            }
        )
    }

    @objc func openLastNotes() {
        guard let lastNotes else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: lastNotes))
    }

    @objc func openMeetingsFolder() {
        guard let meetingsDirectory else { return }
        let url = URL(fileURLWithPath: meetingsDirectory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    @objc func toggleStartAtLogin() {
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
        let content = MenuContent(
            state: state,
            stopMode: stopMode,
            progress: progress,
            busy: busy,
            error: startupError,
            notesEnabled: notesEnabled,
            canOpenLastNotes: lastNotes.map(FileManager.default.fileExists(atPath:)) ?? false,
            canOpenMeetingsFolder: meetingsDirectory != nil,
            startsAtLogin: SMAppService.mainApp.status == .enabled
        )
        statusItem.menu = StatusMenu.menu(showing: content, target: self)
    }

    /// Icon and, while recording, the elapsed time next to it.
    private func renderTitle() {
        guard let button = statusItem.button else { return }
        StatusMenu.update(button, state: state, hasError: startupError != nil)
    }
}
