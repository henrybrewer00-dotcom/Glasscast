#!/bin/bash
# Sign Glasscast.app and its native helper binaries with one Apple Development
# certificate so the helpers share the app's Team ID and inherit its macOS
# Screen Recording (TCC) permission. Ad-hoc signing gives every binary a
# different identity, which silently breaks window enumeration.
#
# Usage: ./scripts/sign-with-dev-cert.sh [/path/to/Glasscast.app]
set -euo pipefail

APP="${1:-/Applications/Glasscast.app}"
# Sign by certificate HASH, not name — two certs can share a name and one may
# be revoked, making the name ambiguous.
IDENTITY="${GLASSCAST_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | grep "Apple Development" | grep -v REVOKED | head -1 | awk '{print $2}')
fi
if [ -z "$IDENTITY" ]; then
  echo "No Apple Development codesigning identity found." >&2
  exit 1
fi
echo "Signing with: $IDENTITY"

ARCH=$(uname -m | sed 's/x86_64/x64/')
BIN_DIR="$APP/Contents/Resources/app.asar.unpacked/electron/native/bin/darwin-$ARCH"

# 1. Sign every standalone native helper (codesign --deep does NOT reach these).
if [ -d "$BIN_DIR" ]; then
  for f in "$BIN_DIR"/*; do
    if file "$f" | grep -q "Mach-O"; then
      codesign --force --sign "$IDENTITY" "$f"
      echo "  signed helper: $(basename "$f")"
    fi
  done
fi

# 2. Sign nested frameworks/helpers, then re-seal the app bundle itself.
codesign --force --deep --sign "$IDENTITY" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 3. Verify the helper and app share a Team ID.
APP_TEAM=$(codesign -dv "$APP" 2>&1 | grep TeamIdentifier || true)
HELPER_TEAM=$(codesign -dv "$BIN_DIR/recordly-window-list" 2>&1 | grep TeamIdentifier || true)
echo "app:    $APP_TEAM"
echo "helper: $HELPER_TEAM"
codesign --verify --deep --strict "$APP" && echo "codesign verify: OK"
