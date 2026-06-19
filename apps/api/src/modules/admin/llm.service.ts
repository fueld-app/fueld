// ═══════════════════════════════════════════════════════════════════════
//  LLM Service — process management, install state, helpers, benchmarks
// ═══════════════════════════════════════════════════════════════════════

import { getLlmClient } from '../../lib/llm';
import { listPrompts, getPrompt, updatePrompt, createPrompt, deletePrompt } from '../../lib/prompt-loader';
import { isSearchHealthy } from '../../lib/web-search';
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { cpus } from 'os';
import type {
  LlmRuntime,
  LlmProfile,
  LlmPreset,
  LlmRecommendationPreset,
  LlmTuningConfig,
  LlmPresetRecommendation,
  LlmRecommendationHistoryEntry,
  LlmRuntimeConfig,
  LlmRuntimeConfigInput,
  LlmLaunchPlan,
  ModelDownloadState,
  InstallState,
  LlmStatusDto,
  LlmInstallStatus,
  LlmConfigDebugDto,
  LlmTestResult,
  LlmBenchmarkRun,
  LlmBenchmarkResult,
} from './llm.types';

// ═══════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_LLAMA_CPP_VERSION = 'b8201';
const DEFAULT_IK_LLAMA_CPP_VERSION = 'main';
const DEFAULT_MODEL_NAME = 'Qwen3.5-0.8B-Q4_K_M';
const DEFAULT_MAX_MODEL_SIZE_MB = 4096;

// ═══════════════════════════════════════════════════════════════════════
//  State — module-level mutable state (process, download, install)
// ═══════════════════════════════════════════════════════════════════════

let _serverProcess: ReturnType<typeof Bun.spawn> | null = null;
let _modelDownload: ModelDownloadState = {
  status: 'idle', filename: null, repoId: null,
  totalBytes: null, downloadedBytes: 0, sizeMb: null,
  error: null, startedAt: null,
};
let _installState: InstallState = {
  status: 'idle', step: '', log: [], error: null, startedAt: null,
  buildCurrent: null, buildTotal: null,
};
let _llamaBinaryHelpCache: { binaryPath: string; mtimeMs: number; text: string } | null = null;

// ═══════════════════════════════════════════════════════════════════════
//  Admin Guard
// ═══════════════════════════════════════════════════════════════════════

export function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Type Guards
// ═══════════════════════════════════════════════════════════════════════

export function isLlmRuntime(value: string | undefined): value is LlmRuntime {
  return value === 'mainline' || value === 'ik';
}

export function isLlmProfile(value: string | undefined): value is LlmProfile {
  return value === 'cpu' || value === 'cuda' || value === 'apple-silicon-experimental';
}

export function isLlmPreset(value: string | undefined): value is LlmPreset {
  return value === 'throughput' || value === 'balanced' || value === 'low-memory';
}

export function isLlmRecommendationPreset(value: string | undefined): value is LlmRecommendationPreset {
  return isLlmPreset(value) || value === 'custom';
}

// ═══════════════════════════════════════════════════════════════════════
//  Recommendation helpers
// ═══════════════════════════════════════════════════════════════════════

function getRecommendationKey(runtime: LlmRuntime, profile: LlmProfile): string {
  return `${runtime}:${profile}`;
}

function normalizeRecommendation(
  key: string,
  input: Partial<LlmPresetRecommendation> | undefined,
): LlmPresetRecommendation | null {
  const [runtimeRaw, profileRaw] = key.split(':');
  const runtimeCandidate = input?.runtime ?? runtimeRaw;
  const profileCandidate = input?.profile ?? profileRaw;
  const runtime: LlmRuntime | null = isLlmRuntime(runtimeCandidate) ? runtimeCandidate : null;
  const profile: LlmProfile | null = isLlmProfile(profileCandidate) ? profileCandidate : null;
  const preset = isLlmRecommendationPreset(input?.preset) ? input.preset : null;
  if (!runtime || !profile || !preset) return null;
  const history = Array.isArray(input?.history)
    ? input.history
        .map((entry) => ({
          preset: isLlmRecommendationPreset(entry?.preset) ? entry.preset : null,
          label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : null,
          averageTokensPerSecond: typeof entry?.averageTokensPerSecond === 'number' ? entry.averageTokensPerSecond : null,
          averageDurationMs: typeof entry?.averageDurationMs === 'number' ? entry.averageDurationMs : null,
          recordedAt: typeof entry?.recordedAt === 'string' && entry.recordedAt.trim() ? entry.recordedAt : '',
        }))
        .filter((entry): entry is LlmRecommendationHistoryEntry => entry.preset !== null && entry.recordedAt.length > 0)
    : [];
  return {
    preset,
    label: typeof input?.label === 'string' && input.label.trim() ? input.label.trim() : null,
    averageTokensPerSecond: typeof input?.averageTokensPerSecond === 'number' ? input.averageTokensPerSecond : null,
    averageDurationMs: typeof input?.averageDurationMs === 'number' ? input.averageDurationMs : null,
    recordedAt: typeof input?.recordedAt === 'string' && input.recordedAt.trim() ? input.recordedAt : new Date().toISOString(),
    runtime,
    profile,
    tuning: input?.tuning ? normalizeLaunchTuning(profile, input.tuning) : null,
    history,
  };
}

function normalizeRecommendations(input: unknown): Record<string, LlmPresetRecommendation> {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input as Record<string, Partial<LlmPresetRecommendation>>).reduce<Record<string, LlmPresetRecommendation>>((acc, [key, value]) => {
    const normalized = normalizeRecommendation(key, value);
    if (normalized) acc[key] = normalized;
    return acc;
  }, {});
}

// ═══════════════════════════════════════════════════════════════════════
//  Defaults
// ═══════════════════════════════════════════════════════════════════════

function getDefaultProfile(): LlmProfile {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'apple-silicon-experimental';
  return 'cpu';
}

