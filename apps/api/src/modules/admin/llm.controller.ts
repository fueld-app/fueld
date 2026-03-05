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
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_LLAMA_CPP_VERSION = 'b8201';
const DEFAULT_MODEL_NAME = 'Qwen3.5-0.8B-Q4_K_M';
const MAX_MODEL_SIZE_MB = Number(process.env['MAX_MODEL_SIZE_MB'] ?? 4096); // 4 GB default

/** Resolve script/bin/model paths based on env vars or defaults */
function getLlmPaths() {
  let scriptDir: string;
  if (process.env['LLM_SCRIPT_DIR']) {
    scriptDir = resolve(process.env['LLM_SCRIPT_DIR']);
  } else {
    // Try candidate paths: production (/opt/fueld/llm) then dev (../../scripts/llm from cwd)
    const candidates = [
      '/opt/fueld/llm',
      join(process.cwd(), '..', '..', 'scripts', 'llm'),
      join(process.cwd(), 'scripts', 'llm'),
    ];
    scriptDir = candidates.find((c) => existsSync(c)) ?? candidates[0];
  }
  const binDir = process.env['LLM_BIN_DIR'] ?? join(scriptDir, 'bin');
  const modelDir = process.env['LLM_MODEL_DIR'] ?? join(scriptDir, 'models');

  return {
    scriptDir,
    binDir,
    modelDir,
    setupScript: join(scriptDir, 'setup.sh'),
    startScript: join(scriptDir, 'start.sh'),
    binary: join(binDir, 'llama-server'),
  };
}

/** Find the currently installed model (first .gguf in models dir). */
function getInstalledModel(): { filename: string; sizeMb: number; path: string } | null {
  const paths = getLlmPaths();
  try {
    const files = readdirSync(paths.modelDir);
    const gguf = files.find((f) => f.endsWith('.gguf'));
    if (!gguf) return null;
    const fullPath = join(paths.modelDir, gguf);
    const sizeMb = Math.round(statSync(fullPath).size / 1024 / 1024);
    return { filename: gguf, sizeMb, path: fullPath };
  } catch {
    return null;
  }
}

