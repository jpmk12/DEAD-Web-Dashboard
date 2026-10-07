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
shot hero.html            hero.png            1600,1560 2
shot mission-profile.html mission-profile.png 1180,880  2
shot sitrep.html          sitrep.png          1180,700  2
shot iw-board.html        iw-board.png        1060,660  2
shot family.html          family.png          1240,1285 2
shot household.html       household.png       1240,1330 2
shot cyber-space.html       cyber-space.png       1220,2300 2
shot news-threads.html     news-threads.png     1280,2000 2
shot news-read.html        news-read.png        1280,1330 2
shot calendar-proposed.html calendar.png        1280,1640 2
shot email-proposed.html    email.png           1280,1760 2
shot family-proposed.html   family-proposed.png 1280,1960 2
shot osint-commands.html    osint-commands.png  1280,2360 2
shot osint-drill.html       osint-drill.png     1280,2640 2
shot osint-prototype.html   osint-prototype.png 1280,2400 2   # interactive; the shot is the landing state
shot osint-country-dock.html  osint-country-dock.png  1280,1440 2   # §11 option A
shot osint-country-split.html osint-country-split.png 1280,1180 2   # §11 option B
shot osint-room-drawer.html   osint-room-drawer.png   1280,1500 2   # §11 option C (recommended)
shot osint-airfields.html     osint-airfields.png     1280,2120 2   # §11 options A′ B′ C′
shot osint-room-prototype.html'#cmd=EUCOM'              osint-room-proto-landing.png  1280,2330 2   # §11 recommended — interactive prototype, landing
shot osint-room-prototype.html'#room=country:Germany'   osint-room-proto-country.png  1280,1400 2   # the country room
shot osint-room-prototype.html'#room=field:ETAR'        osint-room-proto-airfield.png 1280,1400 2   # the airfield page (SITREP)
shot osint-room-prototype.html'#room=country:Russia;pin' osint-room-proto-pinned.png  1600,1400 2   # pinned as a column
shot osint-room-prototype.html'#room=country:Germany'   osint-room-proto-phone.png    500,1500  2   # phone (Chromium's minimum window is 500)
