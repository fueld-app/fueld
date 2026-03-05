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
          GGML_BACKEND_PATH: paths.binDir,
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
  binFiles: string[];
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
}

let _installState: InstallState = {
  status: 'idle', step: '', log: [], error: null, startedAt: null,
};

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
    binFiles: (() => { try { return readdirSync(paths.binDir).sort(); } catch { return []; } })(),
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

  // ─── POST /admin/llm/install — install llama-server binary (async) ──
  .post(
    '/install',
    async ({ auth, body }) => {
      requireAdmin(auth);

      if (_installState.status === 'running') {
        return { success: false, data: null, error: 'An install is already in progress' };
      }

      const version = body.version ?? DEFAULT_LLAMA_CPP_VERSION;
      const buildFromSource = body.buildFromSource === true;
      const paths = getLlmPaths();

      // Stop server if running before replacing binary
      await stopServerProcess();
      try { Bun.spawn(['pkill', '-f', 'llama-server'], { stdout: 'ignore', stderr: 'ignore' }); await new Promise(r => setTimeout(r, 500)); } catch { /* ok */ }

      // Quick pre-flight for build-from-source: check dependencies synchronously
      if (buildFromSource) {
        for (const cmd of ['git', 'cmake', 'g++', 'make']) {
          const check = Bun.spawnSync(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
          if (check.exitCode !== 0) {
            return {
              success: false, data: null,
              error: `Missing build dependency: ${cmd}. Install with: sudo apt-get install -y git cmake g++ make`,
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
      };

      // Fire-and-forget — the actual install runs in the background
      (async () => {
        const log = _installState.log;
        try {
          const { writeFile, mkdir, rm } = await import('fs/promises');

          // Clean bin directory
          try { await rm(paths.binDir, { recursive: true, force: true }); } catch { /* ok */ }
          await mkdir(paths.binDir, { recursive: true });
          await mkdir(paths.modelDir, { recursive: true });

          if (buildFromSource) {
            // ── Build from source ────────────────────────────────────
            _installState.step = 'Cloning repository…';
            log.push(`Building llama.cpp ${version} from source...`);

            const tmpDir = join(paths.scriptDir, '.tmp-build');
            try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
            await mkdir(tmpDir, { recursive: true });

            log.push(`Cloning llama.cpp at tag ${version}...`);
            const clone = Bun.spawnSync(
              ['git', 'clone', '--depth', '1', '--branch', version, 'https://github.com/ggml-org/llama.cpp.git', 'llama.cpp'],
              { cwd: tmpDir, stdout: 'pipe', stderr: 'pipe', timeout: 120_000 },
            );
            if (clone.exitCode !== 0) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`git clone failed: ${clone.stderr.toString().slice(-500)}`);
            }

            const srcDir = join(tmpDir, 'llama.cpp');
            const buildDir = join(srcDir, 'build');

            _installState.step = 'Running cmake configure…';
            log.push('Running cmake configure...');
            const cmake = Bun.spawnSync(
              ['cmake', '-B', 'build', '-DCMAKE_BUILD_TYPE=Release', '-DLLAMA_BUILD_SERVER=ON'],
              { cwd: srcDir, stdout: 'pipe', stderr: 'pipe', timeout: 120_000 },
            );
            if (cmake.exitCode !== 0) {
              const err = cmake.stderr.toString().slice(-1000);
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`cmake configure failed:\n${err}`);
            }
            log.push('cmake configure OK');

            const nproc = Bun.spawnSync(['nproc'], { stdout: 'pipe' });
            const jobs = nproc.stdout.toString().trim() || '2';
            _installState.step = `Compiling (${jobs} jobs)…`;
            log.push(`Building with ${jobs} parallel jobs (this may take a few minutes)...`);
            const make = Bun.spawnSync(
              ['cmake', '--build', 'build', '--config', 'Release', '-j', jobs],
              { cwd: srcDir, stdout: 'pipe', stderr: 'pipe', timeout: 600_000 },
            );
            if (make.exitCode !== 0) {
              const err = make.stderr.toString().slice(-1000);
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`Build failed:\n${err}`);
            }
            log.push('Build completed');

            _installState.step = 'Copying binaries…';
            const find = Bun.spawnSync(['find', buildDir, '-name', 'llama-server', '-type', 'f']);
            const foundBin = find.stdout.toString().trim().split('\n')[0];
            if (!foundBin) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error('llama-server binary not found after build');
            }

            const { copyFileSync, chmodSync } = await import('fs');
            copyFileSync(foundBin, paths.binary);
            chmodSync(paths.binary, 0o755);
            log.push(`Installed llama-server to ${paths.binary}`);

            const findLibs = Bun.spawnSync([
              'find', buildDir,
              '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')',
              '(', '-type', 'f', '-o', '-type', 'l', ')',
            ]);
            const libFiles = findLibs.stdout.toString().trim().split('\n').filter(Boolean);
            for (const libPath of libFiles) {
              const libName = require('path').basename(libPath);
              copyFileSync(libPath, join(paths.binDir, libName));
              log.push(`  → copied ${libName}`);
            }

            await rm(tmpDir, { recursive: true, force: true });

          } else {
            // ── Download pre-built binary ────────────────────────────
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
            const tar = Bun.spawnSync(['tar', '-xzf', tarPath, '-C', extractDir]);
            if (tar.exitCode !== 0) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error(`tar extraction failed: ${tar.stderr.toString()}`);
            }

            const find = Bun.spawnSync(['find', extractDir, '-name', 'llama-server', '-type', 'f']);
            const foundBin = find.stdout.toString().trim().split('\n')[0];
            if (!foundBin) {
              await rm(tmpDir, { recursive: true, force: true });
              throw new Error('llama-server binary not found in archive');
            }

            _installState.step = 'Copying binaries…';
            const { copyFileSync, chmodSync } = await import('fs');
            copyFileSync(foundBin, paths.binary);
            chmodSync(paths.binary, 0o755);
            log.push(`Installed llama-server to ${paths.binary}`);

            const findLibs = Bun.spawnSync([
              'find', extractDir,
              '(', '-name', '*.so', '-o', '-name', '*.so.*', '-o', '-name', '*.dylib', ')',
              '(', '-type', 'f', '-o', '-type', 'l', ')',
            ]);
            const libFiles = findLibs.stdout.toString().trim().split('\n').filter(Boolean);
            for (const libPath of libFiles) {
              const libName = require('path').basename(libPath);
              copyFileSync(libPath, join(paths.binDir, libName));
              log.push(`  → copied ${libName}`);
            }

            await rm(tmpDir, { recursive: true, force: true });
          }

          // Write version marker
          await writeFile(join(paths.binDir, '.llama-cpp-version'), version, 'utf-8');

          // Log final bin directory contents for diagnostics
          try {
            const binContents = readdirSync(paths.binDir).sort();
            log.push(`\nBin directory (${paths.binDir}):`);
            for (const f of binContents) log.push(`  ${f}`);
            const hasBackend = binContents.some(f => f.includes('ggml-cpu'));
            if (!hasBackend) log.push(`\n⚠ WARNING: no ggml-cpu backend found — server will not start!`);
          } catch { /* ok */ }

          // Log CPU info
          try {
            const cpuInfo = Bun.spawnSync(['sh', '-c', 'grep "model name" /proc/cpuinfo | head -1'], { stdout: 'pipe' });
            const cpuModel = cpuInfo.stdout.toString().trim();
            if (cpuModel) log.push(`\nCPU: ${cpuModel}`);
          } catch { /* ok */ }

          log.push(`\n✓ llama-server ${version} installed successfully${buildFromSource ? ' (built from source)' : ''}`);
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
      }),
      detail: { tags: ['Admin', 'LLM'], summary: 'Install/update llama-server binary (async)' },
    },
  )

  // ─── GET /admin/llm/install/progress — poll install progress ──────
  .get(
    '/install/progress',
    ({ auth }) => {
      requireAdmin(auth);
      return {
        success: true,
        data: {
          status: _installState.status,
          step: _installState.step,
          log: _installState.log.join('\n'),
          error: _installState.error,
          startedAt: _installState.startedAt,
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

      // Pre-flight: check for CPU backend
      try {
        const binContents = readdirSync(paths.binDir);
        const hasBackend = binContents.some(f => f.includes('ggml-cpu'));
        if (!hasBackend) {
          return {
            success: false,
            data: {
              started: false,
              message: `No CPU backend found in ${paths.binDir}. Files: ${binContents.sort().join(', ')}. Re-install the binary.`,
            },
          };
        }
      } catch { /* proceed anyway */ }

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
            '--cont-batching',
          ],
          {
            cwd: paths.scriptDir,
            env: {
              ...process.env,
              DYLD_LIBRARY_PATH: dyldPath,
              LD_LIBRARY_PATH: ldPath,
              GGML_BACKEND_PATH: binDir,
            },
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

        // Wait for the server to become healthy (up to 20s)
        let healthy = false;
        for (let i = 0; i < 20; i++) {
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
            tooLarge: f.sizeMb ? f.sizeMb > MAX_MODEL_SIZE_MB : false,
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
              tooLarge: totalMb > MAX_MODEL_SIZE_MB,
              splitParts: parts.length,
              splitTotalMb: totalMb,
            };
          }),
        ];

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
          if (sizeMb > MAX_MODEL_SIZE_MB) {
            return {
              success: false,
              data: null,
              error: `Model is ${sizeMb} MB (${filesToDownload.length} parts), exceeds limit of ${MAX_MODEL_SIZE_MB} MB.`,
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
            const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
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
