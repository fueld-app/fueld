// ═══════════════════════════════════════════════════════════════════════
//  LLM Admin Controller — Status, config, diagnostics & installation
//
//  Admin-only endpoints under /admin/llm.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { getLlmClient } from '../../lib/llm';
import { listPrompts, getPrompt, updatePrompt, createPrompt, deletePrompt } from '../../lib/prompt-loader';
import { isSearchHealthy } from '../../lib/web-search';
import type { ApiResponse } from '@fueld/types';
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { cpus } from 'os';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

/** Validate a prompt slug to prevent path traversal via the `:id` route param. */
function isValidPromptSlug(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) || /^[a-z0-9]$/.test(id);
}

// ─── Constants ──────────────────────────────────────────────────────

type LlmRuntime = 'mainline' | 'ik';
type LlmProfile = 'cpu' | 'cuda' | 'apple-silicon-experimental';
type LlmPreset = 'throughput' | 'balanced' | 'low-memory';
type LlmRecommendationPreset = LlmPreset | 'custom';

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

interface LlmPresetRecommendation {
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

interface LlmRecommendationHistoryEntry {
  preset: LlmRecommendationPreset;
  label: string | null;
  averageTokensPerSecond: number | null;
  averageDurationMs: number | null;
  recordedAt: string;
}

interface LlmRuntimeConfig {
  runtime: LlmRuntime;
  profile: LlmProfile;
  version: string;
  buildFromSource: boolean;
  maxModelSizeMb: number;
  tuning: LlmTuningConfig;
  recommendations: Record<string, LlmPresetRecommendation>;
}

type LlmRuntimeConfigInput = Partial<Omit<LlmRuntimeConfig, 'tuning'>> & {
  tuning?: Partial<LlmTuningConfig>;
  recommendations?: Record<string, LlmPresetRecommendation>;
};

interface LlmLaunchPlan {
  args: string[];
  env: Record<string, string>;
}

interface LlmBinaryHelpCache {
  binaryPath: string;
  mtimeMs: number;
  text: string;
}

const DEFAULT_LLAMA_CPP_VERSION = 'b8201';
const DEFAULT_IK_LLAMA_CPP_VERSION = 'main';
const DEFAULT_MODEL_NAME = 'Qwen3.5-0.8B-Q4_K_M';
const DEFAULT_MAX_MODEL_SIZE_MB = 4096;

let _llamaBinaryHelpCache: LlmBinaryHelpCache | null = null;

function isLlmRuntime(value: string | undefined): value is LlmRuntime {
  return value === 'mainline' || value === 'ik';
}

function isLlmProfile(value: string | undefined): value is LlmProfile {
  return value === 'cpu' || value === 'cuda' || value === 'apple-silicon-experimental';
}

function isLlmPreset(value: string | undefined): value is LlmPreset {
  return value === 'throughput' || value === 'balanced' || value === 'low-memory';
}

function isLlmRecommendationPreset(value: string | undefined): value is LlmRecommendationPreset {
  return isLlmPreset(value) || value === 'custom';
}

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
    if (normalized) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}

function getDefaultProfile(): LlmProfile {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'apple-silicon-experimental';
  }
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

/** Resolve script/bin/model paths based on env vars or defaults */
function getLlmPaths() {
  let scriptDir: string;
  if (process.env['LLM_SCRIPT_DIR']) {
    scriptDir = resolve(process.env['LLM_SCRIPT_DIR']);
  } else {
    // Try candidate paths in order of preference
    const cwd = process.cwd();
    const candidates = [
      '/opt/fueld/llm',                                    // production (managed by setup-vps.sh)
      join(cwd, 'llm'),                                    // production cwd fallback
      join(cwd, '..', '..', 'scripts', 'llm'),             // dev: cwd=apps/api
      join(cwd, 'scripts', 'llm'),                         // dev: cwd=workspace root
    ];
    scriptDir = candidates.find((c) => existsSync(c)) ?? '/opt/fueld/llm';
  }
  const binDir = process.env['LLM_BIN_DIR'] ?? join(scriptDir, 'bin');
  const modelDir = process.env['LLM_MODEL_DIR'] ?? join(scriptDir, 'models');

  return {
    scriptDir,
    binDir,
    modelDir,
    binary: join(binDir, 'llama-server'),
  };
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

  if (process.env['GGML_BACKEND_PATH']) {
    env['GGML_BACKEND_PATH'] = process.env['GGML_BACKEND_PATH'];
  }

  return env;
}

function getLlamaServerHelpText(paths = getLlmPaths()): string {
  if (!existsSync(paths.binary)) return '';

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(paths.binary).mtimeMs;
  } catch {
    return '';
  }

  if (_llamaBinaryHelpCache && _llamaBinaryHelpCache.binaryPath === paths.binary && _llamaBinaryHelpCache.mtimeMs === mtimeMs) {
    return _llamaBinaryHelpCache.text;
  }

  try {
    const result = Bun.spawnSync([paths.binary, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: buildLlmProcessEnv(paths),
      timeout: 5_000,
    });
    const text = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    _llamaBinaryHelpCache = { binaryPath: paths.binary, mtimeMs, text };
    return text;
  } catch {
    return '';
  }
}

function supportsLaunchFlag(flag: string, paths = getLlmPaths()): boolean {
  return getLlamaServerHelpText(paths).includes(flag);
}

function normalizeRuntimeConfig(input?: LlmRuntimeConfigInput): LlmRuntimeConfig {
  const defaults = getDefaultRuntimeConfig();
  const runtime = isLlmRuntime(input?.runtime) ? input.runtime : defaults.runtime;
  const profile = isLlmProfile(input?.profile) ? input.profile : defaults.profile;
  const version = (input?.version?.trim() || '').trim() || (runtime === 'ik' ? DEFAULT_IK_LLAMA_CPP_VERSION : DEFAULT_LLAMA_CPP_VERSION);
  const buildFromSource = runtime === 'ik' ? true : input?.buildFromSource ?? defaults.buildFromSource;
  const rawMaxModelSizeMb = Number(input?.maxModelSizeMb ?? defaults.maxModelSizeMb);
  const maxModelSizeMb = Number.isFinite(rawMaxModelSizeMb) && rawMaxModelSizeMb > 0
    ? Math.round(rawMaxModelSizeMb)
    : defaults.maxModelSizeMb;
  const tuning = normalizeLaunchTuning(profile, input?.tuning);
  const recommendations = normalizeRecommendations(input?.recommendations);
  return { runtime, profile, version, buildFromSource, maxModelSizeMb, tuning, recommendations };
}

function readLlmRuntimeConfig(): LlmRuntimeConfig {
  const defaults = getDefaultRuntimeConfig();
  const configPath = getLlmConfigPath();
  try {
    if (!existsSync(configPath)) return defaults;
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as LlmRuntimeConfigInput;
    return normalizeRuntimeConfig(raw);
  } catch {
    return defaults;
  }
}

function writeLlmRuntimeConfig(input: LlmRuntimeConfigInput): LlmRuntimeConfig {
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
  if (Number.isFinite(envValue) && envValue > 0) {
    return Math.round(envValue);
  }
  return config.maxModelSizeMb;
}

function writePresetRecommendation(input: {
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
      {
        preset: input.preset,
        label: input.label?.trim() || null,
        averageTokensPerSecond: input.averageTokensPerSecond ?? null,
        averageDurationMs: input.averageDurationMs ?? null,
        recordedAt,
      },
      ...(previous?.history ?? []),
    ].slice(0, 10),
  });
  if (!recommendation) {
    return current;
  }
  return writeLlmRuntimeConfig({
    recommendations: {
      ...current.recommendations,
      [key]: recommendation,
    },
  });
}

function getVersionMarkerPath(runtime: LlmRuntime): string {
  const paths = getLlmPaths();
  return join(paths.binDir, runtime === 'ik' ? '.ik-llama-version' : '.llama-cpp-version');
}

function getRuntimeRepo(runtime: LlmRuntime): { cloneUrl: string; githubRepo: string } {
  if (runtime === 'ik') {
    return {
      cloneUrl: 'https://github.com/ikawrakow/ik_llama.cpp.git',
      githubRepo: 'ikawrakow/ik_llama.cpp',
    };
  }
  return {
    cloneUrl: 'https://github.com/ggml-org/llama.cpp.git',
    githubRepo: 'ggml-org/llama.cpp',
  };
}

