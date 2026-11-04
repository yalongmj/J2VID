export type SuitabilityStatus = 'suitable' | 'discarded';
export type SubtitleProvider = 'gemini' | 'deepgram';

export type VideoCategory =
  | 'Live Performance'
  | 'Documentary'
  | 'Movie'
  | 'Advertisement'
  | null;

export type SubtitleType =
  | 'Spoken words'
  | 'Music'
  | 'Sound effect'
  | 'Ambient sound'
  | 'Vocal sound'
  | 'Other';

export interface SuitabilityResult {
  status: SuitabilityStatus;
  category: VideoCategory;
  confidence: number;
  reason: string;
}

export interface SceneAnnotation {
  scene_id: number;
  start_time?: string;
  end_time?: string;
  narrative_description: string;
  start_image?: string; // Base64 snapshot image URL
  snapshot_image?: string; // Base64 snapshot image URL
  raw_description?: string; // Tagalog or English initial draft/guidance
  initial_background?: string;
  revision_history?: string[];
}

export interface SceneInput {
  id: string;
  scene_id: number;
  start_image?: string; // Base64 snapshot image URL
  snapshot_image?: string; // Base64 snapshot image URL
  raw_description: string; // Tagalog or English guidance / action draft
  initial_background?: string;
  frame_count?: number; // Optional frame count/number for sorting
}

export interface SubtitleAnnotation {
  subtitle_id: number;
  start_time: string; // HH:MM:SS.mmm
  end_time: string;   // HH:MM:SS.mmm
  type: SubtitleType;
  text: string;
}

export interface VideoAnnotationResult {
  video_duration: string; // HH:MM:SS.mmm
  suitability: SuitabilityResult;
  scenes: SceneAnnotation[];
  subtitles: SubtitleAnnotation[];
  _modelUsed?: string;
  _fellBackFrom?: string;
  _fallbackTrail?: Array<{provider:string;model:string;keyIndex:number;status:number;reason:string}>;
}

export interface AgentWorkflowStep {
  step_number: number;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  logDetails?: string[];
  durationMs?: number;
}

export interface SampleVideo {
  id: string;
  title: string;
  categoryName: string;
  durationStr: string;
  videoUrl: string;
  description: string;
  thumbnailUrl?: string;
  isSuitable: boolean;
  precomputedResult: VideoAnnotationResult;
}

export interface ValidationError {
  type: 'error' | 'warning';
  field: string;
  message: string;
}

