import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';
import { LlmHealthService } from '@app/core/llm/llm-health.service';

// ─── Interfaces ──────────────────────────────────────────────────────

interface LlmStatus {
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

interface LlmTuningConfig {
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

type TuningPreset = 'throughput' | 'balanced' | 'low-memory' | 'custom';

interface LlmPresetRecommendation {
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

interface LlmRecommendationHistoryEntry {
  preset: TuningPreset;
  label?: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
}

interface LlmInstallStatus {
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

interface TestResult {
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

interface BenchmarkRun {
  run: number;
  success: boolean;
  durationMs: number;
  tokensUsed: number | null;
  tokensPerSecond: number | null;
  error: string | null;
}

interface BenchmarkResult {
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

interface BenchmarkSweepEntry {
  preset: Exclude<TuningPreset, 'custom'>;
  label: string;
  result: BenchmarkResult | null;
  error: string | null;
}

interface BenchmarkSweepResult {
  entries: BenchmarkSweepEntry[];
  recommendedPreset: Exclude<TuningPreset, 'custom'> | null;
}

interface IkCpuSweepEntry {
  key: string;
  label: string;
  tuning: LlmTuningConfig;
  result: BenchmarkResult | null;
  error: string | null;
}

interface IkCpuSweepResult {
  entries: IkCpuSweepEntry[];
  recommendedKey: string | null;
}

interface LlmConfigDebug {
  configPath: string;
  persisted: boolean;
  rawJson: string;
}

interface PromptInfo {
  id: string;
  filename: string;
  updatedAt: string;
  sizeBytes: number;
}

interface PromptDetail extends PromptInfo {
  content: string;
}

interface VersionInfo {
  tag: string;
  date: string;
  assetCount: number;
  assetSizeMb: number | null;
}

interface CacheTypeOption {
  value: string;
  label: string;
  description: string;
}

const CACHE_TYPE_OPTIONS: CacheTypeOption[] = [
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

interface HfModel {
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

interface HfFile {
  filename: string;
  sizeMb: number | null;
  downloadUrl: string;
  tooLarge: boolean;
  splitParts: number | null;
  splitTotalMb: number | null;
}

const PREFERRED_GGUF_ORDER = [
  'Q4_K_M',
  'Q5_K_M',
  'Q6_K',
  'Q8_0',
  'UD-IQ4_XS',
  'IQ4_XS',
  'BF16',
  'F16',
  'FP16',
  'F32',
  'FP32',
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

function stripSplitSuffix(filename: string): string {
  return filename
    .replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i, '')
    .replace(/\.gguf$/i, '');
}

function getGgufVariantLabel(filename: string): string {
  const base = stripSplitSuffix(filename);
  const parts = base.split('-');
  const last = parts.at(-1)?.toUpperCase() ?? base.toUpperCase();
  const previous = parts.at(-2)?.toUpperCase() ?? '';
  if (previous === 'UD' && /^IQ\d(?:_[A-Z0-9]+)+$/i.test(last)) {
    return `UD-${last}`;
  }
  if (/^(Q\d(?:_[A-Z0-9]+)+|Q\d_\d|IQ\d(?:_[A-Z0-9]+)+|BF16|F16|F32|FP16|FP32)$/i.test(last)) {
    return last;
  }
  return last;
}

function getGgufVariantSortKey(file: HfFile): number {
  const label = getGgufVariantLabel(file.filename);
  const preferredIndex = PREFERRED_GGUF_ORDER.indexOf(label as typeof PREFERRED_GGUF_ORDER[number]);
  return preferredIndex === -1 ? Number.MAX_SAFE_INTEGER : preferredIndex;
}

function detectClientThreadCount(): number {
  const concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8;
  return Math.max(2, Math.min(concurrency || 8, 8));
}

function getDefaultTuning(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): LlmTuningConfig {
  const threads = detectClientThreadCount();
  if (profile === 'cuda') {
    return {
      ctxSize: 4096,
      threads,
      threadsBatch: 2,
      parallel: 1,
      batchSize: 2048,
      ubatchSize: 512,
      flashAttn: true,
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q8_0',
      gpuLayers: 999,
      noWarmup: false,
      promptCachePath: '',
      cacheRamMiB: 8192,
      attentionMaxBatch: 0,
      graphReuse: true,
      kCacheHadamard: false,
      cacheRamSimilarity: 0,
      cacheRamMinTokens: 0,
      defragThreshold: -1,
      mergeQkv: false,
      mergeUpGateExperts: false,
      schedulerAsync: false,
      promptCacheAll: false,
      promptCacheReadOnly: false,
    };
  }
  if (profile === 'apple-silicon-experimental') {
    return {
      ctxSize: 4096,
      threads,
      threadsBatch: threads,
      parallel: 1,
      batchSize: 1024,
      ubatchSize: 512,
      flashAttn: true,
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q8_0',
      gpuLayers: 0,
      noWarmup: false,
      promptCachePath: '',
      cacheRamMiB: 8192,
      attentionMaxBatch: 0,
      graphReuse: true,
      kCacheHadamard: false,
      cacheRamSimilarity: 0,
      cacheRamMinTokens: 0,
      defragThreshold: -1,
      mergeQkv: false,
      mergeUpGateExperts: false,
      schedulerAsync: false,
      promptCacheAll: false,
      promptCacheReadOnly: false,
    };
  }
  return {
    ctxSize: 4096,
    threads,
    threadsBatch: threads,
    parallel: 1,
    batchSize: 1024,
    ubatchSize: 256,
    flashAttn: true,
    cacheTypeK: 'q8_0',
    cacheTypeV: 'q8_0',
    gpuLayers: 0,
    noWarmup: false,
    promptCachePath: '',
    cacheRamMiB: 8192,
    attentionMaxBatch: 0,
    graphReuse: true,
    kCacheHadamard: false,
    cacheRamSimilarity: 0,
    cacheRamMinTokens: 0,
    defragThreshold: -1,
    mergeQkv: false,
    mergeUpGateExperts: false,
    schedulerAsync: false,
    promptCacheAll: false,
    promptCacheReadOnly: false,
  };
}

function getPresetTuning(
  profile: 'cpu' | 'cuda' | 'apple-silicon-experimental',
  preset: Exclude<TuningPreset, 'custom'>,
): LlmTuningConfig {
  const base = getDefaultTuning(profile);
  switch (preset) {
    case 'throughput':
      return {
        ...base,
        ctxSize: Math.max(base.ctxSize, 8192),
        parallel: profile === 'cuda' ? 4 : 2,
        batchSize: profile === 'cuda' ? 4096 : 2048,
        ubatchSize: profile === 'cuda' ? 1024 : 512,
        gpuLayers: profile === 'cuda' ? Math.max(base.gpuLayers, 999) : base.gpuLayers,
      };
    case 'low-memory':
      return {
        ...base,
        ctxSize: 2048,
        threads: Math.min(base.threads, 4),
        threadsBatch: Math.min(base.threadsBatch, 4),
        parallel: 1,
        batchSize: 512,
        ubatchSize: 128,
        gpuLayers: profile === 'cuda' ? 32 : 0,
      };
    default:
      return base;
  }
}

function areTuningsEqual(left: LlmTuningConfig, right: LlmTuningConfig): boolean {
  return left.ctxSize === right.ctxSize
    && left.threads === right.threads
    && left.threadsBatch === right.threadsBatch
    && left.parallel === right.parallel
    && left.batchSize === right.batchSize
    && left.ubatchSize === right.ubatchSize
    && left.flashAttn === right.flashAttn
    && left.cacheTypeK === right.cacheTypeK
    && left.cacheTypeV === right.cacheTypeV
    && left.gpuLayers === right.gpuLayers
    && left.noWarmup === right.noWarmup
    && left.promptCachePath === right.promptCachePath
    && left.cacheRamMiB === right.cacheRamMiB
    && left.attentionMaxBatch === right.attentionMaxBatch
    && left.graphReuse === right.graphReuse
    && left.kCacheHadamard === right.kCacheHadamard
    && left.cacheRamSimilarity === right.cacheRamSimilarity
    && left.cacheRamMinTokens === right.cacheRamMinTokens
    && left.defragThreshold === right.defragThreshold
    && left.mergeQkv === right.mergeQkv
    && left.mergeUpGateExperts === right.mergeUpGateExperts
    && left.schedulerAsync === right.schedulerAsync
    && left.promptCacheAll === right.promptCacheAll
    && left.promptCacheReadOnly === right.promptCacheReadOnly;
}

function inferTuningPreset(
  profile: 'cpu' | 'cuda' | 'apple-silicon-experimental',
  tuning: LlmTuningConfig,
): TuningPreset {
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'balanced'))) return 'balanced';
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'throughput'))) return 'throughput';
  if (areTuningsEqual(tuning, getPresetTuning(profile, 'low-memory'))) return 'low-memory';
  return 'custom';
}

function getIkCpuSweepCandidates(current: LlmTuningConfig): IkCpuSweepEntry[] {
  const hardwareThreads = typeof navigator !== 'undefined' ? Math.max(4, navigator.hardwareConcurrency || 8) : 8;
  const threadOptions = Array.from(new Set([
    Math.max(6, Math.min(hardwareThreads, current.threads)),
    Math.max(8, Math.min(hardwareThreads, current.threads + 2)),
    Math.max(10, Math.min(hardwareThreads, current.threads + 4)),
  ])).sort((left, right) => left - right);

  const base = {
    ...current,
    parallel: 1,
    gpuLayers: 0,
    noWarmup: false,
  };

  const candidates: Array<{ key: string; label: string; tuning: LlmTuningConfig }> = [
    {
      key: 'balanced',
      label: `Balanced CPU (${threadOptions[0] ?? current.threads}T / 1024 / 256)`,
      tuning: { ...base, threads: threadOptions[0] ?? current.threads, threadsBatch: threadOptions[0] ?? current.threads, batchSize: 1024, ubatchSize: 256 },
    },
    {
      key: 'throughput',
      label: `Throughput CPU (${threadOptions[1] ?? threadOptions[0] ?? current.threads}T / 1536 / 512)`,
      tuning: { ...base, threads: threadOptions[1] ?? threadOptions[0] ?? current.threads, threadsBatch: threadOptions[1] ?? threadOptions[0] ?? current.threads, batchSize: 1536, ubatchSize: 512 },
    },
    {
      key: 'max-batch',
      label: `High Batch (${threadOptions[2] ?? threadOptions[1] ?? current.threads}T / 2048 / 512)`,
      tuning: { ...base, threads: threadOptions[2] ?? threadOptions[1] ?? current.threads, threadsBatch: threadOptions[2] ?? threadOptions[1] ?? current.threads, batchSize: 2048, ubatchSize: 512 },
    },
    {
      key: 'wide-ubatch',
      label: `Wide Ubatch (${threadOptions[2] ?? threadOptions[1] ?? current.threads}T / 2048 / 1024)`,
      tuning: { ...base, threads: threadOptions[2] ?? threadOptions[1] ?? current.threads, threadsBatch: threadOptions[2] ?? threadOptions[1] ?? current.threads, batchSize: 2048, ubatchSize: 1024 },
    },
  ];

  return candidates.map((candidate) => ({
    ...candidate,
    result: null,
    error: null,
  }));
}

// ─── Component ───────────────────────────────────────────────────────

@Component({
  selector: 'app-llm-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, JsonPipe, DecimalPipe],
  template: `
@if (loading()) {
  <div class="flex items-center justify-center h-64">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
} @else {
  <div class="space-y-6 p-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">LLM Administration</h1>
      <button (click)="refreshStatus()" [disabled]="refreshing()"
        class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
        {{ refreshing() ? 'Refreshing…' : '↻ Refresh' }}
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

      <!-- Status Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <div class="flex items-center gap-3 mb-4">
          <h2 class="text-lg font-semibold text-gray-900">Status</h2>
          <span class="px-2 py-0.5 text-xs font-medium rounded-full"
            [class]="status()?.healthy ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
            {{ status()?.healthy ? 'Online' : 'Offline' }}
          </span>
          @if (status()?.searchAvailable) {
            <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Search</span>
          }
        </div>
        @if (status(); as s) {
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span class="text-gray-500">Model</span><p class="font-mono mt-1">{{ s.model ?? '—' }}</p></div>
            <div><span class="text-gray-500">Size</span><p class="font-mono mt-1">{{ s.modelSizeMb ? s.modelSizeMb + ' MB' : '—' }}</p></div>
            <div><span class="text-gray-500">Latency</span><p class="font-mono mt-1">{{ s.latencyMs != null ? s.latencyMs + ' ms' : '—' }}</p></div>
            <div><span class="text-gray-500">Endpoint</span><p class="font-mono mt-1 truncate">{{ s.baseUrl }}</p></div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span class="px-2 py-1 rounded-full bg-gray-100 text-gray-700">Runtime: {{ s.runtime }}</span>
            <span class="px-2 py-1 rounded-full bg-gray-100 text-gray-700">Profile: {{ profileLabel(s.profile) }}</span>
          </div>
          @if (s.launchArgs.length) {
            <details class="mt-3 text-xs text-gray-500">
              <summary class="cursor-pointer hover:text-gray-700">Effective launch arguments</summary>
              <pre class="mt-2 rounded-md bg-gray-900 p-3 text-[11px] text-green-400 overflow-x-auto whitespace-pre-wrap">{{ 'llama-server ' + s.launchArgs.join(' ') }}</pre>
            </details>
          }
        } @else {
          <p class="text-sm text-gray-500">Unable to reach LLM server</p>
        }
      </div>

      <!-- Installation & Server Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Installation & Server</h2>
        @if (installedVersion(); as iv) {
          <div class="mb-3 flex items-center gap-2">
            <span class="text-sm text-gray-500">Current version:</span>
            <span class="px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800 rounded-full">{{ iv }}</span>
          </div>
        }
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Runtime</label>
            <select
              [ngModel]="selectedRuntime()"
              (ngModelChange)="onRuntimeChange($event)"
              class="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="mainline">llama.cpp (mainline)</option>
              <option value="ik">ik_llama.cpp</option>
            </select>
            <p class="mt-1 text-xs text-gray-500">ik_llama.cpp is source-build oriented and preferred for CPU/CUDA tuning.</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Deployment profile</label>
            <select
              [ngModel]="selectedProfile()"
              (ngModelChange)="onProfileChange($event)"
              class="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="cpu">CPU-only</option>
              <option value="cuda">NVIDIA CUDA</option>
              <option value="apple-silicon-experimental">Apple Silicon Experimental</option>
            </select>
            <p class="mt-1 text-xs text-gray-500">Profile controls the default launch flags used for the server.</p>
          </div>
        </div>
        <div class="flex items-end gap-3 mb-4">
          <div class="flex-1 relative">
            <label class="block text-sm font-medium text-gray-700 mb-1">Runtime version / ref</label>
            <div class="flex gap-2">
              <!-- Custom dropdown -->
              <div class="relative flex-1">
                <button type="button" (click)="toggleVersionDropdown()"
                  class="relative w-full cursor-pointer rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-left text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  @if (selectedVersion()) {
                    <span class="block truncate">{{ versionDisplayLabel(selectedVersion()) }}</span>
                  } @else {
                    <span class="block truncate text-gray-400">{{ versionsLoading() ? 'Loading…' : 'Select a version' }}</span>
                  }
                  <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                  </span>
                </button>
                @if (versionDropdownOpen()) {
                  <div class="fixed inset-0 z-[19]" (click)="versionDropdownOpen.set(false)"></div>
                  <div class="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md bg-white shadow-lg ring-1 ring-black/5">
                    @if (versionsLoading()) {
                      <div class="px-3 py-4 text-sm text-gray-500 text-center">Loading versions…</div>
                    } @else if (versions().length === 0) {
                      <div class="px-3 py-4 text-sm text-gray-500 text-center">No versions found</div>
                    } @else {
                      @for (v of versions(); track v.tag) {
                        <button (click)="selectVersion(v.tag)"
                          class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2"
                          [class.bg-blue-50]="v.tag === selectedVersion()">
                          <div class="flex items-center gap-2 min-w-0">
                            @if (v.tag === installedVersion()) {
                              <span class="flex-shrink-0 w-4 h-4 text-green-600">✓</span>
                            } @else {
                              <span class="flex-shrink-0 w-4"></span>
                            }
                            <span class="font-medium">{{ versionDisplayLabel(v.tag) }}</span>
                          </div>
                          <div class="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
                            @if (v.date) {
                              <span>{{ v.date }}</span>
                            }
                            @if (selectedRuntime() === 'mainline') {
                              @if (v.assetSizeMb) { <span>~{{ v.assetSizeMb }} MB</span> }
                              <span>{{ v.assetCount }} assets</span>
                            } @else {
                              <span>source ref</span>
                            }
                          </div>
                        </button>
                      }
                    }
                  </div>
                }
              </div>
              <button (click)="runInstall()" [disabled]="installing() || !selectedVersion()"
                class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                {{ installing() ? 'Installing…' : 'Install / Update' }}
              </button>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <label class="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" [checked]="buildFromSource()" (change)="buildFromSource.set(!buildFromSource())" class="rounded border-gray-300" [disabled]="selectedRuntime() === 'ik'">
                Build from source
              </label>
              <span class="text-xs text-gray-400">For ik_llama.cpp, source build is required. Mainline can still use pre-built archives.</span>
            </div>
          </div>
        </div>
        @if (installStatus(); as is) {
          <div class="flex items-center gap-4 text-sm text-gray-600 mb-4">
            <span>Binary: <strong [class]="is.binaryInstalled ? 'text-green-700' : 'text-red-700'">{{ is.binaryInstalled ? '✓' : '✗' }}</strong></span>
            <span>Model: <strong [class]="is.modelInstalled ? 'text-green-700' : 'text-red-700'">{{ is.modelInstalled ? is.modelFilename ?? '✓' : '✗' }}</strong></span>
            @if (is.llamaCppVersion) { <span>Version: <strong>{{ is.llamaCppVersion }}</strong></span> }
            <span>Runtime: <strong>{{ is.runtime }}</strong></span>
            <span>Profile: <strong>{{ profileLabel(is.profile) }}</strong></span>
            @if (is.binFiles.length) {
              <details class="text-xs text-gray-500">
                <summary class="cursor-pointer hover:text-gray-700">{{ is.binFiles.length }} files in bin/</summary>
                <div class="mt-1 font-mono">{{ is.binFiles.join(', ') }}</div>
              </details>
            }
          </div>
          <div class="mb-4 text-xs text-gray-500">
            Source repo: <span class="font-mono">{{ runtimeSourceRepo(selectedRuntime()) }}</span>
          </div>
        }
        @if (runtimeCompatibilityWarning(); as warning) {
          <div class="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {{ warning }}
          </div>
        }
        <div class="mb-4 rounded-lg border border-gray-200 p-4">
          <div class="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 class="text-sm font-semibold text-gray-900">Advanced Tuning</h3>
              <p class="text-xs text-gray-500">Persisted launch settings. Server environment variables still take precedence if they are set.</p>
            </div>
            <button
              type="button"
              (click)="resetTuningToDefaults()"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Reset To Profile Defaults
            </button>
          </div>
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium text-gray-500">Presets</span>
            <button
              type="button"
              (click)="applyTuningPreset('throughput')"
              [class]="selectedTuningPreset() === 'throughput' ? 'rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white' : 'rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'"
            >
              Throughput
            </button>
            <button
              type="button"
              (click)="applyTuningPreset('balanced')"
              [class]="selectedTuningPreset() === 'balanced' ? 'rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white' : 'rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'"
            >
              Balanced
            </button>
            <button
              type="button"
              (click)="applyTuningPreset('low-memory')"
              [class]="selectedTuningPreset() === 'low-memory' ? 'rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white' : 'rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'"
            >
              Low Memory
            </button>
            @if (selectedTuningPreset() === 'custom') {
              <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">Custom</span>
            }
          </div>
          @if (savedRecommendation(); as recommendation) {
            <div class="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><strong>Saved recommendation:</strong> {{ recommendationDisplayLabel(recommendation) }}</span>
                  @if (recommendation.averageTokensPerSecond != null) {
                    <span>{{ recommendation.averageTokensPerSecond }} tok/s</span>
                  }
                  @if (recommendation.averageDurationMs != null) {
                    <span>{{ recommendation.averageDurationMs }} ms avg</span>
                  }
                  <span>{{ recommendation.recordedAt | date:'short' }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (recommendation.history.length >= 2) {
                    <span class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      [class]="recommendationTrendTone(recommendation)">
                      Trend: {{ recommendationTrendLabel(recommendation) }}
                    </span>
                    <svg viewBox="0 0 100 24" class="h-6 w-24 overflow-visible" aria-label="Recommendation trend sparkline">
                      <polyline
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        [attr.points]="recommendationSparklinePoints(recommendation)"
                        [class]="recommendationSparklineColor(recommendation)"
                      ></polyline>
                    </svg>
                  }
                  <button
                    type="button"
                    (click)="applySavedRecommendation()"
                    [disabled]="!hasRecommendationDrift()"
                    class="rounded-md border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                  >
                    Apply Recommended
                  </button>
                  <button
                    type="button"
                    (click)="rebenchmarkSavedRecommendation()"
                    [disabled]="recommendationBenchmarkRunning() || benchmarkRunning() || benchmarkSweepRunning() || starting() || stopping() || installing()"
                    class="rounded-md border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                  >
                    {{ recommendationBenchmarkRunning() ? 'Re-benchmarking…' : 'Re-benchmark Recommended' }}
                  </button>
                </div>
              </div>
              @if (recommendation.history.length) {
                <details class="mt-3 text-xs text-green-900/90">
                  <summary class="cursor-pointer hover:text-green-950">Recent benchmark history</summary>
                  <div class="mt-2 overflow-x-auto">
                    <table class="min-w-full text-left text-xs">
                      <thead>
                        <tr class="border-b border-green-200 text-green-800/80">
                          <th class="py-1 pr-3 font-medium">When</th>
                          <th class="py-1 pr-3 font-medium">Preset</th>
                          <th class="py-1 pr-3 font-medium">Tokens/s</th>
                          <th class="py-1 pr-3 font-medium">Avg ms</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (entry of recommendation.history; track entry.recordedAt) {
                          <tr class="border-b border-green-100 last:border-b-0">
                            <td class="py-1 pr-3">{{ entry.recordedAt | date:'short' }}</td>
                            <td class="py-1 pr-3">{{ recommendationHistoryLabel(entry) }}</td>
                            <td class="py-1 pr-3 font-mono">{{ entry.averageTokensPerSecond != null ? entry.averageTokensPerSecond : '—' }}</td>
                            <td class="py-1 pr-3 font-mono">{{ entry.averageDurationMs != null ? entry.averageDurationMs : '—' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </details>
              }
              @if (recommendationTrendLabel(recommendation) === 'Regressing') {
                <div class="mt-3 rounded-md border border-amber-200 bg-amber-100/70 px-3 py-2 text-xs text-amber-950">
                  Recent performance is trending down. Run the preset sweep again to confirm the best preset has not changed for this host.
                </div>
              }
            </div>
            @if (hasRecommendationDrift()) {
              <div class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Current tuning differs from the saved recommendation for this runtime/profile.
              </div>
            }
          }
          <p class="mb-3 text-xs text-gray-500">Use a preset as a starting point, then benchmark and fine-tune if needed.</p>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Context Size</span>
              <input type="number" min="256" [ngModel]="tuning().ctxSize" (ngModelChange)="updateNumericTuning('ctxSize', $event, 256)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Maximum tokens kept in memory. Larger contexts use more RAM.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Threads</span>
              <input type="number" min="1" [ngModel]="tuning().threads" (ngModelChange)="updateNumericTuning('threads', $event, 1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">CPU worker threads for token generation. Higher is not always faster.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Threads Batch</span>
              <input type="number" min="1" [ngModel]="tuning().threadsBatch" (ngModelChange)="updateNumericTuning('threadsBatch', $event, 1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Threads used for prompt ingestion and batched work. Good for first-token latency.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Parallel</span>
              <input type="number" min="1" [ngModel]="tuning().parallel" (ngModelChange)="updateNumericTuning('parallel', $event, 1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">How many requests can decode at once. Keep this at 1 for best single-chat speed.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">GPU Layers</span>
              <input type="number" min="0" [ngModel]="tuning().gpuLayers" (ngModelChange)="updateNumericTuning('gpuLayers', $event, 0)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Layers to offload to GPU. Leave at 0 for CPU-only ik_llama.cpp on macOS.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Batch Size</span>
              <input type="number" min="1" [ngModel]="tuning().batchSize" (ngModelChange)="updateNumericTuning('batchSize', $event, 1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Logical batch size. Larger values can improve throughput but increase memory use.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Ubatch Size</span>
              <input type="number" min="1" [ngModel]="tuning().ubatchSize" (ngModelChange)="updateNumericTuning('ubatchSize', $event, 1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Physical micro-batch size. This is a strong throughput knob for CPU runs.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Cache RAM (MiB)</span>
              <input type="number" min="-1" [ngModel]="tuning().cacheRamMiB" (ngModelChange)="updateNumericTuning('cacheRamMiB', $event, -1)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Prompt cache memory limit. Use 0 to disable or -1 for no limit.</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Cache Type K</span>
              <select [ngModel]="tuning().cacheTypeK" (ngModelChange)="updateStringTuning('cacheTypeK', $event)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                @for (option of cacheTypeOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
              <span class="mt-1 block text-[11px] text-gray-500">{{ cacheTypeDescription(tuning().cacheTypeK) }}</span>
            </label>
            <label class="block text-xs text-gray-600">
              <span class="mb-1 block font-medium">Cache Type V</span>
              <select [ngModel]="tuning().cacheTypeV" (ngModelChange)="updateStringTuning('cacheTypeV', $event)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                @for (option of cacheTypeOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
              <span class="mt-1 block text-[11px] text-gray-500">{{ cacheTypeDescription(tuning().cacheTypeV) }}</span>
            </label>
            <label class="block text-xs text-gray-600 xl:col-span-2">
              <span class="mb-1 block font-medium">Prompt Cache Path</span>
              <input type="text" [ngModel]="tuning().promptCachePath" (ngModelChange)="updateStringTuning('promptCachePath', $event)" placeholder="Leave empty to disable" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <span class="mt-1 block text-[11px] text-gray-500">Optional file path for reusing repeated prompts across requests and restarts. Required for the unsafe prompt-cache toggles below.</span>
            </label>
            <label class="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 xl:self-end">
              <input type="checkbox" [ngModel]="tuning().flashAttn" (ngModelChange)="updateBooleanTuning('flashAttn', $event)" class="rounded border-gray-300">
              <span>
                <span class="block font-medium text-gray-700">Flash Attention</span>
                <span class="block text-gray-500">Faster attention kernels when the selected build and backend support them.</span>
              </span>
            </label>
            <label class="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 xl:self-end">
              <input type="checkbox" [ngModel]="tuning().noWarmup" (ngModelChange)="updateBooleanTuning('noWarmup', $event)" class="rounded border-gray-300">
              <span>
                <span class="block font-medium text-gray-700">Skip Warmup</span>
                <span class="block text-gray-500">Starts faster by skipping the empty warmup pass. Useful during frequent restarts.</span>
              </span>
            </label>
          </div>
          <details class="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-700">
            <summary class="cursor-pointer font-medium text-gray-800">Experimental Tuning</summary>
            <p class="mt-2 text-[11px] text-gray-500">These flags come from the ik_llama.cpp CLI. They can improve throughput on some models, but they are less predictable than the core settings above.</p>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label class="block text-xs text-gray-600">
                <span class="mb-1 block font-medium">Attention Max Batch</span>
                <input type="number" min="0" [ngModel]="tuning().attentionMaxBatch" (ngModelChange)="updateNumericTuning('attentionMaxBatch', $event, 0)" class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <span class="mt-1 block text-[11px] text-gray-500">Caps attention work per step. Leave at 0 to let the runtime choose automatically.</span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                <input type="checkbox" [ngModel]="tuning().graphReuse" (ngModelChange)="updateBooleanTuning('graphReuse', $event)" class="rounded border-gray-300">
                <span>
                  <span class="block font-medium text-gray-700">Graph Reuse</span>
                  <span class="block text-gray-500">Reuses compute graphs between steps. Usually helps throughput.</span>
                </span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                <input type="checkbox" [ngModel]="tuning().kCacheHadamard" (ngModelChange)="updateBooleanTuning('kCacheHadamard', $event)" class="rounded border-gray-300">
                <span>
                  <span class="block font-medium text-gray-700">K-Cache Hadamard</span>
                  <span class="block text-gray-500">Experimental K-cache transform. Benchmark before keeping it enabled.</span>
                </span>
              </label>
            </div>
          </details>
          <details class="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
            <summary class="cursor-pointer font-medium text-rose-950">
              Unsafe Experimental
              @if (hasUnsafeExperimentalEnabled()) {
                <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Unsafe options enabled</span>
              }
            </summary>
            <p class="mt-2 text-[11px] text-rose-800">Defaults are intentionally off. These flags are niche, less documented, or easier to misuse. Benchmark every change and expect regressions on some models.</p>
            <div class="mt-3 flex items-center justify-end">
              <button
                type="button"
                (click)="resetUnsafeExperimentalTuning()"
                [disabled]="!hasUnsafeExperimentalEnabled()"
                class="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-medium text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset Unsafe Flags
              </button>
            </div>
            <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label class="block text-xs text-rose-900" [class.opacity-60]="!hasCacheRamEnabled()">
                <span class="mb-1 flex items-center gap-2 font-medium">
                  <span>Cache RAM Similarity</span>
                  @if (tuning().cacheRamSimilarity > 0) {
                    <span class="inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span>
                  }
                </span>
                <input type="number" min="0" max="1" step="0.05" [ngModel]="tuning().cacheRamSimilarity" (ngModelChange)="updateFloatTuning('cacheRamSimilarity', $event, 0, 1)" [disabled]="!hasCacheRamEnabled()" class="block w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400 disabled:cursor-not-allowed">
                <span class="mt-1 block text-[11px] text-rose-800">Prompt-cache similarity threshold. Higher values make cache reuse stricter. Enable Cache RAM above 0 first.</span>
              </label>
              <label class="block text-xs text-rose-900" [class.opacity-60]="!hasCacheRamEnabled()">
                <span class="mb-1 flex items-center gap-2 font-medium">
                  <span>Cache RAM Min Tokens</span>
                  @if (tuning().cacheRamMinTokens > 0) {
                    <span class="inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span>
                  }
                </span>
                <input type="number" min="0" [ngModel]="tuning().cacheRamMinTokens" (ngModelChange)="updateNumericTuning('cacheRamMinTokens', $event, 0)" [disabled]="!hasCacheRamEnabled()" class="block w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400 disabled:cursor-not-allowed">
                <span class="mt-1 block text-[11px] text-rose-800">Minimum shared cached tokens before prompt-cache reuse activates. Enable Cache RAM above 0 first.</span>
              </label>
              <label class="block text-xs text-rose-900">
                <span class="mb-1 flex items-center gap-2 font-medium">
                  <span>Defrag Threshold</span>
                  @if (tuning().defragThreshold >= 0) {
                    <span class="inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span>
                  }
                </span>
                <input type="number" step="0.1" [ngModel]="tuning().defragThreshold" (ngModelChange)="updateFloatTuning('defragThreshold', $event, -1, 1_000_000)" class="block w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400">
                <span class="mt-1 block text-[11px] text-rose-800">KV-cache defragmentation threshold. Leave at -1 to disable.</span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900">
                <input type="checkbox" [ngModel]="tuning().mergeQkv" (ngModelChange)="updateBooleanTuning('mergeQkv', $event)" class="rounded border-rose-300">
                <span>
                  <span class="block font-medium text-rose-950">Merge QKV @if (tuning().mergeQkv) { <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span> }</span>
                  <span class="block text-rose-800">Tries merged Q/K/V execution. Can help some models, can hurt others.</span>
                </span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900">
                <input type="checkbox" [ngModel]="tuning().mergeUpGateExperts" (ngModelChange)="updateBooleanTuning('mergeUpGateExperts', $event)" class="rounded border-rose-300">
                <span>
                  <span class="block font-medium text-rose-950">Merge Up/Gate Experts @if (tuning().mergeUpGateExperts) { <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span> }</span>
                  <span class="block text-rose-800">Expert-path fusion for some architectures. Benchmark only if you know the model benefits.</span>
                </span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900">
                <input type="checkbox" [ngModel]="tuning().schedulerAsync" (ngModelChange)="updateBooleanTuning('schedulerAsync', $event)" class="rounded border-rose-300">
                <span>
                  <span class="block font-medium text-rose-950">Scheduler Async @if (tuning().schedulerAsync) { <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span> }</span>
                  <span class="block text-rose-800">Async graph scheduling. Potential throughput gain, but higher stability risk.</span>
                </span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900" [class.opacity-60]="!hasPromptCachePath()">
                <input type="checkbox" [ngModel]="tuning().promptCacheAll" (ngModelChange)="updateBooleanTuning('promptCacheAll', $event)" [disabled]="!hasPromptCachePath()" class="rounded border-rose-300 disabled:cursor-not-allowed">
                <span>
                  <span class="block font-medium text-rose-950">Prompt Cache All @if (tuning().promptCacheAll) { <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span> }</span>
                  <span class="block text-rose-800">Stores user input and generations in the prompt cache. Set Prompt Cache Path first.</span>
                </span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900" [class.opacity-60]="!hasPromptCachePath()">
                <input type="checkbox" [ngModel]="tuning().promptCacheReadOnly" (ngModelChange)="updateBooleanTuning('promptCacheReadOnly', $event)" [disabled]="!hasPromptCachePath()" class="rounded border-rose-300 disabled:cursor-not-allowed">
                <span>
                  <span class="block font-medium text-rose-950">Prompt Cache Read-Only @if (tuning().promptCacheReadOnly) { <span class="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">Active</span> }</span>
                  <span class="block text-rose-800">Reads from an existing prompt cache file without updating it. Set Prompt Cache Path first.</span>
                </span>
              </label>
            </div>
            @if (!hasPromptCachePath()) {
              <p class="mt-3 text-[11px] text-rose-800">Prompt-cache toggles stay disabled until Prompt Cache Path is set.</p>
            }
            @if (!hasCacheRamEnabled()) {
              <p class="mt-2 text-[11px] text-rose-800">Cache RAM detail controls stay disabled until Cache RAM is set above 0.</p>
            }
          </details>
        </div>
        <div class="flex items-center gap-3">
          <button (click)="startServer()" [disabled]="starting() || installing() || status()?.healthy"
            class="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50">
            {{ starting() ? 'Starting…' : '▶ Start' }}
          </button>
          <button (click)="stopServer()" [disabled]="stopping() || !status()?.healthy"
            class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
            {{ stopping() ? 'Stopping…' : '■ Stop' }}
          </button>
          @if (serverMessage(); as msg) {
            @if (msg.includes('\\n')) {
              <div class="w-full mt-2">
                <p class="text-sm font-medium" [class]="serverMessageSuccess() ? 'text-green-700' : 'text-red-700'">{{ msg.split('\\n')[0] }}</p>
                <pre class="bg-gray-900 text-red-400 text-xs p-3 rounded-md overflow-x-auto max-h-48 overflow-y-auto mt-1 whitespace-pre-wrap">{{ msg.split('\\n').slice(1).join('\\n').trim() }}</pre>
              </div>
            } @else {
              <span class="text-sm" [class]="serverMessageSuccess() ? 'text-green-700' : 'text-red-700'">{{ msg }}</span>
            }
          }
        </div>
        @if (showInstallLog()) {
          <div class="mt-4">
            <div class="mb-1 flex items-center gap-3">
              <button (click)="showInstallLog.set(!showInstallLog())" class="text-sm text-blue-600 hover:underline">Toggle log</button>
              <button
                type="button"
                (click)="copyInstallLog()"
                [disabled]="!installLog()"
                class="text-sm text-blue-600 hover:underline disabled:text-gray-400"
              >
                Copy log
              </button>
            </div>
            @if (installProgress(); as ip) {
              <div class="mb-2 space-y-1">
                @if (ip.elapsedSec !== null) {
                  <span class="text-xs text-gray-500">Elapsed: {{ formatDuration(ip.elapsedSec) }}</span>
                }
                @if (ip.buildCurrent !== null && ip.buildTotal !== null && ip.buildTotal > 0) {
                  <div class="flex items-center gap-2">
                    <div class="flex-1 bg-gray-200 rounded-full h-2.5">
                      <div class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" [style.width.%]="(ip.buildCurrent / ip.buildTotal) * 100"></div>
                    </div>
                    <span class="text-xs text-gray-600 font-mono whitespace-nowrap">{{ ip.buildCurrent }}/{{ ip.buildTotal }}</span>
                    @if (ip.elapsedSec && ip.buildCurrent > 0) {
                      <span class="text-xs text-gray-500 whitespace-nowrap">~{{ formatDuration(Math.round((ip.elapsedSec / ip.buildCurrent) * (ip.buildTotal - ip.buildCurrent))) }} left</span>
                    }
                  </div>
                }
              </div>
            }
            @if (installLog(); as log) {
              <pre class="bg-gray-900 text-green-400 text-xs p-4 rounded-md overflow-x-auto max-h-64 overflow-y-auto">{{ log }}</pre>
            }
          </div>
        }
      </div>

      <!-- Model Management Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Model Management</h2>
        <div class="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-end">
            <label class="block flex-1 text-sm text-gray-700">
              <span class="mb-1 block font-medium">Max Model Install Size (MB)</span>
              <input
                type="number"
                min="1"
                [ngModel]="modelSizeLimitMb()"
                (ngModelChange)="modelSizeLimitMb.set(clampBenchmarkValue($event, 1, 1048576))"
                class="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
              <span class="mt-1 block text-[11px] text-gray-500">
                Files above this limit are blocked in the model browser. If MAX_MODEL_SIZE_MB is set on the server, that environment value still overrides the saved setting.
              </span>
            </label>
            <button
              type="button"
              (click)="saveModelSettings()"
              [disabled]="modelSettingsSaving()"
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {{ modelSettingsSaving() ? 'Saving…' : 'Save Limit' }}
            </button>
          </div>
          @if (installStatus(); as is) {
            <p class="mt-2 text-xs text-gray-500">
              Effective limit: {{ is.maxModelSizeMb | number }} MB
            </p>
          }
        </div>
        <div class="relative mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Search HuggingFace Models</label>
          <div class="relative">
            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <input type="text" [ngModel]="modelSearchQuery()" (ngModelChange)="onModelSearchInput($event)"
              placeholder="e.g. Qwen3, Phi-4, Llama, Gemma"
              class="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
            @if (modelSearching()) {
              <div class="absolute inset-y-0 right-0 flex items-center pr-3">
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            }
          </div>
          @if (modelSearchResults().length > 0) {
            <div class="fixed inset-0 z-[9]" (click)="modelSearchResults.set([])"></div>
            <div class="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-[400px] overflow-y-auto">
              @for (m of modelSearchResults(); track m.id) {
                <button (click)="selectModelRepo(m.id)"
                  class="block w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-sm text-gray-900 truncate">{{ m.id }}</span>
                        @if (m.parameterCount) {
                          <span class="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-800 rounded">{{ m.parameterCount }}</span>
                        }
                      </div>
                      <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span class="flex items-center gap-1" title="Downloads">
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          {{ m.downloads | number }}
                        </span>
                        <span class="flex items-center gap-1" title="Likes">
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                          {{ m.likes | number }}
                        </span>
                        @if (m.lastModified) {
                          <span title="Last updated">{{ m.lastModified }}</span>
                        }
                        @if (m.ggufFileCount) {
                          <span class="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]" title="GGUF variants">{{ m.ggufFileCount }} files</span>
                        }
                        @if (m.contextLength) {
                          <span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px]" title="Context length">{{ m.contextLength | number }}ctx</span>
                        }
                        @if (m.architecture) {
                          <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{{ m.architecture }}</span>
                        }
                        @if (m.license) {
                          <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{{ m.license }}</span>
                        }
                      </div>
                    </div>
                  </div>
                </button>
              }
            </div>
          }
        </div>
        @if (selectedRepo(); as repo) {
          <div class="mb-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-medium text-gray-900">{{ repo }}</h3>
                <p class="mt-1 text-xs text-gray-500">
                  Hugging Face repos usually publish every quantization variant. This view shows the most useful options first.
                </p>
              </div>
              <button (click)="selectedRepo.set(null); repoFiles.set([])" class="text-xs text-gray-500 hover:text-gray-700">✕ Close</button>
            </div>
            @if (repoFilesLoading()) {
              <p class="text-sm text-gray-500">Loading files…</p>
            } @else if (repoFiles().length === 0) {
              <p class="text-sm text-gray-500">No GGUF files found</p>
            } @else {
              <div class="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                <span>
                  Showing {{ visibleRepoFiles().length }} of {{ repoFiles().length }} variants
                </span>
                @if (repoFiles().length > visibleRepoFiles().length) {
                  <button
                    type="button"
                    (click)="showAllRepoFiles.set(true)"
                    class="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Show all {{ repoFiles().length }}
                  </button>
                } @else if (showAllRepoFiles() && repoFiles().length > 8) {
                  <button
                    type="button"
                    (click)="showAllRepoFiles.set(false)"
                    class="rounded-md border border-gray-300 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Show recommended only
                  </button>
                }
              </div>
              <div class="space-y-2">
                @for (f of visibleRepoFiles(); track f.filename) {
                  <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold text-gray-900">
                          {{ ggufFriendlyLabel(f) }}
                        </span>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                          {{ ggufVariantLabel(f) }}
                        </span>
                        @if (ggufDownloadSizeMb(f) != null) {
                          <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                            Download {{ ggufDownloadSizeMb(f) }} MB
                          </span>
                        }
                        @if (f.splitParts) {
                          <span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                            {{ f.splitParts }} parts
                          </span>
                        }
                      </div>
                      <p class="mt-2 text-xs text-gray-600">{{ ggufVariantDescription(f) }}</p>
                      <p class="mt-1 truncate font-mono text-[11px] text-gray-400">{{ f.filename }}</p>
                    </div>
                    @if (f.tooLarge) {
                      <span class="rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700">Too large</span>
                    } @else {
                      <button (click)="installModel(repo, f.filename)" [disabled]="modelInstalling()"
                        class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
                        {{ isInstallingRepoFile(f) ? 'Installing…' : 'Install' }}
                      </button>
                    }
                  </div>
                }
              </div>
              @if (!showAllRepoFiles() && hiddenRepoFileCount() > 0) {
                <p class="mt-3 text-xs text-gray-500">
                  {{ hiddenRepoFileCount() }} additional niche quantization variants are hidden by default.
                </p>
              }
            }
          </div>
        }
        @if (installStatus()?.modelInstalled) {
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-md">
            <div class="text-sm">
              <span class="text-gray-500">Installed:</span>
              <span class="font-mono ml-1">{{ installStatus()?.modelFilename }}</span>
              @if (installStatus()?.modelSizeMb) { <span class="text-gray-400 ml-1">({{ installStatus()?.modelSizeMb }} MB)</span> }
            </div>
            <button (click)="removeModel()" [disabled]="modelRemoving()"
              class="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200 disabled:opacity-50">
              {{ modelRemoving() ? 'Removing…' : 'Remove' }}
            </button>
          </div>
        }
        @if (modelMessage(); as msg) {
          <p class="mt-2 text-sm" [class]="modelMessageSuccess() ? 'text-green-700' : 'text-red-700'">{{ msg }}</p>
          @if (modelDownloadProgress(); as prog) {
            <div class="mt-1 w-full bg-gray-200 rounded-full h-2">
              <div class="bg-blue-600 h-2 rounded-full transition-all duration-500" [style.width.%]="prog.progressPct ?? 0"></div>
            </div>
          }
        }
      </div>

      <!-- Prompts & Knowledge Base Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-900">Prompts & Knowledge Base</h2>
          <div class="flex items-center gap-2">
            @if (showNewPromptInput()) {
              <input type="text" [ngModel]="newPromptId()" (ngModelChange)="newPromptId.set($event)"
                placeholder="prompt-slug" class="w-40 rounded-lg border border-gray-300 bg-white py-1.5 px-3 text-xs shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
              <button (click)="createNewPrompt()" [disabled]="creatingPrompt() || !newPromptId().trim()"
                class="px-2 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50">Create</button>
              <button (click)="showNewPromptInput.set(false); newPromptId.set('')" class="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            } @else {
              <button (click)="showNewPromptInput.set(true)" class="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200">+ New</button>
            }
          </div>
        </div>
        @if (promptsLoading()) {
          <p class="text-sm text-gray-500">Loading…</p>
        } @else if (prompts().length === 0) {
          <p class="text-sm text-gray-500">No prompts found. Create one to get started.</p>
        } @else {
          <div class="flex flex-wrap gap-1 mb-4 border-b pb-2">
            @for (p of prompts(); track p.id) {
              <button (click)="selectPrompt(p.id)"
                class="px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition-colors"
                [class]="selectedPromptId() === p.id ? 'bg-white text-blue-700 border-gray-300' : 'bg-gray-50 text-gray-600 border-transparent hover:bg-gray-100'">
                {{ p.id }}
              </button>
            }
          </div>
          @if (selectedPrompt(); as prompt) {
            <div class="space-y-3">
              <div class="flex items-center justify-between text-xs text-gray-500">
                <span>{{ prompt.filename }} · {{ prompt.sizeBytes }} bytes · Updated {{ prompt.updatedAt | date:'short' }}</span>
                <button (click)="deleteCurrentPrompt()" class="text-red-600 hover:text-red-800 text-xs">Delete</button>
              </div>
              <textarea [ngModel]="promptEditorContent()" (ngModelChange)="promptEditorContent.set($event)"
                rows="16" class="block w-full rounded-lg border border-gray-300 bg-white py-2.5 px-3 shadow-sm font-mono text-xs placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"></textarea>
              <div class="flex items-center gap-3">
                <button (click)="savePrompt()" [disabled]="promptSaving()"
                  class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                  {{ promptSaving() ? 'Saving…' : 'Save' }}
                </button>
                <button (click)="promptEditorContent.set(selectedPrompt()?.content ?? '')"
                  class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                  Revert
                </button>
                @if (promptMessage(); as msg) {
                  <span class="text-sm" [class]="promptMessageSuccess() ? 'text-green-700' : 'text-red-700'">{{ msg }}</span>
                }
              </div>
            </div>
          }
        }
      </div>

      <!-- Config Debug Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-gray-900">Persisted Config</h2>
            <p class="text-sm text-gray-500">Exact runtime config JSON used for tuning and recommendation persistence.</p>
          </div>
          <div class="flex items-center gap-2">
            @if (configDebug(); as debug) {
              <span class="rounded-full px-2.5 py-1 text-xs font-medium"
                [class]="debug.persisted ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'">
                {{ debug.persisted ? 'Saved File' : 'Generated Defaults' }}
              </span>
              <button
                type="button"
                (click)="downloadConfigDebug()"
                class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Download Config
              </button>
              <button
                type="button"
                (click)="copyConfigDebug()"
                class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Copy JSON
              </button>
            }
          </div>
        </div>
        @if (configDebug(); as debug) {
          <p class="mb-2 text-xs text-gray-500">Path: <span class="font-mono text-gray-700">{{ debug.configPath }}</span></p>
          <pre class="overflow-x-auto rounded-md bg-gray-950 p-4 text-[11px] text-green-300 whitespace-pre-wrap">{{ debug.rawJson }}</pre>
        } @else {
          <p class="text-sm text-gray-500">Config unavailable.</p>
        }
      </div>

      <!-- Test Prompt Card -->
      <div class="bg-white rounded-lg shadow p-6">
        <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-gray-900">Test Prompt</h2>
            <p class="text-xs text-gray-500">Compare production-style answers with raw reasoning output from the same local runtime.</p>
          </div>
          <div class="inline-flex rounded-md border border-gray-300 bg-white p-1">
            <button type="button" (click)="thinkingMode.set('production')"
              [class]="thinkingMode() === 'production' ? 'rounded px-3 py-1.5 text-xs font-medium bg-slate-900 text-white' : 'rounded px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50'">
              Production Answers
            </button>
            <button type="button" (click)="thinkingMode.set('thinking')"
              [class]="thinkingMode() === 'thinking' ? 'rounded px-3 py-1.5 text-xs font-medium bg-slate-900 text-white' : 'rounded px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50'">
              Raw Reasoning
            </button>
          </div>
        </div>
        <textarea [ngModel]="testPrompt()" (ngModelChange)="testPrompt.set($event)" rows="3"
          class="block w-full rounded-lg border border-gray-300 bg-white py-2.5 px-3 text-sm font-mono shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors mb-3"></textarea>
        <button (click)="runTestPrompt()" [disabled]="testRunning()"
          class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
          {{ testRunning() ? 'Running…' : 'Send' }}
        </button>
        @if (testResult(); as r) {
          <div class="mt-4 p-3 rounded-md text-sm" [class]="r.success ? 'bg-green-50' : 'bg-red-50'">
            @if (r.success) {
              @if (r.reasoning) {
                <div class="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Reasoning</p>
                  <p class="whitespace-pre-wrap text-sm text-amber-950">{{ r.reasoning }}</p>
                </div>
              }
              <p class="whitespace-pre-wrap">{{ r.output }}</p>
              <p class="mt-2 text-xs text-gray-500">{{ r.durationMs }}ms · {{ r.tokensUsed }} tokens</p>
            } @else {
              <p class="text-red-700">{{ r.error }}</p>
            }
          </div>
        }
      </div>

      <!-- Benchmark Card -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Benchmark</h2>
        <p class="mb-3 text-xs text-gray-500">Current response mode: <strong>{{ thinkingModeLabel() }}</strong>. Thinking mode is slower but useful for side-by-side comparisons.</p>
        <textarea [ngModel]="benchmarkPrompt()" (ngModelChange)="benchmarkPrompt.set($event)" rows="3"
          class="mb-3 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-mono shadow-sm placeholder:text-gray-400 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"></textarea>
        <div class="mb-3 grid grid-cols-2 gap-3">
          <label class="block text-xs text-gray-600">
            <span class="mb-1 block font-medium">Repeat Count</span>
            <input type="number" min="1" max="10" [ngModel]="benchmarkRepeatCount()" (ngModelChange)="benchmarkRepeatCount.set(clampBenchmarkValue($event, 1, 10))"
              class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </label>
          <label class="block text-xs text-gray-600">
            <span class="mb-1 block font-medium">Max Tokens</span>
            <input type="number" min="1" max="2048" [ngModel]="benchmarkMaxTokens()" (ngModelChange)="benchmarkMaxTokens.set(clampBenchmarkValue($event, 1, 2048))"
              class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </label>
        </div>
        <button (click)="runBenchmark()" [disabled]="benchmarkRunning()"
          class="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-900 disabled:opacity-50">
          {{ benchmarkRunning() ? 'Benchmarking…' : 'Run Benchmark' }}
        </button>
        <button (click)="runPresetBenchmarkSweep()" [disabled]="benchmarkRunning() || benchmarkSweepRunning() || starting() || stopping() || installing()"
          class="ml-2 px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50">
          {{ benchmarkSweepRunning() ? 'Sweeping…' : 'Benchmark Presets' }}
        </button>
        @if (selectedRuntime() === 'ik' && selectedProfile() === 'cpu') {
          <button (click)="runIkCpuBenchmarkSweep()" [disabled]="benchmarkRunning() || benchmarkSweepRunning() || ikCpuSweepRunning() || starting() || stopping() || installing()"
            class="ml-2 mt-2 md:mt-0 px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50">
            {{ ikCpuSweepRunning() ? 'Searching…' : 'Find Best ik CPU Settings' }}
          </button>
        }
        @if (benchmarkResult(); as result) {
          <div class="mt-4 rounded-md border border-gray-200 p-3 text-sm">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><span class="text-gray-500">Successful Runs</span><p class="mt-1 font-mono">{{ result.successCount }} / {{ result.repeatCount }}</p></div>
              <div><span class="text-gray-500">Avg Duration</span><p class="mt-1 font-mono">{{ result.averageDurationMs != null ? result.averageDurationMs + ' ms' : '—' }}</p></div>
              <div><span class="text-gray-500">Avg Tokens/s</span><p class="mt-1 font-mono">{{ result.averageTokensPerSecond != null ? result.averageTokensPerSecond : '—' }}</p></div>
              <div><span class="text-gray-500">Total Tokens</span><p class="mt-1 font-mono">{{ result.totalTokensUsed != null ? result.totalTokensUsed : '—' }}</p></div>
            </div>
            @if (result.outputSample) {
              <details class="mt-3 text-xs text-gray-500">
                <summary class="cursor-pointer hover:text-gray-700">Sample output</summary>
                <pre class="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{{ result.outputSample }}</pre>
              </details>
            }
            <div class="mt-3 overflow-x-auto">
              <table class="min-w-full text-xs">
                <thead>
                  <tr class="border-b border-gray-200 text-left text-gray-500">
                    <th class="py-1 pr-3 font-medium">Run</th>
                    <th class="py-1 pr-3 font-medium">Status</th>
                    <th class="py-1 pr-3 font-medium">Duration</th>
                    <th class="py-1 pr-3 font-medium">Tokens</th>
                    <th class="py-1 pr-3 font-medium">Tokens/s</th>
                  </tr>
                </thead>
                <tbody>
                  @for (run of result.runs; track run.run) {
                    <tr class="border-b border-gray-100 align-top">
                      <td class="py-1 pr-3 font-mono">{{ run.run }}</td>
                      <td class="py-1 pr-3" [class]="run.success ? 'text-green-700' : 'text-red-700'">{{ run.success ? 'OK' : 'Failed' }}</td>
                      <td class="py-1 pr-3 font-mono">{{ run.durationMs }} ms</td>
                      <td class="py-1 pr-3 font-mono">{{ run.tokensUsed != null ? run.tokensUsed : '—' }}</td>
                      <td class="py-1 pr-3 font-mono">{{ run.tokensPerSecond != null ? run.tokensPerSecond : '—' }}</td>
                    </tr>
                    @if (run.error) {
                      <tr>
                        <td></td>
                        <td colspan="4" class="pb-2 pr-3 text-red-700">{{ run.error }}</td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        @if (benchmarkSweepResult(); as sweep) {
          <div class="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">Preset Sweep</h3>
                <p class="text-xs text-slate-600">Each preset restarts the server, runs the configured benchmark, then restores your previous tuning.</p>
              </div>
              @if (sweep.recommendedPreset) {
                <span class="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">Recommended: {{ presetLabel(sweep.recommendedPreset) }}</span>
              }
            </div>
            <div class="space-y-2">
              @for (entry of sweep.entries; track entry.preset) {
                <div class="rounded-md border border-white/70 bg-white px-3 py-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-medium text-slate-900">{{ entry.label }}</div>
                    @if (entry.result) {
                      <div class="flex items-center gap-4 text-xs text-slate-600">
                        <span>{{ entry.result.averageDurationMs != null ? entry.result.averageDurationMs + ' ms' : '—' }}</span>
                        <span>{{ entry.result.averageTokensPerSecond != null ? entry.result.averageTokensPerSecond + ' tok/s' : '—' }}</span>
                        <span>{{ entry.result.successCount }}/{{ entry.result.repeatCount }} ok</span>
                      </div>
                    } @else {
                      <span class="text-xs text-red-700">{{ entry.error ?? 'Benchmark failed' }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }
        @if (ikCpuSweepResult(); as sweep) {
          <div class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-emerald-950">ik CPU Sweep</h3>
                <p class="text-xs text-emerald-800">Benchmarks several safe CPU thread and batch combinations, then applies the best one to the current tuning.</p>
              </div>
              @if (sweep.recommendedKey) {
                <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-900 border border-emerald-200">Recommended: {{ ikSweepRecommendedLabel(sweep) }}</span>
              }
            </div>
            <div class="space-y-2">
              @for (entry of sweep.entries; track entry.key) {
                <div class="rounded-md border border-white/70 bg-white px-3 py-2">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="font-medium text-slate-900">{{ entry.label }}</div>
                      <div class="text-[11px] text-slate-500">T={{ entry.tuning.threads }} · TB={{ entry.tuning.threadsBatch }} · B={{ entry.tuning.batchSize }} · UB={{ entry.tuning.ubatchSize }}</div>
                    </div>
                    @if (entry.result) {
                      <div class="flex items-center gap-4 text-xs text-slate-600">
                        <span>{{ entry.result.averageDurationMs != null ? entry.result.averageDurationMs + ' ms' : '—' }}</span>
                        <span>{{ entry.result.averageTokensPerSecond != null ? entry.result.averageTokensPerSecond + ' tok/s' : '—' }}</span>
                        <span>{{ entry.result.successCount }}/{{ entry.result.repeatCount }} ok</span>
                      </div>
                    } @else {
                      <span class="text-xs text-red-700">{{ entry.error ?? 'Benchmark failed' }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Test RFQ Parsing Card -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Test RFQ Parsing</h2>
        <textarea [ngModel]="rfqText()" (ngModelChange)="rfqText.set($event)" rows="6"
          class="block w-full rounded-lg border border-gray-300 bg-white py-2.5 px-3 text-sm font-mono shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors mb-3"></textarea>
        <button (click)="runTestRfq()" [disabled]="rfqRunning()"
          class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
          {{ rfqRunning() ? 'Parsing…' : 'Parse' }}
        </button>
        @if (rfqResult(); as r) {
          <div class="mt-4 p-3 rounded-md text-sm" [class]="r.success ? 'bg-green-50' : 'bg-red-50'">
            @if (r.success && r.parsed) {
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span class="text-gray-500">Vessel</span><p class="font-medium">{{ r.parsed.vesselName ?? '—' }}</p></div>
                  <div><span class="text-gray-500">IMO</span><p class="font-medium">{{ r.parsed.imo ?? '—' }}</p></div>
                  <div><span class="text-gray-500">Port</span><p class="font-medium">{{ r.parsed.port ?? '—' }}</p></div>
                  <div><span class="text-gray-500">ETA</span><p class="font-medium">{{ r.parsed.eta ?? '—' }}</p></div>
                </div>
                @if (r.parsed.products?.length) {
                  <div>
                    <span class="text-gray-500 text-xs">Products</span>
                    <div class="mt-1 border rounded-md divide-y">
                      @for (p of r.parsed.products; track p.name) {
                        <div class="flex items-center justify-between px-3 py-1.5 text-sm">
                          <span class="font-medium">{{ p.name }}</span>
                          <span class="text-gray-600">{{ p.quantity }} {{ p.unit }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
                @if (r.parsed.confidence != null) {
                  <div class="text-xs text-gray-500">Confidence: {{ r.parsed.confidence }}</div>
                }
                <details class="text-xs">
                  <summary class="text-blue-600 cursor-pointer">Raw JSON</summary>
                  <pre class="mt-1 whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 p-2 rounded">{{ r.parsed | json }}</pre>
                </details>
              </div>
              <p class="mt-2 text-xs text-gray-500">{{ r.durationMs }}ms · {{ r.tokensUsed }} tokens</p>
            } @else if (r.success) {
              <p class="whitespace-pre-wrap">{{ r.output }}</p>
            } @else {
              <p class="text-red-700">{{ r.error }}</p>
            }
          </div>
        }
      </div>

      <!-- Test Web Search Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Test Web Search</h2>
        <div class="flex gap-3 mb-3">
          <input type="text" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)"
            class="block flex-1 rounded-lg border border-gray-300 bg-white py-2.5 px-3 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            placeholder="Ask a question that requires internet search…" />
          <button (click)="runTestSearch()" [disabled]="searchRunning()"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
            {{ searchRunning() ? 'Searching…' : 'Search & Ask' }}
          </button>
        </div>
        @if (searchResult(); as r) {
          <div class="p-3 rounded-md text-sm" [class]="r.success ? 'bg-green-50' : 'bg-red-50'">
            @if (r.success) {
              <p class="whitespace-pre-wrap">{{ r.output }}</p>
              <p class="mt-2 text-xs text-gray-500">{{ r.durationMs }}ms · {{ r.tokensUsed }} tokens</p>
              @if (r.searchResults?.length) {
                <details class="mt-2">
                  <summary class="text-xs text-blue-600 cursor-pointer">{{ r.searchResults!.length }} sources</summary>
                  <ul class="mt-1 space-y-1">
                    @for (sr of r.searchResults; track sr.url) {
                      <li class="text-xs"><a [href]="sr.url" target="_blank" class="text-blue-600 hover:underline">{{ sr.title }}</a></li>
                    }
                  </ul>
                </details>
              }
            } @else {
              <p class="text-red-700">{{ r.error }}</p>
            }
          </div>
        }
      </div>

    </div>
  </div>
}
  `,
})
export class LlmPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly llmHealth = inject(LlmHealthService);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private modelSearchTimer: ReturnType<typeof setTimeout> | null = null;

