import AppKit

// NoteTaker: a menu bar icon to start and stop meeting recordings, with live captions.
//
// `NoteTaker --exec <notes arguments>` runs a command through the app's own
// runner and prints the result, to check the app's setup from a terminal.

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.first == "--exec" {
    do {
        try NotesCLI().run(Array(arguments.dropFirst())) { result in
            if !result.output.isEmpty { print(result.output) }
            if !result.errorOutput.isEmpty {
                FileHandle.standardError.write(Data((result.errorOutput + "\n").utf8))
            }
            exit(result.exitCode)
        }
        dispatchMain()
    } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        exit(1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Menu bar only: no Dock icon and no main window.
app.setActivationPolicy(.accessory)
app.run()
