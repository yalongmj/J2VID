import { classifyError, statusOf } from './api-keys.js';
type Provider = 'gemini' | 'openrouter';
type Step = {provider:Provider; model:string};
export type Failure = Step & {keyIndex:number; status:number; reason:string};
export function buildAttemptChain(requestedModel:string, options:{autoFallback:boolean;hasGemini:boolean;hasOpenRouter:boolean}): Step[] {
  const router = requestedModel.includes('/');
  const requested = requestedModel.replace(/^google\//,'');
  const models = [...new Set([...(requested === 'openrouter/free' ? [] : [requested]), 'gemini-3.8-flash','gemini-3.5-flash-lite','gemini-4-argon'])];
  const direct:Step[] = options.hasGemini ? models.map(model=>({provider:'gemini',model})) : [];
  const routed:Step[] = options.hasOpenRouter ? [...new Set([...(router?[requestedModel]:[]),...models.map(id=>'google/'+id),'openrouter/free'])].map(model=>({provider:'openrouter',model})) : [];
  const chain = router ? [...routed,...direct] : [...direct,...routed];
  return options.autoFallback ? chain : chain.slice(0,1);
}
export const markUnusable = (error:unknown) => Object.assign(error instanceof Error ? error : new Error('Invalid provider response'), {unusableOutput:true});
export function assertCompleteScenes(data:any, inputs:any[]) {
  if (!data?.suitability || !Array.isArray(data.scenes) || data.scenes.length !== inputs.length) throw markUnusable(new Error('Incomplete scene descriptions'));
  for (const scene of data.scenes) {
    if (typeof scene?.scene_id === 'string' && /^\d+$/.test(scene.scene_id)) scene.scene_id = Number(scene.scene_id);
  }
  if (inputs.some(input=>data.scenes.filter((s:any)=>s?.scene_id===input.scene_id && typeof s.narrative_description==='string' && s.narrative_description.trim()).length!==1)) throw markUnusable(new Error('Incomplete scene descriptions'));
}
export function publicTrail(trail:Failure[] = []) {
  return trail.filter((s:any)=>!s.ok).map(({provider,model,keyIndex,status,reason})=>({provider,model,keyIndex,status,reason}));
}
export async function runAttemptChain<T>(chain:Step[], run:(step:Step)=>Promise<T>, {budgetMs=150000,now=Date.now,onFailure}:{budgetMs?:number;now?:()=>number;onFailure?:(step:Step,error:unknown)=>void}={}) {
  const deadline = now()+budgetMs;
  const trail:Failure[]=[];
  let last:any = new Error('No provider is configured.');
  for (const step of chain) {
    if (now()>=deadline) break;
    try { return await run(step); }
    catch (error) {
      last=error;
      trail.push({...step,keyIndex:1,status:statusOf(error),reason:classifyError(error)});
      onFailure?.(step,error);
      if (classifyError(error)==='fatal') break;
    }
  }
  throw Object.assign(last,{fallbackTrail:trail});
}
