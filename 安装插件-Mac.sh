#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
export COMFY_DIRECT_INSTALL_DIR="${COMFY_DIRECT_HOME:-$HOME/Library/Application Support/CodexComfyDirect}"
COMFY_DIRECT_PREPARE_ONLY=1 /bin/bash "$script_dir/setup/prepare-mac.sh"
[[ "${1:-}" == '--prepare-only' ]] && exit 0
command -v codex >/dev/null || { echo '未找到 Codex CLI；运行环境已准备。' >&2; exit 1; }
config_file="${CODEX_HOME:-$HOME/.codex}/config.toml"
if [[ -f "$config_file" ]] && grep -Eq '^\[mcp_servers\.comfy_direct\]' "$config_file"; then
  echo '已有独立 comfy_direct 连接，已保留。请完成明确迁移后再装插件，避免重复。' >&2; exit 1
fi
codex plugin marketplace add "$script_dir"
codex plugin add 'comfy-direct-mac@comfy-direct-personal'
if [[ ! -f "$COMFY_DIRECT_INSTALL_DIR/data/config.json" ]]; then
  /bin/bash "$script_dir/plugins/comfy-direct-mac/scripts/launch.sh" configure --wizard </dev/tty
fi
echo '插件已安装。服务器开机后运行 连接服务器-Mac.sh；此处没有提交生成任务。'
