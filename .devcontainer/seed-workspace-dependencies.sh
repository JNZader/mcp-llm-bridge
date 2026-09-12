#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE=/opt/mcp-llm-bridge-native
readonly SOURCE_NODE_MODULES="$SOURCE/node_modules"
readonly SOURCE_RECEIPT="$SOURCE/native-binding-receipt.json"
readonly DESTINATION="${containerWorkspaceFolder:-${PWD}}/node_modules"
readonly MARKER="$DESTINATION/.native-binding-seed"

fail() { printf 'dependency seed failed: %s\n' "$1" >&2; exit 1; }

[[ -d "$SOURCE_NODE_MODULES" ]] || fail "missing image dependency tree"
[[ -f "$SOURCE_RECEIPT" && ! -L "$SOURCE_RECEIPT" ]] || fail "missing or symlinked image receipt"
[[ -w "$DESTINATION" ]] || fail "workspace node_modules volume is not writable by the runtime user"

node "$SOURCE/verify-native-binding.mjs" --receipt "$SOURCE_RECEIPT" >/dev/null \
  || fail "image dependency tree and receipt do not verify"

receipt_hash=$(sha256sum "$SOURCE_RECEIPT" | awk '{print $1}')
if [[ -e "$MARKER" ]]; then
  [[ -f "$MARKER" && ! -L "$MARKER" ]] || fail "invalid seed marker"
  [[ "$(<"$MARKER")" == "schema=1 receiptSha256=$receipt_hash" ]] || fail "volume was seeded from a different image"
  exit 0
fi
shopt -s nullglob dotglob
entries=("$DESTINATION"/*)
(( ${#entries[@]} == 0 )) || fail "refusing to overwrite a nonempty volume"

while IFS= read -r -d '' link; do
  target=$(realpath "$link") || fail "broken symlink in image dependency tree: $link"
  case "$target" in
    "$SOURCE_NODE_MODULES"/*) ;;
    *) fail "symlink escapes image dependency tree: $link -> $target" ;;
  esac
done < <(find "$SOURCE_NODE_MODULES" -type l -print0)

tmp="$DESTINATION/.seed-tmp.$$"
[[ ! -e "$tmp" ]] || fail "temporary seed path already exists"
mkdir "$tmp"
trap 'rm -rf -- "$tmp"' EXIT
cp -a --no-preserve=ownership "$SOURCE_NODE_MODULES"/. "$tmp"/
printf 'schema=1 receiptSha256=%s\n' "$receipt_hash" > "$tmp/.native-binding-seed"
chmod 0444 "$tmp/.native-binding-seed"
cp -a --no-preserve=ownership "$tmp"/. "$DESTINATION"/
mv "$tmp/.native-binding-seed" "$DESTINATION/.native-binding-seed"
trap - EXIT
rm -rf -- "$tmp"
