// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NoteTaker",
    platforms: [.macOS("15.0")],
    targets: [
        .executableTarget(name: "NoteTaker", path: "Sources/NoteTaker")
    ]
)
