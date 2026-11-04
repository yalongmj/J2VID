import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('starting and segment backgrounds reach Gemini and OpenRouter generation and revision routes', async () => {
  const originalFetch = globalThis.fetch;
  const saved = { ...process.env };
  const userPassword = randomBytes(24).toString('hex');
  const adminPassword = randomBytes(24).toString('hex');
  Object.assign(process.env, { VERCEL: '1', VERCEL_ENV: 'test', USER_PASSWORD: userPassword,
    ADMIN_PASSWORD: adminPassword, UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'synthetic-test-token' });
  const values = new Map<string, any>();
  const expiries = new Map<string, number>();
  let outage = false;
  let unavailableFlash = false;
  const providerRequests: Array<{ url: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('api.deepgram.com')) {
      providerRequests.push({ url, body: 'binary' });
      return Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Hello.', words: [
        { word: 'Hello.', start: 0.1, end: 0.6, language: 'en' }] }] }] } });
    }
    if (url.includes('generativelanguage.googleapis.com') || url.includes('openrouter.ai')) {
      providerRequests.push({ url, body: JSON.parse(String(init?.body)) });
      if (unavailableFlash && url.includes('/gemini-3.8-flash:')) {
        return Response.json({ error: { code: 404, message: 'Model unavailable' } }, { status: 404 });
      }
      const result = { video_duration: '00:00:05.000', suitability: { status: 'suitable', category: 'Documentary', confidence: 0.9, reason: 'Movement' },
        scenes: [...new Set(Array.from(String(init?.body).matchAll(/scene #(\d+)/gi), match => Number(match[1])))].map(scene_id=>({scene_id,narrative_description:'A person walks across the room.'})), subtitles: [], revised_description: 'A person enters the room.' };
      return Response.json(url.includes('openrouter')
        ? { choices: [{ message: { content: JSON.stringify(result) } }] }
        : { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }] });
    }
    if (url !== 'https://redis.test') return originalFetch(input, init);
    if (outage) return new Response('unavailable', { status: 503 });
    const [op, k, ...args] = JSON.parse(String(init?.body));
    for (const [name, until] of expiries) if (until <= Date.now()) values.delete(name);
    let result: any = null;
    const sorted = () => [...(values.get(k) || new Map()).entries()].sort((a,b)=>Number(a[1])-Number(b[1]));
    if (op === 'GET') result = values.get(k) ?? null;
    else if (op === 'SET') { values.set(k,args[0]); expiries.set(k,Date.now()+Number(args[2])*1000); result='OK'; }
    else if (op === 'DEL') result = Number(values.delete(k));
    else if (op === 'EXPIRE') { expiries.set(k, Date.now()+Number(args[0])*1000); result=1; }
    else if (op === 'HSET') { const row=values.get(k)||{}; for(let i=0;i<args.length;i+=2)row[args[i]]=String(args[i+1]);values.set(k,row);result=1; }
    else if (op === 'HGET') result=values.get(k)?.[args[0]] ?? null;
    else if (op === 'HGETALL') result=Object.entries(values.get(k)||{}).flat();
    else if (op === 'HINCRBY') {const row=values.get(k)||{}; result=Number(row[args[0]]||0)+Number(args[1]);row[args[0]]=String(result); values.set(k,row);}
    else if (op === 'ZADD') { const set=values.get(k)||new Map();set.set(args[1],Number(args[0]));values.set(k,set);result=1; }
    else if (op === 'ZREM') result=Number(values.get(k)?.delete(args[0])||false);
    else if (op === 'ZREMRANGEBYSCORE') {const set=values.get(k);for(const [item,score] of set||[])if(score<=Number(args[1]))set.delete(item);result=0;}
    else if (op === 'ZREMRANGEBYRANK') {const items=sorted();const end=Number(args[1])<0?items.length+Number(args[1]):Number(args[1]);for(let i=Number(args[0]);i<=end;i++)values.get(k)?.delete(items[i]?.[0]);result=0;}
    else if (op === 'ZCOUNT') result=sorted().filter(([,score])=>Number(score)>=Number(args[0])).length;
    else if (op === 'ZREVRANGEBYSCORE') result=sorted().reverse().filter(([,score])=>Number(score)>=Number(args[1])).slice(Number(args[3]),Number(args[3])+Number(args[4])).map(([id])=>id);
    else if (op === 'EVAL') {const rateKey=args[1];result=Number(values.get(rateKey)||0)+1;values.set(rateKey,result);}
    else throw new Error(`Unsupported test command: ${op}`);
    return Response.json({result});
  };
  process.env.GEMINI_API_KEY = 'synthetic-gemini-key';
  process.env.OPENROUTER_API_KEY = 'synthetic-router-key';
  const { app } = await import('../server.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (route: string, body: any, cookie = '') => originalFetch(origin + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-J2-Request': '1', Origin: origin, Cookie: cookie },
    body: JSON.stringify(body)
  });
  try {
    const login = await post('/api/access', { action: 'login', username: 'Reviewer', password: userPassword });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    process.env.DEEPGRAM_API_KEY = 'synthetic-deepgram';
    const savedGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const audioResponse = await post('/api/transcribe-audio', { audioData: 'YQ==', audioMimeType: 'audio/mpeg' }, cookie);
    assert.equal(audioResponse.status, 200);
    assert.equal((await audioResponse.json())._provider, 'deepgram');
    const sceneWithAudio = await post('/api/annotate-video', { model: 'openai/gpt-4o-mini',
      audioData: 'YQ==', durationSeconds: 5, scenesInput: [{ scene_id: 1, raw_description: 'A person walks.' }] }, cookie);
    assert.equal(sceneWithAudio.status, 200);
    const sceneResult = await sceneWithAudio.json();
    assert.equal(sceneResult._audioProvider, 'deepgram');
    assert.equal(sceneResult.subtitles[0].text, 'Hello.');
    const invalid = await post('/api/transcribe-audio', { subtitleProvider: 'unknown', audioData: 'YQ==' }, cookie);
    assert.equal(invalid.status, 400);
    process.env.GEMINI_API_KEY = savedGemini;
    unavailableFlash = true;
    const fallback = await post('/api/revise-scene', { model: 'gemini-3.8-flash',
      sceneId: 1, currentDescription: 'A person walks.', feedback: 'Clarify the action.' }, cookie);
    assert.equal(fallback.status, 200);
    assert.equal((await fallback.json())._modelUsed, 'gemini-3.5-flash-lite');
    const attempts = providerRequests.slice(-2);
    assert.match(attempts[0].url, /gemini-3.8-flash/);
    assert.match(attempts[1].url, /gemini-3.5-flash-lite/);
    unavailableFlash = false;
    for (const model of ['gemini-4-argon', 'gemini-3.5-flash-lite', 'google/gemini-3.8-flash']) {
      const generated = await post('/api/annotate-video', { model, autoFallback: false, durationSeconds: 5,
        initialBackground: 'A city street in daylight', scenesInput: [
          { scene_id: 1, raw_description: 'A person walks.', initial_background: 'An office interior' },
          { scene_id: 2, raw_description: 'A person stops.' }] }, cookie);
      assert.equal(generated.status, 200, await generated.text());
      const prompt = JSON.stringify(providerRequests.at(-1)?.body);
      assert.match(prompt, /An office interior/);
      assert.match(prompt, /A city street in daylight/);
      assert.match(prompt, /segment context replaces/);
      assert.match(prompt, /viewpoint is the viewer/);
      const revised = await post('/api/revise-scene', { model, autoFallback: false, sceneId: 1,
        currentDescription: 'A person walks.', feedback: 'Clarify the setting.',
        initialBackground: 'A city street in daylight', sceneBackground: 'An office interior' }, cookie);
      assert.equal(revised.status, 200, await revised.text());
      const revisionPrompt = JSON.stringify(providerRequests.at(-1)?.body);
      assert.match(revisionPrompt, /An office interior/);
      assert.doesNotMatch(revisionPrompt, /A city street in daylight/);
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
