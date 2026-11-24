import AppKit

/// A floating window that shows the live captions of the recording in progress.
///
/// It follows the captions file written by `notes start --live`: one JSON
/// event per line, where a later event with the same id replaces the earlier one.
final class CaptionsPanel: NSObject {
    private struct Caption: Decodable {
        let id: String
        let speaker: String
        let label: String
        let text: String
        let final: Bool
    }

    /// Older captions are dropped from the window; the full transcript comes with the notes.
    private static let maxCaptions = 200

    private let panel: NSPanel
    private let textView = NSTextView()
    private var file: String?
    private var offset: UInt64 = 0
    private var unfinishedLine = Data()
    private var order: [String] = []
    private var captions: [String: Caption] = [:]
    private var timer: Timer?

    override init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 220),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .hudWindow, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        super.init()

        panel.title = "Live Captions"
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        // Kept out of screen sharing: the captions are for the person recording.
        // NOTETAKER_CAPTURABLE=1 turns this off to take screenshots of the window.
        if ProcessInfo.processInfo.environment["NOTETAKER_CAPTURABLE"] == nil {
            panel.sharingType = .none
        }

        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 10, height: 8)
        textView.autoresizingMask = [.width]

        let scrollView = NSScrollView(frame: panel.contentLayoutRect)
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.autoresizingMask = [.width, .height]
        scrollView.documentView = textView
        textView.frame = scrollView.contentView.bounds
        panel.contentView = scrollView

        // Bottom centre of the screen the first time; afterwards wherever it was left.
        if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.midX - 280, y: screen.minY + 60))
        }
        panel.setFrameAutosaveName("LiveCaptions")
    }

    /// Starts showing the captions written to `file`. Does nothing if it already follows it.
    func follow(file: String) {
        guard file != self.file else { return }
        self.file = file
        offset = 0
        unfinishedLine = Data()
        order = []
        captions = [:]
        render()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.readNewEvents() }
        panel.orderFrontRegardless()
    }

    /// Brings the window back after the user closed it.
    func show() {
        panel.orderFrontRegardless()
    }

    /// Stops following the captions and hides the window.
    func close() {
        guard file != nil else { return }
        file = nil
        timer?.invalidate()
        timer = nil
        panel.orderOut(nil)
    }

    private func readNewEvents() {
        guard let file, let handle = FileHandle(forReadingAtPath: file) else { return }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: offset)) != nil,
              let data = try? handle.readToEnd(), !data.isEmpty
        else { return }
        offset += UInt64(data.count)

        // The last line may still be half written.
        var lines = (unfinishedLine + data).split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: false)
        unfinishedLine = Data(lines.removeLast())

        var changed = false
        for line in lines where !line.isEmpty {
            guard let caption = try? JSONDecoder().decode(Caption.self, from: Data(line)) else { continue }
            changed = true
            if caption.text.isEmpty {
                captions[caption.id] = nil
                order.removeAll { $0 == caption.id }
                continue
            }
            if captions[caption.id] == nil { order.append(caption.id) }
            captions[caption.id] = caption
        }
        if order.count > Self.maxCaptions {
            for id in order.prefix(order.count - Self.maxCaptions) { captions[id] = nil }
            order.removeFirst(order.count - Self.maxCaptions)
        }
        if changed { render() }
    }

    private func render() {
        let paragraph = NSMutableParagraphStyle()
        paragraph.paragraphSpacing = 8
        paragraph.lineSpacing = 2
        let font = NSFont.systemFont(ofSize: 15)
        let bold = NSFont.boldSystemFont(ofSize: 15)

        let text = NSMutableAttributedString()
        if order.isEmpty {
            text.append(NSAttributedString(
                string: "Listening…",
                attributes: [.font: font, .foregroundColor: NSColor.secondaryLabelColor]
            ))
        }
        for (position, id) in order.enumerated() {
            guard let caption = captions[id] else { continue }
            let labelColor: NSColor = caption.speaker == "me" ? .systemTeal : .systemYellow
            text.append(NSAttributedString(
                string: caption.label + "  ",
                attributes: [.font: bold, .foregroundColor: labelColor, .paragraphStyle: paragraph]
            ))
            // Dimmed while the person is still talking and the text may change.
            text.append(NSAttributedString(
                string: caption.text + (position == order.count - 1 ? "" : "\n"),
                attributes: [
                    .font: font,
                    .foregroundColor: caption.final ? NSColor.white : NSColor.white.withAlphaComponent(0.6),
                    .paragraphStyle: paragraph,
                ]
            ))
        }
        textView.textStorage?.setAttributedString(text)
        textView.scrollToEndOfDocument(nil)
    }
}
