#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {createInterface} from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {ROOT,config,atomic,check,create,get,list,resume,retrieve,worker,normalize,buildGraph,startWorker} from './lib.mjs';

const props={prompt:{type:'string',description:'Video story, action, dialogue and music requirements.'},reference_images:{type:'array',items:{type:'string'},minItems:1,maxItems:3,description:'Absolute paths to 1–3 PNG/JPEG/WebP reference images.'},duration:{type:'number',minimum:1,maximum:15,default:10},megapixels:{type:'number',minimum:0.1,maximum:0.8,default:0.6},steps:{type:'integer',minimum:1,maximum:50,default:20},aspect_ratio:{type:'string',enum:['16:9','9:16','1:1'],default:'16:9'},seed:{type:'integer',minimum:0},turbo:{type:'boolean',default:false},upscale:{type:'boolean',default:true},ref_image_size:{type:'string',enum:['max','match'],default:'max'},request_key:{type:'string',maxLength:120,description:'Stable unique key for this intended request. Reusing the same key returns the existing job instead of generating again.'}};
const requestSchema={type:'object',properties:props,required:['prompt','reference_images'],additionalProperties:false};
const idSchema={type:'object',properties:{job_id:{type:'string'}},required:['job_id'],additionalProperties:false};
const getSchema={...idSchema,properties:{...idSchema.properties,include_request:{type:'boolean',default:false,description:'Include the original prompt and full diagnostic data only when needed.'}}};
function jobSummary(j,full=false){
 if(full)return j;
 const r=j.request;
 return {id:j.id,kind:j.kind,status:j.status,prompt_id:j.prompt_id,request_key:j.request_key,submit_attempted:j.submit_attempted,created_at:j.created_at,updated_at:j.updated_at,submitted_at:j.submitted_at,progress:j.progress,outputs:j.outputs,uploaded_images:j.uploaded_images,parameters:r?{duration:r.duration,megapixels:r.megapixels,steps:r.steps,seed:r.seed,turbo:r.turbo,upscale:r.upscale,aspect_ratio:r.aspect_ratio}:undefined,error:typeof j.error==='string'?j.error.slice(0,2000):j.error?{gpu_available:j.error.gpu_available,missing_nodes:j.error.missing_nodes,generation_ready:j.error.generation_ready}:undefined,last_connection_error:j.last_connection_error};
}
const tools=[
 {name:'comfy_check',description:'Check ComfyUI connectivity, GPU availability, and workflow node registration. Does not generate anything.',inputSchema:{type:'object',properties:{upscale:{type:'boolean',default:true}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'comfy_submit_video',description:'Submit one H3 video job with optional SeedVR2 HD. Returns a local job ID immediately. A detached worker uploads images, submits once, monitors, and downloads results. Use a stable request_key; query the returned job ID instead of submitting again.',inputSchema:requestSchema,annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'comfy_submit_batch',description:'Submit up to ten video requests; ComfyUI queues generation. This does not add GPU capacity or guarantee parallel generation.',inputSchema:{type:'object',properties:{jobs:{type:'array',items:requestSchema,minItems:1,maxItems:10}},required:['jobs'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'comfy_get_job',description:'Read concise persisted job state and absolute local video paths. Restarts a missing monitor for a nonterminal job without resubmitting a known remote task. Full request is optional.',inputSchema:getSchema,annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'comfy_list_jobs',description:'List jobs managed by this tool, including execution IDs, progress and local outputs.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'comfy_resume_job',description:'Resume a blocked, interrupted or failed-download job. Known prompt IDs are monitored/retrieved without regeneration. An uncertain submission is reconciled by its marker, never blindly submitted again.',inputSchema:idSchema,annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'comfy_fetch_videos',description:'Genuinely retrieve already-generated MP4 files, including while GPU is off. Does not submit a generation. Mark the result as retrieval, not first generation/return.',inputSchema:{type:'object',properties:{prompt_id:{type:'string'},videos:{type:'array',minItems:1,maxItems:2,items:{type:'object',properties:{role:{type:'string',enum:['original','hd']},filename:{type:'string'},subfolder:{type:'string'},expected_sha256:{type:'string'}},required:['role','filename'],additionalProperties:false}}},required:['videos'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}}
];
async function callTool(name,args={}){
 const c=config();
 if(name==='comfy_check')return check(c,args.upscale??true);
 if(name==='comfy_submit_video')return jobSummary(create(c,args));
 if(name==='comfy_submit_batch'){
   if(!Array.isArray(args.jobs)||args.jobs.length<1||args.jobs.length>10)throw Error('Provide 1–10 jobs');
   args.jobs.forEach(normalize);const jobs=args.jobs.map(r=>create(c,r,{start:false}));for(const j of jobs)if(!['completed','failed','partial_failed','preparing','preparation_incomplete'].includes(j.status))startWorker(c,j.id);return {jobs:jobs.map(j=>({id:j.id,status:j.status}))};
 }
 if(name==='comfy_get_job')return jobSummary(get(c,args.job_id),args.include_request??false);
 if(name==='comfy_list_jobs')return {jobs:list(c)};
 if(name==='comfy_resume_job')return jobSummary(resume(c,args.job_id));
 if(name==='comfy_fetch_videos')return jobSummary(retrieve(c,args));
 throw Error('Unknown tool '+name);
}
function mcp(){
 const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 const send=data=>process.stdout.write(JSON.stringify(data)+'\n');
 lines.on('line',async line=>{
  let r;try{r=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
  if(r.id===undefined)return;
  try{
   let result;
   if(r.method==='initialize')result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(r.params?.protocolVersion)?r.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'codex-comfy-direct',version:'0.1.0'},instructions:'Use request_key to prevent duplicate generation. Poll jobs by ID. Return absolute MP4 paths inline to the user. Existing-video retrieval must be labeled accurately. Never infer GPU success from CPU/mock checks.'};
   else if(r.method==='ping')result={};
   else if(r.method==='tools/list')result={tools};
   else if(r.method==='tools/call'){
    try{const value=await callTool(r.params?.name,r.params?.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
    catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
   }else{send({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Method not found'}});return;}
   send({jsonrpc:'2.0',id:r.id,result});
  }catch(e){send({jsonrpc:'2.0',id:r.id,error:{code:-32603,message:e.message}});}
 });
}
function option(name){const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];}
function parseSSH(text){
 const tokens=text.trim().split(/\s+/);if(tokens.shift()!=='ssh')throw Error('Paste a complete ssh user@host -p PORT command');
 let user,host,port=22;
 while(tokens.length){const token=tokens.shift();if(token==='-p'){port=Number(tokens.shift());continue;}const match=token.match(/^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9.-]+)$/);if(!match||host)throw Error('Only a plain SSH host/user/port command is accepted; additional shell/options are not executed');[,user,host]=match;}
 if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid SSH command');return {user,host,port};
}
function register(){
 const target=path.join(os.homedir(),'.codex','config.toml');fs.mkdirSync(path.dirname(target),{recursive:true});const old=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
 const begin='# BEGIN codex-comfy-direct managed',end='# END codex-comfy-direct managed';
 const block=begin+'\n[mcp_servers.comfy_direct]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = '+JSON.stringify([path.join(ROOT,'bin.mjs'),'mcp'])+'\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n'+end+'\n';
 let next;
 if(old.includes(begin)){
  const a=old.indexOf(begin),b=old.indexOf(end,a);if(b<0||old.indexOf(begin,a+begin.length)>=0)throw Error('Ambiguous managed configuration; existing config preserved');next=old.slice(0,a)+block+old.slice(b+end.length).replace(/^\r?\n/,'');
 }else{if(/^\s*\[mcp_servers\.comfy_direct\]\s*$/m.test(old))throw Error('An unmanaged comfy_direct server already exists; preserved for review');next=old.trimEnd()+'\n\n'+block;}
 if(next!==old){if(old)fs.copyFileSync(target,target+'.before-comfy-direct-'+Date.now());fs.writeFileSync(target,next,{mode:0o600});}
 return {registered:true,server:'comfy_direct',config_file:target,note:'Reconnect MCP tools or open a new Codex chat if this session does not refresh tool discovery. Other MCP servers were preserved.'};
}
async function configure(){
 let ssh=option('--ssh-command');if(process.argv.includes('--wizard')){const r=createInterface({input:process.stdin,output:process.stdout});ssh=await r.question('请粘贴平台提供的完整 SSH 命令（不含密码）：');r.close();}
 const c=config();if(ssh)c.ssh=parseSSH(ssh);const endpoint=option('--endpoint');if(endpoint){const u=new URL(endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid endpoint');c.endpoint=endpoint;}
 const file=process.env.COMFY_DIRECT_CONFIG||path.join(ROOT,'data','config.json');atomic(file,{endpoint:c.endpoint,data_dir:c.data_dir,poll_ms:c.poll_ms,timeout_seconds:c.timeout_seconds,ssh:c.ssh});
 const result={configured:true,endpoint:config().endpoint,ssh:c.ssh??null};if(process.argv.includes('--register'))result.codex=register();return result;
}
async function connect(){
 const c=config();if(!c.ssh)throw Error('Run configure --wizard first');
 const local=new URL(c.endpoint);if(!['127.0.0.1','localhost'].includes(local.hostname))throw Error('SSH connection helper requires a localhost endpoint');
 const s=c.ssh;parseSSH(`ssh ${s.user}@${s.host} -p ${s.port}`);const port=Number(local.port)||80;
 const remote=`set -e
for candidate in /root/sj-tmp/ComfyUI /root/sj-tmp/video-demo/ComfyUI; do
 if [ -f "$candidate/main.py" ] && [ -x "$candidate/.venv/bin/python" ]; then
  cd "$candidate"
  exec .venv/bin/python - <<'COMFY_BOOTSTRAP'
import json, os, pathlib, signal, subprocess, time, urllib.request
import torch

base = pathlib.Path.cwd()
state = base / 'user/codex-direct'
state.mkdir(parents=True, exist_ok=True)
def api(route):
    with urllib.request.urlopen('http://127.0.0.1:8188/' + route, timeout=3) as response:
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
    if proc.joinpath('cwd').resolve() != base or b'main.py' not in args or b'--cpu' not in args or b'8188' not in args:
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
    command = [str(base / '.venv/bin/python'), 'main.py', '--listen', '127.0.0.1', '--port', '8188']
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
COMFY_BOOTSTRAP
 fi
done
echo 'ComfyUI installation was not found.' >&2
exit 1`;
 const logfile=path.join(c.data_dir,'connection.log');console.log('连接日志：'+logfile);
 // A script sent on stdin avoids Windows OpenSSH remote-command quote loss.
 // OpenSSH reads the password from the console itself; input is never logged.
 const child=spawn('ssh',['-T','-o','StrictHostKeyChecking=ask','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-L',`127.0.0.1:${port}:127.0.0.1:8188`,'-p',String(s.port),s.user+'@'+s.host,'bash','-s'],{stdio:['pipe','pipe','pipe']});
 const record=(stream,chunk)=>{stream.write(chunk);fs.appendFileSync(logfile,chunk,{mode:0o600});};
 child.stdout.on('data',chunk=>record(process.stdout,chunk));child.stderr.on('data',chunk=>record(process.stderr,chunk));
 child.stdin.on('error',()=>{});child.stdin.end(remote+'\n');
 child.on('error',e=>{record(process.stderr,Buffer.from(e.message+'\n'));process.exitCode=1;});
 child.on('exit',async code=>{process.exitCode=code??1;console.log('连接结束，退出码：'+(code??'unknown'));if(process.stdin.isTTY){const rl=createInterface({input:process.stdin,output:process.stdout});await rl.question('按回车关闭此窗口。');rl.close();}});
}
async function main(){
 const command=process.argv[2];if(command==='mcp'){mcp();return;}if(command==='connect'){await connect();return;}
 const c=config();let result;
 if(command==='worker'){await worker(c,process.argv[3]);return;}
 if(command==='configure')result=await configure();
 else if(command==='register')result=register();
 else if(command==='check')result=await check(c,!process.argv.includes('--original-only'));
 else if(command==='list')result={jobs:list(c)};
 else if(command==='get')result=get(c,process.argv[3]);
 else if(command==='resume')result=resume(c,process.argv[3]);
 else if(command==='submit'||command==='retrieve'){
  const file=option('--request');if(!file)throw Error('--request JSON_FILE is required');const input=JSON.parse(fs.readFileSync(file,'utf8'));result=command==='submit'?create(c,input):retrieve(c,input);
 }else if(command==='build'){
  const input=JSON.parse(fs.readFileSync(option('--request'),'utf8'));const r=normalize(input);result=buildGraph(r,r.references.map((x,i)=>'reference-'+i+x.ext),'dry-run');
 }else throw Error('Commands: configure --wizard [--register], connect, register, mcp, check, submit --request file.json, retrieve --request file.json, get JOB_ID, list, resume JOB_ID, build --request file.json');
 if(command==='configure'&&process.argv.includes('--wizard'))console.log('连接信息和 Codex 工具配置已保存。');
 else console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
