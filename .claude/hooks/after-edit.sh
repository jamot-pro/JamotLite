#!/bin/sh
# After Claude edits a file of the console or its contracts: format it, then
# typecheck the console and check the UI rules (apps/web/DESIGN.md). A problem
# goes back to Claude (exit 2) so it's fixed now, not in CI.
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
case "$file" in
	*/apps/web/src/*|*/packages/contracts/src/*) ;;
	*) exit 0 ;;
esac
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root" || exit 0
pnpm -s exec biome format --write "$file" >/dev/null 2>&1
out=$(pnpm -s --filter @jamot/web typecheck 2>&1) || { echo "$out" | grep -E "error TS" | head -20 >&2; exit 2; }
out=$(node scripts/ui-check.mjs 2>&1) || { echo "$out" >&2; exit 2; }
exit 0
