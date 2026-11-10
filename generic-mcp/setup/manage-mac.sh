#!/bin/bash
set -euo pipefail
tool_root="$(cd "$(dirname "$0")" && pwd)"
tool_node="$(cat "$tool_root/runtime-node.txt")"
export COMFY_DIRECT_CONFIG="$tool_root/data/config.json"
export COMFY_DIRECT_DATA_DIR="$tool_root/data"
case "${1:-connect}" in
 configure) exec "$tool_node" "$tool_root/bin.mjs" configure --wizard;;
 connect|check|list) exec "$tool_node" "$tool_root/bin.mjs" "${1:-connect}";;
 *) echo 'Use connect, configure, check or list.' >&2; exit 1;;
esac
