import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {ROOT,config,atomic} from './lib.mjs';

function option(name){const i=process.argv.indexOf(name);if(i<0)return null;if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error('Missing value for '+name);return process.argv[i+1];}
function portNumber(value){const p=Number(value);if(!Number.isInteger(p)||p<1||p>65535)throw Error('Port must be an integer from 1 to 65535');return p;}
export function parseSSH(text){
 const tokens=text.trim().split(/\s+/);if(tokens.shift()!=='ssh')throw Error('Paste ssh USER@HOST -p PORT, without a password');
 let user,host,port=22;
 while(tokens.length){const token=tokens.shift();if(token==='-p'){port=portNumber(tokens.shift());continue;}const m=token.match(/^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9.-]+)$/);if(!m||host)throw Error('Use a plain SSH user/host/port command; extra shell options are not executed');[,user,host]=m;}
 if(!host)throw Error('SSH host is missing');return {user,host,port};
}
export function availablePort(preferred=18190,allowFallback=true){
 return new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',e=>{if(allowFallback&&e.code==='EADDRINUSE')resolve(availablePort(0,false));else reject(Error('本地端口 '+preferred+' 无法使用；已有连接请先检查，否则重新 configure --local-port auto。'+e.message));});
  probe.listen(preferred,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});
 });
}
function remoteRoot(value){if(typeof value!=='string'||!value.startsWith('/')||/[\0\r\n]/.test(value)||value==='/'||value.split('/').includes('..'))throw Error('remote-root must be the absolute Linux ComfyUI directory');return value.replace(/\/$/,'');}
function save(c){const file=process.env.COMFY_DIRECT_CONFIG||path.join(ROOT,'data/config.json');atomic(file,{endpoint:c.endpoint,data_dir:c.data_dir,poll_ms:c.poll_ms,timeout_seconds:c.timeout_seconds,ssh:c.ssh,remote_root:c.remote_root,remote_port:c.remote_port});}
export async function configure(){
 const c=config();let ssh=option('--ssh-command');const endpoint=option('--endpoint'),local=option('--local-port');
 let root=option('--remote-root'),remote=option('--remote-port');
 if(process.argv.includes('--wizard')){
  const r=createInterface({input:process.stdin,output:process.stdout});
  try{
   ssh=await r.question('完整 SSH 命令（不含密码；回车保留已有配置）：');
   root=await r.question('服务器 ComfyUI 目录（回车保留，默认 /root/sj-tmp/video-demo/ComfyUI）：');
   remote=await r.question('服务器 ComfyUI 端口（回车保留，默认 8188）：');
  }finally{r.close();}
 }
 if(ssh&&endpoint)throw Error('Choose SSH or a direct endpoint, not both');
 if(ssh)c.ssh=parseSSH(ssh);
 if(endpoint){const u=new URL(endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid endpoint');c.endpoint=u.href.replace(/\/$/,'');delete c.ssh;}
 if(!c.ssh&&!endpoint&&!fs.existsSync(process.env.COMFY_DIRECT_CONFIG||path.join(ROOT,'data/config.json')))throw Error('Provide your own --ssh-command or --endpoint; no connection has been configured');
 c.remote_root=remoteRoot(root||c.remote_root||'/root/sj-tmp/video-demo/ComfyUI');
 c.remote_port=portNumber(remote||c.remote_port||8188);
 if(c.ssh&&(ssh||local||!fs.existsSync(process.env.COMFY_DIRECT_CONFIG||path.join(ROOT,'data/config.json')))){
  const requested=local==='auto'?0:local?portNumber(local):Number(new URL(c.endpoint).port)||18190;
  const chosen=await availablePort(requested,!local||local==='auto');
  c.endpoint='http://127.0.0.1:'+chosen;
 }
 save(c);return {configured:true,endpoint:c.endpoint,ssh:c.ssh??null,remote_root:c.remote_root,remote_port:c.remote_port,note:'The local forwarding port, remote ComfyUI port, and SSH port are separate. No connection or generation was started.'};
}
function quote(s){return "'"+s.replaceAll("'","'\\''")+"'";}
export function connectionPlan(c){
 if(!c.ssh)throw Error('Direct endpoint mode does not use SSH. Run check, or configure your own SSH connection.');
 const s=parseSSH(`ssh ${c.ssh.user}@${c.ssh.host} -p ${c.ssh.port}`);
 const local=new URL(c.endpoint);if(local.protocol!=='http:'||!['127.0.0.1','localhost'].includes(local.hostname)||local.pathname!=='/')throw Error('SSH requires an HTTP localhost endpoint without a path');
 const p=portNumber(local.port||80),r=portNumber(c.remote_port||8188),root=remoteRoot(c.remote_root||'/root/sj-tmp/video-demo/ComfyUI');
 const script='set -e\ncd -- '+quote(root)+'\ntest -f main.py && test -x .venv/bin/python || { echo "ComfyUI main.py or .venv/bin/python missing at configured remote_root" >&2; exit 1; }\nexec .venv/bin/python - '+r+" <<'COMFY_BOOTSTRAP'\n"+fs.readFileSync(path.join(ROOT,'remote-bootstrap.py'),'utf8')+'\nCOMFY_BOOTSTRAP\n';
 return {local_port:p,remote_port:r,remote_root:root,args:['-T','-o','StrictHostKeyChecking=ask','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-L',`127.0.0.1:${p}:127.0.0.1:${r}`,'-p',String(s.port),s.user+'@'+s.host,'bash','-s'],script};
}
export async function connect(){
 const c=config(),plan=connectionPlan(c);
 await availablePort(plan.local_port,false);
 const logfile=path.join(c.data_dir,'connection.log');console.log('连接日志：'+logfile);
 const child=spawn('ssh',plan.args,{stdio:['pipe','pipe','pipe']});
 const record=(stream,chunk)=>{stream.write(chunk);fs.appendFileSync(logfile,chunk,{mode:0o600});};
 child.stdout.on('data',chunk=>record(process.stdout,chunk));child.stderr.on('data',chunk=>record(process.stderr,chunk));
 child.stdin.on('error',()=>{});child.stdin.end(plan.script);
 child.on('error',e=>{record(process.stderr,Buffer.from(e.message+'\n'));process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;console.log('连接结束，退出码：'+(code??'unknown'));});
}
