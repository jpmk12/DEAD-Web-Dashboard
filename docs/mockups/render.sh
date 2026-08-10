#!/bin/sh
# Regenerate the README screenshots from the mockup pages in this directory.
# Needs a Chromium/Chrome binary; pass its path as $CHROME or have `chromium`
# on PATH. Shots land in docs/.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}"
shot() { # file.html out.png WxH scale
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor="$4" --window-size="$3" \
    --screenshot="$OUT/$2" "file://$DIR/$1" 2>/dev/null
  echo "wrote docs/$2"
}
shot hero.html            hero.png            1600,1000 2
shot mission-profile.html mission-profile.png 1180,880  2
shot sitrep.html          sitrep.png          1180,700  2
shot iw-board.html        iw-board.png        1060,660  2
