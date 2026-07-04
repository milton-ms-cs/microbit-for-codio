#!/bin/bash
# Codio box startup hook — baked into the stack image (installed to
# /home/codio/startup.sh by stack/install.sh) and run on every box start AS THE
# UNPRIVILEGED codio user (no sudo on student boxes).
#
# Gates the micro:bit tool copy on the assignment type, so microbit-tools/ only
# lands in micro:bit boxes — not every graphics / python / webdev / flask /
# ai-text / scratch workspace (the 1.2 MB hex + html used to leak into all of
# them). The .codio button convention (see the assignment CLAUDE.md ".codio
# cookbook") is the type signal: we grep the stable substring "micro:bit" — NOT
# the emoji label — to avoid rendering/encoding fragility. Works for
# hand-authored assignments too, not just scaffolded ones.
#
# Graphics boxes need NO action here. X on :0 starts on demand when the student
# opens the graphics viewer (novnc.socket is enabled at boot; opening 3050 pulls
# in vnc.service). Graphics-assignment guides open the viewer first via the
# `open_vm` directive, so X is up before the first Run. vnc.service is therefore
# intentionally neither started here nor enabled globally (most assignments
# never draw a pixel).
#
# Idempotent: safe to run repeatedly.

WS=/home/codio/workspace
CODIO="$WS/.codio"

# --- micro:bit assignments: stage the flasher/simulator tool pages ----------
SRC=/opt/microbit-tools/dist
DEST="$WS/microbit-tools"
if [ -f "$CODIO" ] && grep -q "micro:bit" "$CODIO" && [ -d "$SRC" ]; then
  mkdir -p "$DEST"
  cp -f "$SRC"/* "$DEST"/ 2>/dev/null

  # Legacy shim: older assignments shipped their own esm.sh-based copies at the
  # workspace root. Replace those (and only those) with the fixed pages so their
  # existing guide links keep working. (Legacy micro:bit boxes carry the
  # "Send to micro:bit" button, so they still match the grep above.)
  if [ -f "$WS/index.html" ] && grep -q "esm.sh" "$WS/index.html"; then
    cp -f "$SRC/flasher.html" "$WS/index.html"
    cp -f "$SRC"/micropython-microbit-*.hex "$WS/"
  fi
  if [ -f "$WS/simulator.html" ] && grep -q "python-simulator.usermbit.org/v/0.1" "$WS/simulator.html" \
     && ! grep -q "microbit tools" "$WS/simulator.html"; then
    cp -f "$SRC/simulator.html" "$WS/simulator.html"
  fi
fi
