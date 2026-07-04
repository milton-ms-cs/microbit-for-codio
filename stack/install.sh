#!/bin/bash
# micro:bit tools — stack installer.
#
# Run this ONCE in a Codio box that you are about to snapshot as a stack
# (Project ▸ Stack ▸ Create New / Add Version):
#
#   curl -fsSL https://raw.githubusercontent.com/milton-ms-cs/microbit-for-codio/main/stack/install.sh | sudo bash -s v1.1.0
#
# or, from a checkout:  sudo stack/install.sh v1.1.0
#
# It downloads the pinned release of the built tools into /opt/microbit-tools
# and installs /home/codio/startup.sh so every box created from the stack
# copies the tools into the workspace at start.

set -euo pipefail

TAG="${1:?Usage: install.sh <release-tag, e.g. v1.0.0>}"
REPO="milton-ms-cs/microbit-for-codio"
URL="https://github.com/${REPO}/releases/download/${TAG}/microbit-tools-${TAG}.tar.gz"

echo "Installing micro:bit tools ${TAG} from ${URL}"
rm -rf /opt/microbit-tools
mkdir -p /opt/microbit-tools
curl -fsSL "$URL" | tar -xz -C /opt/microbit-tools
test -f /opt/microbit-tools/dist/flasher.html || { echo "ERROR: release archive did not contain dist/flasher.html"; exit 1; }

# Install the startup hook. /home/codio/startup.sh runs at every box start.
cp /opt/microbit-tools/stack/startup.sh /home/codio/startup.sh
chmod +x /home/codio/startup.sh
chown codio:codio /home/codio/startup.sh

echo "Installed: $(cat /opt/microbit-tools/dist/VERSION)"
echo "Now create/version the stack: Codio menu ▸ Project ▸ Stack."
