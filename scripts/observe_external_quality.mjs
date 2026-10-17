// Standalone semantic regression observer for SOTW's public software. No npm
// dependencies, private imports, source-provider requests, credentials or writes
// to SOTW. Only fresh local CI artifact files are written.
import {createHash} from 'node:crypto';
import {mkdir,readdir,lstat,writeFile,readFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const VERSION='sotw-external-quality-v1';
export const ORIGIN='https://statisticsoftheworld.com';
export const SERIES='EUROSTAT.GDP.YOY.Q';
export const INTERVAL_SECONDS=7200;
export const OFFSET_SECONDS=17*60;
export const SCHEDULE='17 */2 * * *';
export const MAX_BYTES=2*1024*1024;
export const TIMEOUT_MS=8000;
export const PROBES=['macro_latest','data_status','macro_recorded','macro_replay'];
const hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export function canonical(v,depth=0){
 if(depth>40)throw new ContractError('nested_content_budget');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isFinite(v))throw new ContractError('nonfinite_content');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 if(obj(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
 throw new ContractError('unsupported_content');
}
export class ContractError extends Error{constructor(code){super(code);this.code=code;}}
const demand=(condition,code)=>{if(!condition)throw new ContractError(code);};
export function validDay(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
export function validStamp(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(v)&&validDay(v.slice(0,10))&&Number.isFinite(Date.parse(v));}
const validUtcStamp=v=>typeof v==='string'&&validStamp(v.endsWith('+00:00')?v.slice(0,-6)+'Z':v);
const stampMicros=v=>BigInt(Date.parse(v.slice(0,19)+'Z'))*1000n+BigInt((v.match(/\.(\d{1,6})Z$/)?.[1]??'').padEnd(6,'0'));
const revision=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const periodStart=v=>/^\d{4}-Q[1-4]$/.test(v)?v.slice(0,4)+'-'+String((Number(v.at(-1))-1)*3+1).padStart(2,'0')+'-01':null;

export function validateMacro(v,recorded=false){
 demand(obj(v)&&obj(v.series)&&Array.isArray(v.data)&&v.data.length<=500&&v.count===v.data.length&&v.truncated===false,'macro_envelope');
 const s=v.series,c=s.coverage;
 demand(s.id===SERIES&&s.source_id==='eurostat'&&s.freq==='Q'&&s.unit==='% y/y'&&s.format==='percent'&&s.redistribution_permitted===true&&typeof s.resale_permitted==='boolean'&&hash.test(s.definition_hash)&&uuid.test(s.generation)&&obj(s.definition)&&s.definition.unit===s.unit&&s.processing_version==='macro-expansion-v1','macro_identity');
 demand(validStamp(v.checked_at)&&validUtcStamp(s.published_at)&&obj(c)&&integer(c.observations)&&integer(c.geographies)&&c.geographies<=c.observations,'macro_coverage');
 demand(c.observations===0?(c.geographies===0&&c.earliest===null&&c.latest===null&&v.count===0):(c.geographies>0&&validDay(c.earliest)&&validDay(c.latest)&&c.earliest<=c.latest&&v.count>0&&v.count===c.geographies),'macro_latest_coverage');
 demand(Array.isArray(s.source_captures)&&s.source_captures.length>0&&s.source_captures.length<=32&&s.source_captures.every(r=>obj(r)&&typeof r.url==='string'&&r.url.startsWith('https://')&&typeof r.retrieved_at==='string'&&validStamp(r.retrieved_at.replace('+00:00','Z'))&&hash.test(r.sha256)&&hash.test(r.capture_sha256)),'macro_source_evidence');
 const seen=new Set(),evidence=new Set();let missing=0,withheld=0,zero=0;
 for(const r of v.data){
  demand(obj(r)&&typeof r.geo==='string'&&/^[A-Z0-9]{2,12}$/.test(r.geo)&&!seen.has(r.geo)&&typeof r.period==='string'&&periodStart(r.period)===r.period_start&&validDay(r.reference_period_end)&&(r.value===null||finite(r.value))&&(r.raw_value===null||finite(r.raw_value))&&(r.complete_status===null||typeof r.complete_status==='string')&&obj(r.source_attributes)&&hash.test(r.source_attributes._sotw_evidence)&&r.source_attributes._sotw_definition===s.definition_hash,'macro_reading');
  demand(['missing','unreliable','provisional','estimated','break','flagged','no-status-flag'].includes(r.quality)&&['older','within-window'].includes(r.freshness)&&integer(r.age_days)&&integer(r.freshness_limit_days)&&r.freshness_limit_days>0&&validStamp(r.checked_at),'macro_reading_screen');
  demand(r.freshness===(r.age_days<=r.freshness_limit_days?'within-window':'older'),'macro_reading_age');
  const flags=String(r.complete_status??'').toUpperCase(),quality=r.raw_value===null?'missing':flags.includes('U')?'unreliable':flags.includes('P')?'provisional':flags.includes('E')?'estimated':flags.includes('B')?'break':flags?'flagged':'no-status-flag';
  demand(r.quality===quality&&(r.quality==='missing'||r.quality==='unreliable'?r.value===null:r.value===r.raw_value),'macro_value_semantics');
  if(r.raw_value===null)missing++;if(r.quality==='unreliable')withheld++;if(r.value===0)zero++;
  seen.add(r.geo);evidence.add(r.source_attributes._sotw_evidence);
 }
 const state=v.recorded_state;
 if(recorded){
  demand(obj(state)&&state.schemaVersion===1&&state.processingVersion==='macro-journal-v1'&&validStamp(state.coverageStart)&&validStamp(state.asOf)&&stampMicros(state.asOf)>=stampMicros(state.coverageStart)&&revision(state.revision)&&state.readSemantics==='transaction_final_recording_time'&&state.readSnapshot==='statement_start_committed_frames'&&state.sourceAvailability==='not_established'&&state.commitAvailability==='not_established'&&state.publicationGeneration===s.generation,'macro_recording_pin');
  demand(obj(state.baselinePerSeries)&&['activation_baseline','first_qualified_publication'].includes(state.baselinePerSeries.origin)&&obj(state.currentRights)&&state.currentRights.redistributionPermitted===true&&typeof state.currentRights.resalePermitted==='boolean'&&(!s.resale_permitted||state.currentRights.resalePermitted),'macro_recording_rights');
  demand(v.data.every(r=>validStamp(r.recordedAt)&&revision(r.revision)),'macro_recording_rows');
  // A row recorded after the pin it is served under is not part of that recorded state,
  // even when a replay repeats it. Exact microseconds and i64 revisions; equality is inside.
  demand(v.data.every(r=>stampMicros(r.recordedAt)<=stampMicros(state.asOf)&&BigInt(r.revision)<=BigInt(state.revision)),'macro_recording_after_pin');
 }else demand(state===undefined,'unexpected_recording_pin');
 const sourceRows=v.data.map(r=>Object.fromEntries(['geo','period','period_start','value','raw_value','quality','complete_status','source_attributes'].map(k=>[k,r[k]]))).sort((a,b)=>a.geo.localeCompare(b.geo)||a.period.localeCompare(b.period));
 const sourceHash=sha256(canonical(sourceRows));
 return {classification:v.count===0?'valid_empty':missing===v.count?'valid_missing':'valid_data',observations:v.count,missing_values:missing,withheld_unreliable:withheld,zero_values:zero,series_id:SERIES,unit:s.unit,definition_sha256:s.definition_hash,generation:s.generation,evidence_ids:[...evidence].sort(),source_observation_sha256:sourceHash,source_hash_basis:'sorted source-observation-fields-v1; clock-derived reference age excluded',source_capture_hashes:s.source_captures.map(r=>({payload_sha256:r.sha256,capture_envelope_sha256:r.capture_sha256})),...(recorded?{recorded_pin:{coverage_start:state.coverageStart,as_of:state.asOf,revision:state.revision,publication_generation:state.publicationGeneration,source_availability:'not_established',commit_availability:'not_established',baseline_origin:state.baselinePerSeries.origin}}:{})};
}

export function validateStatus(v){
 demand(obj(v)&&v.schema_version===1&&v.scope==='reviewed-public-macro-definitions'&&v.summary_scope==='all-qualified-current-definitions'&&integer(v.definitions)&&v.definitions>0&&v.definitions<=5000&&Array.isArray(v.series)&&v.series.length===v.definitions&&validStamp(v.checked_at)&&validUtcStamp(v.snapshot_at)&&v.snapshot_cache_max_seconds===15,'status_envelope');
 for(const k of ['geography_series','country_series','aggregate_series','usable_within_window','older','unreliable','missing','individual_geographies','aggregates','matrix_rows'])demand(integer(v[k]),'status_counts');
 demand(v.country_series+v.aggregate_series===v.geography_series&&v.matrix_rows===v.geography_series&&v.usable_within_window<=v.geography_series&&v.older<=v.geography_series&&v.unreliable+v.missing<=v.geography_series,'status_count_semantics');
 const seen=new Set();for(const s of v.series){demand(obj(s)&&typeof s.id==='string'&&/^[A-Z][A-Z0-9._]{2,99}$/.test(s.id)&&!seen.has(s.id)&&typeof s.unit==='string'&&s.unit&&['A','Q','M'].includes(s.freq)&&uuid.test(s.generation)&&integer(s.geography_series)&&integer(s.country_series)&&integer(s.aggregate_series)&&s.country_series+s.aggregate_series===s.geography_series,'status_definition');seen.add(s.id);}
 demand(v.series.reduce((n,s)=>n+s.geography_series,0)===v.geography_series&&v.series.reduce((n,s)=>n+s.country_series,0)===v.country_series&&v.series.reduce((n,s)=>n+s.aggregate_series,0)===v.aggregate_series,'status_definition_totals');
 demand(obj(v.release_latency)&&v.release_latency.measured===false,'status_scope_disclosure');
 // Optional in-host operating/release trackers are not prerequisites for valid
 // core coverage, nor are their unverified percentages accepted as our evidence.
 const operating=['not_started','measuring','unavailable'].includes(v.operating_baseline?.state)?v.operating_baseline.state:'unavailable',release=['not_started','observing','source_not_public'].includes(v.release_acquisition?.state)?v.release_acquisition.state:'unavailable';
 return {classification:v.geography_series===0?'valid_empty':'valid_data',definitions:v.definitions,observed_pairs:v.geography_series,missing_values:v.missing,unreliable_pairs:v.unreliable,older_pairs:v.older,optional_operating_tracker:operating,optional_release_tracker:release,core_definition_generation_sha256:sha256(canonical(v.series.map(s=>({id:s.id,generation:s.generation,unit:s.unit,freq:s.freq})).sort((a,b)=>a.id.localeCompare(b.id)))),publisher_release_latency_measured:false};
}

export function probePath(id,pin=null){
 demand(PROBES.includes(id),'unreviewed_probe');if(id==='data_status')return '/api/v1/data-status';
 const q=new URLSearchParams({series:SERIES,latest:'1'});
 if(id==='macro_recorded'||id==='macro_replay')q.set('recorded','1');
 if(id==='macro_replay'){demand(obj(pin)&&validStamp(pin.as_of)&&revision(pin.revision),'invalid_replay_pin');q.set('as_of',pin.as_of);q.set('revision',pin.revision);}
 return '/api/v1/economic-data?'+q;
}
export function observationBucket(now){demand(finite(now),'invalid_observer_clock');return new Date((Math.floor((now/1000-OFFSET_SECONDS)/INTERVAL_SECONDS)*INTERVAL_SECONDS+OFFSET_SECONDS)*1000).toISOString();}
export function githubContext(env){
 demand(env.GITHUB_ACTIONS==='true'&&env.RUNNER_ENVIRONMENT==='github-hosted'&&env.GITHUB_SERVER_URL==='https://github.com'&&['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME),'github_hosted_context_required');
 demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY??'')&&/^[1-9]\d{0,18}$/.test(env.GITHUB_RUN_ID??'')&&/^[1-9]\d{0,4}$/.test(env.GITHUB_RUN_ATTEMPT??'')&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')&&/^refs\/heads\/[A-Za-z0-9_./-]+$/.test(env.GITHUB_REF??''),'github_identity');
 const activation=env.SOTW_EXTERNAL_POLICY_START||null;demand(activation===null||validStamp(activation),'invalid_activation_date');
 return {vantage:'github-hosted',repository:env.GITHUB_REPOSITORY,run_id:env.GITHUB_RUN_ID,run_attempt:env.GITHUB_RUN_ATTEMPT,commit:env.GITHUB_SHA,ref:env.GITHUB_REF,event:env.GITHUB_EVENT_NAME,run_url:'https://github.com/'+env.GITHUB_REPOSITORY+'/actions/runs/'+env.GITHUB_RUN_ID,runner_os:env.RUNNER_OS??'unknown',runner_image:env.ImageOS??'unknown',runner_image_version:env.ImageVersion??'unknown',runner_geography:'not_established',schedule:env.SOTW_EXTERNAL_EVENT_SCHEDULE||null,activation_at:activation};
}

async function bodyBytes(response){
 const length=response.headers.get('content-length');
 demand(length===null||/^\d+$/.test(length),'invalid_content_length');if(length!==null&&Number(length)>MAX_BYTES)throw new ContractError('oversize');
 demand(response.headers.get('content-type')?.toLowerCase().startsWith('application/json'),'invalid_content_type');
 demand(response.body&&typeof response.body.getReader==='function','missing_response_body');const reader=response.body.getReader(),parts=[];let n=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>MAX_BYTES)throw new ContractError('oversize');parts.push(Buffer.from(value));}return Buffer.concat(parts,n);}catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
}

export async function observeProbe(id,{fetchImpl=fetch,clock={wall:()=>Date.now(),mono:()=>performance.now()},pin=null,replayExpected=null,onStarted=async()=>{},timeoutMs=TIMEOUT_MS}={}){
 const requestPath=probePath(id,pin),started=clock.wall(),timer=clock.mono();demand(finite(started)&&finite(timer),'invalid_observer_clock');
 const record={endpoint:id,method:'GET',url:ORIGIN+requestPath,started_at:new Date(started).toISOString(),finished_at:null,latency_ms:null,latency_basis:'check_start_through_response_validation_including_checkpoint',http_status:null,response_bytes:0,response_sha256:null,success:false,outcome:'incomplete',error_class:null,semantic:null};await onStarted({...record});
 const controller=new AbortController();let deadline=false;const timeout=setTimeout(()=>{deadline=true;controller.abort();},timeoutMs);
 try{
  const response=await fetchImpl(record.url,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json','User-Agent':'SOTW-ExternalQuality/'+VERSION},signal:controller.signal});record.http_status=response.status;
  if(response.status!==200)throw new ContractError(response.status>=300&&response.status<400?'redirect':response.status===403?'rights_refusal':'http');
  const body=await bodyBytes(response);record.response_bytes=body.byteLength;record.response_sha256=sha256(body);let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new ContractError('invalid_json');}
  canonical(data);record.semantic=id==='data_status'?validateStatus(data):validateMacro(data,id!=='macro_latest');
  if(id==='macro_replay'){demand(data.recorded_state.asOf===pin.as_of&&data.recorded_state.revision===pin.revision,'replay_pin_mismatch');demand(record.semantic.source_observation_sha256===replayExpected?.source_observation_sha256&&record.semantic.definition_sha256===replayExpected?.definition_sha256&&record.semantic.generation===replayExpected?.generation,'replay_cohort_mismatch');}
  record.success=true;record.outcome='valid';
 }catch(error){record.success=false;record.outcome='failed';record.error_class=deadline?'timeout':error instanceof ContractError?error.code:'network';record.semantic=null;}
 finally{
  clearTimeout(timeout);const finished=clock.wall(),elapsed=clock.mono()-timer;record.finished_at=finite(finished)?new Date(finished).toISOString():null;record.latency_ms=finite(elapsed)&&elapsed>=0?Math.round(elapsed*1000)/1000:null;
  if(!finite(finished)||finished<started||record.latency_ms===null){record.success=false;record.outcome='failed';record.error_class='observer_clock';record.semantic=null;}
 }
 return record;
}

export function runCounts(records,inProgress=null){const complete=r=>validStamp(r.started_at)&&validStamp(r.finished_at)&&Date.parse(r.finished_at)>=Date.parse(r.started_at)&&finite(r.latency_ms)&&r.latency_ms>=0;return {planned:PROBES.length,attempted:records.filter(r=>r.started_at).length+(inProgress?.started_at?1:0),completed:records.filter(complete).length,successful:records.filter(r=>complete(r)&&r.success).length,failed:records.filter(r=>complete(r)&&r.outcome==='failed').length,observer_clock_failures:records.filter(r=>r.error_class==='observer_clock').length,unobserved:PROBES.length-records.filter(complete).length,valid_missing_or_empty:records.filter(r=>complete(r)&&r.success&&['valid_missing','valid_empty'].includes(r.semantic?.classification)).length};}
export async function observe({context,fetchImpl=fetch,clock={wall:()=>Date.now(),mono:()=>performance.now()},checkpoint=async()=>{}}){
 const started=clock.wall(),bucket=observationBucket(started);demand(obj(context)&&['github-hosted','local-fixture','local-qualification'].includes(context.vantage),'observer_context');
 const eligible=context.event==='schedule'&&context.schedule===SCHEDULE&&context.run_attempt==='1'&&validStamp(context.activation_at)&&bucket>=context.activation_at;
 const report={schema_version:1,processing_version:VERSION,scope:'SOTW public GDP latest/recorded replay and core coverage semantic checks only',context,started_at:new Date(started).toISOString(),finished_at:null,observation_bucket_start:bucket,bucket_policy:{seconds:INTERVAL_SECONDS,offset_seconds:OFFSET_SECONDS,scheduled_time:null,scheduled_time_precision:'not supplied by GitHub schedule event',scheduled_coverage_eligible:eligible,assignment:'actual first-attempt start bucket; never retrospectively assigned to an earlier intended slot'},request_budget:4,per_request_timeout_ms:TIMEOUT_MS,max_response_bytes:MAX_BYTES,observations:[],counts:runCounts([]),state:'started',notice:'One external vantage; valid missing values are not request failures. Absent or incomplete attempts remain unobserved. These sampled semantic checks do not establish platform uptime, publisher availability or a service guarantee.'};
 report.attempt_id=sha256(canonical({version:VERSION,repository:context.repository,run_id:context.run_id,run_attempt:context.run_attempt,started_at:report.started_at}));await checkpoint(report);
 let pin=null,expected=null;
 for(const id of PROBES){
  if(id==='macro_replay'&&!pin){report.observations.push({endpoint:id,method:'GET',url:null,started_at:null,finished_at:null,latency_ms:null,http_status:null,response_bytes:0,response_sha256:null,success:false,outcome:'unobserved',error_class:'valid_recording_pin_unavailable',semantic:null});report.counts=runCounts(report.observations);await checkpoint(report);continue;}
  const record=await observeProbe(id,{fetchImpl,clock,pin,replayExpected:expected,onStarted:async r=>{report.in_progress=r;report.counts=runCounts(report.observations,r);await checkpoint(report);}});delete report.in_progress;report.observations.push(record);
  if(id==='macro_recorded'&&record.success){pin=record.semantic.recorded_pin;expected=record.semantic;}report.counts=runCounts(report.observations);await checkpoint(report);
 }
 const finished=clock.wall();report.finished_at=finite(finished)?new Date(finished).toISOString():null;report.state=report.counts.successful===PROBES.length?'complete_valid':'complete_with_failures_or_gaps';report.counts=runCounts(report.observations);await checkpoint(report);return report;
}

export function validateObservationReport(r){
 demand(obj(r)&&r.schema_version===1&&r.processing_version===VERSION&&hash.test(r.attempt_id)&&obj(r.context)&&['github-hosted','local-fixture','local-qualification'].includes(r.context.vantage)&&validStamp(r.started_at)&&(r.finished_at===null||validStamp(r.finished_at)&&Date.parse(r.finished_at)>=Date.parse(r.started_at))&&r.request_budget===4&&r.max_response_bytes===MAX_BYTES&&r.per_request_timeout_ms===TIMEOUT_MS&&r.observation_bucket_start===observationBucket(Date.parse(r.started_at))&&obj(r.bucket_policy)&&r.bucket_policy.seconds===INTERVAL_SECONDS&&r.bucket_policy.offset_seconds===OFFSET_SECONDS&&r.bucket_policy.scheduled_time===null&&typeof r.bucket_policy.scheduled_coverage_eligible==='boolean'&&['started','complete_valid','complete_with_failures_or_gaps'].includes(r.state)&&Array.isArray(r.observations)&&r.observations.length<=4,'invalid_artifact_report');
 const seen=new Set();for(const row of r.observations){
  demand(obj(row)&&PROBES.includes(row.endpoint)&&!seen.has(row.endpoint)&&row.method==='GET'&&typeof row.success==='boolean'&&['valid','failed','unobserved'].includes(row.outcome)&&(row.http_status===null||Number.isInteger(row.http_status)&&row.http_status>=100&&row.http_status<=599)&&integer(row.response_bytes)&&row.response_bytes<=MAX_BYTES&&(row.response_sha256===null||hash.test(row.response_sha256)),'invalid_artifact_probe');seen.add(row.endpoint);
  if(row.outcome==='unobserved')demand(row.endpoint==='macro_replay'&&row.started_at===null&&row.finished_at===null&&row.url===null&&row.success===false,'fabricated_unobserved_result');
  else{
   demand(validStamp(row.started_at)&&(row.finished_at===null||validStamp(row.finished_at))&&Date.parse(row.started_at)>=Date.parse(r.started_at)&&typeof row.url==='string'&&row.url.startsWith(ORIGIN+'/api/v1/'),'invalid_artifact_probe_clock');
   const u=new URL(row.url);demand(u.origin===ORIGIN&&!u.username&&!u.password&&!u.hash,'invalid_artifact_url');
   const pin=row.endpoint==='macro_replay'?{as_of:u.searchParams.get('as_of'),revision:u.searchParams.get('revision')}:null;demand(row.url===ORIGIN+probePath(row.endpoint,pin),'unreviewed_artifact_url');
  }
  if(row.success)demand(row.outcome==='valid'&&row.http_status===200&&row.response_bytes>0&&hash.test(row.response_sha256)&&obj(row.semantic)&&['valid_data','valid_missing','valid_empty'].includes(row.semantic.classification),'fabricated_probe_success');
 }
 if(r.in_progress)demand(r.state==='started'&&obj(r.in_progress)&&PROBES.includes(r.in_progress.endpoint)&&!seen.has(r.in_progress.endpoint)&&validStamp(r.in_progress.started_at)&&r.in_progress.finished_at===null&&r.in_progress.outcome==='incomplete'&&r.in_progress.success===false,'fabricated_incomplete_reservation');
 demand(canonical(r.counts)===canonical(runCounts(r.observations,r.in_progress)),'artifact_counts_mismatch');
 if(r.state==='complete_valid')demand(r.counts.successful===4&&r.finished_at!==null,'fabricated_complete_success');
 return r;
}

/** Prospective bucket coverage only; accepted artifacts retain failed attempts.
 * Trust/provenance verification belongs to the root's GitHub artifact importer.
 * A rerun/manual result cannot replace or fill an original scheduled bucket. */
export function summarizeBuckets(reports,{activationAt,windowEnd,maxBuckets=4000}){
 demand(validStamp(activationAt)&&validStamp(windowEnd)&&activationAt<=windowEnd,'invalid_observation_window');const start=Date.parse(activationAt),end=Date.parse(windowEnd),first=Date.parse(observationBucket(start)),last=Date.parse(observationBucket(end));
 demand((last-first)/1000/INTERVAL_SECONDS<=maxBuckets,'observation_window_budget');
 const byBucket=new Map();for(const r of reports){validateObservationReport(r);if(r.bucket_policy.scheduled_coverage_eligible!==true||r.context.vantage!=='github-hosted'||r.context.event!=='schedule'||r.context.schedule!==SCHEDULE||r.context.run_attempt!=='1'||r.context.activation_at!==activationAt)continue;if(!byBucket.has(r.observation_bucket_start))byBucket.set(r.observation_bucket_start,[]);byBucket.get(r.observation_bucket_start).push(r);}
 const slots=[];for(let t=first;t<last;t+=INTERVAL_SECONDS*1000){if(t<start)continue;const key=new Date(t).toISOString(),records=byBucket.get(key)??[];let state='unobserved';if(records.length>1)state='ambiguous_duplicate';else if(records.length===1){const r=records[0],counts=runCounts((r.observations??[]).filter(o=>o.finished_at&&Date.parse(o.finished_at)<=end));state=counts.completed<PROBES.length?'incomplete':counts.failed?'observed_failure':counts.successful===PROBES.length?'observed_valid':'incomplete';}slots.push({bucket_start:key,state});}
 return {activation_at:activationAt,window_end:windowEnd,bucket_seconds:INTERVAL_SECONDS,expected_completed_buckets:slots.length,observed_valid_buckets:slots.filter(s=>s.state==='observed_valid').length,observed_failed_buckets:slots.filter(s=>s.state==='observed_failure').length,incomplete_buckets:slots.filter(s=>s.state==='incomplete').length,ambiguous_duplicate_buckets:slots.filter(s=>s.state==='ambiguous_duplicate').length,unobserved_buckets:slots.filter(s=>s.state==='unobserved').length,buckets:slots,uptime_percentage:null,notice:'Actual observation buckets with missing coverage disclosed; this is not continuous uptime or proof that every GitHub schedule fired.'};
}

async function main(){
 const args=process.argv.slice(2);demand(args.length===3&&args[0]==='--run'&&args[1]==='--output','usage_run_output');const context=githubContext(process.env),out=path.resolve(args[2]);
 try{const stat=await lstat(out);demand(stat.isDirectory()&&!stat.isSymbolicLink()&&(await readdir(out)).length===0,'artifact_directory_not_empty');}catch(error){if(error.code==='ENOENT')await mkdir(out,{recursive:true,mode:0o700});else throw error;}
 const scriptSha=sha256(await readFile(fileURLToPath(import.meta.url)));const checkpoint=async r=>{
  const body=Buffer.from(JSON.stringify({...r,observer_script_sha256:scriptSha},null,2)+'\n');
  const manifest=JSON.stringify({schema_version:1,processing_version:VERSION,files:[{path:'observation.json',sha256:sha256(body),byte_count:body.byteLength}],attempt_id:r.attempt_id,github_run_url:context.run_url,observer_script_sha256:scriptSha},null,2)+'\n';
  await writeFile(path.join(out,'observation.tmp'),body,{mode:0o600});await rename(path.join(out,'observation.tmp'),path.join(out,'observation.json'));
  await writeFile(path.join(out,'manifest.tmp'),manifest,{mode:0o600});await rename(path.join(out,'manifest.tmp'),path.join(out,'manifest.json'));
 };
 const report=await observe({context,checkpoint});
 console.log(JSON.stringify({state:report.state,counts:report.counts,attempt_id:report.attempt_id,response_bodies_saved:false,secrets_required:false,notice:'Outside-host sampled semantic observations only; no uptime claim.'}));if(report.counts.successful!==PROBES.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({state:'observer_failed',notice:'Observer setup failed. No private credential, raw body or unsanitized error text is emitted; missing artifacts are unobserved.'}));process.exitCode=1;});
