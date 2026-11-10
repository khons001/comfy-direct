#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
export COMFY_DIRECT_INSTALL_DIR="${COMFY_DIRECT_INSTALL_DIR:-$HOME/Library/Application Support/ComfyDirect}"
/bin/bash "$script_dir/setup/prepare-mac.sh"
tool_root="$COMFY_DIRECT_INSTALL_DIR"
tool_node="$(cat "$tool_root/runtime-node.txt")"
export COMFY_DIRECT_CONFIG="$tool_root/data/config.json"
export COMFY_DIRECT_DATA_DIR="$tool_root/data"
unset COMFY_DIRECT_ENDPOINT
if [[ "${1:-}" == '--prepare-only' ]]; then
 :
elif [[ -f "$COMFY_DIRECT_CONFIG" ]]; then
 "$tool_node" "$tool_root/bin.mjs" configure
else
 "$tool_node" "$tool_root/bin.mjs" configure --wizard </dev/tty
fi
"$tool_node" "$tool_root/export-mcp.mjs" "$tool_root" "$tool_node"
cp "$script_dir/setup/manage-mac.sh" "$tool_root/manage.sh"
echo '将 mcp-client.json 中的配置添加到支持本地 stdio MCP 的客户端。没有连接服务器或生成视频。'
