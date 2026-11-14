#!/usr/bin/env bash
set -euo pipefail
bundle_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for candidate in python3.12 /root/miniconda3/bin/python3.12 /root/miniconda3/bin/python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys;sys.exit(sys.version_info[:2] != (3,12))'; then
        exec "$candidate" "$bundle_dir/install.py" "$@"
    fi
done
echo 'Python 3.12 was not found. Use the tutorial Python 3.12 image; the system Python will not be changed.' >&2
exit 1
