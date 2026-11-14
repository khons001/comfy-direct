#!/usr/bin/env bash
set -euo pipefail
root_dir="${1:-/root/sj-tmp/video-demo/ComfyUI}"
if [[ ! -f "$root_dir/.codex-video-bundle.json" ]]; then
    echo 'Installation marker not found; refusing to start an unrelated ComfyUI.' >&2
    exit 1
fi
cd -- "$root_dir"
exec "$root_dir/.venv/bin/python" main.py --listen 127.0.0.1 --port "${2:-8188}"