function detectThreadCount(): number {
  const cpuCount = cpus().length;
  return Math.max(2, Math.min(cpuCount, 8));
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

function normalizeLaunchTuning(profile: LlmProfile, input?: Partial<LlmTuningConfig>): LlmTuningConfig {
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
      ? Math.max(0, Math.min(1, input.cacheRamSimilarity))
      : defaults.cacheRamSimilarity,
    cacheRamMinTokens: normalizePositiveInt(input?.cacheRamMinTokens, defaults.cacheRamMinTokens, 0),
    defragThreshold: typeof input?.defragThreshold === 'number' && Number.isFinite(input.defragThreshold)
      ? input.defragThreshold
      : defaults.defragThreshold,
    mergeQkv: typeof input?.mergeQkv === 'boolean' ? input.mergeQkv : defaults.mergeQkv,
    mergeUpGateExperts: typeof input?.mergeUpGateExperts === 'boolean' ? input.mergeUpGateExperts : defaults.mergeUpGateExperts,
    schedulerAsync: typeof input?.schedulerAsync === 'boolean' ? input.schedulerAsync : defaults.schedulerAsync,
    promptCacheAll: typeof input?.promptCacheAll === 'boolean' ? input.promptCacheAll : defaults.promptCacheAll,
    promptCacheReadOnly: typeof input?.promptCacheReadOnly === 'boolean' ? input.promptCacheReadOnly : defaults.promptCacheReadOnly,
  };
}

function buildLaunchPlan(config: LlmRuntimeConfig, modelPath: string): LlmLaunchPlan {
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
  const supportsAttentionMaxBatch = supportsLaunchFlag('--attention-max-batch', paths);
  const supportsPromptCache = supportsLaunchFlag('--prompt-cache', paths);
  const supportsPromptCacheAll = supportsLaunchFlag('--prompt-cache-all', paths);
  const supportsPromptCacheReadOnly = supportsLaunchFlag('--prompt-cache-ro', paths);
  const supportsCacheRamSimilarity = supportsLaunchFlag('--cache-ram-similarity', paths);
  const supportsCacheRamMinTokens = supportsLaunchFlag('--cache-ram-n-min', paths);
  const supportsNoWarmup = supportsLaunchFlag('--no-warmup', paths);
  const supportsGraphReuse = supportsLaunchFlag('--graph-reuse', paths);
  const supportsNoGraphReuse = supportsLaunchFlag('--no-graph-reuse', paths);
  const supportsKCacheHadamard = supportsLaunchFlag('--k-cache-hadamard', paths);
  const supportsDefragThreshold = supportsLaunchFlag('--defrag-thold', paths);
  const supportsMergeQkv = supportsLaunchFlag('--merge-qkv', paths);
  const supportsMergeUpGateExperts = supportsLaunchFlag('--merge-up-gate-experts', paths);
  const supportsSchedulerAsync = supportsLaunchFlag('--scheduler_async', paths);

  const args = [
    '--model', modelPath,
    '--host', host,
    '--port', port,
    '--ctx-size', ctxSize,
    '--threads', threads,
    '--threads-batch', threadsBatch,
    '--parallel', parallel,
    '--batch-size', batchSize,
    '--ubatch-size', ubatchSize,
    '--flash-attn', flashAttn,
    '--cache-type-k', cacheTypeK,
    '--cache-type-v', cacheTypeV,
    '--cache-ram', cacheRamMiB,
    '--cont-batching',
  ];

  if (supportsAttentionMaxBatch) {
    args.push('--attention-max-batch', attentionMaxBatch);
  }

  if (promptCachePath && supportsPromptCache) {
    args.push('--prompt-cache', promptCachePath);
    if (tuning.promptCacheAll && supportsPromptCacheAll) {
      args.push('--prompt-cache-all');
    }
    if (tuning.promptCacheReadOnly && supportsPromptCacheReadOnly) {
      args.push('--prompt-cache-ro');
    }
  }
  if (tuning.cacheRamSimilarity > 0 && supportsCacheRamSimilarity) {
    args.push('--cache-ram-similarity', String(tuning.cacheRamSimilarity));
  }
  if (tuning.cacheRamMinTokens > 0 && supportsCacheRamMinTokens) {
    args.push('--cache-ram-n-min', String(tuning.cacheRamMinTokens));
  }
  if (supportsNoWarmup && ['1', 'true', 'yes', 'on'].includes(noWarmup.toLowerCase())) {
    args.push('--no-warmup');
  }
  if (tuning.graphReuse && supportsGraphReuse) {
    args.push('--graph-reuse');
  } else if (!tuning.graphReuse && supportsNoGraphReuse) {
    args.push('--no-graph-reuse');
  }
  if (tuning.kCacheHadamard && supportsKCacheHadamard) {
    args.push('--k-cache-hadamard');
  }
  if (tuning.defragThreshold >= 0 && supportsDefragThreshold) {
    args.push('--defrag-thold', String(tuning.defragThreshold));
  }
  if (tuning.mergeQkv && supportsMergeQkv) {
    args.push('--merge-qkv');
  }
  if (tuning.mergeUpGateExperts && supportsMergeUpGateExperts) {
    args.push('--merge-up-gate-experts');
  }
  if (tuning.schedulerAsync && supportsSchedulerAsync) {
    args.push('--scheduler_async');
  }

  if (config.profile === 'cuda' && gpuLayers !== '0') {
    args.push('--gpu-layers', gpuLayers);
  }

  const env = buildLlmProcessEnv(paths);

  return { args, env };
}

function getBuildFlags(config: LlmRuntimeConfig): string[] {
  const flags = ['-DCMAKE_BUILD_TYPE=Release', '-DLLAMA_BUILD_SERVER=ON', '-DGGML_NATIVE=ON'];
  if (config.runtime === 'ik') {
    flags.push('-DGGML_IQK_FA_ALL_QUANTS=ON');
  }
  if (config.profile === 'cuda') {
    flags.push('-DGGML_CUDA=ON');
    if (process.env['CMAKE_CUDA_ARCHITECTURES']) {
      flags.push(`-DCMAKE_CUDA_ARCHITECTURES=${process.env['CMAKE_CUDA_ARCHITECTURES']}`);
    }
  } else {
    flags.push('-DGGML_CUDA=OFF');
  }
  if (config.profile === 'apple-silicon-experimental') {
    flags.push('-DGGML_METAL=ON');
  } else if (process.platform === 'darwin') {
    flags.push('-DGGML_METAL=OFF');
  }
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
  if (Number.isFinite(envValue) && envValue > 0) {
    return Math.round(envValue);
  }
  if (config.profile === 'apple-silicon-experimental') {
    return 90_000;
  }
  if (config.runtime === 'ik') {
    return 45_000;
  }
  return 20_000;
}

function getBuildDependencyInstallHint(command: string): string {
  if (process.platform === 'darwin') {
    if (command === 'cmake') {
      return 'Install cmake with Homebrew: brew install cmake';
    }
    if (command === 'git' || command === 'c++') {
      return 'Install Xcode Command Line Tools with: xcode-select --install';
    }
  }
  if (process.platform === 'linux') {
    if (command === 'cmake') {
      return 'Install with: sudo apt-get install -y cmake';
    }
    if (command === 'git') {
      return 'Install with: sudo apt-get install -y git';
    }
    if (command === 'c++') {
      return 'Install with: sudo apt-get install -y build-essential';
    }
  }
  return `Install the required build tool for '${command}' on your platform.`;
}

function getBuildDependencyChecks(): string[] {
  return ['git', 'cmake', 'c++'];
}

function getBuildJobCount(): string {
  return String(Math.max(1, cpus().length));
}

function getCpuModelDescription(): string | null {
  const primaryCpu = cpus()[0]?.model?.trim();
  return primaryCpu || null;
}

/** Find the currently installed model (first .gguf in models dir). */
function getInstalledModel(): { filename: string; sizeMb: number; path: string } | null {
  const paths = getLlmPaths();
  try {
    const files = readdirSync(paths.modelDir).filter((f) => f.endsWith('.gguf')).sort();
    if (files.length === 0) return null;
    const firstFile = files[0];
    const fullPath = join(paths.modelDir, firstFile);
    // Sum all .gguf files (handles split models)
    const totalBytes = files.reduce((sum, f) => sum + statSync(join(paths.modelDir, f)).size, 0);
    const sizeMb = Math.round(totalBytes / 1024 / 1024);
    return { filename: firstFile, sizeMb, path: fullPath };
  } catch {
    return null;
  }
}

