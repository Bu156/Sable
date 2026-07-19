#!/usr/bin/env bash
# Copy the CEF runtime (libcef.so + resources) next to a built binary so the app
# is self-contained: works standalone, when launched by the OS via a sable://
# deep link, or from a release package. Pair with the rpath=$ORIGIN that
# build.rs adds for CEF builds.
#
# Usage: scripts/cef-copy-libs.sh [debug|release] [dest-dir]
#   dest-dir defaults to src-tauri/target/<profile> (beside the built binary).
set -euo pipefail
PROFILE="${1:-debug}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${2:-$ROOT/src-tauri/target/$PROFILE}"

CEF_DIR="$(find "$ROOT/src-tauri/target/$PROFILE/build" -type d -name cef_linux_x86_64 2>/dev/null | head -1)"
if [ -z "$CEF_DIR" ]; then
  echo "❌ CEF dist not found under target/$PROFILE/build — build with --features cef first." >&2
  exit 1
fi

mkdir -p "$DEST"
echo "→ copying CEF runtime from $CEF_DIR to $DEST"
# Libraries (libcef.so + ANGLE/SwiftShader), crashpad handler, then resources.
cp -f "$CEF_DIR"/*.so* "$DEST/" 2>/dev/null || true
cp -f "$CEF_DIR"/chrome_crashpad_handler "$DEST/" 2>/dev/null || true
cp -f "$CEF_DIR"/*.pak "$CEF_DIR"/*.dat "$CEF_DIR"/*.bin "$CEF_DIR"/*.json "$DEST/" 2>/dev/null || true
cp -rf "$CEF_DIR"/locales "$DEST/" 2>/dev/null || true

# The setuid sandbox helper only works when installed as root (deb/rpm). In a
# nosuid context such as an AppImage, drop chrome-sandbox and let Chromium use
# the user-namespace sandbox instead.
if cp -f "$CEF_DIR"/chrome-sandbox "$DEST/" 2>/dev/null; then
  chmod 4755 "$DEST/chrome-sandbox" 2>/dev/null || true
fi
echo "✅ done."
