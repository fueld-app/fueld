import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';
import { LlmHealthService } from '@app/core/llm/llm-health.service';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface LlmStatus {
  healthy: boolean;
  baseUrl: string;
  timeoutMs: number;
  model: string | null;
  modelSizeMb: number | null;
  llamaCppVersion: string | null;
  searchAvailable: boolean;
  latencyMs: number | null;
  runtime: 'mainline' | 'ik';
  profile: 'cpu' | 'cuda' | 'apple-silicon-experimental';
  launchArgs: string[];
  tuning: LlmTuningConfig;
  recommendation: LlmPresetRecommendation | null;
}

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

export type TuningPreset = 'throughput' | 'balanced' | 'low-memory' | 'custom';

export interface LlmPresetRecommendation {
  preset: TuningPreset;
  label?: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
  runtime: 'mainline' | 'ik';
  profile: 'cpu' | 'cuda' | 'apple-silicon-experimental';
  tuning?: LlmTuningConfig | null;
  history: LlmRecommendationHistoryEntry[];
}

export interface LlmRecommendationHistoryEntry {
  preset: TuningPreset;
  label?: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
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
  runtime: 'mainline' | 'ik';
  profile: 'cpu' | 'cuda' | 'apple-silicon-experimental';
  buildFromSource: boolean;
  sourceRepo: string;
  tuning: LlmTuningConfig;
  recommendation: LlmPresetRecommendation | null;
}

export interface TestResult {
  success: boolean;
  durationMs: number;
  input: string;
  output: string | null;
  reasoning?: string | null;
  error: string | null;
  tokensUsed: number | null;
  parsed?: any;
  searchResults?: any[];
  searchResultCount?: number;
}

export interface BenchmarkRun {
  run: number;
  success: boolean;
  durationMs: number;
  tokensUsed: number | null;
  tokensPerSecond: number | null;
  error: string | null;
}

export interface BenchmarkResult {
  prompt: string;
  maxTokens: number;
  repeatCount: number;
  successCount: number;
  averageDurationMs: number | null;
  averageTokensPerSecond: number | null;
  totalTokensUsed: number | null;
  outputSample: string | null;
  runs: BenchmarkRun[];
}

export interface BenchmarkSweepEntry {
  preset: Exclude<TuningPreset, 'custom'>;
  label: string;
  result: BenchmarkResult | null;
  error: string | null;
}

export interface BenchmarkSweepResult {
  entries: BenchmarkSweepEntry[];
  recommendedPreset: Exclude<TuningPreset, 'custom'> | null;
}

export interface IkCpuSweepEntry {
  key: string;
  label: string;
  tuning: LlmTuningConfig;
  result: BenchmarkResult | null;
  error: string | null;
}

export interface IkCpuSweepResult {
  entries: IkCpuSweepEntry[];
  recommendedKey: string | null;
}

export interface LlmConfigDebug {
  configPath: string;
  persisted: boolean;
  rawJson: string;
}

export interface PromptInfo {
  id: string;
  filename: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface PromptDetail extends PromptInfo {
  content: string;
}

export interface VersionInfo {
  tag: string;
  date: string;
  assetCount: number;
  assetSizeMb: number | null;
}

export interface CacheTypeOption {
  value: string;
  label: string;
  description: string;
}

export const CACHE_TYPE_OPTIONS: CacheTypeOption[] = [
  { value: 'f32', label: 'f32 - max precision', description: 'Highest precision, highest memory use.' },
  { value: 'f16', label: 'f16 - safe high precision', description: 'Default balance of precision and compatibility.' },
  { value: 'bf16', label: 'bf16 - hardware dependent', description: 'Lower memory than f32, when supported.' },
  { value: 'q8_0', label: 'q8_0 - recommended', description: 'Common high-quality cache quantization.' },
  { value: 'q6_K', label: 'q6_K - lower memory', description: 'Aggressive memory savings with moderate quality tradeoff.' },
  { value: 'q5_1', label: 'q5_1 - balanced low memory', description: 'Balanced lower-precision cache type.' },
  { value: 'q5_0', label: 'q5_0 - smaller, more lossy', description: 'Lower memory than q8_0, slightly more lossy.' },
  { value: 'q4_1', label: 'q4_1 - risky low memory', description: 'Smaller cache footprint with higher risk of quality loss.' },
  { value: 'q4_0', label: 'q4_0 - minimum memory', description: 'Very memory-efficient, lowest safe common option.' },
  { value: 'iq4_nl', label: 'iq4_nl - experimental', description: 'Experimental integer quantization cache option.' },
];

export interface HfModel {
  id: string;
  author: string;
  downloads: number;
  likes: number;
  lastModified: string | null;
  parameterCount: string | null;
  ggufFileCount: number;
  pipelineTag: string | null;
  modelType: string | null;
  baseModel: string | null;
  license: string | null;
  contextLength: number | null;
  architecture: string | null;
}

export interface HfFile {
  filename: string;
  sizeMb: number | null;
  downloadUrl: string;
  tooLarge: boolean;
  splitParts: number | null;
  splitTotalMb: number | null;
}

// ─── Constants ──────────────────────────────────────────────────────

const PREFERRED_GGUF_ORDER = [
  'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0', 'UD-IQ4_XS', 'IQ4_XS', 'BF16', 'F16', 'FP16', 'F32', 'FP32',
] as const;

const QUANTIZATION_DESCRIPTIONS: Record<string, string> = {
  Q4_K_M: 'Recommended default for balanced RAM and quality.',
  Q5_K_M: 'Higher quality than Q4_K_M, with a larger download.',
  Q6_K: 'Strong quality, heavier memory footprint.',
  Q8_0: 'Very high quality quantized build, large download.',
  'UD-IQ4_XS': 'Ultra-low memory option with more quality tradeoff.',
  IQ4_XS: 'Low-memory option for smaller machines.',
  BF16: 'Near-full precision, large download and RAM usage.',
  F16: 'High precision, large download and RAM usage.',
  FP16: 'High precision, large download and RAM usage.',
  F32: 'Full precision, usually only useful for testing.',
  FP32: 'Full precision, usually only useful for testing.',
};

const QUANTIZATION_FRIENDLY_LABELS: Record<string, string> = {
  Q4_K_M: 'Recommended',
  Q5_K_M: 'Best quality under limit',
  Q6_K: 'Higher quality',
  Q8_0: 'Highest quality quantized',
  'UD-IQ4_XS': 'Lowest memory',
  IQ4_XS: 'Low memory',
  BF16: 'Highest quality',
  F16: 'Highest quality',
  FP16: 'Highest quality',
  F32: 'Full precision',
  FP32: 'Full precision',
};

// ─── Helper Functions ───────────────────────────────────────────────

export function stripSplitSuffix(filename: string): string {
  return filename.replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, '').replace(/\.gguf$/i, '');
}

export function getGgufVariantLabel(filename: string): string {
  const base = stripSplitSuffix(filename);
  const parts = base.split('-');
  const last = parts.at(-1)?.toUpperCase() ?? base.toUpperCase();
  const previous = parts.at(-2)?.toUpperCase() ?? '';
  if (previous === 'UD' && /^IQ\d(?:_[A-Z0-9]+)+$/i.test(last)) return `UD-${last}`;
  if (/^(Q\d(?:_[A-Z0-9]+)+|Q\d_\d|IQ\d(?:_[A-Z0-9]+)+|BF16|F16|F32|FP16|FP32)$/i.test(last)) return last;
  return last;
}

