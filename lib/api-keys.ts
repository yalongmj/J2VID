import { createHash } from 'node:crypto';
export type KeyPurpose = 'gemini' | 'openrouter' | 'audio' | 'deepgram';

function pool(env: NodeJS.ProcessEnv, prefix: string): string[] {
  const names = [prefix, ...Array.from({length: 20}, (_, i) => prefix + '_' + (i + 1))];
  return [...new Set(names.flatMap(name => (env[name] || '').split(/[,;\n]/)).map(key => key.trim()).filter(Boolean))];
}

export function getApiKeys(purpose: KeyPurpose, env: NodeJS.ProcessEnv = process.env): string[] {
  if (purpose === 'deepgram') return pool(env, 'DEEPGRAM_API_KEY');
  if (purpose === 'openrouter') return pool(env, 'OPENROUTER_API_KEY');
  if (purpose === 'audio') {
    const dedicated = pool(env, 'GEMINI_AUDIO_API_KEY');
    return dedicated.length ? dedicated : getApiKeys('gemini', env);
  }
  const keys = pool(env, 'GEMINI_API_KEY');
  if (keys.length) return keys;
  return [...new Set([env.GOOGLE_API_KEY, env.GOOGLE_GENAI_API_KEY]
    .map(value => value?.trim()).filter((value): value is string => !!value))];
}

export function statusOf(e: any) {
  return Number(e?.status || e?.statusCode || e?.code) || 0;
}
const quota = /quota|resource_exhausted|rate.?limit|too many requests/i;
export function classifyError(e: any): 'key' | 'model' | 'fatal' {
  const status = statusOf(e);
  const message = [e?.name, e?.code, e?.message, e?.cause?.code].join(' ');
  if (e?.budgetExhausted) return 'fatal';
  if (e?.unusableOutput || [404,408].includes(status) || /failed_precondition|location is not supported|timeout|aborterror|etimedout/i.test(message)) return 'model';
  if ([401,402,403,429,500,502,503,504,529].includes(status) || quota.test(message) || /api key not valid|api_key_invalid|credits/i.test(message)) return 'key';
  return !status && /econnreset|fetch failed|network|enotfound|econnrefused|eai_again/i.test(message) ? 'key' : 'fatal';
}
export const canTryBackupKey = (error: unknown) => classifyError(error) === 'key';

export class KeyCooldown {
  private until = new Map<string, number>();
  constructor(private now = Date.now) {}
  private id(key: string, scope: string) {
    return createHash('sha256').update(key).digest('hex') + ':' + scope;
  }
  record(key: string, scope: string, error: any) {
    const status = statusOf(error);
    const global = [401,402,403].includes(status);
    const id = this.id(key, global ? '*' : scope);
    const duration = global ? 600000 : status === 429 || quota.test(error?.message) ? 60000 : 15000;
    this.until.set(id, Math.max(this.until.get(id) || 0, this.now() + duration));
  }
  order(keys: string[], scope: string) {
    const now = this.now();
    const expiry = (key: string) => Math.max(now, this.until.get(this.id(key, '*')) || 0, this.until.get(this.id(key, scope)) || 0);
    return keys.map((_, i) => i).sort((a,b) => expiry(keys[a]) - expiry(keys[b]));
  }
}
export async function withApiKeyFallback<T>(keys: string[], request: (key: string) => Promise<T>, enabled = true,
  options: { cooldown?: KeyCooldown; scope?: string; onAttempt?: (step: {keyIndex:number; ok:boolean; status:number}) => void } = {}): Promise<T> {
  if (!keys.length) throw new Error('No API key is configured for this purpose.');
  const scope = options.scope || '';
  const indices = enabled ? options.cooldown?.order(keys, scope) || keys.map((_,i)=>i) : [0];
  for (const index of indices) {
    try {
      const value = await request(keys[index]);
      options.onAttempt?.({keyIndex:index+1, ok:true, status:200});
      return value;
    } catch (error) {
      options.onAttempt?.({keyIndex:index+1, ok:false, status:statusOf(error)});
      if (!canTryBackupKey(error)) throw error;
      options.cooldown?.record(keys[index], scope, error);
      if (index === indices.at(-1)) throw error;
    }
  }
  throw new Error('No API key is configured for this purpose.');
}
