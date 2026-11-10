#!/bin/bash
set -euo pipefail
tool_root="${COMFY_DIRECT_HOME:-$HOME/Library/Application Support/CodexComfyDirect}"
tool_node=''
for candidate in "$tool_root"/runtime/node-*-darwin-*/bin/node; do
  if [[ -x "$candidate" ]]; then tool_node="$candidate"; break; fi
done
if [[ -z "$tool_node" ]]; then tool_node="$(command -v node || true)"; fi
[[ -n "$tool_node" ]] || { echo '请先运行 安装插件-Mac.sh。' >&2; exit 1; }
"$tool_node" -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
export COMFY_DIRECT_DATA_DIR="${COMFY_DIRECT_DATA_DIR:-$tool_root/data}"
export COMFY_DIRECT_CONFIG="${COMFY_DIRECT_CONFIG:-$COMFY_DIRECT_DATA_DIR/config.json}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
if [[ $# -eq 0 ]]; then set -- mcp; fi
exec "$tool_node" "$script_dir/../server/bin.mjs" "$@"