export function getGgufVariantSortKey(file: HfFile): number {
  const label = getGgufVariantLabel(file.filename);
  const preferredIndex = PREFERRED_GGUF_ORDER.indexOf(label as typeof PREFERRED_GGUF_ORDER[number]);
  return preferredIndex === -1 ? Number.MAX_SAFE_INTEGER : preferredIndex;
}

export function detectClientThreadCount(): number {
  const concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8;
  return Math.max(2, Math.min(concurrency || 8, 8));
}

export function getDefaultTuning(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): LlmTuningConfig {
  const threads = detectClientThreadCount();
  if (profile === 'cuda') {
    return { ctxSize: 4096, threads, threadsBatch: 2, parallel: 1, batchSize: 2048, ubatchSize: 512, flashAttn: true, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0', gpuLayers: 999, noWarmup: false, promptCachePath: '', cacheRamMiB: 8192, attentionMaxBatch: 0, graphReuse: true, kCacheHadamard: false, cacheRamSimilarity: 0, cacheRamMinTokens: 0, defragThreshold: -1, mergeQkv: false, mergeUpGateExperts: false, schedulerAsync: false, promptCacheAll: false, promptCacheReadOnly: false };
  }
  if (profile === 'apple-silicon-experimental') {
    return { ctxSize: 4096, threads, threadsBatch: threads, parallel: 1, batchSize: 1024, ubatchSize: 512, flashAttn: true, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0', gpuLayers: 0, noWarmup: false, promptCachePath: '', cacheRamMiB: 8192, attentionMaxBatch: 0, graphReuse: true, kCacheHadamard: false, cacheRamSimilarity: 0, cacheRamMinTokens: 0, defragThreshold: -1, mergeQkv: false, mergeUpGateExperts: false, schedulerAsync: false, promptCacheAll: false, promptCacheReadOnly: false };
  }
  return { ctxSize: 4096, threads, threadsBatch: threads, parallel: 1, batchSize: 1024, ubatchSize: 256, flashAttn: true, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0', gpuLayers: 0, noWarmup: false, promptCachePath: '', cacheRamMiB: 8192, attentionMaxBatch: 0, graphReuse: true, kCacheHadamard: false, cacheRamSimilarity: 0, cacheRamMinTokens: 0, defragThreshold: -1, mergeQkv: false, mergeUpGateExperts: false, schedulerAsync: false, promptCacheAll: false, promptCacheReadOnly: false };
}

export function getPresetTuning(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental', preset: Exclude<TuningPreset, 'custom'>): LlmTuningConfig {
  const base = getDefaultTuning(profile);
  switch (preset) {
    case 'throughput': return { ...base, ctxSize: Math.max(base.ctxSize, 8192), parallel: profile === 'cuda' ? 4 : 2, batchSize: profile === 'cuda' ? 4096 : 2048, ubatchSize: profile === 'cuda' ? 1024 : 512, gpuLayers: profile === 'cuda' ? Math.max(base.gpuLayers, 999) : base.gpuLayers };
    case 'low-memory': return { ...base, ctxSize: 2048, threads: Math.min(base.threads, 4), threadsBatch: Math.min(base.threadsBatch, 4), parallel: 1, batchSize: 512, ubatchSize: 128, gpuLayers: profile === 'cuda' ? 32 : 0 };
    default: return base;
  }
}

export function areTuningsEqual(left: LlmTuningConfig, right: LlmTuningConfig): boolean {
  return left.ctxSize === right.ctxSize && left.threads === right.threads && left.threadsBatch === right.threadsBatch && left.parallel === right.parallel && left.batchSize === right.batchSize && left.ubatchSize === right.ubatchSize && left.flashAttn === right.flashAttn && left.cacheTypeK === right.cacheTypeK && left.cacheTypeV === right.cacheTypeV && left.gpuLayers === right.gpuLayers && left.noWarmup === right.noWarmup && left.promptCachePath === right.promptCachePath && left.cacheRamMiB === right.cacheRamMiB && left.attentionMaxBatch === right.attentionMaxBatch && left.graphReuse === right.graphReuse && left.kCacheHadamard === right.kCacheHadamard && left.cacheRamSimilarity === right.cacheRamSimilarity && left.cacheRamMinTokens === right.cacheRamMinTokens && left.defragThreshold === right.defragThreshold && left.mergeQkv === right.mergeQkv && left.mergeUpGateExperts === right.mergeUpGateExperts && left.schedulerAsync === right.schedulerAsync && left.promptCacheAll === right.promptCacheAll && left.promptCacheReadOnly === right.promptCacheReadOnly;
}

export function inferTuningPreset(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental', tuning: LlmTuningConfig): TuningPreset {
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'balanced'))) return 'balanced';
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'throughput'))) return 'throughput';
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'low-memory'))) return 'low-memory';
  return 'custom';
}

export function getIkCpuSweepCandidates(current: LlmTuningConfig): IkCpuSweepEntry[] {
  const hardwareThreads = typeof navigator !== 'undefined' ? Math.max(4, navigator.hardwareConcurrency || 8) : 8;
  const threadOptions = Array.from(new Set([Math.max(6, Math.min(hardwareThreads, current.threads)), Math.max(8, Math.min(hardwareThreads, current.threads + 2)), Math.max(10, Math.min(hardwareThreads, current.threads + 4))])).sort((a, b) => a - b);
  const base = { ...current, parallel: 1, gpuLayers: 0, noWarmup: false };
  return [
    { key: 'balanced', label: `Balanced CPU (${threadOptions[0] ?? current.threads}T / 1024 / 256)`, tuning: { ...base, threads: threadOptions[0] ?? current.threads, threadsBatch: threadOptions[0] ?? current.threads, batchSize: 1024, ubatchSize: 256 }, result: null, error: null },
    { key: 'throughput', label: `Throughput CPU (${threadOptions[1] ?? threadOptions[0] ?? current.threads}T / 1536 / 512)`, tuning: { ...base, threads: threadOptions[1] ?? threadOptions[0] ?? current.threads, threadsBatch: threadOptions[1] ?? threadOptions[0] ?? current.threads, batchSize: 1536, ubatchSize: 512 }, result: null, error: null },
    { key: 'max-batch', label: `High Batch (${threadOptions[2] ?? threadOptions[1] ?? current.threads}T / 2048 / 512)`, tuning: { ...base, threads: threadOptions[2] ?? threadOptions[1] ?? current.threads, threadsBatch: threadOptions[2] ?? threadOptions[1] ?? current.threads, batchSize: 2048, ubatchSize: 512 }, result: null, error: null },
    { key: 'wide-ubatch', label: `Wide Ubatch (${threadOptions[2] ?? threadOptions[1] ?? current.threads}T / 2048 / 1024)`, tuning: { ...base, threads: threadOptions[2] ?? threadOptions[1] ?? current.threads, threadsBatch: threadOptions[2] ?? threadOptions[1] ?? current.threads, batchSize: 2048, ubatchSize: 1024 }, result: null, error: null },
  ];
}

