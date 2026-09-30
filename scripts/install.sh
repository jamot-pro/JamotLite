#!/bin/sh
# Jamot Lite installer.
#
#   curl -fsSL https://jamot.pro/install.sh | sh
#
# Installs the `jamot` command with npm from the latest GitHub release. Read
# this script before running it; it only needs Node.js 22.19+ and npm, and it
# changes nothing outside npm's global folder.
set -eu

REPO="jamot-pro/JamotLite"
VERSION="${JAMOT_VERSION:-latest}"

say() { printf '%s\n' "$*"; }
fail() { say "jamot install: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 22.19 or newer is needed: https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "npm is needed (it comes with Node.js)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)' \
	|| fail "Node.js $(node -v) is too old; 22.19 or newer is needed"

if [ "$VERSION" = "latest" ]; then
	URL="https://github.com/$REPO/releases/latest/download/jamot-lite.tgz"
else
	URL="https://github.com/$REPO/releases/download/v$VERSION/jamot-lite.tgz"
fi

say "Installing Jamot Lite ($VERSION) from $URL"
npm install --global --no-fund --no-audit "$URL" || fail "npm couldn't install $URL"

say ""
say "Installed: $(jamot --version)"
say ""
say "Next:"
say "  jamot setup     # pick a company, connect a model and a Telegram bot"
say "  jamot start"