/** Read installed llama.cpp version from a marker file, or detect from binary. */
function getInstalledLlamaCppVersion(): string | null {
  const paths = getLlmPaths();
  const markerPath = join(paths.binDir, '.llama-cpp-version');
  try {
    if (existsSync(markerPath)) {
      const v = readFileSync(markerPath, 'utf-8').trim();
      if (v) return v;
    }
  } catch { /* fallthrough */ }

  // Fallback: try to detect version from the binary itself
  if (existsSync(paths.binary)) {
    try {
      const result = Bun.spawnSync([paths.binary, '--version'], {
        stdout: 'pipe', stderr: 'pipe',
        env: {
          ...process.env,
          DYLD_LIBRARY_PATH: [paths.binDir, process.env['DYLD_LIBRARY_PATH']].filter(Boolean).join(':'),
          LD_LIBRARY_PATH: [paths.binDir, process.env['LD_LIBRARY_PATH']].filter(Boolean).join(':'),
        },
        timeout: 5_000,
      });
      const output = result.stdout.toString() + result.stderr.toString();
      const match = output.match(/version:\s*(\d+)/);
      if (match) {
        const version = `b${match[1]}`;
        // Write marker for next time
        try { require('fs').writeFileSync(markerPath, version, 'utf-8'); } catch { /* ok */ }
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
}

export interface LlmTestResult {
  success: boolean;
  durationMs: number;
  input: string;
  output: string | null;
  error: string | null;
  tokensUsed: number | null;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  assets: { name: string; size: number }[];
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
  // The process hasn't exited yet
  return _serverProcess.exitCode === null;
}

async function stopServerProcess(): Promise<boolean> {
  if (_serverProcess && isServerProcessAlive()) {
    _serverProcess.kill();
    // Wait a moment for it to actually stop
    await new Promise((r) => setTimeout(r, 500));
    _serverProcess = null;
    return true;
  }
  _serverProcess = null;
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function getDetailedStatus(): Promise<LlmStatusDto> {
  const llm = getLlmClient();
  const baseUrl = (llm as any).baseUrl as string;
  const timeoutMs = (llm as any).timeoutMs as number;
  const model = getInstalledModel();

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
  const version = getInstalledLlamaCppVersion();

  return {
    healthy, baseUrl, timeoutMs,
    model: model?.filename?.replace('.gguf', '') ?? null,
    modelSizeMb: model?.sizeMb ?? null,
    llamaCppVersion: version,
    searchAvailable,
    latencyMs,
  };
}

function getInstallStatus(): LlmInstallStatus {
  const paths = getLlmPaths();
  const binaryInstalled = existsSync(paths.binary);
  const model = getInstalledModel();

  return {
    binaryInstalled,
    modelInstalled: model !== null,
    binaryPath: paths.binary,
    modelDir: paths.modelDir,
    modelFilename: model?.filename ?? null,
    modelSizeMb: model?.sizeMb ?? null,
    llamaCppVersion: getInstalledLlamaCppVersion(),
    maxModelSizeMb: MAX_MODEL_SIZE_MB,
  };
}

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

  // ─── POST /admin/llm/install — install llama-server binary ────────
  .post(
    '/install',
    async ({ auth, body }): Promise<ApiResponse<{ log: string; success: boolean }>> => {
      requireAdmin(auth);

      const version = body.version ?? DEFAULT_LLAMA_CPP_VERSION;
      const paths = getLlmPaths();

      // Stop server if running before replacing binary
      await stopServerProcess();
      try { Bun.spawn(['pkill', '-f', 'llama-server'], { stdout: 'ignore', stderr: 'ignore' }); await new Promise(r => setTimeout(r, 500)); } catch { /* ok */ }

      // Remove entire bin directory to clean up old version completely
      const { unlink, readdir, writeFile, mkdir, rm } = await import('fs/promises');
      try {
        await rm(paths.binDir, { recursive: true, force: true });
      } catch { /* ok */ }
      await mkdir(paths.binDir, { recursive: true });

      try {
        // Use setup.sh with the requested version
        const proc = Bun.spawn(['bash', paths.setupScript], {
          cwd: paths.scriptDir,
          env: {
            ...process.env,
            LLM_BIN_DIR: paths.binDir,
            LLM_MODEL_DIR: paths.modelDir,
            LLAMA_CPP_VERSION: version,
            SKIP_MODEL_DOWNLOAD: '1', // Only install binary — model managed separately
          },
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;

        const log = [stdout, stderr].filter(Boolean).join('\n').trim();

        if (exitCode === 0) {
          // Write version marker
          await writeFile(join(paths.binDir, '.llama-cpp-version'), version, 'utf-8');
        }

        return {
          success: exitCode === 0,
          data: { log, success: exitCode === 0 },
        };
      } catch (err) {
        return {
          success: false,
          data: {
            log: `Failed to run setup.sh: ${err instanceof Error ? err.message : String(err)}`,
            success: false,
          },
        };
      }
    },
    {
      body: t.Object({
        version: t.Optional(t.String()),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Install/update llama-server binary' },
    },
  )

  // ─── POST /admin/llm/start — start the LLM server ───────────────
  .post(
    '/start',
    async ({ auth }): Promise<ApiResponse<{ started: boolean; message: string }>> => {
      requireAdmin(auth);

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

      // Stop any lingering managed process
      await stopServerProcess();

      try {
        const binDir = paths.binDir;
        const dyldPath = [binDir, process.env['DYLD_LIBRARY_PATH']].filter(Boolean).join(':');
        const ldPath = [binDir, process.env['LD_LIBRARY_PATH']].filter(Boolean).join(':');

        const port = process.env['LLM_PORT'] ?? '8081';
        const host = process.env['LLM_HOST'] ?? '127.0.0.1';

        _serverProcess = Bun.spawn(
          [
            paths.binary,
            '--model', model.path,
            '--host', host,
            '--port', port,
            '--ctx-size', process.env['LLM_CTX'] ?? '2048',
            '--threads', process.env['LLM_THREADS'] ?? '2',
            '--parallel', process.env['LLM_PARALLEL'] ?? '1',
            '--flash-attn', 'auto',
            '--cont-batching',
            '--log-disable',
          ],
          {
            cwd: paths.scriptDir,
            env: {
              ...process.env,
              DYLD_LIBRARY_PATH: dyldPath,
              LD_LIBRARY_PATH: ldPath,
            },
            stdout: 'ignore',
            stderr: 'ignore',
          },
        );

        // Wait for the server to become healthy (up to 20s)
        let healthy = false;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (!isServerProcessAlive()) {
            return {
              success: false,
              data: { started: false, message: `Server process exited with code ${_serverProcess?.exitCode}` },
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
            message: healthy ? `Server started on ${host}:${port}` : 'Server started but health check timed out (20s)',
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
        const { content: output, usage } = await llm.chatCompletion(
          [{ role: 'user', content: prompt }],
          { temperature: 0.3, maxTokens: body.maxTokens ?? 128 },
        );
        const durationMs = Math.round(performance.now() - start);

        return {
          success: true,
          data: {
            success: true,
            durationMs,
            input: prompt,
            output,
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
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Send a test prompt to the LLM' },
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
      try {
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
        const versions = releases
          .filter((r) => !r.prerelease && r.tag_name.startsWith('b'))
          .map((r) => {
            // Find macOS or Linux asset to show approximate size
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

        const installed = getInstalledLlamaCppVersion();

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
        const res = await fetch(`https://huggingface.co/api/models/${repoId}`, {
          headers: { 'User-Agent': 'fueld-admin' },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          return { success: false, data: [], error: `HuggingFace API error: ${res.status}` };
        }

        const model = (await res.json()) as HfModelResult;
        const siblings = model.siblings ?? [];

        const ggufFiles = siblings
          .filter((s) => s.rfilename.endsWith('.gguf'))
          .map((s) => ({
            filename: s.rfilename,
            sizeMb: s.size ? Math.round(s.size / 1024 / 1024) : null,
            downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${s.rfilename}`,
            tooLarge: s.size ? Math.round(s.size / 1024 / 1024) > MAX_MODEL_SIZE_MB : false,
          }));

        return { success: true, data: { repoId, files: ggufFiles, maxModelSizeMb: MAX_MODEL_SIZE_MB } };
      } catch (err) {
        return {
          success: false,
          data: { repoId, files: [], maxModelSizeMb: MAX_MODEL_SIZE_MB },
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

  // ─── POST /admin/llm/models/install — download a GGUF model ───────
  .post(
    '/models/install',
    async ({ auth, body }) => {
      requireAdmin(auth);

      const { repoId, filename } = body;
      if (!repoId || !filename) {
        return { success: false, data: null, error: 'repoId and filename are required' };
      }

      const paths = getLlmPaths();
      const { mkdir, unlink, readdir } = await import('fs/promises');
      await mkdir(paths.modelDir, { recursive: true });

      // Check size limit
      try {
        const headRes = await fetch(
          `https://huggingface.co/${repoId}/resolve/main/${filename}`,
          { method: 'HEAD', signal: AbortSignal.timeout(10_000) },
        );
        const contentLength = headRes.headers.get('content-length');
        if (contentLength) {
          const sizeMb = Math.round(parseInt(contentLength) / 1024 / 1024);
          if (sizeMb > MAX_MODEL_SIZE_MB) {
            return {
              success: false,
              data: null,
              error: `Model is ${sizeMb} MB, exceeds limit of ${MAX_MODEL_SIZE_MB} MB. Adjust MAX_MODEL_SIZE_MB env var to increase.`,
            };
          }
        }
      } catch { /* If HEAD fails, proceed anyway */ }

      // Remove any existing model files
      try {
        const existingFiles = await readdir(paths.modelDir);
        for (const f of existingFiles) {
          if (f.endsWith('.gguf')) {
            await unlink(join(paths.modelDir, f));
          }
        }
      } catch { /* ok */ }

      // Download the model
      const modelPath = join(paths.modelDir, filename);
      const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(600_000) }); // 10 min timeout
        if (!res.ok) {
          return { success: false, data: null, error: `Download failed: HTTP ${res.status}` };
        }

        await Bun.write(modelPath, res);

        const sizeMb = Math.round(statSync(modelPath).size / 1024 / 1024);
        return {
          success: true,
          data: { filename, sizeMb, repoId },
        };
      } catch (err) {
        // Clean up partial download
        try { await unlink(modelPath); } catch { /* ok */ }
        return {
          success: false,
          data: null,
          error: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
    {
      body: t.Object({
        repoId: t.String({ maxLength: 200 }),
        filename: t.String({ maxLength: 200 }),
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Download and install a GGUF model' },
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