@Injectable()
export class LlmPageStore {
  private readonly http = inject(HttpClient);
  readonly llmHealth = inject(LlmHealthService);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private modelSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly Math = Math;

  // ── Status ────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly status = signal<LlmStatus | null>(null);

  // ── Installation ──────────────────────────────────────────────────
  readonly installStatus = signal<LlmInstallStatus | null>(null);
  readonly configDebug = signal<LlmConfigDebug | null>(null);
  readonly installing = signal(false);
  readonly installLog = signal<string | null>(null);
  readonly showInstallLog = signal(false);
  readonly buildFromSource = signal(false);
  readonly installProgress = signal<{ buildCurrent: number | null; buildTotal: number | null; elapsedSec: number | null } | null>(null);

  // ── Server management ─────────────────────────────────────────────
  readonly starting = signal(false);
  readonly stopping = signal(false);
  readonly serverMessage = signal<string | null>(null);
  readonly serverMessageSuccess = signal(false);

  // ── Versions ──────────────────────────────────────────────────────
  readonly versions = signal<VersionInfo[]>([]);
  readonly versionsLoading = signal(false);
  readonly selectedRuntime = signal<'mainline' | 'ik'>('mainline');
  readonly selectedProfile = signal<'cpu' | 'cuda' | 'apple-silicon-experimental'>('cpu');
  readonly selectedTuningPreset = signal<TuningPreset>('balanced');
  readonly tuning = signal<LlmTuningConfig>(getDefaultTuning('cpu'));
  readonly cacheTypeOptions = CACHE_TYPE_OPTIONS;
  readonly savedRecommendation = signal<LlmPresetRecommendation | null>(null);
  readonly selectedVersion = signal('');
  readonly installedVersion = signal<string | null>(null);
  readonly versionDropdownOpen = signal(false);

  // ── Model management ──────────────────────────────────────────────
  readonly modelSearchQuery = signal('');
  readonly modelSearchResults = signal<HfModel[]>([]);
  readonly modelSearching = signal(false);
  readonly selectedRepo = signal<string | null>(null);
  readonly showAllRepoFiles = signal(false);
  readonly repoFiles = signal<HfFile[]>([]);
  readonly repoFilesLoading = signal(false);
  readonly modelSizeLimitMb = signal(4096);
  readonly modelSettingsSaving = signal(false);
  readonly modelInstalling = signal(false);
  readonly installingModelFilename = signal<string | null>(null);
  readonly modelDownloadProgress = signal<{ downloadedMb: number; totalMb: number | null; progressPct: number | null; elapsedSec: number | null } | null>(null);
  readonly modelRemoving = signal(false);
  readonly modelMessage = signal<string | null>(null);
  readonly modelMessageSuccess = signal(false);

  // ── Test prompt ───────────────────────────────────────────────────
  readonly testPrompt = signal('Hello, respond with one word.');
  readonly thinkingMode = signal<'production' | 'thinking'>('production');
  readonly testRunning = signal(false);
  readonly testResult = signal<TestResult | null>(null);

  // ── Benchmark ─────────────────────────────────────────────────────
  readonly benchmarkPrompt = signal('Count from one to twenty in order using digits only.');
  readonly benchmarkRepeatCount = signal(3);
  readonly benchmarkMaxTokens = signal(128);
  readonly benchmarkRunning = signal(false);
  readonly recommendationBenchmarkRunning = signal(false);
  readonly benchmarkResult = signal<BenchmarkResult | null>(null);
  readonly benchmarkSweepRunning = signal(false);
  readonly benchmarkSweepResult = signal<BenchmarkSweepResult | null>(null);
  readonly ikCpuSweepRunning = signal(false);
  readonly ikCpuSweepResult = signal<IkCpuSweepResult | null>(null);

  // ── Test RFQ ──────────────────────────────────────────────────────
  readonly rfqText = signal('MV Pacific Voyager\nIMO 9876543\nFujairah Anchorage\nVLSFO 500 MT\nLSMGO 100 MT\nETA 15/03/2026');
  readonly rfqRunning = signal(false);
  readonly rfqResult = signal<TestResult & { parsed?: any } | null>(null);

  // ── Test Search ───────────────────────────────────────────────────
  readonly searchQuery = signal('What is the current price of VLSFO bunker fuel?');
  readonly searchRunning = signal(false);
  readonly searchResult = signal<TestResult | null>(null);

  // ── Prompts / KB ──────────────────────────────────────────────────
  readonly prompts = signal<PromptInfo[]>([]);
  readonly promptsLoading = signal(false);
  readonly selectedPromptId = signal<string | null>(null);
  readonly selectedPrompt = signal<PromptDetail | null>(null);
  readonly promptEditorContent = signal('');
  readonly promptSaving = signal(false);
  readonly promptMessage = signal<string | null>(null);
  readonly promptMessageSuccess = signal(false);
  readonly newPromptId = signal('');
  readonly creatingPrompt = signal(false);
  readonly showNewPromptInput = signal(false);

  // ── Lifecycle ─────────────────────────────────────────────────────

