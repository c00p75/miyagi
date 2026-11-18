#!/bin/sh
# Launches an isolated editor instance (own profile, own extensions folder, own
# MIYAGI_HOME) with this extension loaded, runs smoke.cjs inside it, and exits.
# Usage: test/host/run.sh [/path/to/editor/binary]
set -u
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
EDITOR_BIN="${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Electron}"
TMP="$(mktemp -d)"
WORK="$TMP/work"
LOG="$TMP/host.log"
mkdir -p "$WORK"
git -C "$WORK" init -q
printf 'export const a = 1;\n' > "$WORK/index.ts"
git -C "$WORK" add -A
git -C "$WORK" -c user.name=t -c user.email=t@t.t -c commit.gpgsign=false commit -qm init

# Started from an editor's terminal, these would make the binary run as plain
# Node or attach to the window it was launched from.
for v in $(env | grep -E '^(ELECTRON_|VSCODE_)' | cut -d= -f1); do unset "$v"; done

# VSCODE_CLI tells the editor it was started from a command line, so it uses
# this environment instead of spending ten seconds resolving a login shell.
VSCODE_CLI=1 MIYAGI_HOME="$TMP/home" "$EDITOR_BIN" \
  --user-data-dir="$TMP/user" --extensions-dir="$TMP/ext" \
  --extensionDevelopmentPath="$HERE" --extensionTestsPath="$HERE/test/host/smoke.cjs" \
  --disable-workspace-trust --skip-welcome --skip-release-notes --disable-updates \
  "$WORK" > "$LOG" 2>&1 &
PID=$!

# Some editors keep their window open after the test host exits, so the verdict
# is read from the log rather than from the editor's own exit.
STATUS=1
i=0
while [ $i -lt 150 ]; do
  if grep -q "MIYAGI SMOKE OK" "$LOG"; then STATUS=0; break; fi
  if grep -q "Extension host with pid .* exited" "$LOG"; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 1
  i=$((i + 1))
done
sleep 1
# Ask, then insist: some editors ignore a polite signal while a window is open.
kill "$PID" 2>/dev/null
sleep 3
kill -9 "$PID" 2>/dev/null
pkill -9 -f "user-data-dir=$TMP/user" 2>/dev/null
wait "$PID" 2>/dev/null

grep -E "MIYAGI SMOKE|\[georgemsapenda\.miyagi-vscode\]|AssertionError|timed out waiting" "$LOG" || true
[ $STATUS -eq 0 ] || { echo "smoke test failed; last lines of the editor log:"; tail -25 "$LOG" | cut -c1-300; }
rm -rf "$TMP"
exit $STATUS
