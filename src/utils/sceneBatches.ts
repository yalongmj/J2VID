import type { SceneInput, VideoAnnotationResult } from '../types';

export interface SceneBatchProgress { completed: number; activeStart: number; activeEnd: number; total: number; }

export async function generateSceneBatches(
  scenes: SceneInput[], options: Record<string, unknown>, onProgress: (step: string) => void,
  request: typeof fetch = fetch,
  onBatchProgress?: (progress: SceneBatchProgress) => void,
  onBatchReady?: (result: VideoAnnotationResult) => void,
  retry: { retries:number; delayMs?:number[]; sleep?:(ms:number)=>Promise<void> } = {retries:0}
): Promise<VideoAnnotationResult> {
  if (!scenes.length) throw new Error('Add at least one snapshot.');
  const results: VideoAnnotationResult[] = [];
  for (let offset = 0; offset < scenes.length; offset += 5) {
    const batch = scenes.slice(offset, offset + 5);
    const number = Math.floor(offset / 5) + 1;
    const label = `Batch ${number} of ${Math.ceil(scenes.length / 5)}`;
    onBatchProgress?.({ completed: offset, activeStart: offset, activeEnd: offset + batch.length, total: scenes.length });
    onProgress(`${label} · Generating descriptions for snapshots ${offset + 1}–${offset + batch.length} of ${scenes.length}`);
    let data:any;
    let originalError:unknown;
    for (let attempt=0;;attempt++) {
      let retryable=true;
      try {
    const response = await request('/api/annotate-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-J2-Request': '1' },
      body: JSON.stringify({ ...options, scenesInput: batch })
    });
    data = await response.json().catch(() => null);
    if (!response.ok) { retryable = [408,425,429,500,502,503,504].includes(response.status) || !!data?.isQuotaExhausted; throw new Error(`${label} failed: ${data?.error || `HTTP ${response.status}`}. Your uploads are retained; use Edit uploads to try again.`); }
    if (!data?.suitability || !Array.isArray(data.scenes) || data.scenes.length !== batch.length ||
      batch.some(input => data.scenes.filter((scene: any) => scene.scene_id === input.scene_id && typeof scene.narrative_description === 'string' && scene.narrative_description.trim()).length !== 1)) {
      throw new Error(`${label} returned incomplete scene descriptions. Your uploads are retained; please try again.`);
    }
        break;
      } catch(error) {
        originalError ??= error;
        if (!retryable || attempt >= retry.retries) throw originalError;
        const delay = retry.delayMs?.[attempt] ?? (attempt === 0 ? 2000 : 8000);
        await (retry.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(delay);
      }
    }
    data.scenes = batch.map(input => ({
      ...data.scenes.find((scene: any) => scene.scene_id === input.scene_id),
      start_image: input.start_image || input.snapshot_image,
      snapshot_image: input.start_image || input.snapshot_image,
      raw_description: input.raw_description,
      initial_background: input.initial_background?.trim() || options.initialBackground
    }));
    results.push(data);
    const discarded = results.find(result => result.suitability.status === 'discarded');
    onBatchReady?.({ ...results[0], suitability: (discarded || results[0]).suitability,
      scenes: results.flatMap(result => result.scenes), subtitles: [],
      video_duration: new Date(Number(options.durationSeconds || 0) * 1000).toISOString().slice(11, 23) });
    onBatchProgress?.({ completed: offset + batch.length, activeStart: offset + batch.length, activeEnd: offset + batch.length, total: scenes.length });
  }
  onProgress('Finishing your scene descriptions');
  const discarded = results.find(result => result.suitability.status === 'discarded');
  return { ...results[0], suitability: (discarded || results[0]).suitability,
    scenes: results.flatMap(result => result.scenes), subtitles: [],
    video_duration: new Date(Number(options.durationSeconds || 0) * 1000).toISOString().slice(11, 23) };
}