  async init(): Promise<void> {
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug(), this.loadPrompts()]);
    this.loading.set(false);
    this.pollTimer = setInterval(() => this.pollHealth(), 30_000);
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.modelSearchTimer) clearTimeout(this.modelSearchTimer);
  }

  // ── Status ────────────────────────────────────────────────────────

  async loadStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<LlmStatus>>(`${API}/admin/llm/status`));
      this.status.set(res.data ?? null);
      if (res.data?.tuning) {
        this.tuning.set({ ...res.data.tuning });
        this.selectedTuningPreset.set(inferTuningPreset(res.data.profile, res.data.tuning));
      }
      this.savedRecommendation.set(res.data?.recommendation ?? null);
    } catch { this.status.set(null); }
  }

  async loadInstallStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<LlmInstallStatus>>(`${API}/admin/llm/install/status`));
      this.installStatus.set(res.data ?? null);
      if (res.data?.maxModelSizeMb) this.modelSizeLimitMb.set(res.data.maxModelSizeMb);
      if (res.data?.runtime) this.selectedRuntime.set(res.data.runtime);
      if (res.data?.profile) this.selectedProfile.set(res.data.profile);
      if (res.data?.tuning) { this.tuning.set({ ...res.data.tuning }); this.selectedTuningPreset.set(inferTuningPreset(res.data.profile, res.data.tuning)); }
      this.savedRecommendation.set(res.data?.recommendation ?? null);
      if (res.data) this.buildFromSource.set(res.data.runtime === 'ik' ? true : res.data.buildFromSource);
      if (res.data?.llamaCppVersion) { this.installedVersion.set(res.data.llamaCppVersion); if (!this.selectedVersion()) this.selectedVersion.set(res.data.llamaCppVersion); }
    } catch { this.installStatus.set(null); }
  }

  async loadConfigDebug(): Promise<void> {
    try { const res = await firstValueFrom(this.http.get<ApiResponse<LlmConfigDebug>>(`${API}/admin/llm/config`)); this.configDebug.set(res.data ?? null); } catch { this.configDebug.set(null); }
  }

  downloadConfigDebug(): void {
    const debug = this.configDebug();
    if (!debug) return;
    const blob = new Blob([debug.rawJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const runtime = this.selectedRuntime();
    const profile = this.selectedProfile();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `llm-runtime-config-${runtime}-${profile}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async copyConfigDebug(): Promise<void> {
    const debug = this.configDebug();
    if (!debug) return;
    try { await navigator.clipboard.writeText(debug.rawJson); this.serverMessage.set('Config JSON copied to clipboard.'); this.serverMessageSuccess.set(true); }
    catch { this.serverMessage.set('Unable to copy config JSON to clipboard.'); this.serverMessageSuccess.set(false); }
  }

  async saveModelSettings(): Promise<void> {
    const maxModelSizeMb = Math.max(1, Math.round(this.modelSizeLimitMb()));
    this.modelSettingsSaving.set(true);
    this.modelMessage.set(null);
    try {
      await firstValueFrom(this.http.post<ApiResponse<LlmConfigDebug>>(`${API}/admin/llm/config`, { maxModelSizeMb }));
      this.modelSizeLimitMb.set(maxModelSizeMb);
      this.modelMessage.set(`Saved model install limit to ${maxModelSizeMb} MB.`);
      this.modelMessageSuccess.set(true);
      await Promise.all([this.loadInstallStatus(), this.loadConfigDebug()]);
      if (this.selectedRepo()) await this.selectModelRepo(this.selectedRepo()!);
    } catch (err: any) { this.modelMessage.set(err?.error?.error ?? err?.error?.message ?? 'Failed to save model settings'); this.modelMessageSuccess.set(false); }
    this.modelSettingsSaving.set(false);
  }

  async copyInstallLog(): Promise<void> {
    const log = this.installLog();
    if (!log) return;
    try { await navigator.clipboard.writeText(log); this.serverMessage.set('Install log copied to clipboard.'); this.serverMessageSuccess.set(true); }
    catch { this.serverMessage.set('Unable to copy install log to clipboard.'); this.serverMessageSuccess.set(false); }
  }

  async refreshStatus(): Promise<void> {
    this.refreshing.set(true);
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.refreshing.set(false);
  }

  private async pollHealth(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ healthy: boolean; searchAvailable: boolean }>>(`${API}/admin/llm/health`));
      const current = this.status();
      if (current) this.status.set({ ...current, healthy: res.data?.healthy ?? false, searchAvailable: res.data?.searchAvailable ?? false });
    } catch { const current = this.status(); if (current) this.status.set({ ...current, healthy: false }); }
  }

  // ── Versions ──────────────────────────────────────────────────────

  async loadVersions(): Promise<void> {
    this.versionsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ versions: VersionInfo[]; installed: string | null }>>(`${API}/admin/llm/versions`, { params: { runtime: this.selectedRuntime() } }));
      this.versions.set(res.data?.versions ?? []);
      this.installedVersion.set(res.data?.installed ?? null);
      if (!this.selectedVersion() && res.data?.versions?.length) this.selectedVersion.set(res.data.versions[0].tag);
    } catch { this.versions.set([]); }
    this.versionsLoading.set(false);
  }

  toggleVersionDropdown(): void {
    if (!this.versionDropdownOpen() && this.versions().length === 0) this.loadVersions();
    this.versionDropdownOpen.set(!this.versionDropdownOpen());
  }

  selectVersion(tag: string): void { this.selectedVersion.set(tag); this.versionDropdownOpen.set(false); }

  onRuntimeChange(runtime: 'mainline' | 'ik'): void {
    this.selectedRuntime.set(runtime);
    if (runtime === 'ik') this.buildFromSource.set(true);
    else this.buildFromSource.set(false);
    this.selectedVersion.set('');
    this.versions.set([]);
    this.versionDropdownOpen.set(false);
    this.loadVersions();
  }

  onProfileChange(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): void { this.selectedProfile.set(profile); this.applyTuningPreset('balanced', profile); }
  resetTuningToDefaults(): void { this.applyTuningPreset('balanced'); }

  applyTuningPreset(preset: Exclude<TuningPreset, 'custom'>, profile = this.selectedProfile()): void {
    this.tuning.set(getPresetTuning(profile, preset));
    this.selectedTuningPreset.set(preset);
  }

  applySavedRecommendation(): void {
    const r = this.savedRecommendation();
    if (!r) return;
    if (r.tuning) { this.tuning.set({ ...r.tuning }); this.selectedTuningPreset.set('custom'); return; }
    if (r.preset !== 'custom') this.applyTuningPreset(r.preset, r.profile);
  }

  hasRecommendationDrift(): boolean {
    const r = this.savedRecommendation();
    if (!r) return false;
    return r.tuning ? !areTuningsEqual(this.tuning(), r.tuning) : this.selectedTuningPreset() !== r.preset;
  }

  async rebenchmarkSavedRecommendation(): Promise<void> {
    const recommendation = this.savedRecommendation();
    if (!recommendation) return;
    this.recommendationBenchmarkRunning.set(true);
    this.serverMessage.set(`Re-benchmarking ${this.recommendationDisplayLabel(recommendation)} recommendation…`);
    this.serverMessageSuccess.set(true);
    const ot = { ...this.tuning() };
    const op = this.selectedTuningPreset();
    const oh = this.status()?.healthy ?? false;
    const rt = recommendation.tuning ? { ...recommendation.tuning } : getPresetTuning(recommendation.profile, recommendation.preset === 'custom' ? 'balanced' : recommendation.preset);
    try {
      this.tuning.set(rt); this.selectedTuningPreset.set(recommendation.tuning ? 'custom' : recommendation.preset);
      await this.requestStopServer();
      const start = await this.requestStartServer(rt);
      if (!start.started) { this.serverMessage.set(start.message); this.serverMessageSuccess.set(false); return; }
      const result = await this.requestBenchmark();
      this.benchmarkResult.set(result);
      await this.saveRecommendation(recommendation.preset, result, recommendation.label ?? null, recommendation.tuning ?? rt);
      this.serverMessage.set(`Recommendation refreshed for ${this.recommendationDisplayLabel(recommendation)}.`); this.serverMessageSuccess.set(true);
    } catch (err: any) { this.serverMessage.set(err?.error?.message ?? err?.message ?? 'Failed to re-benchmark recommendation'); this.serverMessageSuccess.set(false); }
    finally {
      this.tuning.set(ot); this.selectedTuningPreset.set(op);
      try { await this.requestStopServer(); if (oh) await this.requestStartServer(ot); } catch { this.serverMessage.set('Recommendation benchmark finished, but the original server state could not be fully restored.'); this.serverMessageSuccess.set(false); }
      await this.loadStatus(); this.llmHealth.refresh(); this.recommendationBenchmarkRunning.set(false);
    }
  }

  updateNumericTuning(key: 'ctxSize' | 'threads' | 'threadsBatch' | 'parallel' | 'batchSize' | 'ubatchSize' | 'gpuLayers' | 'cacheRamMiB' | 'attentionMaxBatch' | 'cacheRamMinTokens', value: number | string, minimum: number): void {
    const p = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(p)) return;
    const nv = Math.max(minimum, Math.round(p));
    this.tuning.update((c) => ({ ...c, [key]: nv, ...(key === 'cacheRamMiB' && nv <= 0 ? { cacheRamSimilarity: 0, cacheRamMinTokens: 0 } : {}) }));
    this.selectedTuningPreset.set('custom');
  }

  updateFloatTuning(key: 'cacheRamSimilarity' | 'defragThreshold', value: number | string, min: number, max: number): void {
    const p = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(p)) return;
    this.tuning.update((c) => ({ ...c, [key]: Math.min(max, Math.max(min, p)) }));
    this.selectedTuningPreset.set('custom');
  }

  updateStringTuning(key: 'cacheTypeK' | 'cacheTypeV' | 'promptCachePath', value: string): void {
    const t = value.trim();
    this.tuning.update((c) => ({ ...c, [key]: key === 'promptCachePath' ? t : (t || c[key]), ...(key === 'promptCachePath' && !t ? { promptCacheAll: false, promptCacheReadOnly: false } : {}) }));
    this.selectedTuningPreset.set('custom');
  }

  hasPromptCachePath(): boolean { return !!this.tuning().promptCachePath.trim(); }
  hasCacheRamEnabled(): boolean { return this.tuning().cacheRamMiB > 0; }

  hasUnsafeExperimentalEnabled(): boolean {
    const t = this.tuning();
    return t.cacheRamSimilarity > 0 || t.cacheRamMinTokens > 0 || t.defragThreshold >= 0 || t.mergeQkv || t.mergeUpGateExperts || t.schedulerAsync || t.promptCacheAll || t.promptCacheReadOnly;
  }

  resetUnsafeExperimentalTuning(): void {
    this.tuning.update((c) => ({ ...c, cacheRamSimilarity: 0, cacheRamMinTokens: 0, defragThreshold: -1, mergeQkv: false, mergeUpGateExperts: false, schedulerAsync: false, promptCacheAll: false, promptCacheReadOnly: false }));
    this.selectedTuningPreset.set('custom');
  }

  updateBooleanTuning(key: 'flashAttn' | 'noWarmup' | 'graphReuse' | 'kCacheHadamard' | 'mergeQkv' | 'mergeUpGateExperts' | 'schedulerAsync' | 'promptCacheAll' | 'promptCacheReadOnly', value: boolean): void {
    this.tuning.update((c) => ({ ...c, [key]: !!value })); this.selectedTuningPreset.set('custom');
  }

  private getApiErrorMessage(response: unknown, fallback: string): string {
    const c = response as { message?: string; error?: string; data?: { message?: string | null; error?: string | null } | null };
    return c?.error ?? c?.message ?? c?.data?.error ?? c?.data?.message ?? fallback;
  }

  // ── Install binary ────────────────────────────────────────────────

  async runInstall(): Promise<void> {
    this.installing.set(true); this.installLog.set(null); this.showInstallLog.set(true); this.serverMessage.set(null); this.installProgress.set(null);
    try {
      const version = this.selectedVersion() || undefined;
      const bfs = this.selectedRuntime() === 'ik' ? true : this.buildFromSource();
      const res = await firstValueFrom(this.http.post<ApiResponse<{ message: string }>>(`${API}/admin/llm/install`, { version, buildFromSource: bfs, runtime: this.selectedRuntime(), profile: this.selectedProfile(), tuning: this.tuning() }));
      if (!res.success) { const fm = this.getApiErrorMessage(res, 'Install failed'); this.installLog.set(fm); this.serverMessage.set(`Installation failed\n\n${fm}`); this.serverMessageSuccess.set(false); this.installing.set(false); return; }
      this.serverMessage.set(res.data?.message ?? 'Installing…'); this.serverMessageSuccess.set(true);
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const p = await firstValueFrom(this.http.get<ApiResponse<{ status: string; step: string; log: string; error: string | null; elapsedSec: number | null; buildCurrent: number | null; buildTotal: number | null }>>(`${API}/admin/llm/install/progress`));
          const d = p.data;
          if (d) {
            const el = d.log || d.error || d.step || 'Working…';
            this.installLog.set(el); this.serverMessage.set(d.status === 'error' && d.error ? `Installation failed\n\n${d.error}` : (d.step || 'Installing…')); this.serverMessageSuccess.set(d.status !== 'error');
            this.installProgress.set({ buildCurrent: d.buildCurrent, buildTotal: d.buildTotal, elapsedSec: d.elapsedSec });
            if (d.status === 'done') { this.serverMessage.set('Installation complete'); this.serverMessageSuccess.set(true); break; }
            if (d.status === 'error') { this.serverMessage.set(`Installation failed\n\n${d.error ?? 'Install failed'}`); this.serverMessageSuccess.set(false); break; }
          }
        } catch { /* poll */ }
      }
    } catch (err: any) { const fm = err?.error?.error ?? err?.error?.message ?? err?.message ?? 'Install request failed'; this.installLog.set(fm); this.serverMessage.set(`Installation failed\n\n${fm}`); this.serverMessageSuccess.set(false); }
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.installing.set(false); this.installProgress.set(null);
  }

  // ── Utilities ─────────────────────────────────────────────────────

  formatDuration(sec: number | null): string {
    if (sec === null || sec < 0) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  clampBenchmarkValue(value: number | string, minimum: number, maximum: number): number {
    const p = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(p)) return minimum;
    return Math.max(minimum, Math.min(maximum, Math.round(p)));
  }

  presetLabel(preset: TuningPreset): string {
    switch (preset) { case 'throughput': return 'Throughput'; case 'low-memory': return 'Low Memory'; case 'custom': return 'Custom'; default: return 'Balanced'; }
  }

  recommendationDisplayLabel(recommendation: LlmPresetRecommendation): string { return recommendation.label?.trim() || this.presetLabel(recommendation.preset); }
  recommendationHistoryLabel(entry: LlmRecommendationHistoryEntry): string { return entry.label?.trim() || this.presetLabel(entry.preset); }

  cacheTypeDescription(value: string): string {
    return this.cacheTypeOptions.find((e) => e.value === value)?.description ?? 'Common runtime option. Match K and V unless benchmarking suggests otherwise.';
  }

  recommendationTrendLabel(recommendation: LlmPresetRecommendation): 'Improving' | 'Stable' | 'Regressing' {
    const d = this.recommendationTrendDelta(recommendation);
    if (d > 0.05) return 'Improving';
    if (d < -0.05) return 'Regressing';
    return 'Stable';
  }

  recommendationTrendTone(recommendation: LlmPresetRecommendation): string {
    switch (this.recommendationTrendLabel(recommendation)) { case 'Improving': return 'bg-green-100 text-green-800'; case 'Regressing': return 'bg-amber-100 text-amber-900'; default: return 'bg-slate-100 text-slate-700'; }
  }

  recommendationSparklineColor(recommendation: LlmPresetRecommendation): string {
    switch (this.recommendationTrendLabel(recommendation)) { case 'Improving': return 'text-green-700'; case 'Regressing': return 'text-amber-700'; default: return 'text-slate-500'; }
  }

  recommendationSparklinePoints(recommendation: LlmPresetRecommendation): string {
    const v = recommendation.history.slice(0, 6).reverse().map((e) => e.averageTokensPerSecond).filter((x): x is number => x != null);
    if (v.length === 0) return '0,12 100,12';
    if (v.length === 1) return `0,12 100,${12 - Math.min(8, Math.max(-8, v[0] / 100))}`;
    const min = Math.min(...v); const max = Math.max(...v); const range = max - min || 1;
    return v.map((val, i) => { const x = (i / (v.length - 1)) * 100; const y = 20 - (((val - min) / range) * 16 + 2); return `${x},${y}`; }).join(' ');
  }

  private recommendationTrendDelta(recommendation: LlmPresetRecommendation): number {
    const v = recommendation.history.slice(0, 6).map((e) => e.averageTokensPerSecond).filter((x): x is number => x != null);
    if (v.length < 2) return 0;
    return (v[0] - v[v.length - 1]) / v[v.length - 1];
  }

  // ── Server start / stop ───────────────────────────────────────────

  async startServer(): Promise<void> {
    this.starting.set(true); this.serverMessage.set(null);
    try { const res = await this.requestStartServer(); this.serverMessage.set(res.message ?? 'Unknown'); this.serverMessageSuccess.set(res.started ?? false); }
    catch (err: any) { this.serverMessage.set(err?.error?.message ?? 'Start request failed'); this.serverMessageSuccess.set(false); }
    await this.loadStatus(); this.llmHealth.refresh(); this.starting.set(false);
  }

  async stopServer(): Promise<void> {
    this.stopping.set(true); this.serverMessage.set(null);
    try { const res = await this.requestStopServer(); this.serverMessage.set(res.message ?? 'Unknown'); this.serverMessageSuccess.set(res.stopped ?? false); }
    catch (err: any) { this.serverMessage.set(err?.error?.message ?? 'Stop request failed'); this.serverMessageSuccess.set(false); }
    await this.loadStatus(); this.llmHealth.refresh(); this.stopping.set(false);
  }

  private async requestStartServer(tuning = this.tuning()): Promise<{ started: boolean; message: string }> {
    const res = await firstValueFrom(this.http.post<ApiResponse<{ started: boolean; message: string }>>(`${API}/admin/llm/start`, { runtime: this.selectedRuntime(), profile: this.selectedProfile(), tuning }));
    return res.data ?? { started: false, message: 'Unknown' };
  }

  private async requestStopServer(): Promise<{ stopped: boolean; message: string }> {
    const res = await firstValueFrom(this.http.post<ApiResponse<{ stopped: boolean; message: string }>>(`${API}/admin/llm/stop`, {}));
    return res.data ?? { stopped: false, message: 'Unknown' };
  }

  private async requestBenchmark(): Promise<BenchmarkResult | null> {
    const res = await firstValueFrom(this.http.post<ApiResponse<BenchmarkResult>>(`${API}/admin/llm/benchmark`, { prompt: this.benchmarkPrompt(), repeatCount: this.benchmarkRepeatCount(), maxTokens: this.benchmarkMaxTokens(), thinkingMode: this.thinkingMode() }));
    return res.data ?? null;
  }

  private async saveRecommendation(preset: TuningPreset, result: BenchmarkResult | null, label: string | null = null, tuning: LlmTuningConfig | null = null): Promise<void> {
    const recordedAt = new Date().toISOString();
    await firstValueFrom(this.http.post<ApiResponse<{ saved: boolean }>>(`${API}/admin/llm/recommendation`, { preset, label, tuning, runtime: this.selectedRuntime(), profile: this.selectedProfile(), averageTokensPerSecond: result?.averageTokensPerSecond ?? null, averageDurationMs: result?.averageDurationMs ?? null }));
    const prev = this.savedRecommendation()?.history ?? [];
    this.savedRecommendation.set({ preset, label, runtime: this.selectedRuntime(), profile: this.selectedProfile(), averageTokensPerSecond: result?.averageTokensPerSecond ?? null, averageDurationMs: result?.averageDurationMs ?? null, recordedAt, tuning, history: [{ preset, label, averageTokensPerSecond: result?.averageTokensPerSecond ?? null, averageDurationMs: result?.averageDurationMs ?? null, recordedAt }, ...prev].slice(0, 10) });
  }

  profileLabel(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): string {
    switch (profile) { case 'cuda': return 'NVIDIA CUDA'; case 'apple-silicon-experimental': return 'Apple Silicon Experimental'; default: return 'CPU-only'; }
  }

  runtimeCompatibilityWarning(): string | null {
    if (this.selectedRuntime() === 'ik' && this.selectedProfile() === 'apple-silicon-experimental') return 'ik_llama.cpp is currently unstable on the Apple Silicon Experimental (Metal) profile. Use CPU-only on macOS for this runtime.';
    return null;
  }

  runtimeSourceRepo(runtime: 'mainline' | 'ik'): string { return runtime === 'ik' ? 'ikawrakow/ik_llama.cpp' : 'ggml-org/llama.cpp'; }
  ggufVariantLabel(file: HfFile): string { return getGgufVariantLabel(file.filename); }
  ggufFriendlyLabel(file: HfFile): string { return QUANTIZATION_FRIENDLY_LABELS[this.ggufVariantLabel(file)] ?? 'Alternative'; }
  ggufVariantDescription(file: HfFile): string { return QUANTIZATION_DESCRIPTIONS[this.ggufVariantLabel(file)] ?? 'Alternative quantization variant.'; }
  ggufDownloadSizeMb(file: HfFile): number | null { return file.splitTotalMb ?? file.sizeMb; }
  isInstallingRepoFile(file: HfFile): boolean { return this.modelInstalling() && this.installingModelFilename() === file.filename; }

  visibleRepoFiles(): HfFile[] {
    const files = [...this.repoFiles()].sort((a, b) => { const p = getGgufVariantSortKey(a) - getGgufVariantSortKey(b); return p !== 0 ? p : this.ggufVariantLabel(a).localeCompare(this.ggufVariantLabel(b)); });
    if (this.showAllRepoFiles() || files.length <= 8) return files;
    const curated: HfFile[] = []; const seen = new Set<string>();
    for (const f of files) { const l = this.ggufVariantLabel(f); if (getGgufVariantSortKey(f) === Number.MAX_SAFE_INTEGER || seen.has(l)) continue; curated.push(f); seen.add(l); if (curated.length >= 6) break; }
    return curated.length > 0 ? curated : files.slice(0, 8);
  }

  hiddenRepoFileCount(): number { return Math.max(0, this.repoFiles().length - this.visibleRepoFiles().length); }
  versionDisplayLabel(tag: string): string { return this.selectedRuntime() !== 'ik' ? tag : tag === 'main' ? `${tag} (latest branch)` : `${tag} (pinned tag)`; }
  thinkingModeLabel(): string { return this.thinkingMode() === 'thinking' ? 'Raw reasoning' : 'Production answers'; }
  ikSweepRecommendedLabel(result: IkCpuSweepResult): string { return result.entries.find((e) => e.key === result.recommendedKey)?.label ?? 'Unknown'; }

  // ── Model management ──────────────────────────────────────────────

  onModelSearchInput(query: string): void {
    this.modelSearchQuery.set(query);
    if (this.modelSearchTimer) clearTimeout(this.modelSearchTimer);
    if (query.trim().length < 2) { this.modelSearchResults.set([]); return; }
    this.modelSearchTimer = setTimeout(() => this.searchModels(), 400);
  }

  async searchModels(): Promise<void> {
    const q = this.modelSearchQuery().trim();
    if (q.length < 2) return;
    this.modelSearching.set(true);
    try { const res = await firstValueFrom(this.http.get<ApiResponse<HfModel[]>>(`${API}/admin/llm/models/search`, { params: { q } })); this.modelSearchResults.set(res.data ?? []); }
    catch { this.modelSearchResults.set([]); }
    this.modelSearching.set(false);
  }

  async selectModelRepo(repoId: string): Promise<void> {
    this.selectedRepo.set(repoId); this.showAllRepoFiles.set(false); this.repoFilesLoading.set(true); this.modelSearchResults.set([]);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ repoId: string; files: HfFile[]; maxModelSizeMb: number }>>(`${API}/admin/llm/models/files`, { params: { repoId } }));
      this.repoFiles.set(res.data?.files ?? []);
      if (res.data?.maxModelSizeMb) this.modelSizeLimitMb.set(res.data.maxModelSizeMb);
    } catch { this.repoFiles.set([]); }
    this.repoFilesLoading.set(false);
  }

  async installModel(repoId: string, filename: string): Promise<void> {
    this.modelInstalling.set(true); this.installingModelFilename.set(filename); this.modelMessage.set('Starting download…'); this.modelMessageSuccess.set(true); this.modelDownloadProgress.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<{ message: string }>>(`${API}/admin/llm/models/install`, { repoId, filename }));
      if (!res.success) { this.modelMessage.set((res as any).error ?? 'Install failed'); this.modelMessageSuccess.set(false); this.modelInstalling.set(false); this.installingModelFilename.set(null); return; }
      const poll = async (): Promise<boolean> => {
        try {
          const s = await firstValueFrom(this.http.get<ApiResponse<{ status: string; downloadedMb: number; totalMb: number | null; progressPct: number | null; sizeMb: number | null; error: string | null; elapsedSec: number | null }>>(`${API}/admin/llm/models/download-status`));
          const d = s.data!;
          if (d.status === 'downloading') { this.modelDownloadProgress.set({ downloadedMb: d.downloadedMb, totalMb: d.totalMb, progressPct: d.progressPct, elapsedSec: d.elapsedSec }); this.modelMessage.set(`Downloading… ${d.downloadedMb}${d.totalMb ? '/' + d.totalMb : ''} MB${d.progressPct != null ? ` (${d.progressPct}%)` : ''}`); return false; }
          if (d.status === 'done') { this.modelMessage.set(`Installed ${filename} (${d.sizeMb} MB)`); this.modelMessageSuccess.set(true); this.selectedRepo.set(null); this.repoFiles.set([]); return true; }
          if (d.status === 'error') { this.modelMessage.set(d.error ?? 'Download failed'); this.modelMessageSuccess.set(false); return true; }
          return false;
        } catch { return false; }
      };
      for (let i = 0; i < 21600; i++) { await new Promise(r => setTimeout(r, 2000)); const done = await poll(); if (done) break; }
    } catch (err: any) { this.modelMessage.set(err?.error?.error ?? err?.error?.message ?? 'Install failed'); this.modelMessageSuccess.set(false); }
    this.modelDownloadProgress.set(null);
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.modelInstalling.set(false); this.installingModelFilename.set(null);
  }

  async removeModel(): Promise<void> {
    this.modelRemoving.set(true); this.modelMessage.set(null);
    try { const res = await firstValueFrom(this.http.delete<ApiResponse<{ removed: string }>>(`${API}/admin/llm/models`)); this.modelMessage.set(res.success ? `Removed ${res.data?.removed}` : 'Remove failed'); this.modelMessageSuccess.set(res.success); }
    catch (err: any) { this.modelMessage.set(err?.error?.message ?? 'Remove failed'); this.modelMessageSuccess.set(false); }
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]); this.modelRemoving.set(false);
  }

  // ── Tests ─────────────────────────────────────────────────────────

  async runTestPrompt(): Promise<void> {
    this.testRunning.set(true); this.testResult.set(null);
    try { const res = await firstValueFrom(this.http.post<ApiResponse<TestResult>>(`${API}/admin/llm/test`, { prompt: this.testPrompt(), thinkingMode: this.thinkingMode() })); this.testResult.set(res.data ?? null); }
    catch (err: any) { this.testResult.set({ success: false, durationMs: 0, input: this.testPrompt(), output: null, reasoning: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null }); }
    this.testRunning.set(false);
  }

  async runBenchmark(): Promise<void> {
    this.benchmarkRunning.set(true); this.benchmarkResult.set(null);
    try { this.benchmarkResult.set(await this.requestBenchmark()); }
    catch (err: any) { this.benchmarkResult.set({ prompt: this.benchmarkPrompt(), maxTokens: this.benchmarkMaxTokens(), repeatCount: this.benchmarkRepeatCount(), successCount: 0, averageDurationMs: null, averageTokensPerSecond: null, totalTokensUsed: null, outputSample: null, runs: [{ run: 1, success: false, durationMs: 0, tokensUsed: null, tokensPerSecond: null, error: err?.error?.message ?? 'Benchmark request failed' }] }); }
    this.benchmarkRunning.set(false);
  }

  async runPresetBenchmarkSweep(): Promise<void> {
    this.benchmarkSweepRunning.set(true); this.benchmarkSweepResult.set(null); this.serverMessage.set('Benchmarking presets…'); this.serverMessageSuccess.set(true);
    const ot = { ...this.tuning() }; const op = this.selectedTuningPreset(); const oh = this.status()?.healthy ?? false;
    const presets: Array<Exclude<TuningPreset, 'custom'>> = ['throughput', 'balanced', 'low-memory'];
    const entries: BenchmarkSweepEntry[] = [];
    try {
      for (const preset of presets) {
        const t = getPresetTuning(this.selectedProfile(), preset); this.tuning.set(t); this.selectedTuningPreset.set(preset); this.serverMessage.set(`Benchmarking ${this.presetLabel(preset)} preset…`);
        try { await this.requestStopServer(); const start = await this.requestStartServer(t); if (!start.started) { entries.push({ preset, label: this.presetLabel(preset), result: null, error: start.message }); continue; } const result = await this.requestBenchmark(); entries.push({ preset, label: this.presetLabel(preset), result, error: result ? null : 'Benchmark returned no data' }); }
        catch (err: any) { entries.push({ preset, label: this.presetLabel(preset), result: null, error: err?.error?.message ?? err?.message ?? 'Preset benchmark failed' }); }
      }
      const recommended = entries.filter((e) => e.result?.averageTokensPerSecond != null).sort((a, b) => (b.result?.averageTokensPerSecond ?? 0) - (a.result?.averageTokensPerSecond ?? 0))[0]?.preset ?? null;
      this.benchmarkSweepResult.set({ entries, recommendedPreset: recommended });
      if (recommended) { const re = entries.find((e) => e.preset === recommended) ?? null; await this.saveRecommendation(recommended, re?.result ?? null, null, getPresetTuning(this.selectedProfile(), recommended)); }
      this.serverMessage.set(recommended ? `Preset sweep complete. Recommended: ${this.presetLabel(recommended)}.` : 'Preset sweep complete. No clear recommendation.'); this.serverMessageSuccess.set(recommended !== null);
    } finally {
      this.tuning.set(ot); this.selectedTuningPreset.set(op);
      try { await this.requestStopServer(); if (oh) await this.requestStartServer(ot); } catch { this.serverMessage.set('Preset sweep finished, but the original server state could not be fully restored.'); this.serverMessageSuccess.set(false); }
      await this.loadStatus(); this.llmHealth.refresh(); this.benchmarkSweepRunning.set(false);
    }
  }

  async runIkCpuBenchmarkSweep(): Promise<void> {
    this.ikCpuSweepRunning.set(true); this.ikCpuSweepResult.set(null); this.serverMessage.set('Benchmarking ik CPU candidates…'); this.serverMessageSuccess.set(true);
    const ot = { ...this.tuning() }; const op = this.selectedTuningPreset(); const oh = this.status()?.healthy ?? false;
    const entries = getIkCpuSweepCandidates(this.tuning()); let tt = { ...ot }; let tp = op;
    try {
      for (const entry of entries) {
        this.tuning.set({ ...entry.tuning }); this.selectedTuningPreset.set('custom'); this.serverMessage.set(`Benchmarking ${entry.label}…`);
        try { await this.requestStopServer(); const start = await this.requestStartServer(entry.tuning); if (!start.started) { entry.error = start.message; continue; } entry.result = await this.requestBenchmark(); entry.error = entry.result ? null : 'Benchmark returned no data'; } catch (err: any) { entry.error = err?.error?.message ?? err?.message ?? 'ik CPU benchmark failed'; }
      }
      const recommended = entries.filter((e) => e.result?.averageTokensPerSecond != null).sort((a, b) => (b.result?.averageTokensPerSecond ?? 0) - (a.result?.averageTokensPerSecond ?? 0))[0] ?? null;
      this.ikCpuSweepResult.set({ entries, recommendedKey: recommended?.key ?? null });
      if (recommended) { tt = { ...recommended.tuning }; tp = 'custom'; this.benchmarkResult.set(recommended.result); await this.saveRecommendation('custom', recommended.result, `ik CPU sweep (${recommended.label})`, recommended.tuning); this.serverMessage.set(`ik CPU sweep complete. Applied ${recommended.label}.` + (oh ? '' : ' Start the server to persist these settings.')); this.serverMessageSuccess.set(true); }
      else { this.serverMessage.set('ik CPU sweep complete, but no candidate produced a clear recommendation.'); this.serverMessageSuccess.set(false); }
    } finally {
      this.tuning.set(tt); this.selectedTuningPreset.set(tp);
      try { await this.requestStopServer(); if (oh) await this.requestStartServer(tt); } catch { this.serverMessage.set('ik CPU sweep finished, but the server could not be fully restored.'); this.serverMessageSuccess.set(false); }
      await this.loadStatus(); this.llmHealth.refresh(); this.ikCpuSweepRunning.set(false);
    }
  }

  // ── Tests (continued) ─────────────────────────────────────────────

  async runTestRfq(): Promise<void> {
    this.rfqRunning.set(true); this.rfqResult.set(null);
    try { const res = await firstValueFrom(this.http.post<ApiResponse<TestResult & { parsed: any }>>(`${API}/admin/llm/test-rfq`, { rfqText: this.rfqText() })); this.rfqResult.set(res.data ?? null); }
    catch (err: any) { this.rfqResult.set({ success: false, durationMs: 0, input: this.rfqText(), output: null, reasoning: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null, parsed: null }); }
    this.rfqRunning.set(false);
  }

  async runTestSearch(): Promise<void> {
    this.searchRunning.set(true); this.searchResult.set(null);
    try { const res = await firstValueFrom(this.http.post<ApiResponse<TestResult>>(`${API}/admin/llm/test-search`, { query: this.searchQuery() })); this.searchResult.set(res.data ?? null); }
    catch (err: any) { this.searchResult.set({ success: false, durationMs: 0, input: this.searchQuery(), output: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null }); }
    this.searchRunning.set(false);
  }

  // ── Prompts / KB ──────────────────────────────────────────────────

  async loadPrompts(): Promise<void> {
    this.promptsLoading.set(true);
    try { const res = await firstValueFrom(this.http.get<ApiResponse<PromptInfo[]>>(`${API}/admin/llm/prompts`)); const list = res.data ?? []; this.prompts.set(list); if (list.length && !this.selectedPromptId()) await this.selectPrompt(list[0].id); }
    catch { this.prompts.set([]); }
    this.promptsLoading.set(false);
  }

  async selectPrompt(id: string): Promise<void> {
    this.selectedPromptId.set(id); this.promptMessage.set(null);
    try { const res = await firstValueFrom(this.http.get<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts/${id}`)); const p = res.data ?? null; this.selectedPrompt.set(p); this.promptEditorContent.set(p?.content ?? ''); }
    catch { this.selectedPrompt.set(null); this.promptEditorContent.set(''); }
  }

  async savePrompt(): Promise<void> {
    const id = this.selectedPromptId();
    if (!id) return;
    this.promptSaving.set(true); this.promptMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.put<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts/${id}`, { content: this.promptEditorContent() }));
      if (res.success && res.data) { this.selectedPrompt.set(res.data); this.promptEditorContent.set(res.data.content); this.promptMessage.set('Saved'); this.promptMessageSuccess.set(true); this.loadPrompts(); }
      else { this.promptMessage.set((res as any).error ?? 'Save failed'); this.promptMessageSuccess.set(false); }
    } catch (err: any) { this.promptMessage.set(err?.error?.message ?? 'Save failed'); this.promptMessageSuccess.set(false); }
    this.promptSaving.set(false);
    setTimeout(() => this.promptMessage.set(null), 3000);
  }

  async createNewPrompt(): Promise<void> {
    const id = this.newPromptId().trim();
    if (!id) return;
    this.creatingPrompt.set(true); this.promptMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts`, { id, content: `# ${id}\n\nDescribe the system prompt for this workflow here.\n` }));
      if (res.success) { this.newPromptId.set(''); this.showNewPromptInput.set(false); await this.loadPrompts(); await this.selectPrompt(id); }
      else { this.promptMessage.set((res as any).error ?? 'Create failed'); this.promptMessageSuccess.set(false); }
    } catch (err: any) { this.promptMessage.set(err?.error?.message ?? 'Create failed'); this.promptMessageSuccess.set(false); }
    this.creatingPrompt.set(false);
  }

  async deleteCurrentPrompt(): Promise<void> {
    const id = this.selectedPromptId();
    if (!id || !confirm(`Delete prompt "${id}"? This cannot be undone.`)) return;
    try { await firstValueFrom(this.http.delete<ApiResponse<any>>(`${API}/admin/llm/prompts/${id}`)); this.selectedPromptId.set(null); this.selectedPrompt.set(null); await this.loadPrompts(); }
    catch (err: any) { this.promptMessage.set(err?.error?.message ?? 'Delete failed'); this.promptMessageSuccess.set(false); }
  }
}