  // Status
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly status = signal<LlmStatus | null>(null);

  // Installation
  readonly installStatus = signal<LlmInstallStatus | null>(null);
  readonly configDebug = signal<LlmConfigDebug | null>(null);
  readonly installing = signal(false);
  readonly installLog = signal<string | null>(null);
  readonly showInstallLog = signal(false);
  readonly buildFromSource = signal(false);
  readonly installProgress = signal<{ buildCurrent: number | null; buildTotal: number | null; elapsedSec: number | null } | null>(null);

  // Server management
  readonly starting = signal(false);
  readonly stopping = signal(false);
  readonly serverMessage = signal<string | null>(null);
  readonly serverMessageSuccess = signal(false);

  // Versions
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

  // Model management
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

  // Test prompt
  readonly testPrompt = signal('Hello, respond with one word.');
  readonly thinkingMode = signal<'production' | 'thinking'>('production');
  readonly testRunning = signal(false);
  readonly testResult = signal<TestResult | null>(null);

  // Benchmark
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

  // Test RFQ
  readonly rfqText = signal('MV Pacific Voyager\nIMO 9876543\nFujairah Anchorage\nVLSFO 500 MT\nLSMGO 100 MT\nETA 15/03/2026');
  readonly rfqRunning = signal(false);
  readonly rfqResult = signal<TestResult & { parsed?: any } | null>(null);

