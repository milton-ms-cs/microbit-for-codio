#!/bin/bash
# micro:bit tools — Codio box startup hook.
#
# Installed to /home/codio/startup.sh by stack/install.sh and baked into the
# Codio stack, so it runs on every box start. Copies the built tool pages
# into the workspace where Codio's static file server (and therefore guide
# links like microbit-tools/flasher.html?file=...) can reach them.
#
# Idempotent: safe to run repeatedly; overwrites with the stack's version so
# a stack upgrade propagates on next box start.

SRC=/opt/microbit-tools/dist
DEST=/home/codio/workspace/microbit-tools

if [ -d "$SRC" ]; then
  mkdir -p "$DEST"
  cp -f "$SRC"/* "$DEST"/ 2>/dev/null

  # Legacy shim: older assignments shipped their own esm.sh-based copies at
  # the workspace root. Replace those (and only those) with the fixed pages
  # so their existing guide links keep working.
  if [ -f /home/codio/workspace/index.html ] && grep -q "esm.sh" /home/codio/workspace/index.html; then
    cp -f "$SRC/flasher.html" /home/codio/workspace/index.html
    cp -f "$SRC"/micropython-microbit-*.hex /home/codio/workspace/
  fi
  if [ -f /home/codio/workspace/simulator.html ] && grep -q "python-simulator.usermbit.org/v/0.1" /home/codio/workspace/simulator.html \
     && ! grep -q "microbit tools" /home/codio/workspace/simulator.html; then
    cp -f "$SRC/simulator.html" /home/codio/workspace/simulator.html
  fi
fi
