import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyError,getApiKeys,KeyCooldown} from '../lib/api-keys.js';
import {assertCompleteScenes,buildAttemptChain,runAttemptChain} from '../lib/model-fallback.js';
import {generateSceneBatches} from '../src/utils/sceneBatches.js';
const options={autoFallback:true,hasGemini:true,hasOpenRouter:true};
const [argon,flash,lite]=['gemini-4-argon','gemini-3.8-flash','gemini-3.5-flash-lite'];
test('pools include base, lists and final numbered variable',()=>{
 assert.deepEqual(getApiKeys('gemini',{GEMINI_API_KEY:'a,b',GEMINI_API_KEY_1:' b;c\nd',GEMINI_API_KEY_20:'z'}),['a','b','c','d','z']);
});
test('key, model and fatal errors have distinct actions',()=>{
 for(const message of ['API key not valid','API_KEY_INVALID','fetch failed','RESOURCE_EXHAUSTED']) assert.equal(classifyError(new Error(message)),'key');
 for(const code of ['ETIMEDOUT','FAILED_PRECONDITION','AbortError']) assert.equal(classifyError({code}),'model');
 assert.equal(classifyError({status:400}),'fatal');
 assert.equal(classifyError({budgetExhausted:true,status:429}),'fatal');
});
test('scope and global cooldown durations never shrink',()=>{
 let clock=0;const cooldown=new KeyCooldown(()=>clock); const keys=['a','b'];
 cooldown.record('a','one',{status:429}); cooldown.record('a','one',{status:500});
 clock=16000;
 assert.deepEqual(cooldown.order(keys,'one'),[1,0]);assert.deepEqual(cooldown.order(keys,'two'),[0,1]);
 cooldown.record('a','one',{status:401});cooldown.record('a','two',{status:500});
 clock=61000;assert.deepEqual(cooldown.order(keys,'two'),[1,0]);
});
test('all starting models and provider preferences',()=>{
 for(const requested of [argon,flash,lite,'google/'+flash,'openrouter/free']){
 const direct=[...new Set([...(requested==='openrouter/free'?[]:[requested.replace('google/','')]),flash,lite,argon])];
 const router=[...new Set([...(requested.includes('/')?[requested]:[]),...direct.map(id=>'google/'+id),'openrouter/free'])];
 const chain=buildAttemptChain(requested,options);
 assert.deepEqual(chain.map(x=>x.model),requested.includes('/')?[...router,...direct]:[...direct,...router]);
 assert.deepEqual(buildAttemptChain(requested,{...options,autoFallback:false}),chain.slice(0,1));
 }
});
test('deadline retains last failure',async()=>{
 let time=0;let calls=0;
 await assert.rejects(runAttemptChain(buildAttemptChain(argon,options),async()=>{calls++;time=11;throw Object.assign(new Error('last'),{status:429});},{now:()=>time,budgetMs:10}),/last/);
 assert.equal(calls,1);
});
test('scene validation checks identity, count, suitability and description',()=>{
 const input=[{scene_id:5}];const scene={scene_id:'5',narrative_description:'Walks.'};
 const data={suitability:{},scenes:[scene]};assertCompleteScenes(data,input);assert.equal(scene.scene_id,5);
 for(const invalid of [{scenes:[scene]},{...data,scenes:[]},{...data,scenes:[{...scene,scene_id:7}]},{...data,scenes:[{...scene,narrative_description:' '}]}])assert.throws(()=>assertCompleteScenes(invalid,input));
});
test('batch retries preserve completed batches and first error',async()=>{
 const inputs=Array.from({length:6},(_,i)=>({id:String(i),scene_id:i+1,raw_description:''}));
 for(const mode of ['recover','400','exhaust']){
 let count=0;const published:number[]=[];
 const job=generateSceneBatches(inputs,{},()=>{},async(_,init)=>{
 const scenes=JSON.parse(String(init?.body)).scenesInput;
 count++;
 if(count>1 && !(mode==='recover' && count===3)) return Response.json({error:'failure '+count},{status:mode==='400'?400:503});
 return Response.json({suitability:{},scenes:scenes.map((s:any)=>({...s,narrative_description:'Walks.'}))});
 },undefined,data=>published.push(data.scenes.length),{retries:2,sleep:async()=>{}});
 if(mode==='recover') {await job;assert.deepEqual(published,[5,6]);} else {await assert.rejects(job,/failure 2/);assert.deepEqual(published,[5]);}
 assert.equal(count,mode==='400'?2:mode==='recover'?3:4);
 }
});
test('real provider adapters rotate keys across models and providers',async()=>{
 process.env.VERCEL='1';
 const saved={...process.env};const fetchBefore=globalThis.fetch;
 const gem=['synthetic-gem-one','synthetic-gem-two'];const router=['synthetic-router-one','synthetic-router-two'];
 process.env.GEMINI_API_KEY=gem.join(',');process.env.OPENROUTER_API_KEY=router.join(',');
 const calls:string[]=[];
 try {
 const {runModelChain}=await import('../server.js');
 globalThis.fetch=async(input,init)=>{
 const url=String(input);const headers=new Headers(init?.headers);
 const direct=url.includes('googleapis');const model=direct?url.match(/models\/([^:]+)/)![1]:JSON.parse(String(init?.body)).model;
 const position=direct?gem.indexOf(headers.get('x-goog-api-key')!):router.indexOf((headers.get('Authorization')||'').slice(7));
 calls.push(model+' '+position);
 if(!direct && position===1)return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
 return Response.json({error:{code:429,message:'quota'}},{status:429});
 };
 const result=await runModelChain({requestedModel:argon,geminiParams:{contents:'test'},openRouter:{userPrompt:'test'},accept:data=>assert.equal(data.ok,true)});
 assert.deepEqual(calls,[argon,flash,lite,'google/'+argon].flatMap(id=>[id+' 0',id+' 1']));
 assert.equal(result.trail.length,7);
 for(const key of [...gem,...router])assert.ok(!JSON.stringify(result.trail).includes(key));
 }finally{globalThis.fetch=fetchBefore;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
