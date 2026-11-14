import json, os, pathlib, signal, subprocess, time, urllib.request
import sys
import torch
port = int(sys.argv[1])

base = pathlib.Path.cwd()
state = base / ('user/codex-direct' if port == 8188 else 'user/comfy-direct-' + str(port))
state.mkdir(parents=True, exist_ok=True)
def api(route):
    with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/' + route, timeout=3) as response:
        return json.load(response)
gpu = torch.cuda.is_available()
print(json.dumps({'cuda_available': gpu, 'device_count': torch.cuda.device_count(),
                  'devices': [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]}), flush=True)
try:
    current = api('system_stats')
except Exception:
    current = None
if current and gpu and not any(d.get('type') == 'cuda' for d in current.get('devices', [])):
    queue = api('queue')
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise RuntimeError('CPU service has active jobs; preserved without restart')
    pid = int((state / 'server.pid').read_text())
    proc = pathlib.Path('/proc') / str(pid)
    args = (proc / 'cmdline').read_bytes().split(bytes([0]))
    if proc.joinpath('cwd').resolve() != base or b'main.py' not in args or b'--cpu' not in args or str(port).encode() not in args:
        raise RuntimeError('Existing service is not the recorded CPU process; preserved')
    os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        try:
            api('system_stats')
        except Exception:
            current = None
            break
        time.sleep(1)
    else:
        raise RuntimeError('CPU service did not stop; no second server started')
if not current:
    command = [str(base / '.venv/bin/python'), 'main.py', '--listen', '127.0.0.1', '--port', str(port)]
    if not gpu:
        command += ['--cpu', '--disable-partner-nodes']
        print('CUDA unavailable: starting CPU inspection service only; generation remains blocked.', flush=True)
    with (state / 'server.log').open('ab') as log:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    (state / 'server.pid').write_text(str(child.pid))
    for _ in range(120):
        if child.poll() is not None:
            raise RuntimeError('ComfyUI exited; inspect user/codex-direct/server.log')
        try:
            current = api('system_stats')
            break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError('Service readiness timed out; server log retained')
if gpu and not any(d.get('type') == 'cuda' for d in current.get('devices', [])):
    raise RuntimeError('GPU detected but API still reports CPU; generation is not ready')
print('ComfyUI ready. Keep this connection window open.', flush=True)
while True:
    time.sleep(60)