  // Test Search
  readonly searchQuery = signal('What is the current price of VLSFO bunker fuel?');
  readonly searchRunning = signal(false);
  readonly searchResult = signal<TestResult | null>(null);

  // Prompts / KB
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

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug(), this.loadPrompts()]);
    this.loading.set(false);
    this.pollTimer = setInterval(() => this.pollHealth(), 30_000);
  }

  ngOnDestroy(): void {
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
      if (res.data?.maxModelSizeMb) {
        this.modelSizeLimitMb.set(res.data.maxModelSizeMb);
      }
      if (res.data?.runtime) {
        this.selectedRuntime.set(res.data.runtime);
      }
      if (res.data?.profile) {
        this.selectedProfile.set(res.data.profile);
      }
      if (res.data?.tuning) {
        this.tuning.set({ ...res.data.tuning });
        this.selectedTuningPreset.set(inferTuningPreset(res.data.profile, res.data.tuning));
      }
      this.savedRecommendation.set(res.data?.recommendation ?? null);
      if (res.data) {
        this.buildFromSource.set(res.data.runtime === 'ik' ? true : res.data.buildFromSource);
      }
      if (res.data?.llamaCppVersion) {
        this.installedVersion.set(res.data.llamaCppVersion);
        // Pre-select installed version in dropdown if nothing selected yet
        if (!this.selectedVersion()) {
          this.selectedVersion.set(res.data.llamaCppVersion);
        }
      }
    } catch { this.installStatus.set(null); }
  }

  async loadConfigDebug(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<LlmConfigDebug>>(`${API}/admin/llm/config`));
      this.configDebug.set(res.data ?? null);
    } catch {
      this.configDebug.set(null);
    }
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
    try {
      await navigator.clipboard.writeText(debug.rawJson);
      this.serverMessage.set('Config JSON copied to clipboard.');
      this.serverMessageSuccess.set(true);
    } catch {
      this.serverMessage.set('Unable to copy config JSON to clipboard.');
      this.serverMessageSuccess.set(false);
    }
  }

  async saveModelSettings(): Promise<void> {
    const maxModelSizeMb = Math.max(1, Math.round(this.modelSizeLimitMb()));
    this.modelSettingsSaving.set(true);
    this.modelMessage.set(null);
    try {
      await firstValueFrom(this.http.post<ApiResponse<LlmConfigDebug>>(`${API}/admin/llm/config`, {
        maxModelSizeMb,
      }));
      this.modelSizeLimitMb.set(maxModelSizeMb);
      this.modelMessage.set(`Saved model install limit to ${maxModelSizeMb} MB.`);
      this.modelMessageSuccess.set(true);
      await Promise.all([this.loadInstallStatus(), this.loadConfigDebug()]);
      if (this.selectedRepo()) {
        await this.selectModelRepo(this.selectedRepo()!);
      }
    } catch (err: any) {
      this.modelMessage.set(err?.error?.error ?? err?.error?.message ?? 'Failed to save model settings');
      this.modelMessageSuccess.set(false);
    }
    this.modelSettingsSaving.set(false);
  }

  async copyInstallLog(): Promise<void> {
    const log = this.installLog();
    if (!log) return;
    try {
      await navigator.clipboard.writeText(log);
      this.serverMessage.set('Install log copied to clipboard.');
      this.serverMessageSuccess.set(true);
    } catch {
      this.serverMessage.set('Unable to copy install log to clipboard.');
      this.serverMessageSuccess.set(false);
    }
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
      if (current) {
        this.status.set({ ...current, healthy: res.data?.healthy ?? false, searchAvailable: res.data?.searchAvailable ?? false });
      }
    } catch {
      const current = this.status();
      if (current) this.status.set({ ...current, healthy: false });
    }
  }

  // ── Versions ──────────────────────────────────────────────────────

  async loadVersions(): Promise<void> {
    this.versionsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ versions: VersionInfo[]; installed: string | null }>>(`${API}/admin/llm/versions`, {
        params: { runtime: this.selectedRuntime() },
      }));
      this.versions.set(res.data?.versions ?? []);
      this.installedVersion.set(res.data?.installed ?? null);
      if (!this.selectedVersion() && res.data?.versions?.length) {
        this.selectedVersion.set(res.data.versions[0].tag);
      }
    } catch { this.versions.set([]); }
    this.versionsLoading.set(false);
  }

  toggleVersionDropdown(): void {
    const isOpen = this.versionDropdownOpen();
    if (!isOpen && this.versions().length === 0) {
      this.loadVersions();
    }
    this.versionDropdownOpen.set(!isOpen);
  }

  selectVersion(tag: string): void {
    this.selectedVersion.set(tag);
    this.versionDropdownOpen.set(false);
  }

  onRuntimeChange(runtime: 'mainline' | 'ik'): void {
    this.selectedRuntime.set(runtime);
    if (runtime === 'ik') {
      this.buildFromSource.set(true);
      if (this.selectedProfile() === 'cpu' || this.selectedProfile() === 'cuda' || this.selectedProfile() === 'apple-silicon-experimental') {
        // keep current profile
      }
    } else {
      // Mainline prefers prebuilt archives unless the user explicitly re-enables source builds.
      this.buildFromSource.set(false);
    }
    this.selectedVersion.set('');
    this.versions.set([]);
    this.versionDropdownOpen.set(false);
    this.loadVersions();
  }

  onProfileChange(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): void {
    this.selectedProfile.set(profile);
    this.applyTuningPreset('balanced', profile);
  }

  resetTuningToDefaults(): void {
    this.applyTuningPreset('balanced');
  }

  applyTuningPreset(
    preset: Exclude<TuningPreset, 'custom'>,
    profile = this.selectedProfile(),
  ): void {
    this.tuning.set(getPresetTuning(profile, preset));
    this.selectedTuningPreset.set(preset);
  }

  applySavedRecommendation(): void {
    const recommendation = this.savedRecommendation();
    if (!recommendation) return;
    if (recommendation.tuning) {
      this.tuning.set({ ...recommendation.tuning });
      this.selectedTuningPreset.set('custom');
      return;
    }
    if (recommendation.preset !== 'custom') {
      this.applyTuningPreset(recommendation.preset, recommendation.profile);
    }
  }

  hasRecommendationDrift(): boolean {
    const recommendation = this.savedRecommendation();
    if (!recommendation) return false;
    if (recommendation.tuning) {
      return !areTuningsEqual(this.tuning(), recommendation.tuning);
    }
    return this.selectedTuningPreset() !== recommendation.preset;
  }

  async rebenchmarkSavedRecommendation(): Promise<void> {
    const recommendation = this.savedRecommendation();
    if (!recommendation) return;

    this.recommendationBenchmarkRunning.set(true);
    this.serverMessage.set(`Re-benchmarking ${this.recommendationDisplayLabel(recommendation)} recommendation…`);
    this.serverMessageSuccess.set(true);

    const originalTuning = { ...this.tuning() };
    const originalPreset = this.selectedTuningPreset();
    const originalHealthy = this.status()?.healthy ?? false;
    const recommendedTuning = recommendation.tuning
      ? { ...recommendation.tuning }
      : getPresetTuning(recommendation.profile, recommendation.preset === 'custom' ? 'balanced' : recommendation.preset);

    try {
      this.tuning.set(recommendedTuning);
      this.selectedTuningPreset.set(recommendation.tuning ? 'custom' : recommendation.preset);

      await this.requestStopServer();
      const start = await this.requestStartServer(recommendedTuning);
      if (!start.started) {
        this.serverMessage.set(start.message);
        this.serverMessageSuccess.set(false);
        return;
      }

      const result = await this.requestBenchmark();
      this.benchmarkResult.set(result);
      await this.saveRecommendation(recommendation.preset, result, recommendation.label ?? null, recommendation.tuning ?? recommendedTuning);
      this.serverMessage.set(`Recommendation refreshed for ${this.recommendationDisplayLabel(recommendation)}.`);
      this.serverMessageSuccess.set(true);
    } catch (err: any) {
      this.serverMessage.set(err?.error?.message ?? err?.message ?? 'Failed to re-benchmark recommendation');
      this.serverMessageSuccess.set(false);
    } finally {
      this.tuning.set(originalTuning);
      this.selectedTuningPreset.set(originalPreset);

      try {
        await this.requestStopServer();
        if (originalHealthy) {
          await this.requestStartServer(originalTuning);
        }
      } catch {
        this.serverMessage.set('Recommendation benchmark finished, but the original server state could not be fully restored.');
        this.serverMessageSuccess.set(false);
      }

      await this.loadStatus();
      this.llmHealth.refresh();
      this.recommendationBenchmarkRunning.set(false);
    }
  }

  updateNumericTuning(
    key: 'ctxSize' | 'threads' | 'threadsBatch' | 'parallel' | 'batchSize' | 'ubatchSize' | 'gpuLayers' | 'cacheRamMiB' | 'attentionMaxBatch' | 'cacheRamMinTokens',
    value: number | string,
    minimum: number,
  ): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return;
    const nextValue = Math.max(minimum, Math.round(parsed));
    this.tuning.update((current) => ({
      ...current,
      [key]: nextValue,
      ...(key === 'cacheRamMiB' && nextValue <= 0
        ? {
            cacheRamSimilarity: 0,
            cacheRamMinTokens: 0,
          }
        : {}),
    }));
    this.selectedTuningPreset.set('custom');
  }

  updateFloatTuning(
    key: 'cacheRamSimilarity' | 'defragThreshold',
    value: number | string,
    minimum: number,
    maximum: number,
  ): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return;
    this.tuning.update((current) => ({
      ...current,
      [key]: Math.min(maximum, Math.max(minimum, parsed)),
    }));
    this.selectedTuningPreset.set('custom');
  }

  updateStringTuning(key: 'cacheTypeK' | 'cacheTypeV' | 'promptCachePath', value: string): void {
    const trimmed = value.trim();
    this.tuning.update((current) => ({
      ...current,
      [key]: key === 'promptCachePath' ? trimmed : (trimmed || current[key]),
      ...(key === 'promptCachePath' && !trimmed
        ? {
            promptCacheAll: false,
            promptCacheReadOnly: false,
          }
        : {}),
    }));
    this.selectedTuningPreset.set('custom');
  }

  hasPromptCachePath(): boolean {
    return !!this.tuning().promptCachePath.trim();
  }

  hasCacheRamEnabled(): boolean {
    return this.tuning().cacheRamMiB > 0;
  }

  hasUnsafeExperimentalEnabled(): boolean {
    const tuning = this.tuning();
    return tuning.cacheRamSimilarity > 0
      || tuning.cacheRamMinTokens > 0
      || tuning.defragThreshold >= 0
      || tuning.mergeQkv
      || tuning.mergeUpGateExperts
      || tuning.schedulerAsync
      || tuning.promptCacheAll
      || tuning.promptCacheReadOnly;
  }

  resetUnsafeExperimentalTuning(): void {
    this.tuning.update((current) => ({
      ...current,
      cacheRamSimilarity: 0,
      cacheRamMinTokens: 0,
      defragThreshold: -1,
      mergeQkv: false,
      mergeUpGateExperts: false,
      schedulerAsync: false,
      promptCacheAll: false,
      promptCacheReadOnly: false,
    }));
    this.selectedTuningPreset.set('custom');
  }

  updateBooleanTuning(
    key: 'flashAttn' | 'noWarmup' | 'graphReuse' | 'kCacheHadamard' | 'mergeQkv' | 'mergeUpGateExperts' | 'schedulerAsync' | 'promptCacheAll' | 'promptCacheReadOnly',
    value: boolean,
  ): void {
    this.tuning.update((current) => ({
      ...current,
      [key]: !!value,
    }));
    this.selectedTuningPreset.set('custom');
  }

  private getApiErrorMessage(response: unknown, fallback: string): string {
    const candidate = response as {
      message?: string;
      error?: string;
      data?: { message?: string | null; error?: string | null } | null;
    };
    return candidate?.error
      ?? candidate?.message
      ?? candidate?.data?.error
      ?? candidate?.data?.message
      ?? fallback;
  }

  // ── Install binary ────────────────────────────────────────────────

  async runInstall(): Promise<void> {
    this.installing.set(true);
    this.installLog.set(null);
    this.showInstallLog.set(true);
    this.serverMessage.set(null);
    this.installProgress.set(null);
    try {
      const version = this.selectedVersion() || undefined;
      const buildFromSource = this.selectedRuntime() === 'ik' ? true : this.buildFromSource();
      const res = await firstValueFrom(this.http.post<ApiResponse<{ message: string }>>(`${API}/admin/llm/install`, {
        version,
        buildFromSource,
        runtime: this.selectedRuntime(),
        profile: this.selectedProfile(),
        tuning: this.tuning(),
      }));

      if (!res.success) {
        const failureMessage = this.getApiErrorMessage(res, 'Install failed');
        this.installLog.set(failureMessage);
        this.serverMessage.set(`Installation failed\n\n${failureMessage}`);
        this.serverMessageSuccess.set(false);
        this.installing.set(false);
        return;
      }

      this.serverMessage.set(res.data?.message ?? 'Installing…');
      this.serverMessageSuccess.set(true);

      // Poll install progress every 3s
      for (let i = 0; i < 600; i++) { // up to ~30 min
        await new Promise(r => setTimeout(r, 3000));
        try {
          const progress = await firstValueFrom(this.http.get<ApiResponse<{ status: string; step: string; log: string; error: string | null; elapsedSec: number | null; buildCurrent: number | null; buildTotal: number | null }>>(`${API}/admin/llm/install/progress`));
          const d = progress.data;
          if (d) {
            const effectiveLog = d.log || d.error || d.step || 'Working…';
            this.installLog.set(effectiveLog);
            this.serverMessage.set(d.status === 'error' && d.error ? `Installation failed\n\n${d.error}` : (d.step || 'Installing…'));
            this.serverMessageSuccess.set(d.status !== 'error');
            this.installProgress.set({ buildCurrent: d.buildCurrent, buildTotal: d.buildTotal, elapsedSec: d.elapsedSec });

            if (d.status === 'done') {
              this.serverMessage.set('Installation complete');
              this.serverMessageSuccess.set(true);
              break;
            }
            if (d.status === 'error') {
              this.serverMessage.set(`Installation failed\n\n${d.error ?? 'Install failed'}`);
              this.serverMessageSuccess.set(false);
              break;
            }
          }
        } catch { /* poll error, keep trying */ }
      }
    } catch (err: any) {
      const failureMessage = err?.error?.error ?? err?.error?.message ?? err?.message ?? 'Install request failed';
      this.installLog.set(failureMessage);
      this.serverMessage.set(`Installation failed\n\n${failureMessage}`);
      this.serverMessageSuccess.set(false);
    }
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.installing.set(false);
    this.installProgress.set(null);
  }

  // ── Utilities ─────────────────────────────────────────────────────

  readonly Math = Math;

  formatDuration(sec: number | null): string {
    if (sec === null || sec < 0) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  clampBenchmarkValue(value: number | string, minimum: number, maximum: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return minimum;
    return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
  }

  presetLabel(preset: TuningPreset): string {
    switch (preset) {
      case 'throughput': return 'Throughput';
      case 'low-memory': return 'Low Memory';
      case 'custom': return 'Custom';
      default: return 'Balanced';
    }
  }

  recommendationDisplayLabel(recommendation: LlmPresetRecommendation): string {
    return recommendation.label?.trim() || this.presetLabel(recommendation.preset);
  }

  recommendationHistoryLabel(entry: LlmRecommendationHistoryEntry): string {
    return entry.label?.trim() || this.presetLabel(entry.preset);
  }

  cacheTypeDescription(value: string): string {
    const option = this.cacheTypeOptions.find((entry) => entry.value === value);
    return option?.description ?? 'Common runtime option. Match K and V unless benchmarking suggests otherwise.';
  }

  recommendationTrendLabel(recommendation: LlmPresetRecommendation): 'Improving' | 'Stable' | 'Regressing' {
    const delta = this.recommendationTrendDelta(recommendation);
    if (delta > 0.05) return 'Improving';
    if (delta < -0.05) return 'Regressing';
    return 'Stable';
  }

  recommendationTrendTone(recommendation: LlmPresetRecommendation): string {
    switch (this.recommendationTrendLabel(recommendation)) {
      case 'Improving':
        return 'bg-green-100 text-green-800';
      case 'Regressing':
        return 'bg-amber-100 text-amber-900';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  recommendationSparklineColor(recommendation: LlmPresetRecommendation): string {
    switch (this.recommendationTrendLabel(recommendation)) {
      case 'Improving':
        return 'text-green-700';
      case 'Regressing':
        return 'text-amber-700';
      default:
        return 'text-slate-500';
    }
  }

  recommendationSparklinePoints(recommendation: LlmPresetRecommendation): string {
    const values = recommendation.history
      .slice(0, 6)
      .reverse()
      .map((entry) => entry.averageTokensPerSecond)
      .filter((value): value is number => value != null);
    if (values.length === 0) return '0,12 100,12';
    if (values.length === 1) return `0,12 100,${12 - Math.min(8, Math.max(-8, values[0] / 100))}`;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 20 - (((value - min) / range) * 16 + 2);
        return `${x},${y}`;
      })
      .join(' ');
  }

  private recommendationTrendDelta(recommendation: LlmPresetRecommendation): number {
    const values = recommendation.history
      .slice(0, 6)
      .map((entry) => entry.averageTokensPerSecond)
      .filter((value): value is number => value != null);
    if (values.length < 2) return 0;
    const newest = values[0];
    const oldest = values[values.length - 1];
    if (!oldest) return 0;
    return (newest - oldest) / oldest;
  }

  private async requestStartServer(tuning = this.tuning()): Promise<{ started: boolean; message: string }> {
    const res = await firstValueFrom(this.http.post<ApiResponse<{ started: boolean; message: string }>>(`${API}/admin/llm/start`, {
      runtime: this.selectedRuntime(),
      profile: this.selectedProfile(),
      tuning,
    }));
    return res.data ?? { started: false, message: 'Unknown' };
  }

  private async requestStopServer(): Promise<{ stopped: boolean; message: string }> {
    const res = await firstValueFrom(this.http.post<ApiResponse<{ stopped: boolean; message: string }>>(`${API}/admin/llm/stop`, {}));
    return res.data ?? { stopped: false, message: 'Unknown' };
  }

  private async requestBenchmark(): Promise<BenchmarkResult | null> {
    const res = await firstValueFrom(this.http.post<ApiResponse<BenchmarkResult>>(`${API}/admin/llm/benchmark`, {
      prompt: this.benchmarkPrompt(),
      repeatCount: this.benchmarkRepeatCount(),
      maxTokens: this.benchmarkMaxTokens(),
      thinkingMode: this.thinkingMode(),
    }));
    return res.data ?? null;
  }

  private async saveRecommendation(
    preset: TuningPreset,
    result: BenchmarkResult | null,
    label: string | null = null,
    tuning: LlmTuningConfig | null = null,
  ): Promise<void> {
    const recordedAt = new Date().toISOString();
    await firstValueFrom(this.http.post<ApiResponse<{ saved: boolean }>>(`${API}/admin/llm/recommendation`, {
      preset,
      label,
      tuning,
      runtime: this.selectedRuntime(),
      profile: this.selectedProfile(),
      averageTokensPerSecond: result?.averageTokensPerSecond ?? null,
      averageDurationMs: result?.averageDurationMs ?? null,
    }));
    const previousHistory = this.savedRecommendation()?.history ?? [];
    this.savedRecommendation.set({
      preset,
      label,
      runtime: this.selectedRuntime(),
      profile: this.selectedProfile(),
      averageTokensPerSecond: result?.averageTokensPerSecond ?? null,
      averageDurationMs: result?.averageDurationMs ?? null,
      recordedAt,
      tuning,
      history: [
        {
          preset,
          label,
          averageTokensPerSecond: result?.averageTokensPerSecond ?? null,
          averageDurationMs: result?.averageDurationMs ?? null,
          recordedAt,
        },
        ...previousHistory,
      ].slice(0, 10),
    });
  }

  // ── Server start / stop ───────────────────────────────────────────

  async startServer(): Promise<void> {
    this.starting.set(true);
    this.serverMessage.set(null);
    try {
      const res = await this.requestStartServer();
      this.serverMessage.set(res.message ?? 'Unknown');
      this.serverMessageSuccess.set(res.started ?? false);
    } catch (err: any) {
      this.serverMessage.set(err?.error?.message ?? 'Start request failed');
      this.serverMessageSuccess.set(false);
    }
    await this.loadStatus();
    this.llmHealth.refresh();
    this.starting.set(false);
  }

  async stopServer(): Promise<void> {
    this.stopping.set(true);
    this.serverMessage.set(null);
    try {
      const res = await this.requestStopServer();
      this.serverMessage.set(res.message ?? 'Unknown');
      this.serverMessageSuccess.set(res.stopped ?? false);
    } catch (err: any) {
      this.serverMessage.set(err?.error?.message ?? 'Stop request failed');
      this.serverMessageSuccess.set(false);
    }
    await this.loadStatus();
    this.llmHealth.refresh();
    this.stopping.set(false);
  }

  profileLabel(profile: 'cpu' | 'cuda' | 'apple-silicon-experimental'): string {
    switch (profile) {
      case 'cuda': return 'NVIDIA CUDA';
      case 'apple-silicon-experimental': return 'Apple Silicon Experimental';
      default: return 'CPU-only';
    }
  }

  runtimeCompatibilityWarning(): string | null {
    if (this.selectedRuntime() === 'ik' && this.selectedProfile() === 'apple-silicon-experimental') {
      return 'ik_llama.cpp is currently unstable on the Apple Silicon Experimental (Metal) profile. Use CPU-only on macOS for this runtime.';
    }
    return null;
  }

  runtimeSourceRepo(runtime: 'mainline' | 'ik'): string {
    return runtime === 'ik' ? 'ikawrakow/ik_llama.cpp' : 'ggml-org/llama.cpp';
  }

  ggufVariantLabel(file: HfFile): string {
    return getGgufVariantLabel(file.filename);
  }

  ggufFriendlyLabel(file: HfFile): string {
    const label = this.ggufVariantLabel(file);
    return QUANTIZATION_FRIENDLY_LABELS[label] ?? 'Alternative';
  }

  ggufVariantDescription(file: HfFile): string {
    const label = this.ggufVariantLabel(file);
    return QUANTIZATION_DESCRIPTIONS[label] ?? 'Alternative quantization variant.';
  }

  ggufDownloadSizeMb(file: HfFile): number | null {
    return file.splitTotalMb ?? file.sizeMb;
  }

  isInstallingRepoFile(file: HfFile): boolean {
    return this.modelInstalling() && this.installingModelFilename() === file.filename;
  }

  visibleRepoFiles(): HfFile[] {
    const files = [...this.repoFiles()].sort((left, right) => {
      const priorityDelta = getGgufVariantSortKey(left) - getGgufVariantSortKey(right);
      if (priorityDelta !== 0) return priorityDelta;
      return this.ggufVariantLabel(left).localeCompare(this.ggufVariantLabel(right));
    });

    if (this.showAllRepoFiles() || files.length <= 8) {
      return files;
    }

    const curated: HfFile[] = [];
    const seenLabels = new Set<string>();
    for (const file of files) {
      const label = this.ggufVariantLabel(file);
      const isPreferred = getGgufVariantSortKey(file) !== Number.MAX_SAFE_INTEGER;
      if (!isPreferred || seenLabels.has(label)) continue;
      curated.push(file);
      seenLabels.add(label);
      if (curated.length >= 6) break;
    }

    return curated.length > 0 ? curated : files.slice(0, 8);
  }

  hiddenRepoFileCount(): number {
    return Math.max(0, this.repoFiles().length - this.visibleRepoFiles().length);
  }

  versionDisplayLabel(tag: string): string {
    if (this.selectedRuntime() !== 'ik') return tag;
    return tag === 'main' ? `${tag} (latest branch)` : `${tag} (pinned tag)`;
  }

  thinkingModeLabel(): string {
    return this.thinkingMode() === 'thinking' ? 'Raw reasoning' : 'Production answers';
  }

  ikSweepRecommendedLabel(result: IkCpuSweepResult): string {
    return result.entries.find((entry) => entry.key === result.recommendedKey)?.label ?? 'Unknown';
  }

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
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<HfModel[]>>(`${API}/admin/llm/models/search`, { params: { q } }));
      this.modelSearchResults.set(res.data ?? []);
    } catch { this.modelSearchResults.set([]); }
    this.modelSearching.set(false);
  }

  async selectModelRepo(repoId: string): Promise<void> {
    this.selectedRepo.set(repoId);
    this.showAllRepoFiles.set(false);
    this.repoFilesLoading.set(true);
    this.modelSearchResults.set([]);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ repoId: string; files: HfFile[]; maxModelSizeMb: number }>>(`${API}/admin/llm/models/files`, { params: { repoId } }));
      this.repoFiles.set(res.data?.files ?? []);
      if (res.data?.maxModelSizeMb) {
        this.modelSizeLimitMb.set(res.data.maxModelSizeMb);
      }
    } catch { this.repoFiles.set([]); }
    this.repoFilesLoading.set(false);
  }

  async installModel(repoId: string, filename: string): Promise<void> {
    this.modelInstalling.set(true);
    this.installingModelFilename.set(filename);
    this.modelMessage.set('Starting download…');
    this.modelMessageSuccess.set(true);
    this.modelDownloadProgress.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<{ message: string }>>(`${API}/admin/llm/models/install`, { repoId, filename }));
      if (!res.success) {
        this.modelMessage.set((res as any).error ?? 'Install failed');
        this.modelMessageSuccess.set(false);
        this.modelInstalling.set(false);
        this.installingModelFilename.set(null);
        return;
      }

      // Poll download status every 2s
      const poll = async (): Promise<boolean> => {
        try {
          const s = await firstValueFrom(this.http.get<ApiResponse<{
            status: string; downloadedMb: number; totalMb: number | null;
            progressPct: number | null; sizeMb: number | null;
            error: string | null; elapsedSec: number | null;
          }>>(`${API}/admin/llm/models/download-status`));
          const d = s.data!;
          if (d.status === 'downloading') {
            this.modelDownloadProgress.set({ downloadedMb: d.downloadedMb, totalMb: d.totalMb, progressPct: d.progressPct, elapsedSec: d.elapsedSec });
            const pct = d.progressPct != null ? ` (${d.progressPct}%)` : '';
            this.modelMessage.set(`Downloading… ${d.downloadedMb}${d.totalMb ? '/' + d.totalMb : ''} MB${pct}`);
            return false; // not done
          } else if (d.status === 'done') {
            this.modelMessage.set(`Installed ${filename} (${d.sizeMb} MB)`);
            this.modelMessageSuccess.set(true);
            this.selectedRepo.set(null);
            this.repoFiles.set([]);
            return true;
          } else if (d.status === 'error') {
            this.modelMessage.set(d.error ?? 'Download failed');
            this.modelMessageSuccess.set(false);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      };

      // Poll loop. Large model downloads can legitimately take much longer than 10 minutes.
      for (let i = 0; i < 21_600; i++) { // up to 12 hours at a 2s poll interval
        await new Promise(r => setTimeout(r, 2000));
        const done = await poll();
        if (done) break;
      }
    } catch (err: any) {
      this.modelMessage.set(err?.error?.error ?? err?.error?.message ?? 'Install failed');
      this.modelMessageSuccess.set(false);
    }
    this.modelDownloadProgress.set(null);
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.modelInstalling.set(false);
    this.installingModelFilename.set(null);
  }

  async removeModel(): Promise<void> {
    this.modelRemoving.set(true);
    this.modelMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.delete<ApiResponse<{ removed: string }>>(`${API}/admin/llm/models`));
      this.modelMessage.set(res.success ? `Removed ${res.data?.removed}` : 'Remove failed');
      this.modelMessageSuccess.set(res.success);
    } catch (err: any) {
      this.modelMessage.set(err?.error?.message ?? 'Remove failed');
      this.modelMessageSuccess.set(false);
    }
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadConfigDebug()]);
    this.modelRemoving.set(false);
  }

  // ── Tests ─────────────────────────────────────────────────────────

  async runTestPrompt(): Promise<void> {
    this.testRunning.set(true);
    this.testResult.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<TestResult>>(`${API}/admin/llm/test`, {
        prompt: this.testPrompt(),
        thinkingMode: this.thinkingMode(),
      }));
      this.testResult.set(res.data ?? null);
    } catch (err: any) {
      this.testResult.set({ success: false, durationMs: 0, input: this.testPrompt(), output: null, reasoning: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null });
    }
    this.testRunning.set(false);
  }

  async runBenchmark(): Promise<void> {
    this.benchmarkRunning.set(true);
    this.benchmarkResult.set(null);
    try {
      this.benchmarkResult.set(await this.requestBenchmark());
    } catch (err: any) {
      this.benchmarkResult.set({
        prompt: this.benchmarkPrompt(),
        maxTokens: this.benchmarkMaxTokens(),
        repeatCount: this.benchmarkRepeatCount(),
        successCount: 0,
        averageDurationMs: null,
        averageTokensPerSecond: null,
        totalTokensUsed: null,
        outputSample: null,
        runs: [{
          run: 1,
          success: false,
          durationMs: 0,
          tokensUsed: null,
          tokensPerSecond: null,
          error: err?.error?.message ?? 'Benchmark request failed',
        }],
      });
    }
    this.benchmarkRunning.set(false);
  }

  async runPresetBenchmarkSweep(): Promise<void> {
    this.benchmarkSweepRunning.set(true);
    this.benchmarkSweepResult.set(null);
    this.serverMessage.set('Benchmarking presets…');
    this.serverMessageSuccess.set(true);

    const originalTuning = { ...this.tuning() };
    const originalPreset = this.selectedTuningPreset();
    const originalHealthy = this.status()?.healthy ?? false;
    const presets: Array<Exclude<TuningPreset, 'custom'>> = ['throughput', 'balanced', 'low-memory'];
    const entries: BenchmarkSweepEntry[] = [];

    try {
      for (const preset of presets) {
        const tuning = getPresetTuning(this.selectedProfile(), preset);
        this.tuning.set(tuning);
        this.selectedTuningPreset.set(preset);
        this.serverMessage.set(`Benchmarking ${this.presetLabel(preset)} preset…`);

        try {
          await this.requestStopServer();
          const start = await this.requestStartServer(tuning);
          if (!start.started) {
            entries.push({
              preset,
              label: this.presetLabel(preset),
              result: null,
              error: start.message,
            });
            continue;
          }

          const result = await this.requestBenchmark();
          entries.push({
            preset,
            label: this.presetLabel(preset),
            result,
            error: result ? null : 'Benchmark returned no data',
          });
        } catch (err: any) {
          entries.push({
            preset,
            label: this.presetLabel(preset),
            result: null,
            error: err?.error?.message ?? err?.message ?? 'Preset benchmark failed',
          });
        }
      }

      const recommended = entries
        .filter((entry) => entry.result?.averageTokensPerSecond != null)
        .sort((left, right) => (right.result?.averageTokensPerSecond ?? 0) - (left.result?.averageTokensPerSecond ?? 0))[0]?.preset ?? null;

      this.benchmarkSweepResult.set({
        entries,
        recommendedPreset: recommended,
      });
      if (recommended) {
        const recommendedEntry = entries.find((entry) => entry.preset === recommended) ?? null;
        await this.saveRecommendation(recommended, recommendedEntry?.result ?? null, null, getPresetTuning(this.selectedProfile(), recommended));
      }
      this.serverMessage.set(recommended ? `Preset sweep complete. Recommended: ${this.presetLabel(recommended)}.` : 'Preset sweep complete. No clear recommendation.');
      this.serverMessageSuccess.set(recommended !== null);
    } finally {
      this.tuning.set(originalTuning);
      this.selectedTuningPreset.set(originalPreset);

      try {
        await this.requestStopServer();
        if (originalHealthy) {
          await this.requestStartServer(originalTuning);
        }
      } catch {
        this.serverMessage.set('Preset sweep finished, but the original server state could not be fully restored.');
        this.serverMessageSuccess.set(false);
      }

      await this.loadStatus();
      this.llmHealth.refresh();
      this.benchmarkSweepRunning.set(false);
    }
  }

  async runIkCpuBenchmarkSweep(): Promise<void> {
    this.ikCpuSweepRunning.set(true);
    this.ikCpuSweepResult.set(null);
    this.serverMessage.set('Benchmarking ik CPU candidates…');
    this.serverMessageSuccess.set(true);

    const originalTuning = { ...this.tuning() };
    const originalPreset = this.selectedTuningPreset();
    const originalHealthy = this.status()?.healthy ?? false;
    const entries = getIkCpuSweepCandidates(this.tuning());
    let targetTuning = { ...originalTuning };
    let targetPreset: TuningPreset = originalPreset;

    try {
      for (const entry of entries) {
        this.tuning.set({ ...entry.tuning });
        this.selectedTuningPreset.set('custom');
        this.serverMessage.set(`Benchmarking ${entry.label}…`);

        try {
          await this.requestStopServer();
          const start = await this.requestStartServer(entry.tuning);
          if (!start.started) {
            entry.error = start.message;
            continue;
          }

          entry.result = await this.requestBenchmark();
          entry.error = entry.result ? null : 'Benchmark returned no data';
        } catch (err: any) {
          entry.error = err?.error?.message ?? err?.message ?? 'ik CPU benchmark failed';
        }
      }

      const recommended = entries
        .filter((entry) => entry.result?.averageTokensPerSecond != null)
        .sort((left, right) => (right.result?.averageTokensPerSecond ?? 0) - (left.result?.averageTokensPerSecond ?? 0))[0] ?? null;

      this.ikCpuSweepResult.set({
        entries,
        recommendedKey: recommended?.key ?? null,
      });

      if (recommended) {
        targetTuning = { ...recommended.tuning };
        targetPreset = 'custom';
        this.benchmarkResult.set(recommended.result);
        await this.saveRecommendation('custom', recommended.result, `ik CPU sweep (${recommended.label})`, recommended.tuning);
        this.serverMessage.set(`ik CPU sweep complete. Applied ${recommended.label}.` + (originalHealthy ? '' : ' Start the server to persist these settings.'));
        this.serverMessageSuccess.set(true);
      } else {
        this.serverMessage.set('ik CPU sweep complete, but no candidate produced a clear recommendation.');
        this.serverMessageSuccess.set(false);
      }
    } finally {
      this.tuning.set(targetTuning);
      this.selectedTuningPreset.set(targetPreset);

      try {
        await this.requestStopServer();
        if (originalHealthy) {
          await this.requestStartServer(targetTuning);
        }
      } catch {
        this.serverMessage.set('ik CPU sweep finished, but the server could not be fully restored.');
        this.serverMessageSuccess.set(false);
      }

      await this.loadStatus();
      this.llmHealth.refresh();
      this.ikCpuSweepRunning.set(false);
    }
  }

  async runTestRfq(): Promise<void> {
    this.rfqRunning.set(true);
    this.rfqResult.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<TestResult & { parsed: any }>>(`${API}/admin/llm/test-rfq`, { rfqText: this.rfqText() }));
      this.rfqResult.set(res.data ?? null);
    } catch (err: any) {
      this.rfqResult.set({ success: false, durationMs: 0, input: this.rfqText(), output: null, reasoning: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null, parsed: null });
    }
    this.rfqRunning.set(false);
  }

  async runTestSearch(): Promise<void> {
    this.searchRunning.set(true);
    this.searchResult.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<TestResult>>(`${API}/admin/llm/test-search`, { query: this.searchQuery() }));
      this.searchResult.set(res.data ?? null);
    } catch (err: any) {
      this.searchResult.set({ success: false, durationMs: 0, input: this.searchQuery(), output: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null });
    }
    this.searchRunning.set(false);
  }

  // ── Prompts / KB ──────────────────────────────────────────────────

  async loadPrompts(): Promise<void> {
    this.promptsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<PromptInfo[]>>(`${API}/admin/llm/prompts`));
      const list = res.data ?? [];
      this.prompts.set(list);
      if (list.length && !this.selectedPromptId()) await this.selectPrompt(list[0].id);
    } catch { this.prompts.set([]); }
    this.promptsLoading.set(false);
  }

  async selectPrompt(id: string): Promise<void> {
    this.selectedPromptId.set(id);
    this.promptMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts/${id}`));
      const prompt = res.data ?? null;
      this.selectedPrompt.set(prompt);
      this.promptEditorContent.set(prompt?.content ?? '');
    } catch { this.selectedPrompt.set(null); this.promptEditorContent.set(''); }
  }

  async savePrompt(): Promise<void> {
    const id = this.selectedPromptId();
    if (!id) return;
    this.promptSaving.set(true);
    this.promptMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.put<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts/${id}`, { content: this.promptEditorContent() }));
      if (res.success && res.data) {
        this.selectedPrompt.set(res.data);
        this.promptEditorContent.set(res.data.content);
        this.promptMessage.set('Saved');
        this.promptMessageSuccess.set(true);
        this.loadPrompts();
      } else {
        this.promptMessage.set((res as any).error ?? 'Save failed');
        this.promptMessageSuccess.set(false);
      }
    } catch (err: any) {
      this.promptMessage.set(err?.error?.message ?? 'Save failed');
      this.promptMessageSuccess.set(false);
    }
    this.promptSaving.set(false);
    setTimeout(() => this.promptMessage.set(null), 3000);
  }

  async createNewPrompt(): Promise<void> {
    const id = this.newPromptId().trim();
    if (!id) return;
    this.creatingPrompt.set(true);
    this.promptMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<PromptDetail>>(`${API}/admin/llm/prompts`, { id, content: `# ${id}\n\nDescribe the system prompt for this workflow here.\n` }));
      if (res.success) {
        this.newPromptId.set('');
        this.showNewPromptInput.set(false);
        await this.loadPrompts();
        await this.selectPrompt(id);
      } else {
        this.promptMessage.set((res as any).error ?? 'Create failed');
        this.promptMessageSuccess.set(false);
      }
    } catch (err: any) {
      this.promptMessage.set(err?.error?.message ?? 'Create failed');
      this.promptMessageSuccess.set(false);
    }
    this.creatingPrompt.set(false);
  }

  async deleteCurrentPrompt(): Promise<void> {
    const id = this.selectedPromptId();
    if (!id || !confirm(`Delete prompt "${id}"? This cannot be undone.`)) return;
    try {
      await firstValueFrom(this.http.delete<ApiResponse<any>>(`${API}/admin/llm/prompts/${id}`));
      this.selectedPromptId.set(null);
      this.selectedPrompt.set(null);
      await this.loadPrompts();
    } catch (err: any) {
      this.promptMessage.set(err?.error?.message ?? 'Delete failed');
      this.promptMessageSuccess.set(false);
    }
  }
}
