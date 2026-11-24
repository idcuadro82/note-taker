// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "audiocap",
    platforms: [.macOS("15.0")],
    targets: [
        .executableTarget(name: "audiocap", path: "Sources/audiocap")
    ]
)