function getDefaultRuntimeConfig(): LlmRuntimeConfig {
  const runtime = isLlmRuntime(process.env['LLM_RUNTIME']) ? process.env['LLM_RUNTIME'] : 'mainline';
  const profile = isLlmProfile(process.env['LLM_PROFILE']) ? process.env['LLM_PROFILE'] : getDefaultProfile();
  const buildFromSourceEnv = process.env['LLM_BUILD_FROM_SOURCE'];
  const buildFromSource = buildFromSourceEnv == null
    ? runtime === 'ik'
    : ['1', 'true', 'yes', 'on'].includes(buildFromSourceEnv.toLowerCase());
  return {
    runtime,
    profile,
    version: runtime === 'ik' ? DEFAULT_IK_LLAMA_CPP_VERSION : DEFAULT_LLAMA_CPP_VERSION,
    buildFromSource,
    maxModelSizeMb: DEFAULT_MAX_MODEL_SIZE_MB,
    tuning: getDefaultLaunchTuning(profile),
    recommendations: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Paths
// ═══════════════════════════════════════════════════════════════════════

export function getLlmPaths() {
  let scriptDir: string;
  if (process.env['LLM_SCRIPT_DIR']) {
    scriptDir = resolve(process.env['LLM_SCRIPT_DIR']);
  } else {
    const cwd = process.cwd();
    const candidates = [
      '/opt/fueld/llm',
      join(cwd, 'llm'),
      join(cwd, '..', '..', 'scripts', 'llm'),
      join(cwd, 'scripts', 'llm'),
    ];
    scriptDir = candidates.find((c) => existsSync(c)) ?? '/opt/fueld/llm';
  }
  const binDir = process.env['LLM_BIN_DIR'] ?? join(scriptDir, 'bin');
  const modelDir = process.env['LLM_MODEL_DIR'] ?? join(scriptDir, 'models');
  return { scriptDir, binDir, modelDir, binary: join(binDir, 'llama-server') };
}

function getLlmConfigPath(): string {
  return join(getLlmPaths().scriptDir, 'runtime-config.json');
}

function buildLlmProcessEnv(paths = getLlmPaths()): Record<string, string> {
  const env = {
    ...process.env,
    DYLD_LIBRARY_PATH: [paths.binDir, process.env['DYLD_LIBRARY_PATH']].filter(Boolean).join(':'),
    LD_LIBRARY_PATH: [paths.binDir, process.env['LD_LIBRARY_PATH']].filter(Boolean).join(':'),
  } as Record<string, string>;
  if (process.env['GGML_BACKEND_PATH']) env['GGML_BACKEND_PATH'] = process.env['GGML_BACKEND_PATH'];
  return env;
}

// ═══════════════════════════════════════════════════════════════════════
//  Binary Help
// ═══════════════════════════════════════════════════════════════════════

function getLlamaServerHelpText(paths = getLlmPaths()): string {
  if (!existsSync(paths.binary)) return '';
  let mtimeMs = 0;
  try { mtimeMs = statSync(paths.binary).mtimeMs; } catch { return ''; }
  if (_llamaBinaryHelpCache && _llamaBinaryHelpCache.binaryPath === paths.binary && _llamaBinaryHelpCache.mtimeMs === mtimeMs) {
    return _llamaBinaryHelpCache.text;
  }
  try {
    const result = Bun.spawnSync([paths.binary, '--help'], { stdout: 'pipe', stderr: 'pipe', env: buildLlmProcessEnv(paths), timeout: 5_000 });
    const text = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    _llamaBinaryHelpCache = { binaryPath: paths.binary, mtimeMs, text };
    return text;
  } catch { return ''; }
}

function supportsLaunchFlag(flag: string, paths = getLlmPaths()): boolean {
  return getLlamaServerHelpText(paths).includes(flag);
}

// ═══════════════════════════════════════════════════════════════════════
//  Runtime Config
// ═══════════════════════════════════════════════════════════════════════

export function normalizeRuntimeConfig(input?: LlmRuntimeConfigInput): LlmRuntimeConfig {
  const defaults = getDefaultRuntimeConfig();
  const runtime = isLlmRuntime(input?.runtime) ? input.runtime : defaults.runtime;
  const profile = isLlmProfile(input?.profile) ? input.profile : defaults.profile;
  const version = (input?.version?.trim() || '').trim() || (runtime === 'ik' ? DEFAULT_IK_LLAMA_CPP_VERSION : DEFAULT_LLAMA_CPP_VERSION);
  const buildFromSource = runtime === 'ik' ? true : input?.buildFromSource ?? defaults.buildFromSource;
  const rawMaxModelSizeMb = Number(input?.maxModelSizeMb ?? defaults.maxModelSizeMb);
  const maxModelSizeMb = Number.isFinite(rawMaxModelSizeMb) && rawMaxModelSizeMb > 0 ? Math.round(rawMaxModelSizeMb) : defaults.maxModelSizeMb;
  const tuning = normalizeLaunchTuning(profile, input?.tuning);
  const recommendations = normalizeRecommendations(input?.recommendations);
  return { runtime, profile, version, buildFromSource, maxModelSizeMb, tuning, recommendations };
}

export function readLlmRuntimeConfig(): LlmRuntimeConfig {
  const defaults = getDefaultRuntimeConfig();
  const configPath = getLlmConfigPath();
  try {
    if (!existsSync(configPath)) return defaults;
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as LlmRuntimeConfigInput;
    return normalizeRuntimeConfig(raw);
  } catch { return defaults; }
}

export function writeLlmRuntimeConfig(input: LlmRuntimeConfigInput): LlmRuntimeConfig {
  const paths = getLlmPaths();
  mkdirSync(paths.scriptDir, { recursive: true });
  const config = normalizeRuntimeConfig({ ...readLlmRuntimeConfig(), ...input });
  writeFileSync(getLlmConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function getCurrentRecommendation(config: LlmRuntimeConfig): LlmPresetRecommendation | null {
  return config.recommendations[getRecommendationKey(config.runtime, config.profile)] ?? null;
}

function getMaxModelSizeMb(config: LlmRuntimeConfig = readLlmRuntimeConfig()): number {
  const envValue = Number(process.env['MAX_MODEL_SIZE_MB'] ?? '');
  if (Number.isFinite(envValue) && envValue > 0) return Math.round(envValue);
  return config.maxModelSizeMb;
}

// ═══════════════════════════════════════════════════════════════════════
//  Preset Recommendation
// ═══════════════════════════════════════════════════════════════════════

export function writePresetRecommendation(input: {
  runtime: LlmRuntime;
  profile: LlmProfile;
  preset: LlmRecommendationPreset;
  label?: string | null;
  tuning?: Partial<LlmTuningConfig> | null;
  averageTokensPerSecond?: number | null;
  averageDurationMs?: number | null;
}): LlmRuntimeConfig {
  const current = readLlmRuntimeConfig();
  const key = getRecommendationKey(input.runtime, input.profile);
  const previous = current.recommendations[key] ?? null;
  const recordedAt = new Date().toISOString();
  const recommendation = normalizeRecommendation(key, {
    ...input,
    tuning: input.tuning ? normalizeLaunchTuning(input.profile, input.tuning) : null,
    recordedAt,
    history: [
      { preset: input.preset, label: input.label?.trim() || null, averageTokensPerSecond: input.averageTokensPerSecond ?? null, averageDurationMs: input.averageDurationMs ?? null, recordedAt },
      ...(previous?.history ?? []),
    ].slice(0, 10),
  });
  if (!recommendation) return current;
  return writeLlmRuntimeConfig({ recommendations: { ...current.recommendations, [key]: recommendation } });
}

// ═══════════════════════════════════════════════════════════════════════
//  Version / Repo helpers
// ═══════════════════════════════════════════════════════════════════════

function getVersionMarkerPath(runtime: LlmRuntime): string {
  const paths = getLlmPaths();
  return join(paths.binDir, runtime === 'ik' ? '.ik-llama-version' : '.llama-cpp-version');
}

function getRuntimeRepo(runtime: LlmRuntime): { cloneUrl: string; githubRepo: string } {
  if (runtime === 'ik') {
    return { cloneUrl: 'https://github.com/ikawrakow/ik_llama.cpp.git', githubRepo: 'ikawrakow/ik_llama.cpp' };
  }
  return { cloneUrl: 'https://github.com/ggml-org/llama.cpp.git', githubRepo: 'ggml-org/llama.cpp' };
}

// ═══════════════════════════════════════════════════════════════════════
//  Launch / Tuning
// ═══════════════════════════════════════════════════════════════════════

function detectThreadCount(): number {
  return Math.max(2, Math.min(cpus().length, 8));
}

function normalizePositiveInt(value: unknown, fallback: number, minimum = 1): number {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.round(parsed));
}

function normalizeStringValue(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function formatLaunchBoolean(value: boolean): 'on' | 'off' {
  return value ? 'on' : 'off';
}

function getDefaultLaunchTuning(profile: LlmProfile): LlmTuningConfig {
  const threads = detectThreadCount();
  const cpuConfig = (): LlmTuningConfig => ({
    ctxSize: 4096, threads, threadsBatch: threads, parallel: 1, batchSize: 1024, ubatchSize: 256,
    flashAttn: true, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0', gpuLayers: 0, noWarmup: false,
    promptCachePath: '', cacheRamMiB: 8192, attentionMaxBatch: 0, graphReuse: true,
    kCacheHadamard: false, cacheRamSimilarity: 0, cacheRamMinTokens: 0, defragThreshold: -1,
    mergeQkv: false, mergeUpGateExperts: false, schedulerAsync: false,
    promptCacheAll: false, promptCacheReadOnly: false,
  });
  if (profile === 'cuda') return { ...cpuConfig(), gpuLayers: 999, batchSize: 2048, ubatchSize: 512, threadsBatch: 2 };
  if (profile === 'apple-silicon-experimental') return { ...cpuConfig(), ubatchSize: 512 };
  return cpuConfig();
}

export function normalizeLaunchTuning(profile: LlmProfile, input?: Partial<LlmTuningConfig>): LlmTuningConfig {
  const defaults = getDefaultLaunchTuning(profile);
  return {
    ctxSize: normalizePositiveInt(input?.ctxSize, defaults.ctxSize, 256),
    threads: normalizePositiveInt(input?.threads, defaults.threads, 1),
    threadsBatch: normalizePositiveInt(input?.threadsBatch, defaults.threadsBatch, 1),
    parallel: normalizePositiveInt(input?.parallel, defaults.parallel, 1),
    batchSize: normalizePositiveInt(input?.batchSize, defaults.batchSize, 1),
    ubatchSize: normalizePositiveInt(input?.ubatchSize, defaults.ubatchSize, 1),
    flashAttn: typeof input?.flashAttn === 'boolean' ? input.flashAttn : defaults.flashAttn,
    cacheTypeK: normalizeStringValue(input?.cacheTypeK, defaults.cacheTypeK),
    cacheTypeV: normalizeStringValue(input?.cacheTypeV, defaults.cacheTypeV),
    gpuLayers: normalizePositiveInt(input?.gpuLayers, defaults.gpuLayers, 0),
    noWarmup: typeof input?.noWarmup === 'boolean' ? input.noWarmup : defaults.noWarmup,
    promptCachePath: typeof input?.promptCachePath === 'string' ? input.promptCachePath.trim() : defaults.promptCachePath,
    cacheRamMiB: normalizePositiveInt(input?.cacheRamMiB, defaults.cacheRamMiB, -1),
    attentionMaxBatch: normalizePositiveInt(input?.attentionMaxBatch, defaults.attentionMaxBatch, 0),
    graphReuse: typeof input?.graphReuse === 'boolean' ? input.graphReuse : defaults.graphReuse,
    kCacheHadamard: typeof input?.kCacheHadamard === 'boolean' ? input.kCacheHadamard : defaults.kCacheHadamard,
    cacheRamSimilarity: typeof input?.cacheRamSimilarity === 'number' && Number.isFinite(input.cacheRamSimilarity)
      ? Math.max(0, Math.min(1, input.cacheRamSimilarity)) : defaults.cacheRamSimilarity,
    cacheRamMinTokens: normalizePositiveInt(input?.cacheRamMinTokens, defaults.cacheRamMinTokens, 0),
    defragThreshold: typeof input?.defragThreshold === 'number' && Number.isFinite(input.defragThreshold) ? input.defragThreshold : defaults.defragThreshold,
    mergeQkv: typeof input?.mergeQkv === 'boolean' ? input.mergeQkv : defaults.mergeQkv,
    mergeUpGateExperts: typeof input?.mergeUpGateExperts === 'boolean' ? input.mergeUpGateExperts : defaults.mergeUpGateExperts,
    schedulerAsync: typeof input?.schedulerAsync === 'boolean' ? input.schedulerAsync : defaults.schedulerAsync,
    promptCacheAll: typeof input?.promptCacheAll === 'boolean' ? input.promptCacheAll : defaults.promptCacheAll,
    promptCacheReadOnly: typeof input?.promptCacheReadOnly === 'boolean' ? input.promptCacheReadOnly : defaults.promptCacheReadOnly,
  };
}

export function buildLaunchPlan(config: LlmRuntimeConfig, modelPath: string): LlmLaunchPlan {
  const tuning = normalizeLaunchTuning(config.profile, config.tuning);
  const paths = getLlmPaths();
  const host = process.env['LLM_HOST'] ?? '127.0.0.1';
  const port = process.env['LLM_PORT'] ?? '8081';
  const ctxSize = process.env['LLM_CTX'] ?? String(tuning.ctxSize);
  const threads = process.env['LLM_THREADS'] ?? String(tuning.threads);
  const threadsBatch = process.env['LLM_THREADS_BATCH'] ?? String(tuning.threadsBatch);
  const parallel = process.env['LLM_PARALLEL'] ?? String(tuning.parallel);
  const batchSize = process.env['LLM_BATCH'] ?? String(tuning.batchSize);
  const ubatchSize = process.env['LLM_UBATCH'] ?? String(tuning.ubatchSize);
  const flashAttn = process.env['LLM_FLASH_ATTN'] ?? formatLaunchBoolean(tuning.flashAttn);
  const cacheTypeK = process.env['LLM_CACHE_TYPE_K'] ?? tuning.cacheTypeK;
  const cacheTypeV = process.env['LLM_CACHE_TYPE_V'] ?? tuning.cacheTypeV;
  const gpuLayers = process.env['LLM_GPU_LAYERS'] ?? String(tuning.gpuLayers);
  const cacheRamMiB = process.env['LLM_CACHE_RAM_MIB'] ?? String(tuning.cacheRamMiB);
  const promptCachePath = process.env['LLM_PROMPT_CACHE'] ?? tuning.promptCachePath;
  const noWarmup = process.env['LLM_NO_WARMUP'] ?? formatLaunchBoolean(tuning.noWarmup);
  const attentionMaxBatch = process.env['LLM_ATTENTION_MAX_BATCH'] ?? String(tuning.attentionMaxBatch);

  const args = [
    '--model', modelPath, '--host', host, '--port', port,
    '--ctx-size', ctxSize, '--threads', threads, '--threads-batch', threadsBatch,
    '--parallel', parallel, '--batch-size', batchSize, '--ubatch-size', ubatchSize,
    '--flash-attn', flashAttn, '--cache-type-k', cacheTypeK, '--cache-type-v', cacheTypeV,
    '--cache-ram', cacheRamMiB, '--cont-batching',
  ];

  if (supportsLaunchFlag('--attention-max-batch', paths)) args.push('--attention-max-batch', attentionMaxBatch);
  if (promptCachePath && supportsLaunchFlag('--prompt-cache', paths)) {
    args.push('--prompt-cache', promptCachePath);
    if (tuning.promptCacheAll && supportsLaunchFlag('--prompt-cache-all', paths)) args.push('--prompt-cache-all');
    if (tuning.promptCacheReadOnly && supportsLaunchFlag('--prompt-cache-ro', paths)) args.push('--prompt-cache-ro');
  }
  if (tuning.cacheRamSimilarity > 0 && supportsLaunchFlag('--cache-ram-similarity', paths)) args.push('--cache-ram-similarity', String(tuning.cacheRamSimilarity));
  if (tuning.cacheRamMinTokens > 0 && supportsLaunchFlag('--cache-ram-n-min', paths)) args.push('--cache-ram-n-min', String(tuning.cacheRamMinTokens));
  if (supportsLaunchFlag('--no-warmup', paths) && ['1', 'true', 'yes', 'on'].includes(noWarmup.toLowerCase())) args.push('--no-warmup');
  if (tuning.graphReuse && supportsLaunchFlag('--graph-reuse', paths)) args.push('--graph-reuse');
  else if (!tuning.graphReuse && supportsLaunchFlag('--no-graph-reuse', paths)) args.push('--no-graph-reuse');
  if (tuning.kCacheHadamard && supportsLaunchFlag('--k-cache-hadamard', paths)) args.push('--k-cache-hadamard');
  if (tuning.defragThreshold >= 0 && supportsLaunchFlag('--defrag-thold', paths)) args.push('--defrag-thold', String(tuning.defragThreshold));
  if (tuning.mergeQkv && supportsLaunchFlag('--merge-qkv', paths)) args.push('--merge-qkv');
  if (tuning.mergeUpGateExperts && supportsLaunchFlag('--merge-up-gate-experts', paths)) args.push('--merge-up-gate-experts');
  if (tuning.schedulerAsync && supportsLaunchFlag('--scheduler_async', paths)) args.push('--scheduler_async');
  if (config.profile === 'cuda' && gpuLayers !== '0') args.push('--gpu-layers', gpuLayers);

  return { args, env: buildLlmProcessEnv(paths) };
}

function getBuildFlags(config: LlmRuntimeConfig): string[] {
  const flags = ['-DCMAKE_BUILD_TYPE=Release', '-DLLAMA_BUILD_SERVER=ON', '-DGGML_NATIVE=ON'];
  if (config.runtime === 'ik') flags.push('-DGGML_IQK_FA_ALL_QUANTS=ON');
  if (config.profile === 'cuda') {
    flags.push('-DGGML_CUDA=ON');
    if (process.env['CMAKE_CUDA_ARCHITECTURES']) flags.push(`-DCMAKE_CUDA_ARCHITECTURES=${process.env['CMAKE_CUDA_ARCHITECTURES']}`);
  } else flags.push('-DGGML_CUDA=OFF');
  if (config.profile === 'apple-silicon-experimental') flags.push('-DGGML_METAL=ON');
  else if (process.platform === 'darwin') flags.push('-DGGML_METAL=OFF');
  return flags;
}

function getUnsupportedRuntimeProfileMessage(config: LlmRuntimeConfig): string | null {
  if (config.runtime === 'ik' && config.profile === 'apple-silicon-experimental') {
    return 'ik_llama.cpp with Apple Silicon Experimental uses the Metal backend, and this upstream runtime is currently unstable there. Use the CPU profile on macOS for ik_llama.cpp.';
  }
  return null;
}

function getStartupTimeoutMs(config: LlmRuntimeConfig): number {
  const envValue = Number(process.env['LLM_STARTUP_TIMEOUT_MS'] ?? '');
  if (Number.isFinite(envValue) && envValue > 0) return Math.round(envValue);
  if (config.profile === 'apple-silicon-experimental') return 90_000;
  if (config.runtime === 'ik') return 45_000;
  return 20_000;
}

export function getBuildDependencyInstallHint(command: string): string {
  if (process.platform === 'darwin') {
    if (command === 'cmake') return 'Install cmake with Homebrew: brew install cmake';
    if (command === 'git' || command === 'c++') return 'Install Xcode Command Line Tools with: xcode-select --install';
  }
  if (process.platform === 'linux') {
    if (command === 'cmake') return 'Install with: sudo apt-get install -y cmake';
    if (command === 'git') return 'Install with: sudo apt-get install -y git';
    if (command === 'c++') return 'Install with: sudo apt-get install -y build-essential';
  }
  return `Install the required build tool for '${command}' on your platform.`;
}

export function getBuildDependencyChecks(): string[] { return ['git', 'cmake', 'c++']; }
function getBuildJobCount(): string { return String(Math.max(1, cpus().length)); }
function getCpuModelDescription(): string | null { return cpus()[0]?.model?.trim() || null; }

// ═══════════════════════════════════════════════════════════════════════
//  Model / Binary discovery
// ═══════════════════════════════════════════════════════════════════════

export function getInstalledModel(): { filename: string; sizeMb: number; path: string } | null {
  const paths = getLlmPaths();
  try {
    const files = readdirSync(paths.modelDir).filter((f) => f.endsWith('.gguf')).sort();
    if (files.length === 0) return null;
    const firstFile = files[0];
    const fullPath = join(paths.modelDir, firstFile);
    const totalBytes = files.reduce((sum, f) => sum + statSync(join(paths.modelDir, f)).size, 0);
    return { filename: firstFile, sizeMb: Math.round(totalBytes / 1024 / 1024), path: fullPath };
  } catch { return null; }
}

export function getInstalledLlamaCppVersion(runtime: LlmRuntime = readLlmRuntimeConfig().runtime): string | null {
  const paths = getLlmPaths();
  const markerPath = getVersionMarkerPath(runtime);
  try {
    if (existsSync(markerPath)) { const v = readFileSync(markerPath, 'utf-8').trim(); if (v) return v; }
    const legacyMarkerPath = join(paths.binDir, '.llama-cpp-version');
    if (runtime === 'mainline' && existsSync(legacyMarkerPath)) { const legacy = readFileSync(legacyMarkerPath, 'utf-8').trim(); if (legacy) return legacy; }
  } catch { /* fallthrough */ }
  if (existsSync(paths.binary)) {
    try {
      const result = Bun.spawnSync([paths.binary, '--version'], { stdout: 'pipe', stderr: 'pipe', env: buildLlmProcessEnv(paths), timeout: 5_000 });
      const output = result.stdout.toString() + result.stderr.toString();
      const match = output.match(/version:\s*(\d+)/);
      if (match) {
        const version = `b${match[1]}`;
        try { writeFileSync(markerPath, version, 'utf-8'); } catch { /* ok */ }
        return version;
      }
    } catch { /* ok */ }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Process management
// ═══════════════════════════════════════════════════════════════════════

function isServerProcessAlive(): boolean {
  if (!_serverProcess) return false;
  return _serverProcess.exitCode === null;
}

export async function stopServerProcess(): Promise<boolean> {
  if (_serverProcess && isServerProcessAlive()) { _serverProcess.kill(); await new Promise((r) => setTimeout(r, 500)); _serverProcess = null; return true; }
  _serverProcess = null;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
//  Status / Install helpers
// ═══════════════════════════════════════════════════════════════════════

export async function getDetailedStatus(): Promise<LlmStatusDto> {
  const llm = getLlmClient();
  const baseUrl = (llm as any).baseUrl as string;
  const timeoutMs = (llm as any).timeoutMs as number;
  const model = getInstalledModel();
  const runtimeConfig = readLlmRuntimeConfig();
  const launchPlan = model ? buildLaunchPlan(runtimeConfig, model.path) : null;
  let healthy = false;
  let latencyMs: number | null = null;
  try { const start = performance.now(); healthy = await llm.isHealthy(); latencyMs = healthy ? Math.round(performance.now() - start) : null; } catch { healthy = false; }
  const searchAvailable = await isSearchHealthy();
  const version = getInstalledLlamaCppVersion(runtimeConfig.runtime);
  return {
    healthy, baseUrl, timeoutMs,
    model: model?.filename?.replace('.gguf', '') ?? null,
    modelSizeMb: model?.sizeMb ?? null, llamaCppVersion: version, searchAvailable, latencyMs,
    runtime: runtimeConfig.runtime, profile: runtimeConfig.profile,
    launchArgs: launchPlan?.args ?? [], tuning: runtimeConfig.tuning,
    recommendation: getCurrentRecommendation(runtimeConfig),
  };
}

export function getInstallStatus(): LlmInstallStatus {
  const paths = getLlmPaths();
  const runtimeConfig = readLlmRuntimeConfig();
  const binaryInstalled = existsSync(paths.binary);
  const model = getInstalledModel();
  const repo = getRuntimeRepo(runtimeConfig.runtime);
  return {
    binaryInstalled, modelInstalled: model !== null, binaryPath: paths.binary, modelDir: paths.modelDir,
    modelFilename: model?.filename ?? null, modelSizeMb: model?.sizeMb ?? null,
    llamaCppVersion: getInstalledLlamaCppVersion(runtimeConfig.runtime),
    maxModelSizeMb: getMaxModelSizeMb(runtimeConfig),
    binFiles: (() => { try { return readdirSync(paths.binDir).sort(); } catch { return []; } })(),
    runtime: runtimeConfig.runtime, profile: runtimeConfig.profile, buildFromSource: runtimeConfig.buildFromSource,
    sourceRepo: repo.githubRepo, tuning: runtimeConfig.tuning, recommendation: getCurrentRecommendation(runtimeConfig),
  };
}

export function getConfigDebug(): LlmConfigDebugDto {
  const configPath = getLlmConfigPath();
  const persisted = existsSync(configPath);
  const rawJson = persisted ? readFileSync(configPath, 'utf-8') : JSON.stringify(readLlmRuntimeConfig(), null, 2);
  return { configPath, persisted, rawJson };
}

// ═══════════════════════════════════════════════════════════════════════
//  Server start
// ═══════════════════════════════════════════════════════════════════════

export async function startServer(runtimeConfig: LlmRuntimeConfig): Promise<{ started: boolean; message: string }> {
  const llm = getLlmClient();
  if (await llm.isHealthy()) return { started: true, message: 'Server is already running' };
  const paths = getLlmPaths();
  const model = getInstalledModel();
  if (!existsSync(paths.binary) || !model) return { started: false, message: 'Binary or model not installed. Run install first.' };
  const compatibilityMessage = getUnsupportedRuntimeProfileMessage(runtimeConfig);
  if (compatibilityMessage) return { started: false, message: compatibilityMessage };
  await stopServerProcess();
  try {
    const launchPlan = buildLaunchPlan(runtimeConfig, model.path);
    const host = process.env['LLM_HOST'] ?? '127.0.0.1';
    const port = process.env['LLM_PORT'] ?? '8081';
    _serverProcess = Bun.spawn([paths.binary, ...launchPlan.args], { cwd: paths.scriptDir, env: launchPlan.env, stdout: 'pipe', stderr: 'pipe' });
    let stderrOutput = '';
    const stderrReader = (async () => { try { const stderr = _serverProcess!.stderr; if (stderr && typeof stderr !== 'number') stderrOutput = (await new Response(stderr as ReadableStream).text()).slice(-2000); } catch { /* */ } })();
    const startupTimeoutMs = getStartupTimeoutMs(runtimeConfig);
    const startupDeadline = Date.now() + startupTimeoutMs;
    let healthy = false;
    while (Date.now() < startupDeadline) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!isServerProcessAlive()) { await stderrReader; return { started: false, message: `Server process exited with code ${_serverProcess?.exitCode}${stderrOutput.trim() ? '\n\n' + stderrOutput.trim() : ''}` }; }
      if (await llm.isHealthy()) { healthy = true; break; }
    }
    return { started: healthy, message: healthy ? `Server started on ${host}:${port}` : `Server started but health check timed out (${Math.round(startupTimeoutMs / 1000)}s)` };
  } catch (err) { return { started: false, message: `Failed to start: ${err instanceof Error ? err.message : String(err)}` }; }
}

// ═══════════════════════════════════════════════════════════════════════
//  Install state accessors
// ═══════════════════════════════════════════════════════════════════════

export function getInstallProgress() {
  const elapsedSec = _installState.startedAt ? Math.round((Date.now() - _installState.startedAt) / 1000) : null;
  return {
    status: _installState.status, step: _installState.step, log: _installState.log.join('\n'),
    error: _installState.error, startedAt: _installState.startedAt, elapsedSec,
    buildCurrent: _installState.buildCurrent, buildTotal: _installState.buildTotal,
  };
}

export function getInstallStateRef() { return _installState; }
export function getServerProcessRef() { return _serverProcess; }

// ═══════════════════════════════════════════════════════════════════════
//  Install async (the fire-and-forget build/download)
// ═══════════════════════════════════════════════════════════════════════

export async function runAsyncInstall(
  runtimeConfig: LlmRuntimeConfig,
  buildFromSource: boolean,
  paths: ReturnType<typeof getLlmPaths>,
): Promise<void> {
  const log = _installState.log;
  async function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if (opts.timeoutMs) { await Promise.race([proc.exited, new Promise((_, reject) => setTimeout(() => { proc.kill(); reject(new Error(`Timed out after ${opts.timeoutMs}ms`)); }, opts.timeoutMs))]); }
    else await proc.exited;
    return { exitCode: proc.exitCode ?? 1, stdout, stderr };
  }
  try {
    const { writeFile, mkdir, rm, rename } = await import('fs/promises');
    const stageBinDir = join(paths.scriptDir, '.tmp-bin-install');
    const stageBinary = join(stageBinDir, 'llama-server');
    const stageVersionMarker = join(stageBinDir, runtimeConfig.runtime === 'ik' ? '.ik-llama-version' : '.llama-cpp-version');
    try { await rm(stageBinDir, { recursive: true, force: true }); } catch { /* ok */ }
    await mkdir(stageBinDir, { recursive: true });
    await mkdir(paths.modelDir, { recursive: true });

    if (buildFromSource) {
      _installState.step = 'Cloning repository…';
      const repo = getRuntimeRepo(runtimeConfig.runtime);
      log.push(`Building ${repo.githubRepo} ${runtimeConfig.version} from source...`);
      const tmpDir = join(paths.scriptDir, '.tmp-build');
      try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
      await mkdir(tmpDir, { recursive: true });
      log.push(`Cloning ${repo.githubRepo} at ref ${runtimeConfig.version}...`);
      const clone = await run(['git', 'clone', '--depth', '1', '--branch', runtimeConfig.version, repo.cloneUrl, 'llama.cpp'], { cwd: tmpDir, timeoutMs: 120_000 });
      if (clone.exitCode !== 0) { await rm(tmpDir, { recursive: true, force: true }); throw new Error(`git clone failed: ${clone.stderr.slice(-500)}`); }
      log.push('Clone OK');
      const srcDir = join(tmpDir, 'llama.cpp');
      const buildDir = join(srcDir, 'build');
      _installState.step = 'Running cmake configure…';
      log.push('Running cmake configure...');
      const cmake = await run(['cmake', '-B', 'build', ...getBuildFlags(runtimeConfig)], { cwd: srcDir, timeoutMs: 120_000 });
      if (cmake.exitCode !== 0) { await rm(tmpDir, { recursive: true, force: true }); throw new Error(`cmake configure failed:\n${[cmake.stderr, cmake.stdout].filter(Boolean).join('\n').slice(-1500)}`); }
      log.push('cmake configure OK');
      const jobs = getBuildJobCount();
      _installState.step = `Compiling (${jobs} jobs)…`;
      _installState.buildCurrent = 0; _installState.buildTotal = null;
      const makeProc = Bun.spawn(['cmake', '--build', 'build', '--config', 'Release', '-j', jobs], { cwd: srcDir, stdout: 'pipe', stderr: 'pipe' });
      const progressRegex = /^\[\s*(\d+)\/(\d+)\]/;
      async function streamLines(reader: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> {
        let buffer = ''; const chunks: string[] = [];
        for await (const chunk of reader) { const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk); chunks.push(text); buffer += text; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) onLine(line); }
        if (buffer) onLine(buffer); return chunks.join('');
      }
      await Promise.all([
        streamLines(makeProc.stdout as ReadableStream<Uint8Array>, (line) => { const m = progressRegex.exec(line); if (m) { _installState.buildCurrent = parseInt(m[1], 10); _installState.buildTotal = parseInt(m[2], 10); _installState.step = `Compiling [${m[1]}/${m[2]}]…`; } }),
        streamLines(makeProc.stderr as ReadableStream<Uint8Array>, () => {}),
      ]);
      const makeTimeout = setTimeout(() => makeProc.kill(), 600_000);
      await makeProc.exited; clearTimeout(makeTimeout);
      if (makeProc.exitCode !== 0) { await rm(tmpDir, { recursive: true, force: true }); throw new Error('Build failed'); }
      _installState.buildCurrent = null; _installState.buildTotal = null;
      _installState.step = 'Copying binaries…';
      const find = await run(['find', buildDir, '-name', 'llama-server', '-type', 'f']);
      const foundBin = find.stdout.trim().split('\n')[0];
      if (!foundBin) { await rm(tmpDir, { recursive: true, force: true }); throw new Error('llama-server binary not found after build'); }
      const { copyFileSync, chmodSync } = await import('fs');
      copyFileSync(foundBin, stageBinary); chmodSync(stageBinary, 0o755);
      const findLibs = await run(['find', buildDir, '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')', '(', '-type', 'f', '-o', '-type', 'l', ')']);
      for (const libPath of findLibs.stdout.trim().split('\n').filter(Boolean)) { copyFileSync(libPath, join(stageBinDir, require('path').basename(libPath))); }
      await rm(tmpDir, { recursive: true, force: true });
    } else {
      if (runtimeConfig.runtime !== 'mainline') throw new Error('Pre-built archive install is only available for mainline llama.cpp.');
      const os = process.platform === 'darwin' ? 'macos' : 'linux';
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const assetName = os === 'macos' ? `llama-${runtimeConfig.version}-bin-macos-${arch}.tar.gz` : `llama-${runtimeConfig.version}-bin-ubuntu-${arch}.tar.gz`;
      const url = `https://github.com/ggml-org/llama.cpp/releases/download/${runtimeConfig.version}/${assetName}`;
      _installState.step = 'Downloading…';
      log.push(`Downloading ${assetName} from GitHub...`);
      const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
      const tmpDir = join(paths.scriptDir, '.tmp-install');
      await mkdir(tmpDir, { recursive: true });
      const tarPath = join(tmpDir, assetName);
      await Bun.write(tarPath, res);
      _installState.step = 'Extracting…';
      const extractDir = join(tmpDir, 'extract');
      await mkdir(extractDir, { recursive: true });
      const tar = await run(['tar', '-xzf', tarPath, '-C', extractDir]);
      if (tar.exitCode !== 0) { await rm(tmpDir, { recursive: true, force: true }); throw new Error(`tar extraction failed: ${tar.stderr}`); }
      const find2 = await run(['find', extractDir, '-name', 'llama-server', '-type', 'f']);
      const foundBin2 = find2.stdout.trim().split('\n')[0];
      if (!foundBin2) { await rm(tmpDir, { recursive: true, force: true }); throw new Error('llama-server binary not found in archive'); }
      _installState.step = 'Copying binaries…';
      const { copyFileSync, chmodSync } = await import('fs');
      copyFileSync(foundBin2, stageBinary); chmodSync(stageBinary, 0o755);
      const findLibs2 = await run(['find', extractDir, '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')', '(', '-type', 'f', '-o', '-type', 'l', ')']);
      for (const libPath of findLibs2.stdout.trim().split('\n').filter(Boolean)) { copyFileSync(libPath, join(stageBinDir, require('path').basename(libPath))); }
      await rm(tmpDir, { recursive: true, force: true });
    }
    await writeFile(stageVersionMarker, runtimeConfig.version, 'utf-8');
    try { await rm(paths.binDir, { recursive: true, force: true }); } catch { /* ok */ }
    await rename(stageBinDir, paths.binDir);
    writeLlmRuntimeConfig(runtimeConfig);
    try { const binContents = readdirSync(paths.binDir).sort(); log.push(`\nBin directory (${paths.binDir}):`); for (const f of binContents) log.push(`  ${f}`); } catch { /* ok */ }
    const compatMsg = getUnsupportedRuntimeProfileMessage(runtimeConfig);
    if (compatMsg) log.push(`\n⚠ COMPATIBILITY WARNING: ${compatMsg}`);
    const cpuModel = getCpuModelDescription();
    if (cpuModel) log.push(`\nCPU: ${cpuModel}`);
    log.push(`\n✓ ${runtimeConfig.runtime === 'ik' ? 'ik_llama.cpp' : 'llama.cpp'} ${runtimeConfig.version} installed successfully${buildFromSource ? ' (built from source)' : ''}`);
    _installState.status = 'done'; _installState.step = 'Complete';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`\nFailed: ${msg}`);
    _installState.status = 'error'; _installState.error = msg; _installState.step = 'Failed';
  }
}

export function initInstallState(): void {
  _installState = {
    status: 'running',
    step: 'Starting…',
    log: [],
    error: null,
    startedAt: Date.now(),
    buildCurrent: null,
    buildTotal: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Health & test helpers
// ═══════════════════════════════════════════════════════════════════════

export async function checkHealth(): Promise<{ healthy: boolean; searchAvailable: boolean }> {
  const llm = getLlmClient();
  const [healthy, searchAvailable] = await Promise.all([llm.isHealthy(), isSearchHealthy()]);
  return { healthy, searchAvailable };
}

export async function runTestPrompt(prompt: string, maxTokens: number, thinkingMode: 'production' | 'thinking'): Promise<LlmTestResult> {
  const llm = getLlmClient();
  const start = performance.now();
  try {
    const { content: output, reasoning, usage } = await llm.chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: thinkingMode === 'thinking' ? 0.6 : 0.2, maxTokens, thinkingMode },
    );
    return { success: true, durationMs: Math.round(performance.now() - start), input: prompt, output, reasoning, error: null, tokensUsed: usage?.totalTokens ?? null };
  } catch (err) {
    return { success: false, durationMs: Math.round(performance.now() - start), input: prompt, output: null, reasoning: null, error: err instanceof Error ? err.message : String(err), tokensUsed: null };
  }
}

export async function runBenchmark(prompt: string, maxTokens: number, repeatCount: number, thinkingMode: 'production' | 'thinking'): Promise<LlmBenchmarkResult> {
  const llm = getLlmClient();
  const runs: LlmBenchmarkRun[] = [];
  let outputSample: string | null = null;
  for (let index = 0; index < repeatCount; index++) {
    const start = performance.now();
    try {
      const { content, usage } = await llm.chatCompletion([{ role: 'user', content: prompt }], { temperature: thinkingMode === 'thinking' ? 0.6 : 0.1, maxTokens, thinkingMode });
      const durationMs = Math.round(performance.now() - start);
      const tokensUsed = usage?.totalTokens ?? null;
      if (!outputSample && content) outputSample = content;
      runs.push({ run: index + 1, success: true, durationMs, tokensUsed, tokensPerSecond: tokensUsed && durationMs > 0 ? Number(((tokensUsed * 1000) / durationMs).toFixed(2)) : null, error: null });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      runs.push({ run: index + 1, success: false, durationMs, tokensUsed: null, tokensPerSecond: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const successfulRuns = runs.filter((r) => r.success);
  const averageDurationMs = successfulRuns.length ? Math.round(successfulRuns.reduce((sum, r) => sum + r.durationMs, 0) / successfulRuns.length) : null;
  const totalTokens = successfulRuns.every((r) => r.tokensUsed != null) ? successfulRuns.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0) : null;
  const averageTokensPerSecond = successfulRuns.length ? Number((successfulRuns.reduce((sum, r) => sum + (r.tokensPerSecond ?? 0), 0) / successfulRuns.length).toFixed(2)) : null;
  return { prompt, maxTokens, repeatCount, successCount: successfulRuns.length, averageDurationMs, averageTokensPerSecond, totalTokensUsed: totalTokens, outputSample, runs };
}

export async function runTestRfq(rfqText: string): Promise<LlmTestResult & { parsed: any }> {
  const llm = getLlmClient();
  const start = performance.now();
  try {
    const { parsed, usage } = await llm.parseRFQ(rfqText, 'test', 'Admin Test');
    const durationMs = Math.round(performance.now() - start);
    return { success: parsed !== null, durationMs, input: rfqText, output: parsed ? JSON.stringify(parsed, null, 2) : null, reasoning: null, error: parsed === null ? 'Parser returned null' : null, tokensUsed: usage?.totalTokens ?? null, parsed };
  } catch (err) {
    return { success: false, durationMs: Math.round(performance.now() - start), input: rfqText, output: null, reasoning: null, error: err instanceof Error ? err.message : String(err), tokensUsed: null, parsed: null };
  }
}

export async function runTestSearch(query: string, maxTokens: number): Promise<any> {
  const llm = getLlmClient();
  const start = performance.now();
  try {
    const { answer, searchResults, usage } = await llm.searchAndChat(query, { maxTokens });
    return { success: true, durationMs: Math.round(performance.now() - start), input: query, output: answer, error: null, tokensUsed: usage?.totalTokens ?? null, searchResults, searchResultCount: searchResults.length };
  } catch (err) {
    return { success: false, durationMs: Math.round(performance.now() - start), input: query, output: null, error: err instanceof Error ? err.message : String(err), searchResults: [], searchResultCount: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Version listing (GitHub)
// ═══════════════════════════════════════════════════════════════════════

export async function listGithubVersions(runtime: LlmRuntime, limit: number): Promise<{ versions: any[]; installed: string | null }> {
  try {
    if (runtime === 'ik') {
      const tagsRes = await fetch(`https://api.github.com/repos/ikawrakow/ik_llama.cpp/tags?per_page=${limit}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fueld-admin' }, signal: AbortSignal.timeout(10_000) });
      if (!tagsRes.ok) throw new Error(`GitHub API error: ${tagsRes.status}`);
      const tags = (await tagsRes.json()) as Array<{ name: string }>;
      return { versions: [{ tag: 'main', date: '', assetCount: 0, assetSizeMb: null }, ...tags.map((tag) => ({ tag: tag.name, date: '', assetCount: 0, assetSizeMb: null }))], installed: getInstalledLlamaCppVersion(runtime) };
    }
    const res = await fetch(`https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=${limit}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fueld-admin' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const releases = (await res.json()) as Array<{ tag_name: string; published_at: string; prerelease: boolean; assets: { name: string; size: number }[] }>;
    const versions = releases.filter((r) => !r.prerelease && r.tag_name.startsWith('b')).map((r) => {
      const macAsset = r.assets?.find(a => a.name.includes('macos') || a.name.includes('darwin'));
      const linuxAsset = r.assets?.find(a => a.name.includes('ubuntu') || a.name.includes('linux'));
      const mainAsset = macAsset || linuxAsset || r.assets?.[0];
      return { tag: r.tag_name, date: r.published_at?.slice(0, 10) ?? '', assetCount: r.assets?.length ?? 0, assetSizeMb: mainAsset ? Math.round(mainAsset.size / 1024 / 1024) : null };
    });
    return { versions, installed: getInstalledLlamaCppVersion(runtime) };
  } catch (err) { throw err; }
}

// ═══════════════════════════════════════════════════════════════════════
//  Model search (HuggingFace)
// ═══════════════════════════════════════════════════════════════════════

export async function searchHuggingFaceModels(q: string, limit: number): Promise<any[]> {
  const params = new URLSearchParams({ search: q, filter: 'gguf', sort: 'downloads', direction: '-1', limit: String(limit) });
  params.append('expand[]', 'config'); params.append('expand[]', 'lastModified'); params.append('expand[]', 'siblings'); params.append('expand[]', 'cardData'); params.append('expand[]', 'gguf');
  const res = await fetch(`https://huggingface.co/api/models?${params}`, { headers: { 'User-Agent': 'fueld-admin' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HuggingFace API error: ${res.status}`);
  const models = (await res.json()) as Array<any>;
  return models.map((m: any) => {
    let parameterCount: string | null = null;
    const paramTotal = m.gguf?.total ?? m.safetensors?.total;
    if (paramTotal) {
      if (paramTotal >= 1e12) parameterCount = `${(paramTotal / 1e12).toFixed(1)}T`;
      else if (paramTotal >= 1e9) parameterCount = `${(paramTotal / 1e9).toFixed(1)}B`;
      else if (paramTotal >= 1e6) parameterCount = `${(paramTotal / 1e6).toFixed(0)}M`;
      else parameterCount = `${paramTotal}`;
    } else {
      const nameMatch = (m.id ?? m.modelId).match(/(\d+\.?\d*)[BbMm](?![a-zA-Z])/);
      if (nameMatch) parameterCount = `${nameMatch[1]}${nameMatch[0].slice(-1).toUpperCase()}`;
    }
    const ggufFileCount = (m.siblings ?? []).filter((s: any) => s.rfilename.endsWith('.gguf')).length;
    return { id: m.id ?? m.modelId, author: m.author, downloads: m.downloads ?? 0, likes: m.likes ?? 0, lastModified: m.lastModified, parameterCount, ggufFileCount, pipelineTag: m.pipeline_tag ?? null, modelType: m.config?.model_type ?? m.cardData?.model_type ?? null };
  });
}

export async function downloadModel(modelUrl: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  // Parse the HF repo + filename from the selection
  const paths = getLlmPaths();
  await mkdir(paths.modelDir, { recursive: true });
  // Simple download with progress tracking via the existing _modelDownload state
  _modelDownload = { status: 'downloading', filename: null, repoId: null, totalBytes: null, downloadedBytes: 0, sizeMb: null, error: null, startedAt: Date.now() };

  // Delegate to background process
  const downloadProc = Bun.spawn([
    'bash', '-c',
    `cd "${paths.modelDir}" && curl -L --progress-bar -o "${require('path').basename(modelUrl)}" "${modelUrl}"`,
  ]);

  await downloadProc.exited;

  if (downloadProc.exitCode === 0) {
    _modelDownload.status = 'done';
  } else {
    _modelDownload.status = 'error';
    _modelDownload.error = `Download exited with code ${downloadProc.exitCode}`;
  }
}
