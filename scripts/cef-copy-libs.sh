#!/usr/bin/env bash
# Copy the CEF runtime (libcef.so + resources) next to the built binary so it
# is self-contained: works when launched standalone, by the OS via a sable://
# deep link, or from a release bundle. Pair with the rpath=$ORIGIN that
# build.rs adds for CEF builds.
#
# Usage: scripts/cef-copy-libs.sh [debug|release]   (default: debug)
set -euo pipefail
PROFILE="${1:-debug}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/src-tauri/target/$PROFILE"

CEF_DIR="$(find "$ROOT/src-tauri/target/$PROFILE/build" -type d -name cef_linux_x86_64 2>/dev/null | head -1)"
if [ -z "$CEF_DIR" ]; then
  echo "❌ CEF dist not found under target/$PROFILE/build — build with --features cef first." >&2
  exit 1
fi

echo "→ copying CEF runtime from $CEF_DIR to $TARGET"
cp -f "$CEF_DIR"/*.so* "$CEF_DIR"/*.pak "$CEF_DIR"/*.dat "$CEF_DIR"/*.bin "$CEF_DIR"/*.json "$TARGET/" 2>/dev/null || true
cp -f "$CEF_DIR"/chrome-sandbox "$TARGET/" 2>/dev/null || true
chmod 4755 "$TARGET/chrome-sandbox" 2>/dev/null || true   # setuid sandbox helper
cp -rf "$CEF_DIR"/locales "$TARGET/" 2>/dev/null || true
echo "✅ done. libcef.so is now next to the $PROFILE binary."
