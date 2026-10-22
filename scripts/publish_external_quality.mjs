// Trusted public-repository publisher. Observation bytes are data, never code.
// Only the --publish entry point receives a short-lived GitHub contents token.
import {readFile,lstat,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonical,sha256,githubContext,validateObservationReport,validStamp,SCHEDULE,VERSION,SERIES,ContractError} from './observe_external_quality.mjs';

export const REPOSITORY='dregon03/sotw-status';
export const REPOSITORY_ID=1415634723;
export const WORKFLOW_ID=382172461;
export const DEFAULT_BRANCH='main';
export const WORKFLOW_PATH='.github/workflows/external-quality.yml';
export const OBSERVER_SHA256='921849eedfa40c4bdacac5c9cd798bdc0299e2b4d1f939729f722e44c5b89576';
export const MAX_REPORT_BYTES=64*1024;
export const MAX_MANIFEST_BYTES=4096;
export const MAX_API_BYTES=2*1024*1024;
const hash=/^[a-f0-9]{64}$/,gitSha=/^[a-f0-9]{40}$/,digits=/^[1-9]\d{0,18}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const demand=(v,code)=>{if(!v)throw new ContractError(code);};
const exactKeys=(v,allowed,code)=>demand(obj(v)&&Object.keys(v).every(k=>allowed.includes(k)),code);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const readJson=(bytes,max,code)=>{demand(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=max,code+'_size');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ContractError(code+'_json');}};
export function decodeOutput(value,max){
 demand(typeof value==='string'&&value.length>0&&value.length<=Math.ceil(max/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'invalid_output_encoding');
 const bytes=Buffer.from(value,'base64');demand(bytes.length<=max&&bytes.toString('base64')===value,'invalid_output_encoding');return bytes;
}

export function trustedContext(env){
 const c=githubContext(env);
 demand(c.repository===REPOSITORY&&env.GITHUB_REPOSITORY_ID===String(REPOSITORY_ID)&&c.ref==='refs/heads/'+DEFAULT_BRANCH&&env.GITHUB_WORKFLOW_REF===REPOSITORY+'/'+WORKFLOW_PATH+'@refs/heads/'+DEFAULT_BRANCH&&env.GITHUB_WORKFLOW_SHA===c.commit,'unapproved_workflow_identity');
 demand(c.event!=='schedule'||c.schedule===SCHEDULE&&validStamp(c.activation_at),'schedule_policy_required');
 return c;
}
export function policyAllowed(env,now=Date.now()){
 const c=trustedContext(env);demand(Number.isFinite(now),'invalid_policy_clock');
 return c.event==='workflow_dispatch'||env.SOTW_EXTERNAL_ENABLED==='true'&&now>=Date.parse(c.activation_at);
}

function validateClosedReport(r){
 exactKeys(r,['schema_version','processing_version','scope','context','started_at','finished_at','observation_bucket_start','bucket_policy','request_budget','per_request_timeout_ms','max_response_bytes','observations','counts','state','notice','attempt_id','observer_script_sha256','in_progress'],'unreviewed_report_field');
 exactKeys(r.context,['vantage','repository','run_id','run_attempt','commit','ref','event','run_url','runner_os','runner_image','runner_image_version','runner_geography','schedule','activation_at'],'unreviewed_context_field');
 exactKeys(r.bucket_policy,['seconds','offset_seconds','scheduled_time','scheduled_time_precision','scheduled_coverage_eligible','assignment'],'unreviewed_bucket_field');
 exactKeys(r.counts,['planned','attempted','completed','successful','failed','observer_clock_failures','unobserved','valid_missing_or_empty'],'unreviewed_count_field');
 for(const row of [...r.observations,...(r.in_progress?[r.in_progress]:[])]){
  exactKeys(row,['endpoint','method','url','started_at','finished_at','latency_ms','latency_basis','http_status','response_bytes','response_sha256','success','outcome','error_class','semantic'],'unreviewed_probe_field');
  if(row.started_at!==null){
   demand(validStamp(row.started_at)&&(r.finished_at===null||Date.parse(row.started_at)<=Date.parse(r.finished_at)),'probe_outside_report_clock');
   if(row.finished_at!==null)demand(validStamp(row.finished_at)&&(r.finished_at===null||Date.parse(row.finished_at)<=Date.parse(r.finished_at))&&(row.error_class==='observer_clock'||Date.parse(row.finished_at)>=Date.parse(row.started_at)),'probe_outside_report_clock');
  }
  demand(row.success?row.error_class===null&&row.semantic!==null:row.semantic===null,'probe_outcome_semantics');
  if(row.semantic===null)continue;
  const s=row.semantic;
  if(row.endpoint==='data_status'){
   exactKeys(s,['classification','definitions','observed_pairs','missing_values','unreliable_pairs','older_pairs','optional_operating_tracker','optional_release_tracker','core_definition_generation_sha256','publisher_release_latency_measured'],'unreviewed_status_field');
   demand(['definitions','observed_pairs','missing_values','unreliable_pairs','older_pairs'].every(k=>integer(s[k]))&&s.definitions>0&&s.definitions<=5000&&s.missing_values+s.unreliable_pairs<=s.observed_pairs&&s.older_pairs<=s.observed_pairs&&s.classification===(s.observed_pairs===0?'valid_empty':'valid_data')&&hash.test(s.core_definition_generation_sha256)&&s.publisher_release_latency_measured===false&&['not_started','measuring','unavailable'].includes(s.optional_operating_tracker)&&['not_started','observing','source_not_public','unavailable'].includes(s.optional_release_tracker),'unreviewed_status_semantics');
  }else{
   exactKeys(s,['classification','observations','missing_values','withheld_unreliable','zero_values','series_id','unit','definition_sha256','generation','evidence_ids','source_observation_sha256','source_hash_basis','source_capture_hashes','recorded_pin'],'unreviewed_macro_field');
   demand(s.series_id===SERIES&&s.unit==='% y/y'&&uuid.test(s.generation)&&hash.test(s.definition_sha256)&&hash.test(s.source_observation_sha256)&&['observations','missing_values','withheld_unreliable','zero_values'].every(k=>integer(s[k]))&&s.observations<=500&&s.missing_values+s.withheld_unreliable+s.zero_values<=s.observations&&s.classification===(s.observations===0?'valid_empty':s.missing_values===s.observations?'valid_missing':'valid_data')&&Array.isArray(s.evidence_ids)&&s.evidence_ids.length<=s.observations&&s.evidence_ids.every(v=>hash.test(v))&&(s.observations===0?s.evidence_ids.length===0:s.evidence_ids.length>0)&&Array.isArray(s.source_capture_hashes)&&s.source_capture_hashes.length>0&&s.source_capture_hashes.length<=32,'unreviewed_macro_semantics');
   for(const c of s.source_capture_hashes){exactKeys(c,['payload_sha256','capture_envelope_sha256'],'unreviewed_capture_field');demand(hash.test(c.payload_sha256)&&hash.test(c.capture_envelope_sha256),'invalid_capture_hash');}
   demand(row.endpoint==='macro_latest'?s.recorded_pin===undefined:obj(s.recorded_pin),'recording_pin_presence');
   if(s.recorded_pin){
    const p=s.recorded_pin;exactKeys(p,['coverage_start','as_of','revision','publication_generation','source_availability','commit_availability','baseline_origin'],'unreviewed_pin_field');
    const micros=v=>BigInt(Date.parse(v.slice(0,19)+'Z'))*1000n+BigInt((v.match(/\.(\d{1,6})Z$/)?.[1]??'').padEnd(6,'0'));
    demand(validStamp(p.coverage_start)&&validStamp(p.as_of)&&micros(p.as_of)>=micros(p.coverage_start)&&digits.test(p.revision)&&BigInt(p.revision)<=9223372036854775807n&&p.publication_generation===s.generation&&p.source_availability==='not_established'&&p.commit_availability==='not_established'&&['activation_baseline','first_qualified_publication'].includes(p.baseline_origin),'invalid_recording_semantics');
    if(row.endpoint==='macro_replay'){const u=new URL(row.url);demand(u.searchParams.get('as_of')===p.as_of&&u.searchParams.get('revision')===p.revision,'replay_pin_semantics');}
   }
  }
 }
 const recorded=r.observations.find(v=>v.endpoint==='macro_recorded'),replay=r.observations.find(v=>v.endpoint==='macro_replay');
 if(replay?.success)demand(recorded?.success&&['generation','definition_sha256','source_observation_sha256'].every(k=>recorded.semantic[k]===replay.semantic[k])&&canonical(recorded.semantic.recorded_pin)===canonical(replay.semantic.recorded_pin),'replay_report_cohort');
 // No arbitrary nested extras, control characters, raw response bodies or values.
 const walk=(v,depth=0)=>{demand(depth<=15,'report_depth');if(typeof v==='string')demand(v.length<=1000&&!/[\x00-\x1f\x7f]/.test(v),'report_string');else if(Array.isArray(v))v.forEach(x=>walk(x,depth+1));else if(obj(v))for(const[k,x]of Object.entries(v)){demand(!['__proto__','prototype','constructor'].includes(k),'report_unsafe_key');walk(x,depth+1);}};walk(r);
}

export function validateEnvelope(reportBytes,manifestBytes,context){
 const report=readJson(reportBytes,MAX_REPORT_BYTES,'report'),manifest=readJson(manifestBytes,MAX_MANIFEST_BYTES,'manifest');
 validateObservationReport(report);validateClosedReport(report);
 demand(report.observer_script_sha256===OBSERVER_SHA256&&report.context.vantage==='github-hosted','unapproved_observer');
 for(const k of ['repository','run_id','run_attempt','commit','ref','event','run_url','schedule','activation_at'])demand(report.context[k]===context[k],'report_context_mismatch');
 demand(report.attempt_id===sha256(canonical({version:VERSION,repository:context.repository,run_id:context.run_id,run_attempt:context.run_attempt,started_at:report.started_at})),'attempt_identity_mismatch');
 const eligible=context.event==='schedule'&&context.schedule===SCHEDULE&&context.run_attempt==='1'&&validStamp(context.activation_at)&&report.observation_bucket_start>=context.activation_at;
 demand(report.bucket_policy.scheduled_coverage_eligible===eligible,'scheduled_eligibility_mismatch');
 exactKeys(manifest,['schema_version','processing_version','files','attempt_id','github_run_url','observer_script_sha256'],'unreviewed_manifest_field');
 demand(manifest.schema_version===1&&manifest.processing_version===VERSION&&manifest.attempt_id===report.attempt_id&&manifest.github_run_url===context.run_url&&manifest.observer_script_sha256===OBSERVER_SHA256&&Array.isArray(manifest.files)&&manifest.files.length===1,'manifest_identity');
 const f=manifest.files[0];exactKeys(f,['path','sha256','byte_count'],'unreviewed_manifest_member');
 demand(f.path==='observation.json'&&f.sha256===sha256(reportBytes)&&f.byte_count===reportBytes.length,'manifest_report_mismatch');
 return {report,manifest};
}

export function validateGitHubIdentity(repo,workflow,run,context){
 demand(repo.id===REPOSITORY_ID&&repo.full_name===REPOSITORY&&repo.private===false&&repo.fork===false&&repo.default_branch===DEFAULT_BRANCH,'repository_identity');
 demand(workflow.id===WORKFLOW_ID&&workflow.path===WORKFLOW_PATH&&workflow.state==='active','workflow_identity');
 demand(String(run.id)===context.run_id&&String(run.run_attempt)===context.run_attempt&&run.workflow_id===WORKFLOW_ID&&run.path===WORKFLOW_PATH&&run.event===context.event&&run.head_sha===context.commit&&run.head_branch===DEFAULT_BRANCH&&run.repository?.id===REPOSITORY_ID&&run.repository?.full_name===REPOSITORY&&run.head_repository?.id===REPOSITORY_ID&&run.head_repository?.full_name===REPOSITORY&&['in_progress','completed'].includes(run.status),'github_run_identity');
 demand(validStamp(run.run_started_at)&&validStamp(run.created_at),'github_run_clock');
}

export async function publishReport({reportBytes,manifestBytes,context,api,codeHashes,now=()=>new Date().toISOString()}){
 demand(context?.vantage==='github-hosted'&&context.repository===REPOSITORY&&context.ref==='refs/heads/'+DEFAULT_BRANCH&&digits.test(context.run_id)&&/^[1-9]\d{0,4}$/.test(context.run_attempt)&&gitSha.test(context.commit)&&['schedule','workflow_dispatch'].includes(context.event),'unsafe_publication_context');
 const {report}=validateEnvelope(reportBytes,manifestBytes,context);
 demand(obj(codeHashes)&&Object.keys(codeHashes).length===4&&['observer','publisher','workflow','package_manifest'].every(k=>hash.test(codeHashes[k]))&&codeHashes.observer===OBSERVER_SHA256,'publisher_code_pins');
 const base='/repos/'+REPOSITORY;
 const repo=await api('GET',base),workflow=await api('GET',base+'/actions/workflows/'+WORKFLOW_ID),run=await api('GET',base+'/actions/runs/'+context.run_id+'/attempts/'+context.run_attempt);
 validateGitHubIdentity(repo,workflow,run,context);
 demand(Date.parse(report.started_at)>=Date.parse(run.run_started_at)&&Date.parse(report.started_at)<=Date.parse(now())&&(report.finished_at===null||Date.parse(report.finished_at)<=Date.parse(now())),'report_outside_run_clock');
 for(const row of [...report.observations,...(report.in_progress?[report.in_progress]:[])])for(const k of ['started_at','finished_at'])if(row[k]!==null)demand(Date.parse(row[k])<=Date.parse(now()),'probe_outside_publication_clock');
 const prefix='public-results/runs/'+context.run_id+'/'+context.run_attempt;
 demand(digits.test(context.run_id)&&/^[1-9]\d{0,4}$/.test(context.run_attempt)&&gitSha.test(context.commit),'unsafe_publication_path');
 const ref=await api('GET',base+'/git/ref/heads/'+DEFAULT_BRANCH);
 demand(ref.ref==='refs/heads/'+DEFAULT_BRANCH&&ref.object?.type==='commit'&&gitSha.test(ref.object.sha),'invalid_default_ref');
 const parent=ref.object.sha;
 const existing=await api('GET',base+'/contents/'+prefix+'?ref='+parent,{allow404:true});
 demand(existing===null,'attempt_already_published');
 // Also reject partial paths that the contents endpoint unexpectedly classifies.
 const commit=await api('GET',base+'/git/commits/'+parent);
 demand(commit.sha===parent&&gitSha.test(commit.tree?.sha),'invalid_parent_commit');
 const publishedAt=now();demand(validStamp(publishedAt),'invalid_publication_clock');
 const publicationBytes=Buffer.from(JSON.stringify({schema_version:1,storage:'public-git-commit-v1',repository:REPOSITORY,repository_id:REPOSITORY_ID,workflow_id:WORKFLOW_ID,workflow_path:WORKFLOW_PATH,source_commit:context.commit,source_ref:context.ref,run_id:context.run_id,run_attempt:context.run_attempt,event:context.event,run_url:context.run_url,attempt_id:report.attempt_id,published_at:publishedAt,code_sha256:codeHashes,files:[{path:'observation.json',sha256:sha256(reportBytes),byte_count:reportBytes.length},{path:'manifest.json',sha256:sha256(manifestBytes),byte_count:manifestBytes.length}],trust_notice:'Verify GitHub source run/attempt, source code pins and the atomic publication commit independently. These hashes are integrity evidence, not a substitute for provenance. No artifact archive is created.'},null,2)+'\n');
 demand(reportBytes.length+manifestBytes.length+publicationBytes.length<80*1024,'publication_byte_budget');
 const files=[['observation.json',reportBytes],['manifest.json',manifestBytes],['publication.json',publicationBytes]],tree=[];
 for(const [name,bytes] of files){
  const blob=await api('POST',base+'/git/blobs',{body:{content:bytes.toString('base64'),encoding:'base64'}});
  demand(gitSha.test(blob.sha),'invalid_blob_result');tree.push({path:prefix+'/'+name,mode:'100644',type:'blob',sha:blob.sha});
 }
 const createdTree=await api('POST',base+'/git/trees',{body:{base_tree:commit.tree.sha,tree}});demand(gitSha.test(createdTree.sha),'invalid_tree_result');
 const createdCommit=await api('POST',base+'/git/commits',{body:{message:'Record external semantic check '+context.run_id+'/'+context.run_attempt,tree:createdTree.sha,parents:[parent]}});demand(gitSha.test(createdCommit.sha),'invalid_commit_result');
 // A concurrent update refuses the non-fast-forward write. No retry, rebase,
 // deletion, force update or replacing any historical attempt is performed.
 const moved=await api('PATCH',base+'/git/refs/heads/'+DEFAULT_BRANCH,{body:{sha:createdCommit.sha,force:false}});
 demand(moved.ref==='refs/heads/'+DEFAULT_BRANCH&&moved.object?.sha===createdCommit.sha,'publication_ref_result');
 return {published:true,run_id:context.run_id,run_attempt:context.run_attempt,commit:createdCommit.sha,path:prefix,report_sha256:sha256(reportBytes),manifest_sha256:sha256(manifestBytes),publication_sha256:sha256(publicationBytes),byte_count:files.reduce((n,[,b])=>n+b.length,0),artifact_uploaded:false};
}

export function githubApi(token,{fetchImpl=fetch}={}){
 demand(typeof token==='string'&&token.length>0&&token.length<=2048,'publisher_token_required');
 let calls=0;
 return async(method,requestPath,{body,allow404=false}={})=>{
  const suffix=typeof requestPath==='string'&&requestPath.startsWith('/repos/'+REPOSITORY)?requestPath.slice(('/repos/'+REPOSITORY).length):null;
  const approved=suffix!==null&&(method==='GET'&&(suffix===''||suffix==='/actions/workflows/'+WORKFLOW_ID||/^\/actions\/runs\/[1-9]\d{0,18}\/attempts\/[1-9]\d{0,4}$/.test(suffix)||suffix==='/git/ref/heads/'+DEFAULT_BRANCH||/^\/contents\/public-results\/runs\/[1-9]\d{0,18}\/[1-9]\d{0,4}\?ref=[a-f0-9]{40}$/.test(suffix)||/^\/git\/commits\/[a-f0-9]{40}$/.test(suffix))||method==='POST'&&['/git/blobs','/git/trees','/git/commits'].includes(suffix)||method==='PATCH'&&suffix==='/git/refs/heads/'+DEFAULT_BRANCH);
  demand(++calls<=14&&approved,'unreviewed_github_request');
  demand(!allow404||method==='GET'&&suffix.startsWith('/contents/public-results/runs/'),'unreviewed_missing_path');
  demand(!requestPath.includes('#')&&!requestPath.includes('..')&&requestPath.length<=240,'unsafe_github_path');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'sotw-status-public-publisher'};
   if(method!=='GET')headers.Authorization='Bearer '+token;
   if(body!==undefined)headers['Content-Type']='application/json';
   const response=await fetchImpl('https://api.github.com'+requestPath,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',credentials:'omit',signal:controller.signal});
   if(response.status===404&&method==='GET'&&allow404){await response.body?.cancel();return null;}
   demand(response.status===(method==='POST'?201:200),'github_api_refused');
   const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.byteLength;demand(size<=MAX_API_BYTES,'github_api_body_budget');chunks.push(Buffer.from(chunk));}
   return readJson(Buffer.concat(chunks),MAX_API_BYTES,'github_api');
  }catch(error){if(error instanceof ContractError)throw error;throw new ContractError('github_api_transport');}finally{clearTimeout(timer);}
 };
}

