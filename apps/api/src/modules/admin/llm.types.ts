// ═══════════════════════════════════════════════════════════════════════
//  LLM Types — shared types extracted from llm.controller.ts
// ═══════════════════════════════════════════════════════════════════════

export type LlmRuntime = 'mainline' | 'ik';
export type LlmProfile = 'cpu' | 'cuda' | 'apple-silicon-experimental';
export type LlmPreset = 'throughput' | 'balanced' | 'low-memory';
export type LlmRecommendationPreset = LlmPreset | 'custom';

export interface LlmTuningConfig {
  ctxSize: number;
  threads: number;
  threadsBatch: number;
  parallel: number;
  batchSize: number;
  ubatchSize: number;
  flashAttn: boolean;
  cacheTypeK: string;
  cacheTypeV: string;
  gpuLayers: number;
  noWarmup: boolean;
  promptCachePath: string;
  cacheRamMiB: number;
  attentionMaxBatch: number;
  graphReuse: boolean;
  kCacheHadamard: boolean;
  cacheRamSimilarity: number;
  cacheRamMinTokens: number;
  defragThreshold: number;
  mergeQkv: boolean;
  mergeUpGateExperts: boolean;
  schedulerAsync: boolean;
  promptCacheAll: boolean;
  promptCacheReadOnly: boolean;
}

export interface LlmPresetRecommendation {
  preset: LlmRecommendationPreset;
  label: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
  runtime: LlmRuntime;
  profile: LlmProfile;
  tuning: LlmTuningConfig | null;
  history: LlmRecommendationHistoryEntry[];
}

export interface LlmRecommendationHistoryEntry {
  preset: LlmRecommendationPreset;
  label: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
}

export interface LlmRuntimeConfig {
  runtime: LlmRuntime;
  profile: LlmProfile;
  version: string;
  buildFromSource: boolean;
  maxModelSizeMb: number;
  tuning: LlmTuningConfig;
  recommendations: Record<string, LlmPresetRecommendation>;
}

export type LlmRuntimeConfigInput = Partial<Omit<LlmRuntimeConfig, 'tuning'>> & {
  tuning?: Partial<LlmTuningConfig>;
  recommendations?: Record<string, LlmPresetRecommendation>;
};

export interface LlmLaunchPlan {
  args: string[];
  env: Record<string, string>;
}

export interface ModelDownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  filename: string | null;
  repoId: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  sizeMb: number | null;
  error: string | null;
  startedAt: number | null;
}

export interface InstallState {
  status: 'idle' | 'running' | 'done' | 'error';
  step: string;
  log: string[];
  error: string | null;
  startedAt: number | null;
  buildCurrent: number | null;
  buildTotal: number | null;
}

export interface LlmStatusDto {
  healthy: boolean;
  baseUrl: string;
  timeoutMs: number;
  model: string | null;
  modelSizeMb: number | null;
  llamaCppVersion: string | null;
  searchAvailable: boolean;
  latencyMs: number | null;
  runtime: LlmRuntime;
  profile: LlmProfile;
  launchArgs: string[];
  tuning: LlmTuningConfig;
  recommendation: LlmPresetRecommendation | null;
}

export interface LlmInstallStatus {
  binaryInstalled: boolean;
  modelInstalled: boolean;
  binaryPath: string;
  modelDir: string;
  modelFilename: string | null;
  modelSizeMb: number | null;
  llamaCppVersion: string | null;
  maxModelSizeMb: number;
  binFiles: string[];
  runtime: LlmRuntime;
  profile: LlmProfile;
  buildFromSource: boolean;
  sourceRepo: string;
  tuning: LlmTuningConfig;
  recommendation: LlmPresetRecommendation | null;
}

export interface LlmTestResult {
  success: boolean;
  durationMs: number;
  input: string;
  output: string | null;
  reasoning: string | null;
  error: string | null;
  tokensUsed: number | null;
}

export interface LlmBenchmarkRun {
  run: number;
  success: boolean;
  durationMs: number;
  tokensUsed: number | null;
  tokensPerSecond: number | null;
  error: string | null;
}

export interface LlmBenchmarkResult {
  prompt: string;
  maxTokens: number;
  repeatCount: number;
  successCount: number;
  averageDurationMs: number | null;
  averageTokensPerSecond: number | null;
  totalTokensUsed: number | null;
  outputSample: string | null;
  runs: LlmBenchmarkRun[];
}

export interface LlmConfigDebugDto {
  configPath: string;
  persisted: boolean;
  rawJson: string;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  assets: { name: string; size: number }[];
}

export interface GithubTag {
  name: string;
  commit?: { sha: string };
}

export interface HfModelResult {
  id: string;
  author: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
  pipeline_tag?: string;
  cardData?: {
    model_type?: string;
    base_model?: string;
    language?: string | string[];
    license?: string;
    quantized_by?: string;
  };
  config?: { model_type?: string };
  safetensors?: { total?: number; parameters?: Record<string, number> };
  gguf?: { total?: number; architecture?: string; context_length?: number };
  siblings?: Array<{ rfilename: string; size?: number }>;
}
