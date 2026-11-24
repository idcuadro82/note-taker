#!/usr/bin/env bash
# Builds the menu bar app into build/NoteTaker.app.
# Run it again after upgrading Node or moving this repository.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO_DIR/build/NoteTaker.app"

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "Node was not found. Install Node 24 or later and run this again." >&2
  exit 1
fi

swift build -c release --package-path "$REPO_DIR/menubar"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$REPO_DIR/menubar/.build/release/NoteTaker" "$APP/Contents/MacOS/NoteTaker"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>local.note-taker.menubar</string>
  <key>CFBundleName</key>
  <string>NoteTaker</string>
  <key>CFBundleExecutable</key>
  <string>NoteTaker</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>NoteTaker records your microphone to transcribe what you say in meetings.</string>
</dict>
</plist>
PLIST

# An app opened from the Finder does not inherit the shell's PATH, so the
# locations of Node and of the Homebrew tools are stored in the app.
BREW_BIN="$(brew --prefix 2>/dev/null || echo /opt/homebrew)/bin"
NODE="$NODE" REPO="$REPO_DIR" EXTRA_PATH="$BREW_BIN" "$NODE" -e '
  const { NODE, REPO, EXTRA_PATH } = process.env;
  process.stdout.write(JSON.stringify({ node: NODE, repo: REPO, extraPath: EXTRA_PATH }, null, 2) + "\n");
' > "$APP/Contents/Resources/paths.json"

# macOS ties the recording permissions to the app's signature. A plain local
# signature identifies the app by the hash of its code, so every rebuild would
# look like a new app and lose them. Identifying it by its bundle id instead
# keeps the permissions across rebuilds.
codesign --force --sign - \
  -r='designated => identifier "local.note-taker.menubar"' \
  "$APP" 2>/dev/null

echo "Built $APP"
echo "Open it with: open \"$APP\""
