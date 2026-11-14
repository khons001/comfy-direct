#!/usr/bin/env python3
"""Install a pinned H3 + SeedVR2 bundle into an isolated Linux directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import zipfile
import importlib.util

BUNDLE = Path(__file__).resolve().parent

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def read_json(name):
    return json.loads((BUNDLE / name).read_text(encoding='utf-8'))

def safe_path(root, relative):
    p = (root / relative).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ValueError('Path outside installation directory: ' + relative)
    return p

def extract(source, target):
    with zipfile.ZipFile(source) as z:
        for entry in z.infolist():
            parts = Path(entry.filename).parts
            if len(parts) < 2 or entry.is_dir():
                continue
            p = safe_path(target, str(Path(*parts[1:])))
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Symlinks are not accepted in source archives')
            p.parent.mkdir(parents=True, exist_ok=True)
            with z.open(entry) as f, p.open('wb') as out:
                shutil.copyfileobj(f, out)

def run(command, **kwargs):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True, **kwargs)

def prepare(root):
    marker = root / '.codex-video-bundle.json'
    locks = read_json('sources.lock.json')
    identity = {item['name']: item['sha256'] for item in locks}
    if root.exists() and any(root.iterdir()):
        if not marker.exists() or json.loads(marker.read_text()) != identity:
            raise RuntimeError('Target is not an installation of this bundle. Choose a NEW directory; existing ComfyUI is preserved.')
        print('Source bundle already prepared; no source overwritten.')
        return
    for item in locks:
        p = BUNDLE / item['file']
        if digest(p) != item['sha256']:
            raise RuntimeError('Source checksum mismatch: ' + item['file'])
    root.mkdir(parents=True, exist_ok=True)
    for item in locks:
        dest = root if item['name'] == 'comfyui' else root / 'custom_nodes/ComfyUI-SeedVR2'
        extract(BUNDLE / item['file'], dest)
    workflows = root / 'user/default/workflows'
    workflows.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BUNDLE / 'workflow.json', workflows / 'H3_SeedVR2_单图演示.json')
    dest = root / 'input/参考图.png'
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BUNDLE / 'reference.png', dest)
    marker.write_text(json.dumps(identity), encoding='utf-8')

def install_dependencies(root, cpu_test):
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('Run with Python 3.12. Do not replace the system Python.')
    py = root / '.venv/bin/python'
    if not py.exists() or subprocess.run([str(py), '-m', 'pip', '--version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        run([sys.executable, '-m', 'venv', root / '.venv'])
    for item in read_json('wheels.lock.json'):
        if digest(BUNDLE / item['file']) != item['sha256']:
            raise RuntimeError('Bundled dependency wheel checksum mismatch')
    run([py, '-m', 'pip', 'install', 'pip==24.2'])
    index = 'https://download.pytorch.org/whl/' + ('cpu' if cpu_test else 'cu128')
    # Keep PyTorch's index limited to its own wheels; obtain its pinned dependencies
    # through the normal package index instead of probing unrelated latest releases.
    run([py, '-m', 'pip', 'install', '--no-deps', 'torch==2.8.0', 'torchvision==0.23.0', 'torchaudio==2.8.0', '--index-url', index])
    command = [py, '-m', 'pip', 'install', '-r', BUNDLE / 'requirements.lock.txt']
    if not cpu_test:
        command += ['-r', BUNDLE / 'cuda-requirements.lock.txt']
    run(command, cwd=BUNDLE)
    run([py, '-m', 'pip', 'check'])
    with (root / 'installed-packages.txt').open('w') as f:
        run([py, '-m', 'pip', 'freeze'], stdout=f)

def install_models(root, reuse):
    verified = []
    preferred_endpoint = os.environ.get('HF_ENDPOINT', '').rstrip('/')
    for item in read_json('models.lock.json'):
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Unsafe model path')
        # A managed model may intentionally be a read-only reuse symlink. Check
        # its parent containment, then hash the existing leaf without replacing it.
        dest = safe_path(root / 'models', str(relative.parent)) / relative.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() or dest.is_symlink():
            if dest.is_file() and dest.stat().st_size == item['size'] and digest(dest) == item['sha256']:
                print('Verified installed model:', item['path'], flush=True)
                verified.append({'path': item['path'], 'sha256': item['sha256'], 'source': 'existing target'})
                continue
            raise RuntimeError('Existing model does not match locked checksum; preserved: ' + str(dest))
        source = safe_path(reuse, item['path']) if reuse else dest
        if source.is_file() and source.stat().st_size == item['size'] and digest(source) == item['sha256']:
            if source != dest and not dest.exists():
                dest.symlink_to(source)
            print('Verified model:', item['path'], flush=True)
            verified.append({'path': item['path'], 'sha256': item['sha256'], 'source': 'reuse' if reuse else 'existing target'})
            continue
        if dest.exists() or dest.is_symlink():
            raise RuntimeError('Existing model does not match locked checksum; preserved: ' + str(dest))
        if shutil.disk_usage(dest.parent).free < item['size'] + 2 * 1024**3:
            raise RuntimeError('Not enough disk space for ' + item['path'])
        partial = dest.with_name(dest.name + '.partial')
        canonical = item['url']
        mirror = canonical.replace('https://huggingface.co/', 'https://hf-mirror.com/')
        for attempt in range(3):
            try:
                url = canonical.replace('https://huggingface.co', preferred_endpoint) if preferred_endpoint else (canonical if attempt == 0 else mirror)
                print('Downloading:', item['path'], 'via', urllib.parse.urlparse(url).hostname, flush=True)
                offset = partial.stat().st_size if partial.exists() else 0
                if offset >= item['size']:
                    offset = 0
                headers = {'Range': 'bytes=' + str(offset) + '-'} if offset else {}
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=20) as response:
                    append = offset > 0 and response.status == 206
                    if append and not response.headers.get('Content-Range', '').startswith('bytes '+str(offset)+'-'):
                        raise RuntimeError('Invalid resume offset returned by download server')
                    with partial.open('ab' if append else 'wb') as out:
                        shutil.copyfileobj(response, out, length=8*1024*1024)
                if partial.stat().st_size != item['size'] or digest(partial) != item['sha256']:
                    raise RuntimeError('Downloaded model checksum mismatch')
                partial.replace(dest)
                if url.startswith('https://hf-mirror.com/'):
                    preferred_endpoint = 'https://hf-mirror.com'
                verified.append({'path': item['path'], 'sha256': item['sha256'], 'source': 'download'})
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3)
    (root / 'models-verification.json').write_text(json.dumps(verified, indent=2), encoding='utf-8')

def smoke_test(root, cpu_test):
    py = root / '.venv/bin/python'
    import socket
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    log = root / 'installation-smoke.log'
    command = [str(py), 'main.py', '--listen', '127.0.0.1', '--port', str(port)]
    if cpu_test:
        command += ['--cpu', '--disable-partner-nodes']
    with log.open('w') as output:
        process = subprocess.Popen(command, cwd=root, stdout=output, stderr=subprocess.STDOUT)
        try:
            for _ in range(180):
                if process.poll() is not None:
                    raise RuntimeError('ComfyUI exited during startup; see ' + str(log))
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/object_info', timeout=3) as r:
                        nodes = json.load(r)
                    required = read_json('required-nodes.json')
                    missing = sorted(set(required) - set(nodes))
                    # These upstream schemas index the first CUDA device while
                    # registering. A no-GPU check must report them as deferred,
                    # rather than pretend they registered or fail the core install.
                    gpu_only_schemas = {'SeedVR2LoadDiTModel', 'SeedVR2LoadVAEModel'}
                    deferred_nodes = missing if cpu_test and set(missing) <= gpu_only_schemas else []
                    if missing and not deferred_nodes:
                        raise RuntimeError('Required nodes missing: ' + ', '.join(missing))
                    checked = 0
                    deferred = []
                    for node_id, node in read_json('api-template.json').items():
                        if node['class_type'] in deferred_nodes:
                            continue
                        definition = nodes[node['class_type']].get('input', {})
                        inputs = dict(definition.get('required', {}), **definition.get('optional', {}))
                        for name, value in node['inputs'].items():
                            spec = inputs.get(name)
                            if spec and isinstance(spec[0], list) and not isinstance(value, list):
                                checked += 1
                                if value not in spec[0]:
                                    if cpu_test and isinstance(value, str) and value.startswith('cuda'):
                                        deferred.append({'node': node_id, 'input': name, 'value': value})
                                        continue
                                    raise RuntimeError('Workflow input is not available: node '+node_id+', '+name+'='+str(value))
                    report = {'startup': 'passed', 'required_nodes': len(required), 'cpu_test': cpu_test,
                              'registered_required_nodes': len(required)-len(deferred_nodes),
                              'deferred_gpu_nodes': deferred_nodes,
                              'acceptance': 'cpu_checks_passed_gpu_pending' if cpu_test else 'startup_checks_passed_generation_pending',
                              'gpu_generation_verified': False, 'models_checked_by_this_test': False,
                              'workflow_enum_inputs_checked': checked,
                              'deferred_gpu_inputs': deferred,
                              'reference_image_listed': '参考图.png' in nodes['LoadImage']['input']['required']['image'][0]}
                    (root / 'installation-report.json').write_text(json.dumps(report, indent=2))
                    print(json.dumps(report)); return
                except (OSError, urllib.error.URLError):
                    time.sleep(2)
            raise TimeoutError('ComfyUI startup timed out; see ' + str(log))
        finally:
            process.terminate()
            try: process.wait(timeout=20)
            except subprocess.TimeoutExpired: process.kill(); process.wait()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', type=Path, default=Path('/root/sj-tmp/video-demo/ComfyUI'))
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--prepare-only', action='store_true')
    ap.add_argument('--cpu-test', action='store_true')
    ap.add_argument('--cpu-smoke', action='store_true', help='Install CUDA wheels but check service startup without a GPU')
    ap.add_argument('--skip-models', action='store_true')
    ap.add_argument('--models-from', type=Path)
    args = ap.parse_args()
    if args.plan:
        print(json.dumps({'root': str(args.root), 'models_bytes': sum(m['size'] for m in read_json('models.lock.json')),
                          'source_locks': read_json('sources.lock.json')}, indent=2)); return
    if sys.platform != 'linux': raise RuntimeError('Linux server required')
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('Python 3.12 is required. Use the matching server image; do not replace system Python.')
    if importlib.util.find_spec('ensurepip') is None:
        raise RuntimeError('Python 3.12 venv/ensurepip is missing. On Debian/Ubuntu, install python3.12-venv, or choose a Python 3.12 image with venv support. No installation files were changed.')
    root = args.root.resolve()
    prepare(root)
    if args.prepare_only: return
    install_dependencies(root, args.cpu_test)
    if not args.skip_models: install_models(root, args.models_from.resolve() if args.models_from else None)
    smoke_test(root, args.cpu_test or args.cpu_smoke)
    print('Installation checks finished. GPU video generation is a separate acceptance step.')

if __name__ == '__main__':
    main()
