import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

export const ROOT=path.dirname(fileURLToPath(import.meta.url));
const TERMINAL=new Set(['completed','partial_failed','failed','blocked_gpu','remote_missing','submission_unknown','paused_timeout','download_failed']);
export function atomic(file, value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});
  // Windows readers/scanners can briefly hold the replacement target open.
  // Keep the old valid JSON in place and retry replacement instead of truncating it.
  for(let attempt=0;;attempt++){
    try{fs.renameSync(tmp,file);break;}
    catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=49)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
  }
}
export function config(){
  const file=process.env.COMFY_DIRECT_CONFIG||path.join(ROOT,'data','config.json');
  const user=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const c={endpoint:'http://127.0.0.1:18190',poll_ms:5000,timeout_seconds:21600,...user};
  c.data_dir=path.resolve(process.env.COMFY_DIRECT_DATA_DIR||c.data_dir||path.join(ROOT,'data'));
  if(process.env.COMFY_DIRECT_ENDPOINT)c.endpoint=process.env.COMFY_DIRECT_ENDPOINT;
  const url=new URL(c.endpoint);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid ComfyUI endpoint; credentials must not appear in its URL.');
  c.endpoint=url.href.replace(/\/$/,'');c.poll_ms=Math.max(200,Number(c.poll_ms)||5000);
  fs.mkdirSync(path.join(c.data_dir,'jobs'),{recursive:true});return c;
}
function jobDir(c,id){if(!/^[a-z0-9-]{10,80}$/.test(id))throw Error('Invalid job ID');return path.join(c.data_dir,'jobs',id);}
function jobFile(c,id){return path.join(jobDir(c,id),'job.json');}
export function load(c,id){return JSON.parse(fs.readFileSync(jobFile(c,id),'utf8'));}
function save(c,j){j.updated_at=new Date().toISOString();atomic(jobFile(c,j.id),j);}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function stateDB(c){
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(path.join(c.data_dir,'state.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (request_key TEXT PRIMARY KEY, signature TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE, created_ms INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS workers (job_id TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL);');
  return db;
}
export async function api(c,route,{method='GET',body,timeout=15000,raw=false}={}){
  const headers={};if(process.env.COMFY_API_TOKEN)headers.Authorization='Bearer '+process.env.COMFY_API_TOKEN;
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  const response=await fetch(c.endpoint+route,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!response.ok){const e=Error('ComfyUI HTTP '+response.status+': '+(await response.text()).slice(0,8000));e.http_status=response.status;throw e;}
  return raw?response:response.json();
}
export function normalize(r){
  if(!r||typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>30000)throw Error('prompt must contain 1–30000 characters');
  const files=r.reference_images||(r.reference_image?[r.reference_image]:[]);
  if(!Array.isArray(files)||files.length<1||files.length>3)throw Error('Provide 1–3 reference_images');
  const references=files.map(file=>{
    if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Reference image must use an absolute local path');
    const stat=fs.statSync(file);if(!stat.isFile()||stat.size>30*1024**2)throw Error('Reference image must be a file up to 30MB');
    const data=fs.readFileSync(file),ext=path.extname(file).toLowerCase();
    const valid=ext==='.png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||['.jpg','.jpeg'].includes(ext)&&data[0]===255&&data[1]===216||ext==='.webp'&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
    if(!valid)throw Error('Reference file is not a supported PNG/JPEG/WebP image');
    return {source:path.resolve(file),sha256:crypto.createHash('sha256').update(data).digest('hex'),ext};
  });
  const duration=r.duration??10,megapixels=r.megapixels??0.6,steps=r.steps??20;
  if(typeof duration!=='number'||duration<1||duration>15)throw Error('duration must be 1–15 seconds');
  if(typeof megapixels!=='number'||megapixels<0.1||megapixels>0.8)throw Error('megapixels must be 0.1–0.8; 0.6 is the tested normal-mode preset');
  if(!Number.isInteger(steps)||steps<1||steps>50)throw Error('steps must be an integer from 1–50');
  const aspect=r.aspect_ratio??'16:9';if(!['16:9','9:16','1:1'].includes(aspect))throw Error('Unsupported aspect_ratio');
  const seed=r.seed??crypto.randomInt(1,2147483647);if(!Number.isSafeInteger(seed)||seed<0)throw Error('seed must be a non-negative safe integer');
  if(r.turbo!==undefined&&typeof r.turbo!=='boolean'||r.upscale!==undefined&&typeof r.upscale!=='boolean')throw Error('turbo/upscale must be boolean');
  const refSize=r.ref_image_size??'max';if(!['max','match'].includes(refSize))throw Error('ref_image_size must be max or match');
  if(r.request_key!==undefined&&(typeof r.request_key!=='string'||r.request_key.length>120||!r.request_key.length))throw Error('Invalid request_key');
  return {prompt:r.prompt,references,duration,megapixels,steps,aspect_ratio:aspect,seed,turbo:r.turbo??false,upscale:r.upscale??true,ref_image_size:refSize,request_key:r.request_key??null};
}
export function buildGraph(request,uploaded,id){
  const g=JSON.parse(fs.readFileSync(path.join(ROOT,'workflow-api.json'),'utf8'));
  g['138'].inputs.value=request.prompt;g['132'].inputs.value=request.duration;
  g['115'].inputs.megapixels=request.megapixels;
  g['115'].inputs.aspect_ratio={'16:9':'16:9 (Widescreen)','9:16':'9:16 (Portrait Widescreen)','1:1':'1:1 (Square)'}[request.aspect_ratio];
  g['143'].inputs.value=request.steps;g['146'].inputs.value=request.turbo;
  g['129'].inputs.noise_seed=request.seed;g['154'].inputs.seed=request.seed;
  g['136'].inputs.ref_image_size=request.ref_image_size;
  for(const k of Object.keys(g['136'].inputs))if(k.startsWith('ref_images.'))delete g['136'].inputs[k];
  for(const [k,v] of Object.entries(g))if(v.class_type==='LoadImage')delete g[k];
  uploaded.forEach((name,i)=>{const nid=String(900+i);g[nid]={class_type:'LoadImage',inputs:{image:name}};g['136'].inputs['ref_images.ref_image_'+i]=[nid,0];});
  g['92'].inputs.filename_prefix='codex-direct/'+id+'/H3';g['162'].inputs.filename_prefix='codex-direct/'+id+'/HD';
  const keep=new Set();function walk(n){if(keep.has(n))return;if(!g[n])throw Error('Workflow references missing node '+n);keep.add(n);for(const v of Object.values(g[n].inputs))if(Array.isArray(v)&&typeof v[0]==='string'&&Number.isInteger(v[1]))walk(v[0]);}
  walk('92');if(request.upscale)walk('162');
  return Object.fromEntries(Object.entries(g).filter(([k])=>keep.has(k)));
}
export async function check(c,upscale=true){
  const [stats,nodes]=await Promise.all([api(c,'/system_stats'),api(c,'/object_info')]);
  const graph=buildGraph({prompt:'preflight',duration:2,megapixels:0.2,steps:4,aspect_ratio:'16:9',seed:1,turbo:false,upscale,ref_image_size:'match'},['reference.png'],'preflight');
  const required=[...new Set(Object.values(graph).map(n=>n.class_type))];
  const missing=required.filter(x=>!nodes[x]);
  const unavailable=[];
  for(const [id,node] of Object.entries(graph)){
    const schema=nodes[node.class_type]?.input;
    if(!schema)continue;
    const inputs={...schema.required,...schema.optional};
    for(const [name,value] of Object.entries(node.inputs)){
      const choices=inputs[name]?.[0];
      if(Array.isArray(choices)&&!Array.isArray(value)&&!choices.includes(value)){
        // The reference image is uploaded only when a generation is submitted.
        if(node.class_type==='LoadImage'&&name==='image')continue;
        unavailable.push({node:id,class_type:node.class_type,input:name,value});
      }
    }
  }
  const gpu=stats.devices?.some(d=>d.type==='cuda')??false;
  return {connected:true,endpoint:c.endpoint,gpu_available:gpu,required_node_count:required.length,missing_nodes:missing,unavailable_inputs:unavailable,generation_ready:gpu&&!missing.length&&!unavailable.length,system:stats.system,devices:stats.devices};
}
function allJobs(c){return fs.readdirSync(path.join(c.data_dir,'jobs')).map(id=>{try{return load(c,id);}catch{return null;}}).filter(Boolean);}
export function list(c){return allJobs(c).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(j=>({id:j.id,kind:j.kind,status:j.status,prompt_id:j.prompt_id,created_at:j.created_at,progress:j.progress,outputs:j.outputs,error:j.error}));}
function isJobWorker(pid,id,seen){
  if(!Number.isInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);}catch{return false;}
  if(seen&&Date.now()-Date.parse(seen)<30000)return true;
  // PID values can be reused after a reboot or a crash. Only inspect the stale
  // candidate process; never kill it or assume any live PID is our worker.
  let result;
  if(process.platform==='win32'){
    const script='[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $p = Get-CimInstance Win32_Process -Filter "ProcessId = '+pid+'"; if ($p) { [Console]::Write($p.CommandLine) }';
    result=spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',timeout:5000,windowsHide:true});
  }else result=spawnSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8',timeout:5000});
  if(result.error||result.status!==0)return true; // Inconclusive: avoid duplicate work.
  return result.stdout.includes(id)&&result.stdout.includes('bin.mjs')&&/\bworker\b/.test(result.stdout);
}
export function startWorker(c,id){
  const j=load(c,id);if(!TERMINAL.has(j.status)&&isJobWorker(j.worker_pid,id,j.heartbeat_at??j.updated_at))return;
  const dir=jobDir(c,id),log=fs.openSync(path.join(dir,'worker.log'),'a');
  const child=spawn(process.execPath,[path.join(ROOT,'bin.mjs'),'worker',id],{detached:true,stdio:['ignore',log,log],windowsHide:true,env:{...process.env,COMFY_DIRECT_DATA_DIR:c.data_dir,COMFY_DIRECT_ENDPOINT:c.endpoint}});child.unref();fs.closeSync(log);
}
export function create(c,input,{start=true}={}){
  const r=normalize(input);const signature=crypto.createHash('sha256').update(JSON.stringify({...r,seed:input.seed??null,references:r.references.map(x=>({sha256:x.sha256,ext:x.ext}))})).digest('hex');
  const id=crypto.randomUUID(),dir=jobDir(c,id);
  if(r.request_key){
    const db=stateDB(c);let row;
    try{
      const legacy=allJobs(c).find(j=>j.request_key===r.request_key);
      if(legacy){if(legacy.request_signature!==signature)throw Error('request_key is already used by a different request');return legacy;}
      db.prepare('INSERT OR IGNORE INTO requests(request_key,signature,job_id,created_ms) VALUES(?,?,?,?)').run(r.request_key,signature,id,Date.now());
      row=db.prepare('SELECT * FROM requests WHERE request_key=?').get(r.request_key);
    }finally{db.close();}
    if(row.signature!==signature)throw Error('request_key is already used by a different request');
    if(row.job_id!==id)return get(c,row.job_id);
  }
  const j={id,kind:'generation',status:'created',created_at:new Date().toISOString(),request_key:r.request_key,request_signature:signature,request:r,prompt_id:null,submit_attempted:false,outputs:[]};
  try{
    fs.mkdirSync(path.join(dir,'references'),{recursive:true});
    r.references=r.references.map((ref,i)=>{const file=path.join(dir,'references',String(i+1)+ref.ext);fs.copyFileSync(ref.source,file);return {...ref,file};});
    save(c,j);
  }catch(e){j.status='failed';j.error='Local request preparation failed before submission: '+e.message;save(c,j);throw e;}
  if(start)startWorker(c,id);return j;
}
export function resume(c,id){const j=load(c,id);if(['completed','partial_failed','failed'].includes(j.status))throw Error('This job cannot be resumed; inspect its result before creating a new request.');if(isJobWorker(j.worker_pid,id,j.heartbeat_at??j.updated_at))return j;j.worker_pid=null;j.status='created';j.error=null;save(c,j);startWorker(c,id);return j;}
export function get(c,id){
  if(!fs.existsSync(jobFile(c,id))){const db=stateDB(c);try{const row=db.prepare('SELECT created_ms FROM requests WHERE job_id=?').get(id);if(row)return {id,status:Date.now()-row.created_ms<30000?'preparing':'preparation_incomplete',note:'Request is reserved; no duplicate generation was submitted.'};}finally{db.close();}}
  const j=load(c,id);if(!TERMINAL.has(j.status))startWorker(c,id);return j;
}
function descriptor(x){
  if(!x||!['original','hd'].includes(x.role)||typeof x.filename!=='string'||path.basename(x.filename)!==x.filename||/[\\/\0]/.test(x.filename)||!x.filename.toLowerCase().endsWith('.mp4'))throw Error('Invalid video descriptor');
  const subfolder=x.subfolder??'';if(typeof subfolder!=='string'||subfolder.startsWith('/')||subfolder.includes('\\')||subfolder.split('/').includes('..')||subfolder.includes('\0')||subfolder.includes(':'))throw Error('Invalid output subfolder');
  if(x.expected_sha256&&!/^[0-9a-f]{64}$/i.test(x.expected_sha256))throw Error('Invalid expected_sha256');
  return {...x,subfolder,type:'output'};
}
export function retrieve(c,args){
  if(!Array.isArray(args.videos)||!args.videos.length||args.videos.length>2)throw Error('Provide one or two video descriptors');
  const videos=args.videos.map(descriptor);if(new Set(videos.map(x=>x.role)).size!==videos.length)throw Error('Duplicate video role');
  const j={id:crypto.randomUUID(),kind:'retrieval',status:'created',created_at:new Date().toISOString(),prompt_id:args.prompt_id??null,remote_videos:videos,outputs:[]};save(c,j);startWorker(c,j.id);return j;
}
async function recoverSubmission(c,j){
  const queue=await api(c,'/queue');for(const entry of [...queue.queue_running??[],...queue.queue_pending??[]])if(entry[3]?.comfy_direct_job_id===j.id||entry[3]?.client_id===j.id)return entry[1];
  const history=await api(c,'/history?max_items=100');for(const [id,h] of Object.entries(history))if(h.prompt?.[3]?.comfy_direct_job_id===j.id||h.prompt?.[3]?.client_id===j.id)return id;return null;
}
export async function uploadImages(c,references,id){
  if(!/^[a-z0-9-]{10,80}$/.test(id))throw Error('Invalid upload marker');
  const names=[];for(const [i,ref] of references.entries()){
    const form=new FormData();form.append('image',new Blob([fs.readFileSync(ref.file??ref.source)]),'codex-'+id+'-'+(i+1)+ref.ext);form.append('type','input');form.append('overwrite','false');
    const reply=await api(c,'/upload/image',{method:'POST',body:form,timeout:60000});
    if(typeof reply.name!=='string'||/[\\/\0]/.test(reply.name))throw Error('Invalid upload response');
    const sub=reply.subfolder||'';if(sub.includes('..')||sub.startsWith('/')||sub.includes('\\'))throw Error('Invalid upload subfolder');
    names.push((sub?sub+'/':'')+reply.name);
  }return names;
}
async function upload(c,j){
  const names=await uploadImages(c,j.request.references,j.id);j.uploaded_images=names;save(c,j);return names;
}
function historyVideos(h){
  const found=[];for(const [id,role] of [['92','original'],['162','hd']]){
    const out=h.outputs?.[id];for(const v of [...out?.images??[],...out?.videos??[],...out?.gifs??[]])if(v.filename?.toLowerCase().endsWith('.mp4')){found.push(descriptor({...v,role}));break;}
  }return found;
}
async function download(c,j,videos){
  j.status='downloading';j.remote_videos=videos;save(c,j);
  for(const v of videos){
    const target=path.join(jobDir(c,j.id),v.role+'.mp4');const prior=j.outputs.find(o=>o.role===v.role);
    if(prior&&fs.existsSync(target)&&sha(target)===prior.sha256)continue;
    const q=new URLSearchParams({filename:v.filename,subfolder:v.subfolder,type:'output'});
    const r=await api(c,'/view?'+q,{raw:true,timeout:300000});
    const hash=crypto.createHash('sha256');let bytes=0;
    const meter=new Transform({transform(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done(null,chunk);}});
    await pipeline(Readable.fromWeb(r.body),meter,fs.createWriteStream(target+'.partial'));
    const expected=Number(r.headers.get('content-length'));
    if(!bytes||expected&&expected!==bytes)throw Error('Incomplete video download');
    const head=Buffer.alloc(12),fd=fs.openSync(target+'.partial','r');try{fs.readSync(fd,head,0,12,0);}finally{fs.closeSync(fd);}
    if(head.toString('ascii',4,8)!=='ftyp')throw Error('Response is not an MP4 file');
    const digest=hash.digest('hex');if(v.expected_sha256&&digest!==v.expected_sha256.toLowerCase())throw Error('Video SHA256 mismatch');
    fs.renameSync(target+'.partial',target);j.outputs=j.outputs.filter(o=>o.role!==v.role);j.outputs.push({role:v.role,path:target,bytes,sha256:digest,metadata:v.metadata??null});save(c,j);
  }
}
export async function worker(c,id){
  const dir=jobDir(c,id),token=crypto.randomUUID();
  const db=stateDB(c);let claim;
  try{
    const prior=db.prepare('SELECT * FROM workers WHERE job_id=?').get(id),state=load(c,id);
    if(prior&&isJobWorker(prior.pid,id,state.heartbeat_at??state.updated_at))return;
    claim=prior?db.prepare('UPDATE workers SET token=?,pid=? WHERE job_id=? AND token=?').run(token,process.pid,id,prior.token):db.prepare('INSERT OR IGNORE INTO workers(job_id,token,pid) VALUES(?,?,?)').run(id,token,process.pid);
  }finally{db.close();}
  if(Number(claim.changes)!==1)return;
  let socket,heartbeat;const j=load(c,id);j.worker_pid=process.pid;j.error=null;
  heartbeat=setInterval(()=>{j.heartbeat_at=new Date().toISOString();save(c,j);},10000);heartbeat.unref();
  try{
    if(j.kind==='retrieval'){await download(c,j,j.remote_videos);j.status='completed';return;}
    if(!j.prompt_id){
      j.status='checking';save(c,j);
      if(j.submit_attempted){j.prompt_id=await recoverSubmission(c,j);if(!j.prompt_id){j.status='submission_unknown';j.error='Submission may have reached ComfyUI. No duplicate was submitted; inspect the server queue/history.';return;}}
      else{
        const health=await check(c,j.request.upscale);if(!health.generation_ready){j.status='blocked_gpu';j.error=health;return;}
        j.status='uploading';save(c,j);const images=j.uploaded_images||await upload(c,j);
        const graph=buildGraph(j.request,images,j.id);atomic(path.join(dir,'submitted-workflow.json'),graph);
        j.status='submitting';j.submit_attempted=true;save(c,j);
        try{const response=await api(c,'/prompt',{method:'POST',body:{prompt:graph,client_id:j.id,extra_data:{comfy_direct_job_id:j.id}},timeout:30000});if(!response.prompt_id)throw Error('Missing prompt_id');j.prompt_id=response.prompt_id;}
        catch(e){if(e.http_status&&e.http_status<500){j.status='failed';j.error=e.message;return;}j.prompt_id=await recoverSubmission(c,j).catch(()=>null);if(!j.prompt_id){j.status='submission_unknown';j.error=e.message;return;}}
        j.submitted_at=new Date().toISOString();save(c,j);
      }
    }
    if(typeof WebSocket!=='undefined'){
      try{const url=new URL(c.endpoint+'/ws');url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('clientId',j.id);socket=new WebSocket(url);socket.addEventListener('error',()=>{});socket.addEventListener('message',event=>{try{if(typeof event.data!=='string')return;const e=JSON.parse(event.data),d=e.data;if(d?.prompt_id!==j.prompt_id)return;if(['progress','executing','execution_error'].includes(e.type)){j.progress={event:e.type,node:d.node,value:d.value,max:d.max,at:new Date().toISOString()};save(c,j);}}catch{}});}catch{}
    }
    const deadline=Date.now()+c.timeout_seconds*1000;let missingSince=null;
    while(Date.now()<deadline){
      try{
        const history=await api(c,'/history/'+encodeURIComponent(j.prompt_id));const h=history[j.prompt_id];
        if(h){
          const videos=historyVideos(h);atomic(path.join(dir,'comfy-history.json'),h);
          const failed=h.status?.status_str==='error'||h.status?.messages?.some(m=>m[0]==='execution_error');
          if(videos.length)await download(c,j,videos);
          if(failed){j.status=videos.length?'partial_failed':'failed';j.error=JSON.stringify(h.status).slice(0,12000);return;}
          if(!videos.some(v=>v.role==='original')||j.request.upscale&&!videos.some(v=>v.role==='hd')){j.status='failed';j.error='Completed history lacks expected video output(s)';return;}
          j.status='completed';return;
        }
        const queue=await api(c,'/queue');const running=(queue.queue_running??[]).some(e=>e[1]===j.prompt_id),queued=(queue.queue_pending??[]).some(e=>e[1]===j.prompt_id);
        j.status=running?'running':queued?'queued':'locating';j.last_connection_error=null;
        if(!running&&!queued){missingSince??=Date.now();if(Date.now()-missingSince>60000){j.status='remote_missing';j.error='Task is absent from queue and history, possibly after a server restart. No regeneration was submitted.';return;}}else missingSince=null;
        save(c,j);
      }catch(e){j.status='reconnecting';j.last_connection_error=e.message;save(c,j);}
      await sleep(c.poll_ms);
    }j.status='paused_timeout';j.error='Monitoring timeout; task was not cancelled. Resume monitoring by job ID.';
  }catch(e){j.status=j.status==='downloading'?'download_failed':'failed';j.error=e.message;}
  finally{clearInterval(heartbeat);socket?.close();j.worker_pid=null;save(c,j);const db=stateDB(c);try{db.prepare('DELETE FROM workers WHERE job_id=? AND token=?').run(id,token);}finally{db.close();}}
}