/** Read installed llama.cpp version from a marker file, or detect from binary. */
function getInstalledLlamaCppVersion(runtime: LlmRuntime = readLlmRuntimeConfig().runtime): string | null {
  const paths = getLlmPaths();
  const markerPath = getVersionMarkerPath(runtime);
  try {
    if (existsSync(markerPath)) {
      const v = readFileSync(markerPath, 'utf-8').trim();
      if (v) return v;
    }
    const legacyMarkerPath = join(paths.binDir, '.llama-cpp-version');
    if (runtime === 'mainline' && existsSync(legacyMarkerPath)) {
      const legacy = readFileSync(legacyMarkerPath, 'utf-8').trim();
      if (legacy) return legacy;
    }
  } catch { /* fallthrough */ }

  // Fallback: try to detect version from the binary itself
  if (existsSync(paths.binary)) {
    try {
      const result = Bun.spawnSync([paths.binary, '--version'], {
        stdout: 'pipe', stderr: 'pipe',
        env: buildLlmProcessEnv(paths),
        timeout: 5_000,
      });
      const output = result.stdout.toString() + result.stderr.toString();
      const match = output.match(/version:\s*(\d+)/);
      if (match) {
        const version = `b${match[1]}`;
        // Write marker for next time
        try { writeFileSync(markerPath, version, 'utf-8'); } catch { /* ok */ }
        return version;
      }
    } catch { /* ok */ }
  }

  return null;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface LlmStatusDto {
  healthy: boolean;
  baseUrl: string;
  timeoutMs: number;
  model: string | null;
  modelSizeMb: number | null;
  llamaCppVersion: string | null;
  searchAvailable: boolean;
  /** Latency of the health-check round-trip in ms, or null if unreachable */
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

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  assets: { name: string; size: number }[];
}

interface GithubTag {
  name: string;
  commit?: { sha: string };
}

interface HfModelResult {
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
  config?: {
    model_type?: string;
  };
  safetensors?: {
    total?: number;
    parameters?: Record<string, number>;
  };
  gguf?: {
    total?: number;
    architecture?: string;
    context_length?: number;
  };
  siblings?: Array<{ rfilename: string; size?: number }>;
}

// ─── Process management ─────────────────────────────────────────────

let _serverProcess: ReturnType<typeof Bun.spawn> | null = null;

function isServerProcessAlive(): boolean {
  if (!_serverProcess) return false;
  return _serverProcess.exitCode === null;
}

async function stopServerProcess(): Promise<boolean> {
  if (_serverProcess && isServerProcessAlive()) {
    _serverProcess.kill();
    await new Promise((r) => setTimeout(r, 500));
    _serverProcess = null;
    return true;
  }
  _serverProcess = null;
  return false;
}

// ─── Model download state ───────────────────────────────────────────

interface ModelDownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  filename: string | null;
  repoId: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  sizeMb: number | null;
  error: string | null;
  startedAt: number | null;
}

let _modelDownload: ModelDownloadState = {
  status: 'idle', filename: null, repoId: null,
  totalBytes: null, downloadedBytes: 0, sizeMb: null,
  error: null, startedAt: null,
};

// ─── Install state (async build/download) ───────────────────────────

interface InstallState {
  status: 'idle' | 'running' | 'done' | 'error';
  step: string;
  log: string[];
  error: string | null;
  startedAt: number | null;
  /** cmake build progress: current file number */
  buildCurrent: number | null;
  /** cmake build progress: total files to compile */
  buildTotal: number | null;
}

let _installState: InstallState = {
  status: 'idle', step: '', log: [], error: null, startedAt: null,
  buildCurrent: null, buildTotal: null,
};

// ─── Helpers ────────────────────────────────────────────────────────

async function getDetailedStatus(): Promise<LlmStatusDto> {
  const llm = getLlmClient();
  const baseUrl = (llm as any).baseUrl as string;
  const timeoutMs = (llm as any).timeoutMs as number;
  const model = getInstalledModel();
  const runtimeConfig = readLlmRuntimeConfig();
  const launchPlan = model ? buildLaunchPlan(runtimeConfig, model.path) : null;

  let healthy = false;
  let latencyMs: number | null = null;

  try {
    const start = performance.now();
    healthy = await llm.isHealthy();
    latencyMs = healthy ? Math.round(performance.now() - start) : null;
  } catch {
    healthy = false;
  }

  const searchAvailable = await isSearchHealthy();
  const version = getInstalledLlamaCppVersion(runtimeConfig.runtime);

  return {
    healthy, baseUrl, timeoutMs,
    model: model?.filename?.replace('.gguf', '') ?? null,
    modelSizeMb: model?.sizeMb ?? null,
    llamaCppVersion: version,
    searchAvailable,
    latencyMs,
    runtime: runtimeConfig.runtime,
    profile: runtimeConfig.profile,
    launchArgs: launchPlan?.args ?? [],
    tuning: runtimeConfig.tuning,
    recommendation: getCurrentRecommendation(runtimeConfig),
  };
}

function getInstallStatus(): LlmInstallStatus {
  const paths = getLlmPaths();
  const runtimeConfig = readLlmRuntimeConfig();
  const binaryInstalled = existsSync(paths.binary);
  const model = getInstalledModel();
  const repo = getRuntimeRepo(runtimeConfig.runtime);

  return {
    binaryInstalled,
    modelInstalled: model !== null,
    binaryPath: paths.binary,
    modelDir: paths.modelDir,
    modelFilename: model?.filename ?? null,
    modelSizeMb: model?.sizeMb ?? null,
    llamaCppVersion: getInstalledLlamaCppVersion(runtimeConfig.runtime),
    maxModelSizeMb: getMaxModelSizeMb(runtimeConfig),
    binFiles: (() => { try { return readdirSync(paths.binDir).sort(); } catch { return []; } })(),
    runtime: runtimeConfig.runtime,
    profile: runtimeConfig.profile,
    buildFromSource: runtimeConfig.buildFromSource,
    sourceRepo: repo.githubRepo,
    tuning: runtimeConfig.tuning,
    recommendation: getCurrentRecommendation(runtimeConfig),
  };
}

function getConfigDebug(): LlmConfigDebugDto {
  const configPath = getLlmConfigPath();
  const persisted = existsSync(configPath);
  const rawJson = persisted
    ? readFileSync(configPath, 'utf-8')
    : JSON.stringify(readLlmRuntimeConfig(), null, 2);
  return {
    configPath,
    persisted,
    rawJson,
  };
}

const llmTuningSchema = t.Object({
  ctxSize: t.Optional(t.Number({ minimum: 256 })),
  threads: t.Optional(t.Number({ minimum: 1 })),
  threadsBatch: t.Optional(t.Number({ minimum: 1 })),
  parallel: t.Optional(t.Number({ minimum: 1 })),
  batchSize: t.Optional(t.Number({ minimum: 1 })),
  ubatchSize: t.Optional(t.Number({ minimum: 1 })),
  flashAttn: t.Optional(t.Boolean()),
  cacheTypeK: t.Optional(t.String()),
  cacheTypeV: t.Optional(t.String()),
  gpuLayers: t.Optional(t.Number({ minimum: 0 })),
  noWarmup: t.Optional(t.Boolean()),
  promptCachePath: t.Optional(t.String()),
  cacheRamMiB: t.Optional(t.Number({ minimum: -1 })),
  attentionMaxBatch: t.Optional(t.Number({ minimum: 0 })),
  graphReuse: t.Optional(t.Boolean()),
  kCacheHadamard: t.Optional(t.Boolean()),
  cacheRamSimilarity: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  cacheRamMinTokens: t.Optional(t.Number({ minimum: 0 })),
  defragThreshold: t.Optional(t.Number()),
  mergeQkv: t.Optional(t.Boolean()),
  mergeUpGateExperts: t.Optional(t.Boolean()),
  schedulerAsync: t.Optional(t.Boolean()),
  promptCacheAll: t.Optional(t.Boolean()),
  promptCacheReadOnly: t.Optional(t.Boolean()),
});

const llmPresetSchema = t.Union([
  t.Literal('throughput'),
  t.Literal('balanced'),
  t.Literal('low-memory'),
  t.Literal('custom'),
]);

const llmConfigSchema = t.Object({
  runtime: t.Optional(t.Union([t.Literal('mainline'), t.Literal('ik')])),
  profile: t.Optional(t.Union([t.Literal('cpu'), t.Literal('cuda'), t.Literal('apple-silicon-experimental')])),
  version: t.Optional(t.String()),
  buildFromSource: t.Optional(t.Boolean()),
  maxModelSizeMb: t.Optional(t.Number({ minimum: 1 })),
  tuning: t.Optional(llmTuningSchema),
});

