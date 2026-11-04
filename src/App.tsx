import { SceneDescriptionDialog } from './components/SceneDescriptionDialog';
import { generateSceneBatches, type SceneBatchProgress } from './utils/sceneBatches';
import { useWorkspaceUI } from './components/WorkspaceUI';
import { ProcessingScreen } from './components/ProcessingScreen';
import { transcribeAudioFile, audioTimestamp } from './utils/audioUpload';
import { SubtitleProvider } from './types';
import React, { useState, useEffect } from 'react';
import { SAMPLE_VIDEOS } from './data/sampleVideos';
import { SubtitleList } from './components/SubtitleList';
import { VideoAnnotationResult, AgentWorkflowStep, SceneAnnotation, SceneInput, SubtitleAnnotation } from './types';
import { Header } from './components/Header';
import { SnapshotViewer } from './components/SnapshotViewer';
import { SuitabilityBadge } from './components/SuitabilityBadge';
import { SceneList } from './components/SceneList';
import { TimelineTrack } from './components/TimelineTrack';
import { WorkflowStepsVisualizer } from './components/WorkflowStepsVisualizer';
import { JsonInspector } from './components/JsonInspector';
import { ValidationReport } from './components/ValidationReport';
import { ManualAnnotationEditor } from './components/ManualAnnotationEditor';
import { EventSetupModal } from './components/EventSetupModal';
import { UploadBentoPortal } from './components/UploadBentoPortal';
import { ModelSelectorModal } from './components/ModelSelectorModal';
import { DEFAULT_MODEL_ID, AVAILABLE_MODELS, resolveModelSelection, GEMINI_FALLBACK_MODEL_ID } from './data/models';
import { formatSecondsToTimestamp, parseTimestampToSeconds } from './utils/timeUtils';
import { MapPin, Clock, Sparkles, Edit3, Globe, Layers, AlertTriangle, Zap, ArrowRightLeft, ShieldCheck } from 'lucide-react';

