import { getApiKeys } from './api-keys.js';
import { GEMINI_MODEL_IDS, OPENROUTER_MODEL_IDS, MODEL_CATALOG_REVIEWED } from '../src/data/models.js';

export function apiHealth() {
  const hasGeminiKey = getApiKeys('gemini').length > 0;
  const hasOpenRouterKey = getApiKeys('openrouter').length > 0;
  return {
    keyCounts:Object.fromEntries((['gemini','openrouter','audio','deepgram'] as const).map(p=>[p,getApiKeys(p).length])),
    status: 'ok', hasApiKey: hasGeminiKey || hasOpenRouterKey,
    keyConfigured: hasGeminiKey || hasOpenRouterKey,
    hasGeminiKey, hasOpenRouterKey,
    hasAudioKey: getApiKeys('audio').length > 0,
    hasDeepgramKey: getApiKeys('deepgram').length > 0,
    availableGeminiModels: GEMINI_MODEL_IDS,
    availableOpenRouterModels: OPENROUTER_MODEL_IDS,
    modelCatalogReviewed: MODEL_CATALOG_REVIEWED,
    // Configured means a key exists; it does not assert successful authentication.
    timestamp: new Date().toISOString()
  };
}