export const llmController = new Elysia({ prefix: '/admin/llm' })
  .use(authGuard)

  // ─── GET /admin/llm/status — health + config overview ───────────
  .get(
    '/status',
    async ({ auth }): Promise<ApiResponse<LlmStatusDto>> => {
      requireAdmin(auth);
      const status = await getDetailedStatus();
      return { success: true, data: status };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Get LLM server status & config' },
    },
  )

  // ─── GET /admin/llm/install/status — binary & model presence ────
  .get(
    '/install/status',
    ({ auth }): ApiResponse<LlmInstallStatus> => {
      requireAdmin(auth);
      return { success: true, data: getInstallStatus() };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Check if LLM binary & model are installed' },
    },
  )

  .get(
    '/config',
    ({ auth }): ApiResponse<LlmConfigDebugDto> => {
      requireAdmin(auth);
      return { success: true, data: getConfigDebug() };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Get persisted LLM runtime config JSON' },
    },
  )

  .post(
    '/config',
    ({ auth, body }): ApiResponse<LlmConfigDebugDto> => {
      requireAdmin(auth);
      writeLlmRuntimeConfig({
        runtime: body.runtime,
        profile: body.profile,
        version: body.version,
        buildFromSource: body.buildFromSource,
        maxModelSizeMb: body.maxModelSizeMb,
        tuning: body.tuning,
      });
      return { success: true, data: getConfigDebug() };
    },
    {
      body: llmConfigSchema,
      detail: { tags: ['Admin', 'LLM'], summary: 'Persist LLM runtime config' },
    },
  )

  // ─── POST /admin/llm/install — install llama-server binary (async) ──
  .post(
    '/recommendation',
    ({ auth, body }): ApiResponse<{ saved: boolean }> => {
      requireAdmin(auth);

      const runtime = isLlmRuntime(body.runtime) ? body.runtime : readLlmRuntimeConfig().runtime;
      const profile = isLlmProfile(body.profile) ? body.profile : readLlmRuntimeConfig().profile;
      writePresetRecommendation({
        runtime,
        profile,
        preset: body.preset,
        label: body.label,
        tuning: body.tuning,
        averageTokensPerSecond: body.averageTokensPerSecond,
        averageDurationMs: body.averageDurationMs,
      });

      return { success: true, data: { saved: true } };
    },
    {
      body: t.Object({
        preset: llmPresetSchema,
        label: t.Optional(t.String()),
        tuning: t.Optional(llmTuningSchema),
        runtime: t.Optional(t.Union([t.Literal('mainline'), t.Literal('ik')])),
        profile: t.Optional(t.Union([t.Literal('cpu'), t.Literal('cuda'), t.Literal('apple-silicon-experimental')])),
        averageTokensPerSecond: t.Optional(t.Number()),
        averageDurationMs: t.Optional(t.Number({ minimum: 0 })),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Persist the recommended tuning preset for the current runtime/profile' },
    },
  )

  .post(
    '/install',
    async ({ auth, body }) => {
      requireAdmin(auth);

      if (_installState.status === 'running') {
        return { success: false, data: null, error: 'An install is already in progress' };
      }

      const runtimeConfig = normalizeRuntimeConfig({
        ...readLlmRuntimeConfig(),
        runtime: body.runtime,
        profile: body.profile,
        version: body.version,
        buildFromSource: body.buildFromSource,
        tuning: body.tuning,
      });
      const version = runtimeConfig.version;
      const buildFromSource = runtimeConfig.buildFromSource;
      const paths = getLlmPaths();

      // Stop server if running before replacing binary
      await stopServerProcess();
      try { Bun.spawn(['pkill', '-f', 'llama-server'], { stdout: 'ignore', stderr: 'ignore' }); await new Promise(r => setTimeout(r, 500)); } catch { /* ok */ }

      // Quick pre-flight for build-from-source: check dependencies synchronously
      if (buildFromSource) {
        for (const cmd of getBuildDependencyChecks()) {
          const check = Bun.spawnSync(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
          if (check.exitCode !== 0) {
            return {
              success: false, data: null,
              error: `Missing build dependency: ${cmd}. ${getBuildDependencyInstallHint(cmd)}`,
            };
          }
        }
      }

      // Start async install
      _installState = {
        status: 'running',
        step: buildFromSource ? 'Preparing to build from source…' : 'Starting download…',
        log: [],
        error: null,
        startedAt: Date.now(),
        buildCurrent: null,
        buildTotal: null,
      };

      // Fire-and-forget — the actual install runs in the background.
      // IMPORTANT: use async Bun.spawn (not spawnSync) so the event loop
      // stays free to serve progress-poll requests while building.
      (async () => {
        const log = _installState.log;

        /** Run a command asynchronously, stream output to install log. */
        async function run(
          cmd: string[],
          opts: { cwd?: string; timeoutMs?: number } = {},
        ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
          const proc = Bun.spawn(cmd, {
            cwd: opts.cwd,
            stdout: 'pipe',
            stderr: 'pipe',
          });

          // Stream stdout/stderr into log array in real-time
          const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);

          // If timeout requested, race against it
          if (opts.timeoutMs) {
            const timer = new Promise<never>((_, reject) =>
              setTimeout(() => { proc.kill(); reject(new Error(`Command timed out after ${opts.timeoutMs}ms: ${cmd.join(' ')}`)); }, opts.timeoutMs),
            );
            await Promise.race([proc.exited, timer]);
          } else {
            await proc.exited;
          }

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
            // ── Build from source ────────────────────────────────────
            _installState.step = 'Cloning repository…';
            const repo = getRuntimeRepo(runtimeConfig.runtime);
            log.push(`Building ${repo.githubRepo} ${version} from source...`);

            const tmpDir = join(paths.scriptDir, '.tmp-build');
            try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
            await mkdir(tmpDir, { recursive: true });

            log.push(`Cloning ${repo.githubRepo} at ref ${version}...`);
            const clone = await run(
              ['git', 'clone', '--depth', '1', '--branch', version, repo.cloneUrl, 'llama.cpp'],
              { cwd: tmpDir, timeoutMs: 120_000 },
            );
            if (clone.exitCode !== 0) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`git clone failed: ${clone.stderr.slice(-500)}`);
            }
            log.push('Clone OK');

            const srcDir = join(tmpDir, 'llama.cpp');
            const buildDir = join(srcDir, 'build');

            _installState.step = 'Running cmake configure…';
            log.push('Running cmake configure...');
            const cmake = await run(
              ['cmake', '-B', 'build', ...getBuildFlags(runtimeConfig)],
              { cwd: srcDir, timeoutMs: 120_000 },
            );
            if (cmake.exitCode !== 0) {
              const err = cmake.stderr.slice(-1000);
              await rm(tmpDir, { recursive: true, force: true });
              const output = [cmake.stderr, cmake.stdout].filter(Boolean).join('\n').slice(-1500);
              throw new Error(`cmake configure failed:\n${output}`);
            }
            log.push('cmake configure OK');

            const jobs = getBuildJobCount();
            _installState.step = `Compiling (${jobs} jobs)…`;
            _installState.buildCurrent = 0;
            _installState.buildTotal = null;
            log.push(`Building with ${jobs} parallel jobs (this may take a few minutes)...`);

            // Stream cmake build to get real-time [X/Y] progress
            const makeProc = Bun.spawn(
              ['cmake', '--build', 'build', '--config', 'Release', '-j', jobs],
              { cwd: srcDir, stdout: 'pipe', stderr: 'pipe' },
            );

            // cmake outputs progress like "[ 42%] Building CXX..." or "[123/456]" to stdout
            // Read stdout line-by-line to parse progress
            const progressRegex = /^\[\s*(\d+)\/(\d+)\]/;
            const percentRegex = /^\[\s*(\d+)%\]/;
            let lastStdout = '';
            let lastStderr = '';

            async function streamLines(reader: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> {
              const chunks: string[] = [];
              let buffer = '';
              for await (const chunk of reader) {
                const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
                chunks.push(text);
                buffer += text;
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) onLine(line);
              }
              if (buffer) onLine(buffer);
              return chunks.join('');
            }

            const [makeStdout, makeStderr] = await Promise.all([
              streamLines(makeProc.stdout as ReadableStream<Uint8Array>, (line) => {
                lastStdout = line;
                const m = progressRegex.exec(line);
                if (m) {
                  _installState.buildCurrent = parseInt(m[1], 10);
                  _installState.buildTotal = parseInt(m[2], 10);
                  _installState.step = `Compiling [${m[1]}/${m[2]}]…`;
                } else {
                  const pm = percentRegex.exec(line);
                  if (pm) {
                    const pct = parseInt(pm[1], 10);
                    _installState.buildCurrent = pct;
                    _installState.buildTotal = 100;
                    _installState.step = `Compiling ${pct}%…`;
                  }
                }
              }),
              streamLines(makeProc.stderr as ReadableStream<Uint8Array>, (line) => {
                lastStderr = line;
              }),
            ]);

            // Wait for process with timeout
            const makeTimeout = setTimeout(() => { makeProc.kill(); }, 600_000);
            await makeProc.exited;
            clearTimeout(makeTimeout);

            if (makeProc.exitCode !== 0) {
              const err = [makeStderr, makeStdout].filter(Boolean).join('\n').slice(-1500);
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`Build failed:\n${err}`);
            }
            log.push('Build completed');
            _installState.buildCurrent = null;
            _installState.buildTotal = null;

            _installState.step = 'Copying binaries…';
            const find = await run(['find', buildDir, '-name', 'llama-server', '-type', 'f']);
            const foundBin = find.stdout.trim().split('\n')[0];
            if (!foundBin) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error('llama-server binary not found after build');
            }

            const { copyFileSync, chmodSync } = await import('fs');
            copyFileSync(foundBin, stageBinary);
            chmodSync(stageBinary, 0o755);
            log.push(`Staged llama-server to ${stageBinary}`);

            const findLibs = await run([
              'find', buildDir,
              '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')',
              '(', '-type', 'f', '-o', '-type', 'l', ')',
            ]);
            const libFiles = findLibs.stdout.trim().split('\n').filter(Boolean);
            for (const libPath of libFiles) {
              const libName = require('path').basename(libPath);
              copyFileSync(libPath, join(stageBinDir, libName));
              log.push(`  → copied ${libName}`);
            }

            await rm(tmpDir, { recursive: true, force: true });

          } else {
            // ── Download pre-built binary ────────────────────────────
            if (runtimeConfig.runtime !== 'mainline') {
              throw new Error('Pre-built archive install is only available for mainline llama.cpp. Use build-from-source for ik_llama.cpp.');
            }

            const os = process.platform === 'darwin' ? 'macos' : 'linux';
            const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
            const assetName = os === 'macos'
              ? `llama-${version}-bin-macos-${arch}.tar.gz`
              : `llama-${version}-bin-ubuntu-${arch}.tar.gz`;
            const url = `https://github.com/ggml-org/llama.cpp/releases/download/${version}/${assetName}`;

            _installState.step = 'Downloading…';
            log.push(`Downloading ${assetName} from GitHub...`);
            log.push(`URL: ${url}`);

            const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
            if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);

            const tmpDir = join(paths.scriptDir, '.tmp-install');
            await mkdir(tmpDir, { recursive: true });
            const tarPath = join(tmpDir, assetName);
            await Bun.write(tarPath, res);
            log.push(`Downloaded ${Math.round(statSync(tarPath).size / 1024 / 1024)} MB`);

            _installState.step = 'Extracting…';
            const extractDir = join(tmpDir, 'extract');
            await mkdir(extractDir, { recursive: true });
            const tar = await run(['tar', '-xzf', tarPath, '-C', extractDir]);
            if (tar.exitCode !== 0) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`tar extraction failed: ${tar.stderr}`);
            }

            const find = await run(['find', extractDir, '-name', 'llama-server', '-type', 'f']);
            const foundBin = find.stdout.trim().split('\n')[0];
            if (!foundBin) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error('llama-server binary not found in archive');
            }

            _installState.step = 'Copying binaries…';
            const { copyFileSync, chmodSync } = await import('fs');
            copyFileSync(foundBin, stageBinary);
            chmodSync(stageBinary, 0o755);
            log.push(`Staged llama-server to ${stageBinary}`);

            const findLibs = await run([
              'find', extractDir,
              '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')',
              '(', '-type', 'f', '-o', '-type', 'l', ')',
            ]);
            const libFiles = findLibs.stdout.trim().split('\n').filter(Boolean);
            for (const libPath of libFiles) {
              const libName = require('path').basename(libPath);
              copyFileSync(libPath, join(stageBinDir, libName));
              log.push(`  → copied ${libName}`);
            }

            await rm(tmpDir, { recursive: true, force: true });
          }

          // Write version marker in the staged bin directory
          await writeFile(stageVersionMarker, version, 'utf-8');

          // Replace the live bin directory only after the staged install is complete.
          try { await rm(paths.binDir, { recursive: true, force: true }); } catch { /* ok */ }
          await rename(stageBinDir, paths.binDir);

          writeLlmRuntimeConfig(runtimeConfig);

          // Log final bin directory contents for diagnostics
          try {
            const binContents = readdirSync(paths.binDir).sort();
            log.push(`\nBin directory (${paths.binDir}):`);
            for (const f of binContents) log.push(`  ${f}`);
          } catch { /* ok */ }

          const compatibilityMessage = getUnsupportedRuntimeProfileMessage(runtimeConfig);
          if (compatibilityMessage) {
            log.push(`\n⚠ COMPATIBILITY WARNING: ${compatibilityMessage}`);
          }

          const cpuModel = getCpuModelDescription();
          if (cpuModel) {
            log.push(`\nCPU: ${cpuModel}`);
          }

          log.push(`\n✓ ${runtimeConfig.runtime === 'ik' ? 'ik_llama.cpp' : 'llama.cpp'} ${version} installed successfully${buildFromSource ? ' (built from source)' : ''}`);
          _installState.status = 'done';
          _installState.step = 'Complete';

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.push(`\nFailed: ${msg}`);
          _installState.status = 'error';
          _installState.error = msg;
          _installState.step = 'Failed';
        }
      })();

      return {
        success: true,
        data: { message: buildFromSource ? 'Build started in background' : 'Install started in background' },
      };
    },
    {
      body: t.Object({
        version: t.Optional(t.String()),
        buildFromSource: t.Optional(t.Boolean()),
        runtime: t.Optional(t.Union([t.Literal('mainline'), t.Literal('ik')])),
        profile: t.Optional(t.Union([t.Literal('cpu'), t.Literal('cuda'), t.Literal('apple-silicon-experimental')])),
        tuning: t.Optional(llmTuningSchema),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Install/update llama-server binary (async)' },
    },
  )

  // ─── GET /admin/llm/install/progress — poll install progress ──────
  .get(
    '/install/progress',
    ({ auth }) => {
      requireAdmin(auth);
      const elapsedSec = _installState.startedAt
        ? Math.round((Date.now() - _installState.startedAt) / 1000)
        : null;
      return {
        success: true,
        data: {
          status: _installState.status,
          step: _installState.step,
          log: _installState.log.join('\n'),
          error: _installState.error,
          startedAt: _installState.startedAt,
          elapsedSec,
          buildCurrent: _installState.buildCurrent,
          buildTotal: _installState.buildTotal,
        },
      };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Poll install/build progress' },
    },
  )

  // ─── POST /admin/llm/start — start the LLM server ───────────────
  .post(
    '/start',
    async ({ auth, body }): Promise<ApiResponse<{ started: boolean; message: string }>> => {
      requireAdmin(auth);

      const runtimeConfig = writeLlmRuntimeConfig({
        runtime: body?.runtime,
        profile: body?.profile,
        tuning: body?.tuning,
      });

      // Check if already running
      const llm = getLlmClient();
      if (await llm.isHealthy()) {
        return { success: true, data: { started: true, message: 'Server is already running' } };
      }

      const paths = getLlmPaths();
      const model = getInstalledModel();

      if (!existsSync(paths.binary) || !model) {
        return {
          success: false,
          data: { started: false, message: 'Binary or model not installed. Run install first.' },
        };
      }

      const compatibilityMessage = getUnsupportedRuntimeProfileMessage(runtimeConfig);
      if (compatibilityMessage) {
        return {
          success: false,
          data: {
            started: false,
            message: compatibilityMessage,
          },
        };
      }

      // Stop any lingering managed process
      await stopServerProcess();

      try {
        const launchPlan = buildLaunchPlan(runtimeConfig, model.path);
        const host = process.env['LLM_HOST'] ?? '127.0.0.1';
        const port = process.env['LLM_PORT'] ?? '8081';

        _serverProcess = Bun.spawn(
          [paths.binary, ...launchPlan.args],
          {
            cwd: paths.scriptDir,
            env: launchPlan.env,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );

        // Collect stderr in background for diagnostics
        let stderrOutput = '';
        const stderrReader = (async () => {
          try {
            const stderr = _serverProcess!.stderr;
            if (stderr && typeof stderr !== 'number') {
              const text = await new Response(stderr as ReadableStream).text();
              stderrOutput = text.slice(-2000); // keep last 2KB
            }
          } catch { /* ok */ }
        })();

        const startupTimeoutMs = getStartupTimeoutMs(runtimeConfig);
        const startupDeadline = Date.now() + startupTimeoutMs;
        let healthy = false;
        while (Date.now() < startupDeadline) {
          await new Promise((r) => setTimeout(r, 1000));
          if (!isServerProcessAlive()) {
            await stderrReader; // ensure we captured the output
            const errMsg = stderrOutput.trim();
            return {
              success: false,
              data: { started: false, message: `Server process exited with code ${_serverProcess?.exitCode}${errMsg ? '\n\n' + errMsg : ''}` },
            };
          }
          if (await llm.isHealthy()) {
            healthy = true;
            break;
          }
        }

        return {
          success: healthy,
          data: {
            started: healthy,
            message: healthy
              ? `Server started on ${host}:${port}`
              : `Server started but health check timed out (${Math.round(startupTimeoutMs / 1000)}s)`,
          },
        };
      } catch (err) {
        return {
          success: false,
          data: {
            started: false,
            message: `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    },
    {
      body: t.Optional(t.Object({
        runtime: t.Optional(t.Union([t.Literal('mainline'), t.Literal('ik')])),
        profile: t.Optional(t.Union([t.Literal('cpu'), t.Literal('cuda'), t.Literal('apple-silicon-experimental')])),
        tuning: t.Optional(llmTuningSchema),
      })),
      detail: { tags: ['Admin', 'LLM'], summary: 'Start the LLM server process' },
    },
  )

  // ─── POST /admin/llm/stop — stop the LLM server ─────────────────
  .post(
    '/stop',
    async ({ auth }): Promise<ApiResponse<{ stopped: boolean; message: string }>> => {
      requireAdmin(auth);

      const stopped = await stopServerProcess();

      // Also try killing any llama-server process (e.g. started externally)
      if (!stopped) {
        try {
          Bun.spawn(['pkill', '-f', 'llama-server'], { stdout: 'ignore', stderr: 'ignore' });
          await new Promise((r) => setTimeout(r, 500));
          return { success: true, data: { stopped: true, message: 'Sent kill signal to llama-server' } };
        } catch {
          return { success: true, data: { stopped: false, message: 'No managed server process found' } };
        }
      }

      return { success: true, data: { stopped: true, message: 'Server stopped' } };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Stop the LLM server process' },
    },
  )

  // ─── POST /admin/llm/test — send a test prompt ──────────────────
  .post(
    '/test',
    async ({ auth, body }): Promise<ApiResponse<LlmTestResult>> => {
      requireAdmin(auth);

      const llm = getLlmClient();
      const prompt = body.prompt?.trim() || 'Hello, respond with one word.';
      const start = performance.now();

      try {
        const { content: output, reasoning, usage } = await llm.chatCompletion(
          [{ role: 'user', content: prompt }],
          {
            temperature: body.thinkingMode === 'thinking' ? 0.6 : 0.2,
            maxTokens: body.maxTokens ?? 128,
            thinkingMode: body.thinkingMode === 'thinking' ? 'thinking' : 'production',
          },
        );
        const durationMs = Math.round(performance.now() - start);

        return {
          success: true,
          data: {
            success: true,
            durationMs,
            input: prompt,
            output,
            reasoning,
            error: null,
            tokensUsed: usage?.totalTokens ?? null,
          },
        };
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        return {
          success: true,
          data: {
            success: false,
            durationMs,
            input: prompt,
            output: null,
            reasoning: null,
            error: err instanceof Error ? err.message : String(err),
            tokensUsed: null,
          },
        };
      }
    },
    {
      body: t.Object({
        prompt: t.Optional(t.String({ maxLength: 2000 })),
        maxTokens: t.Optional(t.Number({ minimum: 1, maximum: 2048 })),
        thinkingMode: t.Optional(t.Union([t.Literal('production'), t.Literal('thinking')])),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Send a test prompt to the LLM' },
    },
  )

  // ─── POST /admin/llm/benchmark — run repeated prompt benchmark ──
  .post(
    '/benchmark',
    async ({ auth, body }): Promise<ApiResponse<LlmBenchmarkResult>> => {
      requireAdmin(auth);

      const llm = getLlmClient();
      const prompt = body.prompt?.trim() || 'Count from one to twenty in order using digits only.';
      const maxTokens = body.maxTokens ?? 128;
      const repeatCount = body.repeatCount ?? 3;
      const thinkingMode = body.thinkingMode === 'thinking' ? 'thinking' : 'production';
      const runs: LlmBenchmarkRun[] = [];
      let outputSample: string | null = null;

      for (let index = 0; index < repeatCount; index++) {
        const start = performance.now();
        try {
          const { content, usage } = await llm.chatCompletion(
            [{ role: 'user', content: prompt }],
            {
              temperature: thinkingMode === 'thinking' ? 0.6 : 0.1,
              maxTokens,
              thinkingMode,
            },
          );
          const durationMs = Math.round(performance.now() - start);
          const tokensUsed = usage?.totalTokens ?? null;
          if (!outputSample && content) {
            outputSample = content;
          }
          runs.push({
            run: index + 1,
            success: true,
            durationMs,
            tokensUsed,
            tokensPerSecond: tokensUsed && durationMs > 0 ? Number(((tokensUsed * 1000) / durationMs).toFixed(2)) : null,
            error: null,
          });
        } catch (err) {
          const durationMs = Math.round(performance.now() - start);
          runs.push({
            run: index + 1,
            success: false,
            durationMs,
            tokensUsed: null,
            tokensPerSecond: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const successfulRuns = runs.filter((run) => run.success);
      const averageDurationMs = successfulRuns.length
        ? Math.round(successfulRuns.reduce((sum, run) => sum + run.durationMs, 0) / successfulRuns.length)
        : null;
      const totalTokens = successfulRuns.every((run) => run.tokensUsed != null)
        ? successfulRuns.reduce((sum, run) => sum + (run.tokensUsed ?? 0), 0)
        : null;
      const averageTokensPerSecond = successfulRuns.length
        ? Number((successfulRuns.reduce((sum, run) => sum + (run.tokensPerSecond ?? 0), 0) / successfulRuns.length).toFixed(2))
        : null;

      return {
        success: true,
        data: {
          prompt,
          maxTokens,
          repeatCount,
          successCount: successfulRuns.length,
          averageDurationMs,
          averageTokensPerSecond,
          totalTokensUsed: totalTokens,
          outputSample,
          runs,
        },
      };
    },
    {
      body: t.Object({
        prompt: t.Optional(t.String({ maxLength: 2000 })),
        maxTokens: t.Optional(t.Number({ minimum: 1, maximum: 2048 })),
        repeatCount: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        thinkingMode: t.Optional(t.Union([t.Literal('production'), t.Literal('thinking')])),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Run a repeated prompt benchmark against the LLM' },
    },
  )

  // ─── POST /admin/llm/test-rfq — test RFQ parsing ────────────────
  .post(
    '/test-rfq',
    async ({ auth, body }): Promise<ApiResponse<LlmTestResult & { parsed: any }>> => {
      requireAdmin(auth);

      const llm = getLlmClient();
      const rfqText = body.rfqText?.trim() || 'MV Pacific Voyager\nIMO 9876543\nFujairah\nVLSFO 500 MT\nLSMGO 100 MT\nETA 15/03/2026';
      const start = performance.now();

      try {
        const { parsed, usage } = await llm.parseRFQ(rfqText, 'test', 'Admin Test');
        const durationMs = Math.round(performance.now() - start);

        return {
          success: true,
          data: {
            success: parsed !== null,
            durationMs,
            input: rfqText,
            output: parsed ? JSON.stringify(parsed, null, 2) : null,
            reasoning: null,
            error: parsed === null ? 'Parser returned null (confidence too low or extraction failed)' : null,
            tokensUsed: usage?.totalTokens ?? null,
            parsed,
          },
        };
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        return {
          success: true,
          data: {
            success: false,
            durationMs,
            input: rfqText,
            output: null,
            reasoning: null,
            error: err instanceof Error ? err.message : String(err),
            tokensUsed: null,
            parsed: null,
          },
        };
      }
    },
    {
      body: t.Object({
        rfqText: t.Optional(t.String({ maxLength: 5000 })),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Test RFQ parsing with the LLM' },
    },
  )

  // ─── GET /admin/llm/health — lightweight health-only (for polling) ─
  .get(
    '/health',
    async ({ auth }): Promise<ApiResponse<{ healthy: boolean; searchAvailable: boolean }>> => {
      requireAdmin(auth);
      const llm = getLlmClient();
      const [healthy, searchAvailable] = await Promise.all([
        llm.isHealthy(),
        isSearchHealthy(),
      ]);
      return { success: true, data: { healthy, searchAvailable } };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Lightweight LLM health check' },
    },
  )

  // ─── POST /admin/llm/test-search — test web search-augmented chat ─
  .post(
    '/test-search',
    async ({ auth, body }) => {
      requireAdmin(auth);
      const llm = getLlmClient();
      const query = body.query?.trim() || 'What is the current price of VLSFO?';
      const start = performance.now();

      try {
        const { answer, searchResults, usage } = await llm.searchAndChat(query, {
          maxTokens: body.maxTokens ?? 512,
        });
        const durationMs = Math.round(performance.now() - start);

        return {
          success: true,
          data: {
            success: true,
            durationMs,
            input: query,
            output: answer,
            error: null,
            tokensUsed: usage?.totalTokens ?? null,
            searchResults,
            searchResultCount: searchResults.length,
          },
        };
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        return {
          success: true,
          data: {
            success: false,
            durationMs,
            input: query,
            output: null,
            error: err instanceof Error ? err.message : String(err),
            searchResults: [],
            searchResultCount: 0,
          },
        };
      }
    },
    {
      body: t.Object({
        query: t.Optional(t.String({ maxLength: 2000 })),
        maxTokens: t.Optional(t.Number({ minimum: 1, maximum: 2048 })),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Test search-augmented chat' },
    },
  )

  // ═══════════════════════════════════════════════════════════════════
  //  Version management — GitHub releases for llama.cpp
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /admin/llm/versions — list llama.cpp releases from GitHub ─
  .get(
    '/versions',
    async ({ auth, query }) => {
      requireAdmin(auth);

      const limit = query.limit ?? 20;
      const runtime = isLlmRuntime(query.runtime) ? query.runtime : readLlmRuntimeConfig().runtime;
      try {
        let versions: Array<{ tag: string; date: string; assetCount: number; assetSizeMb: number | null }>;

        if (runtime === 'ik') {
          const tagsRes = await fetch(
            `https://api.github.com/repos/ikawrakow/ik_llama.cpp/tags?per_page=${limit}`,
            {
              headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'fueld-admin',
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!tagsRes.ok) {
            return { success: false, data: { versions: [], installed: null }, error: `GitHub API error: ${tagsRes.status}` };
          }
          const tags = (await tagsRes.json()) as GithubTag[];
          versions = [
            { tag: 'main', date: '', assetCount: 0, assetSizeMb: null },
            ...tags.map((tag) => ({ tag: tag.name, date: '', assetCount: 0, assetSizeMb: null })),
          ];
        } else {
          const res = await fetch(
            `https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=${limit}`,
            {
              headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'fueld-admin',
              },
              signal: AbortSignal.timeout(10_000),
            },
          );

          if (!res.ok) {
            return { success: false, data: [], error: `GitHub API error: ${res.status}` };
          }

          const releases = (await res.json()) as GithubRelease[];
          versions = releases
            .filter((r) => !r.prerelease && r.tag_name.startsWith('b'))
            .map((r) => {
              const macAsset = r.assets?.find(a => a.name.includes('macos') || a.name.includes('darwin'));
              const linuxAsset = r.assets?.find(a => a.name.includes('ubuntu') || a.name.includes('linux'));
              const mainAsset = macAsset || linuxAsset || r.assets?.[0];
              return {
                tag: r.tag_name,
                date: r.published_at?.slice(0, 10) ?? '',
                assetCount: r.assets?.length ?? 0,
                assetSizeMb: mainAsset ? Math.round(mainAsset.size / 1024 / 1024) : null,
              };
            });
        }

        const installed = getInstalledLlamaCppVersion(runtime);

        return { success: true, data: { versions, installed } };
      } catch (err) {
        return {
          success: false,
          data: { versions: [], installed: null },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
        runtime: t.Optional(t.Union([t.Literal('mainline'), t.Literal('ik')])),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'List available llama.cpp versions' },
    },
  )

  // ═══════════════════════════════════════════════════════════════════
  //  Model management — HuggingFace search + install/remove
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /admin/llm/models/search — search HuggingFace for GGUF models ─
  .get(
    '/models/search',
    async ({ auth, query }) => {
      requireAdmin(auth);

      const q = query.q?.trim();
      if (!q) return { success: true, data: [] };

      try {
        const params = new URLSearchParams({
          search: q,
          filter: 'gguf',
          sort: 'downloads',
          direction: '-1',
          limit: String(query.limit ?? 10),
        });
        // Request expanded fields for richer metadata
        params.append('expand[]', 'config');
        params.append('expand[]', 'lastModified');
        params.append('expand[]', 'siblings');
        params.append('expand[]', 'cardData');
        params.append('expand[]', 'gguf');

        const res = await fetch(`https://huggingface.co/api/models?${params}`, {
          headers: { 'User-Agent': 'fueld-admin' },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          return { success: false, data: [], error: `HuggingFace API error: ${res.status}` };
        }

        const models = (await res.json()) as HfModelResult[];

        return {
          success: true,
          data: models.map((m) => {
            // Extract parameter count from gguf/safetensors metadata or infer from model name
            let parameterCount: string | null = null;
            const paramTotal = m.gguf?.total ?? m.safetensors?.total;
            if (paramTotal) {
              if (paramTotal >= 1e12) parameterCount = `${(paramTotal / 1e12).toFixed(1)}T`;
              else if (paramTotal >= 1e9) parameterCount = `${(paramTotal / 1e9).toFixed(1)}B`;
              else if (paramTotal >= 1e6) parameterCount = `${(paramTotal / 1e6).toFixed(0)}M`;
              else parameterCount = `${paramTotal}`;
            } else {
              // Try to infer from model name (e.g. "gemma-3-27b-it-GGUF", "Qwen3.5-0.8B-GGUF")
              const nameMatch = (m.id ?? m.modelId).match(/(\d+\.?\d*)[BbMm](?![a-zA-Z])/);
              if (nameMatch) parameterCount = `${nameMatch[1]}${nameMatch[0].slice(-1).toUpperCase()}`;
            }

            // Count GGUF files available in the repo
            const ggufFileCount = (m.siblings ?? [])
              .filter((s: { rfilename: string }) => s.rfilename.endsWith('.gguf'))
              .length;

            return {
              id: m.id ?? m.modelId,
              author: m.author,
              downloads: m.downloads,
              likes: m.likes ?? 0,
              lastModified: m.lastModified?.slice(0, 10) ?? null,
              parameterCount,
              ggufFileCount,
              pipelineTag: m.pipeline_tag ?? null,
              modelType: m.config?.model_type ?? m.cardData?.model_type ?? null,
              baseModel: m.cardData?.base_model ?? null,
              license: m.cardData?.license ?? null,
              contextLength: m.gguf?.context_length ?? null,
              architecture: m.gguf?.architecture ?? null,
            };
          }),
        };
      } catch (err) {
        return {
          success: false,
          data: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Search HuggingFace for GGUF models' },
    },
  )

  // ─── GET /admin/llm/models/files — list GGUF files in a HF repo ───
  .get(
    '/models/files',
    async ({ auth, query }) => {
      requireAdmin(auth);

      const repoId = query.repoId?.trim();
      if (!repoId) return { success: false, data: [], error: 'repoId is required' };

      try {
        const maxModelSizeMb = getMaxModelSizeMb();
        const res = await fetch(`https://huggingface.co/api/models/${repoId}?blobs=true`, {
          headers: { 'User-Agent': 'fueld-admin' },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          return { success: false, data: [], error: `HuggingFace API error: ${res.status}` };
        }

        const model = (await res.json()) as HfModelResult;
        const siblings = model.siblings ?? [];

        const ggufRaw = siblings
          .filter((s) => s.rfilename.endsWith('.gguf'))
          .map((s) => ({
            filename: s.rfilename,
            sizeMb: s.size ? Math.round(s.size / 1024 / 1024) : null,
            sizeBytes: s.size ?? null,
            downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${s.rfilename}`,
          }));

        // Group split GGUF files (e.g. model-00001-of-00003.gguf) into a single entry
        const splitRegex = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/;
        const splitGroups = new Map<string, typeof ggufRaw>();
        const singleFiles: typeof ggufRaw = [];

        for (const f of ggufRaw) {
          const m = f.filename.match(splitRegex);
          if (m) {
            const key = m[1]; // base name without part number
            if (!splitGroups.has(key)) splitGroups.set(key, []);
            splitGroups.get(key)!.push(f);
          } else {
            singleFiles.push(f);
          }
        }

        const ggufFiles = [
          // Single files
          ...singleFiles.map((f) => ({
            filename: f.filename,
            sizeMb: f.sizeMb,
            downloadUrl: f.downloadUrl,
            tooLarge: f.sizeMb ? f.sizeMb > maxModelSizeMb : false,
            splitParts: null as number | null,
            splitTotalMb: null as number | null,
          })),
          // Split groups — show as single entry with part 1 filename
          ...Array.from(splitGroups.entries()).map(([base, parts]) => {
            parts.sort((a, b) => a.filename.localeCompare(b.filename));
            const totalBytes = parts.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);
            const totalMb = Math.round(totalBytes / 1024 / 1024);
            return {
              filename: parts[0].filename, // first part (the one to pass to install)
              sizeMb: parts[0].sizeMb,
              downloadUrl: parts[0].downloadUrl,
              tooLarge: totalMb > maxModelSizeMb,
              splitParts: parts.length,
              splitTotalMb: totalMb,
            };
          }),
        ];

        return { success: true, data: { repoId, files: ggufFiles, maxModelSizeMb } };
      } catch (err) {
        return {
          success: false,
          data: { repoId, files: [], maxModelSizeMb: getMaxModelSizeMb() },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        repoId: t.Optional(t.String({ maxLength: 200 })),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'List GGUF files in a HuggingFace repo' },
    },
  )

  // ─── POST /admin/llm/models/install — start downloading a GGUF model (async) ─
  .post(
    '/models/install',
    async ({ auth, body }) => {
      requireAdmin(auth);

      const { repoId, filename } = body;
      if (!repoId || !filename) {
        return { success: false, data: null, error: 'repoId and filename are required' };
      }

      if (_modelDownload.status === 'downloading') {
        return { success: false, data: null, error: 'A download is already in progress' };
      }

      const paths = getLlmPaths();
  const runtimeConfig = readLlmRuntimeConfig();
  const maxModelSizeMb = getMaxModelSizeMb(runtimeConfig);
      const { mkdir } = await import('fs/promises');
      await mkdir(paths.modelDir, { recursive: true });

      // Detect split GGUF files (e.g. model-00001-of-00003.gguf)
      const splitMatch = filename.match(/^(.+)-(\d{5})-of-(\d{5})\.gguf$/);
      const filesToDownload: string[] = [];
      if (splitMatch) {
        const base = splitMatch[1];
        const totalParts = parseInt(splitMatch[3]);
        for (let i = 1; i <= totalParts; i++) {
          filesToDownload.push(`${base}-${String(i).padStart(5, '0')}-of-${splitMatch[3]}.gguf`);
        }
      } else {
        filesToDownload.push(filename);
      }

      // Check total size limit via HEAD on all parts
      let totalBytes: number | null = null;
      try {
        let sum = 0;
        for (const f of filesToDownload) {
          const headRes = await fetch(
            `https://huggingface.co/${repoId}/resolve/main/${f}`,
            { method: 'HEAD', signal: AbortSignal.timeout(10_000) },
          );
          const cl = headRes.headers.get('content-length');
          if (cl) sum += parseInt(cl);
        }
        if (sum > 0) {
          totalBytes = sum;
          const sizeMb = Math.round(sum / 1024 / 1024);
          if (sizeMb > maxModelSizeMb) {
            return {
              success: false,
              data: null,
              error: `Model is ${sizeMb} MB (${filesToDownload.length} parts), exceeds limit of ${maxModelSizeMb} MB.`,
            };
          }
        }
      } catch { /* proceed anyway */ }

      // Start background download
      _modelDownload = {
        status: 'downloading', filename, repoId,
        totalBytes, downloadedBytes: 0, sizeMb: null,
        error: null, startedAt: Date.now(),
      };

      // Fire-and-forget — download all parts sequentially in the background
      (async () => {
        try {
          const { unlink, readdir } = await import('fs/promises');

          // Remove existing .gguf files
          try {
            const existing = await readdir(paths.modelDir);
            for (const f of existing) {
              if (f.endsWith('.gguf')) await unlink(join(paths.modelDir, f));
            }
          } catch { /* ok */ }

          // Download each part
          for (const partFilename of filesToDownload) {
            const url = `https://huggingface.co/${repoId}/resolve/main/${partFilename}`;
            const res = await fetch(url);
            if (!res.ok) {
              _modelDownload.status = 'error';
              _modelDownload.error = `Download failed for ${partFilename}: HTTP ${res.status}`;
              return;
            }

            const modelPath = join(paths.modelDir, partFilename);
            const writer = Bun.file(modelPath).writer();
            const reader = res.body?.getReader();
            if (!reader) {
              _modelDownload.status = 'error';
              _modelDownload.error = `No response body for ${partFilename}`;
              return;
            }

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              writer.write(value);
              _modelDownload.downloadedBytes += value.byteLength;
            }
            await writer.end();
          }

          // Calculate total size of all downloaded files
          let totalSize = 0;
          for (const f of filesToDownload) {
            try { totalSize += statSync(join(paths.modelDir, f)).size; } catch { /* ok */ }
          }
          const sizeMb = Math.round(totalSize / 1024 / 1024);
          _modelDownload.status = 'done';
          _modelDownload.sizeMb = sizeMb;
        } catch (err) {
          _modelDownload.status = 'error';
          _modelDownload.error = err instanceof Error ? err.message : String(err);
          // Clean up partial downloads
          try {
            const { unlink } = await import('fs/promises');
            for (const f of filesToDownload) {
              try { await unlink(join(paths.modelDir, f)); } catch { /* ok */ }
            }
          } catch { /* ok */ }
        }
      })();

      return {
        success: true,
        data: {
          message: filesToDownload.length > 1
            ? `Download started (${filesToDownload.length} parts)`
            : 'Download started',
          filename, repoId, totalBytes, parts: filesToDownload.length,
        },
      };
    },
    {
      body: t.Object({
        repoId: t.String({ maxLength: 200 }),
        filename: t.String({ maxLength: 200 }),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Start downloading a GGUF model (async)' },
    },
  )

  // ─── GET /admin/llm/models/download-status — poll download progress ─
  .get(
    '/models/download-status',
    ({ auth }) => {
      requireAdmin(auth);
      const d = _modelDownload;
      const progressPct = d.totalBytes && d.totalBytes > 0
        ? Math.round((d.downloadedBytes / d.totalBytes) * 100)
        : null;
      return {
        success: true,
        data: {
          status: d.status,
          filename: d.filename,
          repoId: d.repoId,
          totalMb: d.totalBytes ? Math.round(d.totalBytes / 1024 / 1024) : null,
          downloadedMb: Math.round(d.downloadedBytes / 1024 / 1024),
          progressPct,
          sizeMb: d.sizeMb,
          error: d.error,
          elapsedSec: d.startedAt ? Math.round((Date.now() - d.startedAt) / 1000) : null,
        },
      };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Poll model download progress' },
    },
  )

  // ─── DELETE /admin/llm/models — remove installed model ─────────────
  .delete(
    '/models',
    async ({ auth }) => {
      requireAdmin(auth);

      const model = getInstalledModel();
      if (!model) {
        return { success: false, data: null, error: 'No model is currently installed' };
      }

      // Stop server first if running
      await stopServerProcess();

      const { unlink, readdir } = await import('fs/promises');
      const paths = getLlmPaths();

      // Remove ALL .gguf files in model dir (not just the first one)
      try {
        const files = await readdir(paths.modelDir);
        for (const f of files) {
          if (f.endsWith('.gguf')) {
            await unlink(join(paths.modelDir, f));
          }
        }
      } catch { /* ok */ }

      return { success: true, data: { removed: model.filename } };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'Remove the installed model' },
    },
  )

  // ═══════════════════════════════════════════════════════════════════
  //  Prompts / Knowledge Base — CRUD
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /admin/llm/prompts — list all prompt files ─────────────
  .get(
    '/prompts',
    async ({ auth }) => {
      requireAdmin(auth);
      const prompts = await listPrompts();
      return { success: true, data: prompts };
    },
    {
      detail: { tags: ['Admin', 'LLM'], summary: 'List all prompt files' },
    },
  )

  // ─── GET /admin/llm/prompts/:id — get prompt content ─────────────
  .get(
    '/prompts/:id',
    async ({ auth, params }) => {
      requireAdmin(auth);
      if (!isValidPromptSlug(params.id)) {
        return { success: false, data: null, error: 'Invalid prompt id' };
      }
      const prompt = await getPrompt(params.id);
      if (!prompt) {
        return { success: false, data: null, error: `Prompt "${params.id}" not found` };
      }
      return { success: true, data: prompt };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Get prompt content by ID' },
    },
  )

  // ─── POST /admin/llm/prompts — create a new prompt file ──────────
  .post(
    '/prompts',
    async ({ auth, body }) => {
      requireAdmin(auth);
      try {
        const created = await createPrompt(body.id, body.content);
        return { success: true, data: created };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      body: t.Object({
        id: t.String({ minLength: 1, maxLength: 100 }),
        content: t.String({ maxLength: 50_000 }),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Create a new prompt file' },
    },
  )

  // ─── PUT /admin/llm/prompts/:id — update prompt content ──────────
  .put(
    '/prompts/:id',
    async ({ auth, params, body }) => {
      requireAdmin(auth);
      if (!isValidPromptSlug(params.id)) {
        return { success: false, data: null, error: 'Invalid prompt id' };
      }
      try {
        const updated = await updatePrompt(params.id, body.content);
        return { success: true, data: updated };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ content: t.String({ maxLength: 50_000 }) }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Update prompt content' },
    },
  )

  // ─── DELETE /admin/llm/prompts/:id — delete a prompt file ─────────
  .delete(
    '/prompts/:id',
    async ({ auth, params }) => {
      requireAdmin(auth);
      if (!isValidPromptSlug(params.id)) {
        return { success: false, data: null, error: 'Invalid prompt id' };
      }
      try {
        await deletePrompt(params.id);
        return { success: true, data: { deleted: params.id } };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Delete a prompt file' },
    },
  );
