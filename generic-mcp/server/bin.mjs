#!/usr/bin/env node
import fs from 'node:fs';
import {configure,connect} from './connection.mjs';
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
 return {id:j.id,kind:j.kind,status:j.status,prompt_id:j.prompt_id,request_key:j.request_key,submit_attempted:j.submit_attempted,created_at:j.created_at,updated_at:j.updated_at,submitted_at:j.submitted_at,progress:j.progress,outputs:j.outputs,uploaded_images:j.uploaded_images,parameters:r?{duration:r.duration,megapixels:r.megapixels,steps:r.steps,seed:r.seed,turbo:r.turbo,upscale:r.upscale,aspect_ratio:r.aspect_ratio}:undefined,error:typeof j.error==='string'?j.error.slice(0,2000):j.error?{gpu_available:j.error.gpu_available,missing_nodes:j.error.missing_nodes,unavailable_inputs:j.error.unavailable_inputs,generation_ready:j.error.generation_ready}:undefined,last_connection_error:j.last_connection_error};
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
   if(r.method==='initialize')result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(r.params?.protocolVersion)?r.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'comfy-direct',version:'0.1.3'},instructions:'Use request_key to prevent duplicate generation. Poll jobs by ID. Return absolute MP4 paths inline to the user. Existing-video retrieval must be labeled accurately. Never infer GPU success from CPU/mock checks.'};
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
async function main(){
 const command=process.argv[2];if(command==='mcp'){mcp();return;}if(command==='connect'){await connect();return;}
 const c=config();let result;
 if(command==='worker'){await worker(c,process.argv[3]);return;}
 if(command==='configure')result=await configure();
 else if(command==='check')result=await check(c,!process.argv.includes('--original-only'));
 else if(command==='list')result={jobs:list(c)};
 else if(command==='get')result=get(c,process.argv[3]);
 else if(command==='resume')result=resume(c,process.argv[3]);
 else if(command==='submit'||command==='retrieve'){
  const file=option('--request');if(!file)throw Error('--request JSON_FILE is required');const input=JSON.parse(fs.readFileSync(file,'utf8'));result=command==='submit'?create(c,input):retrieve(c,input);
 }else if(command==='build'){
  const input=JSON.parse(fs.readFileSync(option('--request'),'utf8'));const r=normalize(input);result=buildGraph(r,r.references.map((x,i)=>'reference-'+i+x.ext),'dry-run');
 }else throw Error('Commands: configure --wizard | --ssh-command COMMAND --remote-root PATH --remote-port PORT --local-port auto | --endpoint URL; connect; mcp; check; submit --request file.json; retrieve --request file.json; get JOB_ID; list; resume JOB_ID; build --request file.json');
 if(command==='configure'&&process.argv.includes('--wizard'))console.log('连接信息已保存。客户端请添加 mcp-client.json 中的配置。');
 else console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