async function pinnedCode(){
 const pairs=[['observer','scripts/observe_external_quality.mjs'],['publisher','scripts/publish_external_quality.mjs'],['workflow',WORKFLOW_PATH],['package_manifest','PACKAGE-MANIFEST.json']];
 const hashes={},bodies={};for(const[k,p]of pairs){bodies[k]=await readFile(p);hashes[k]=sha256(bodies[k]);}demand(hashes.observer===OBSERVER_SHA256,'observer_script_changed');
 const manifest=readJson(bodies.package_manifest,16*1024,'package_manifest');
 const expected=['.github/workflows/external-quality.yml','README.md','public-results/local-qualification.json','scripts/check-external-quality-observer.mjs','scripts/check-external-quality-publisher.mjs','scripts/observe_external_quality.mjs','scripts/publish_external_quality.mjs'];
 demand(manifest.schema_version===2&&manifest.file_count_excluding_manifest===expected.length&&manifest.scope==='static-reviewed-project-files-only; excludes PACKAGE-MANIFEST.json and public-results/runs/**'&&Array.isArray(manifest.files)&&manifest.files.length===expected.length&&manifest.files.map(f=>f.path).sort().join('|')===expected.sort().join('|'),'package_manifest_scope');
 for(const[k,p]of pairs.filter(([k])=>k!=='package_manifest')){const f=manifest.files.find(f=>f.path===p);demand(f.sha256===hashes[k]&&f.byte_count===bodies[k].length,'package_manifest_code_mismatch');}
 return hashes;
}
async function main(){
 const args=process.argv.slice(2),context=trustedContext(process.env);
 if(args.length===1&&args[0]==='--policy'){
  demand(process.env.GITHUB_JOB==='observe'&&process.env.GITHUB_OUTPUT,'policy_job_required');
  await appendFile(process.env.GITHUB_OUTPUT,'allowed='+String(policyAllowed(process.env))+'\n');return;
 }
 if(args.length===3&&args[0]==='--prepare'&&args[1]==='--input'){
  demand(process.env.GITHUB_JOB==='observe'&&process.env.GITHUB_OUTPUT,'prepare_job_required');
  demand(args[2]==='external-quality-artifacts','unapproved_input_directory');
  const directory=path.resolve(args[2]);const d=await lstat(directory);demand(d.isDirectory()&&!d.isSymbolicLink(),'unsafe_input_directory');
  const bytes=[];for(const name of ['observation.json','manifest.json']){const f=path.join(directory,name),s=await lstat(f);demand(s.isFile()&&!s.isSymbolicLink()&&s.size<=(name==='observation.json'?MAX_REPORT_BYTES:MAX_MANIFEST_BYTES),'unsafe_input_file');bytes.push(await readFile(f));}
  validateEnvelope(bytes[0],bytes[1],context);await pinnedCode();
  await appendFile(process.env.GITHUB_OUTPUT,'report='+bytes[0].toString('base64')+'\nmanifest='+bytes[1].toString('base64')+'\nsealed=true\n');return;
 }
 demand(args.length===1&&args[0]==='--publish'&&process.env.GITHUB_JOB==='publish','publish_job_required');
 const reportBytes=decodeOutput(process.env.SOTW_REPORT_BASE64,MAX_REPORT_BYTES),manifestBytes=decodeOutput(process.env.SOTW_MANIFEST_BASE64,MAX_MANIFEST_BYTES);
 validateEnvelope(reportBytes,manifestBytes,context);
 const result=await publishReport({reportBytes,manifestBytes,context,api:githubApi(process.env.SOTW_PUBLISH_TOKEN),codeHashes:await pinnedCode()});
 console.log(JSON.stringify(result));
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'Immutable public report: https://github.com/'+REPOSITORY+'/tree/'+result.commit+'/'+result.path+'\nReport SHA256: '+result.report_sha256+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({published:false,error_class:error instanceof ContractError?error.code:'publisher_setup',notice:'Publication was refused. Missing evidence remains unobserved; no overwrite or automatic retry is performed.'}));process.exitCode=1;});