export default function App() {
  const [previewScene, setPreviewScene] = useState<SceneAnnotation | null>(null);
  const [mode, setMode] = useState<'home' | 'scenes' | 'subtitles'>('home');
  const [processingStep, setProcessingStep] = useState('Preparing your upload');
  const [batchProgress, setBatchProgress] = useState<SceneBatchProgress | null>(null);
  // Active annotation result
  const [annotationResult, setAnnotationResult] = useState<VideoAnnotationResult | null>(null);
  const [hasStartedGeneration, setHasStartedGeneration] = useState<boolean>(false);

  // Active scene index for inspector
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(30);

  // UI Tabs & Modals
  const [activeTab, setActiveTab] = useState<'annotations' | 'timeline' | 'json' | 'workflow'>('annotations');
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [editingScene, setEditingScene] = useState<SceneAnnotation | null>(null);

  // Custom Event Setup Parameters Modal State
  const [isSetupModalOpen, setIsSetupModalOpen] = useState<boolean>(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('j2-activity', { detail: isEditorOpen ? 'editing' : isSetupModalOpen ? 'setup' : activeTab }));
  }, [activeTab, isEditorOpen, isSetupModalOpen]);
  const [configuredScenes, setConfiguredScenes] = useState<SceneInput[]>([]);
  const [globalBackground, setGlobalBackground] = useState<string>('');

  // Selected AI Model & Quota Fallback
  const [subtitleProvider, setSubtitleProvider] = useState<SubtitleProvider>('deepgram');
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return resolveModelSelection(localStorage.getItem('j2_selected_gemini_model'));
  });
  const [autoFallback, setAutoFallback] = useState<boolean>(() => {
    const saved = localStorage.getItem('j2_auto_fallback');
    return saved !== null ? saved === 'true' : true;
  });
  const { isModelModalOpen, setIsModelModalOpen } = useWorkspaceUI();
  const [quotaExhaustedAlert, setQuotaExhaustedAlert] = useState<{ model: string; suggestedFallback: string } | null>(null);
  const [fallbackSuccessNotice, setFallbackSuccessNotice] = useState<{ originalModel: string; usedModel: string } | null>(null);

  // Agent Pipeline state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // API Status & Error Warnings (e.g. Vercel environment variables)
  const [apiError, setApiError] = useState<string | null>(null);
  const [keyMissingWarning, setKeyMissingWarning] = useState<boolean>(false);
  const [keyStatus, setKeyStatus] = useState<{
    hasApiKey: boolean;
    hasGeminiKey: boolean;
    hasOpenRouterKey: boolean;
  }>({ hasApiKey: true, hasGeminiKey: true, hasOpenRouterKey: false });

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem('j2_selected_gemini_model', modelId);
    setQuotaExhaustedAlert(null);
  };

  const handleToggleAutoFallback = (enabled: boolean) => {
    setAutoFallback(enabled);
    localStorage.setItem('j2_auto_fallback', String(enabled));
  };

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`Backend health check failed (HTTP ${res.status}). Check the Vercel runtime logs; API key status could not be verified.`);
        return res.json();
      })
      .then((data) => {
        if (data) {
          setKeyStatus({
            hasApiKey: data.hasApiKey ?? false,
            hasGeminiKey: data.hasGeminiKey ?? false,
            hasOpenRouterKey: data.hasOpenRouterKey ?? false
          });
          if (data.hasApiKey === false) {
            setKeyMissingWarning(true);
          }
        }
      })
      .catch((error) => {
        setApiError(error instanceof Error ? error.message : 'Backend health check failed. API key status could not be verified.');
      });
  }, []);
  // Reset handler
  const handleReset = () => {
    setPreviewScene(null);
    setMode('home');
    setConfiguredScenes([]);
    setApiError(null);
    setAnnotationResult(null);
    setHasStartedGeneration(false);
    setActiveSceneIndex(0);
  };

  // Run full multimodal agent pipeline on input scenes, snapshots, and optional audio
  const runAgentPipelineOnScenes = async (
    scenesInput: SceneInput[],
    bgContext?: string,
    audioFile?: File,
    audioFileName?: string
  ) => {
    if (!scenesInput || scenesInput.length === 0) return;

    setPreviewScene(null);
    setAnnotationResult(null);
    setConfiguredScenes(scenesInput);
    setBatchProgress(null);
    setGlobalBackground(bgContext || '');
    setIsAnalyzing(true);
    setHasStartedGeneration(true);
    setActiveTab('workflow');
    setCurrentStepIndex(0);

    setMode('scenes');
    setApiError(null);
    setProcessingStep('Preparing your upload');
    try {
      const audioResult = audioFile ? await transcribeAudioFile(audioFile, {
        subtitleProvider, autoFallback, onProgress: setProcessingStep
      }) : undefined;
      const totalSec = audioResult?.duration || scenesInput.length * 15;
      setDuration(totalSec);
      const result = await generateSceneBatches(scenesInput, {
        initialBackground: bgContext, durationSeconds: totalSec,
        subtitleProvider, model: selectedModel, autoFallback
      }, setProcessingStep, fetch, setBatchProgress, partial => {
        if (audioResult) partial.subtitles = audioResult.subtitles;
        setAnnotationResult(partial);
      }, {retries:autoFallback ? 2 : 0});
      if (audioResult) result.subtitles = audioResult.subtitles;
      setAnnotationResult(result);
      setActiveSceneIndex(0);
      setActiveTab('annotations');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Generation failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleJumpToTime = (seconds: number) => {
    setCurrentTime(seconds);
    if (annotationResult && annotationResult.scenes.length > 0) {
      const idx = Math.min(Math.floor(seconds / 15), annotationResult.scenes.length - 1);
      if (idx >= 0) setActiveSceneIndex(idx);
    }
  };

  // Scene Editing
  const handleSaveScene = (updatedScene: SceneAnnotation) => {
    if (!annotationResult) return;
    const existingIdx = annotationResult.scenes.findIndex((s) => s.scene_id === updatedScene.scene_id);
    let newScenes = [...annotationResult.scenes];

    if (existingIdx >= 0) {
      newScenes[existingIdx] = updatedScene;
    } else {
      newScenes.push(updatedScene);
      newScenes.sort((a, b) => a.scene_id - b.scene_id);
    }

    setAnnotationResult({
      ...annotationResult,
      scenes: newScenes
    });
  };

  const handleDeleteScene = (sceneId: number) => {
    if (!annotationResult) return;
    const newScenes = annotationResult.scenes
      .filter((s) => s.scene_id !== sceneId)
      .map((s, idx) => ({ ...s, scene_id: idx + 1 }));

    setAnnotationResult({
      ...annotationResult,
      scenes: newScenes
    });
  };

  const handleReviseScene = async (sceneId: number, feedback: string) => {
    if (!annotationResult) return;
    const targetScene = annotationResult.scenes.find((s) => s.scene_id === sceneId);
    if (!targetScene) return;

    try {
      const res = await fetch('/api/revise-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-J2-Request': '1' },
        body: JSON.stringify({
          sceneId,
          currentDescription: targetScene.narrative_description,
          feedback,
          rawDescription: targetScene.raw_description,
          startImage: targetScene.start_image,
          initialBackground: globalBackground,
          sceneBackground: targetScene.initial_background,
          model: selectedModel,
          autoFallback
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data._fellBackFrom) {
          setFallbackSuccessNotice({
            originalModel: data._fellBackFrom,
            usedModel: data._modelUsed || 'Gemini 3.1 Flash Lite'
          });
        }
        if (data.revised_description) {
          const updatedScenes = annotationResult.scenes.map((sc) => {
            if (sc.scene_id === sceneId) {
              return {
                ...sc,
                narrative_description: data.revised_description
              };
            }
            return sc;
          });
          setAnnotationResult({
            ...annotationResult,
            scenes: updatedScenes
          });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 429 || errData.isQuotaExhausted) {
          setQuotaExhaustedAlert({
            model: errData.modelUsed || selectedModel,
            suggestedFallback: errData.suggestedFallback || GEMINI_FALLBACK_MODEL_ID
          });
        }
      }
    } catch (err) {
      console.error('Failed to revise scene:', err);
    }
  };

  // Subtitle Handlers
  const handleAddSubtitle = () => {
    if (!annotationResult) return;
    const nextId = (annotationResult.subtitles?.length || 0) + 1;
    const newSub: SubtitleAnnotation = {
      subtitle_id: nextId,
      start_time: '00:00:00.000',
      end_time: '00:00:05.000',
      type: 'Spoken words',
      text: 'New spoken subtitle line...'
    };
    setAnnotationResult({
      ...annotationResult,
      subtitles: [...(annotationResult.subtitles || []), newSub]
    });
  };

  const handleDeleteSubtitle = (subId: number) => {
    if (!annotationResult?.subtitles) return;
    const updatedSubs = annotationResult.subtitles
      .filter((s) => s.subtitle_id !== subId)
      .map((s, idx) => ({ ...s, subtitle_id: idx + 1 }));

    setAnnotationResult({
      ...annotationResult,
      subtitles: updatedSubs
    });
  };

  const handleEditSubtitle = (sub: SubtitleAnnotation) => {
    const newText = prompt('Edit subtitle text:', sub.text);
    if (newText !== null && annotationResult?.subtitles) {
      const updatedSubs = annotationResult.subtitles.map((s) =>
        s.subtitle_id === sub.subtitle_id ? { ...s, text: newText.trim() } : s
      );
      setAnnotationResult({
        ...annotationResult,
        subtitles: updatedSubs
      });
    }
  };

  const subtitlePanel = <SubtitleList
    subtitleProvider={subtitleProvider} onSubtitleProviderChange={setSubtitleProvider}
    subtitles={annotationResult?.subtitles || []} currentTime={currentTime}
    onJumpToTime={handleJumpToTime} onEditSubtitle={handleEditSubtitle}
    onAddSubtitle={handleAddSubtitle} onDeleteSubtitle={handleDeleteSubtitle}
    onSubtitlesGenerated={subtitles => setAnnotationResult(previous => ({
      ...(previous || { video_duration: '00:00:00.000', suitability: { status: 'suitable', category: null, confidence: 1, reason: '' }, scenes: [] }), subtitles
    }))} selectedModel={selectedModel} autoFallback={autoFallback}
  />;
  return (
    <div className="min-h-screen flex flex-col">
      <Header currentTitle={mode === 'subtitles' ? 'Subtitles' : 'Scene descriptions'}
        onRunAgentAnalysis={() => setIsSetupModalOpen(true)} isAnalyzing={isAnalyzing}
        annotationResult={annotationResult} activeTab={activeTab} setActiveTab={setActiveTab}
        onResetVideo={handleReset} hasVideo={mode !== 'home'} selectedModel={selectedModel}
        onOpenModelSelector={() => setIsModelModalOpen(true)} />
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {isAnalyzing ? <ProcessingScreen step={processingStep} scenes={configuredScenes} progress={batchProgress} readyScenes={annotationResult?.scenes} onOpenScene={setPreviewScene} /> : <>
          {apiError && <div role="alert" className="border border-red-700 p-4">{apiError}</div>}
          {mode === 'home' ? <section className="aces-start">
            <div className="aces-home-icon"><Layers size={28} aria-hidden="true"/></div>
            <h1>Video Annotation</h1>
            <p>Create scene descriptions from snapshots or generate subtitles from audio.</p>
            <div className="aces-actions">
              <button className="aces-primary" onClick={() => { setMode('scenes'); setIsSetupModalOpen(true); }}><Layers size={20} aria-hidden="true"/> Generate scene descriptions</button>
              <button className="aces-secondary" onClick={() => setMode('subtitles')}><Sparkles size={20} aria-hidden="true"/> Generate subtitles</button>
            </div>
            
          </section> : mode === 'subtitles' ? subtitlePanel : <>
            <div className="aces-section-heading">
              <div><h1 className="text-3xl font-bold">Scene descriptions</h1><p className="mt-2 text-sm">Snapshots are processed in batches of up to 5, one batch at a time.</p></div>
              <button className="aces-primary" onClick={() => setIsSetupModalOpen(true)}>{annotationResult ? 'Edit uploads' : 'Upload snapshots'}</button>
            </div>
            {annotationResult && <>
              <details className="border p-4"><summary className="cursor-pointer">Preview snapshots & validation</summary><div className="mt-4 grid gap-4 md:grid-cols-2"><SnapshotViewer scenes={annotationResult.scenes} activeSceneIndex={activeSceneIndex} onSelectScene={setActiveSceneIndex} annotationResult={annotationResult}/><ValidationReport annotationResult={annotationResult}/></div></details>
              <SceneList scenes={annotationResult.scenes} currentTime={currentTime} onJumpToTime={handleJumpToTime}
                onEditScene={scene => { setEditingScene(scene); setIsEditorOpen(true); }} onAddScene={() => setIsSetupModalOpen(true)} onDeleteScene={handleDeleteScene} onReviseScene={handleReviseScene}/>
              {!!annotationResult.subtitles?.length && subtitlePanel}
              <details className="border p-4"><summary className="cursor-pointer">View JSON</summary><JsonInspector annotationResult={annotationResult}/></details>
            </>}
          </>}
        </>}
      </main>
      <footer className="aces-footer"><a href="https://acesintelligence.xyz">ACES INTELLIGENCE</a><span>Video annotation workspace</span></footer>

      {previewScene && <SceneDescriptionDialog scene={previewScene} scenes={annotationResult?.scenes || []} onSelectScene={setPreviewScene} isProcessing={isAnalyzing} onClose={() => setPreviewScene(null)} />}

      {/* Pop-up Event & Scene Configurator Modal */}
      <EventSetupModal
        subtitleProvider={subtitleProvider}
        onSubtitleProviderChange={setSubtitleProvider}
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        initialScenes={configuredScenes}
        onSubmit={({ scenes, globalBackground, audioFile, audioFileName }) => {
          runAgentPipelineOnScenes(scenes, globalBackground, audioFile, audioFileName);
        }}
      />

      {/* Manual Scene Event Editor Modal */}
      <ManualAnnotationEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        initialScene={editingScene}
        currentVideoTime={currentTime}
        onSaveScene={handleSaveScene}
      />

      {/* Model Selection & Free-Tier Quota Fallback Modal */}
      <ModelSelectorModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        autoFallback={autoFallback}
        onToggleAutoFallback={handleToggleAutoFallback}
        hasGeminiKey={keyStatus.hasGeminiKey}
        hasOpenRouterKey={keyStatus.hasOpenRouterKey}
      />
    </div>
  );
}


