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
}

interface TestResult {
  success: boolean;
  durationMs: number;
  input: string;
  output: string | null;
  error: string | null;
  tokensUsed: number | null;
  parsed?: any;
  searchResults?: any[];
  searchResultCount?: number;
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
        <div class="flex items-end gap-3 mb-4">
          <div class="flex-1 relative">
            <label class="block text-sm font-medium text-gray-700 mb-1">llama.cpp Version</label>
            <div class="flex gap-2">
              <!-- Custom dropdown -->
              <div class="relative flex-1">
                <button type="button" (click)="toggleVersionDropdown()"
                  class="relative w-full cursor-pointer rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-left text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  @if (selectedVersion()) {
                    <span class="block truncate">{{ selectedVersion() }}</span>
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
                            <span class="font-medium">{{ v.tag }}</span>
                          </div>
                          <div class="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
                            <span>{{ v.date }}</span>
                            @if (v.assetSizeMb) { <span>~{{ v.assetSizeMb }} MB</span> }
                            <span>{{ v.assetCount }} assets</span>
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
          </div>
        </div>
        @if (installStatus(); as is) {
          <div class="flex items-center gap-4 text-sm text-gray-600 mb-4">
            <span>Binary: <strong [class]="is.binaryInstalled ? 'text-green-700' : 'text-red-700'">{{ is.binaryInstalled ? '✓' : '✗' }}</strong></span>
            <span>Model: <strong [class]="is.modelInstalled ? 'text-green-700' : 'text-red-700'">{{ is.modelInstalled ? is.modelFilename ?? '✓' : '✗' }}</strong></span>
            @if (is.llamaCppVersion) { <span>Version: <strong>{{ is.llamaCppVersion }}</strong></span> }
          </div>
        }
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
        @if (showInstallLog() && installLog(); as log) {
          <div class="mt-4">
            <button (click)="showInstallLog.set(!showInstallLog())" class="text-sm text-blue-600 hover:underline mb-1">Toggle log</button>
            <pre class="bg-gray-900 text-green-400 text-xs p-4 rounded-md overflow-x-auto max-h-64 overflow-y-auto">{{ log }}</pre>
          </div>
        }
      </div>

      <!-- Model Management Card -->
      <div class="bg-white rounded-lg shadow p-6 lg:col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Model Management</h2>
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
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium text-gray-900">{{ repo }}</h3>
              <button (click)="selectedRepo.set(null); repoFiles.set([])" class="text-xs text-gray-500 hover:text-gray-700">✕ Close</button>
            </div>
            @if (repoFilesLoading()) {
              <p class="text-sm text-gray-500">Loading files…</p>
            } @else if (repoFiles().length === 0) {
              <p class="text-sm text-gray-500">No GGUF files found</p>
            } @else {
              <div class="border rounded-md divide-y">
                @for (f of repoFiles(); track f.filename) {
                  <div class="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span class="font-mono text-xs">{{ f.filename }}</span>
                      @if (f.sizeMb != null) { <span class="text-gray-400 ml-2">{{ f.sizeMb }} MB</span> }
                    </div>
                    @if (f.tooLarge) {
                      <span class="text-xs text-red-600">Too large</span>
                    } @else {
                      <button (click)="installModel(repo, f.filename)" [disabled]="modelInstalling()"
                        class="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
                        {{ modelInstalling() ? 'Installing…' : 'Install' }}
                      </button>
                    }
                  </div>
                }
              </div>
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

      <!-- Test Prompt Card -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Test Prompt</h2>
        <textarea [ngModel]="testPrompt()" (ngModelChange)="testPrompt.set($event)" rows="3"
          class="block w-full rounded-lg border border-gray-300 bg-white py-2.5 px-3 text-sm font-mono shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors mb-3"></textarea>
        <button (click)="runTestPrompt()" [disabled]="testRunning()"
          class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
          {{ testRunning() ? 'Running…' : 'Send' }}
        </button>
        @if (testResult(); as r) {
          <div class="mt-4 p-3 rounded-md text-sm" [class]="r.success ? 'bg-green-50' : 'bg-red-50'">
            @if (r.success) {
              <p class="whitespace-pre-wrap">{{ r.output }}</p>
              <p class="mt-2 text-xs text-gray-500">{{ r.durationMs }}ms · {{ r.tokensUsed }} tokens</p>
            } @else {
              <p class="text-red-700">{{ r.error }}</p>
            }
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
  readonly installing = signal(false);
  readonly installLog = signal<string | null>(null);
  readonly showInstallLog = signal(false);

  // Server management
  readonly starting = signal(false);
  readonly stopping = signal(false);
  readonly serverMessage = signal<string | null>(null);
  readonly serverMessageSuccess = signal(false);

  // Versions
  readonly versions = signal<VersionInfo[]>([]);
  readonly versionsLoading = signal(false);
  readonly selectedVersion = signal('');
  readonly installedVersion = signal<string | null>(null);
  readonly versionDropdownOpen = signal(false);

  // Model management
  readonly modelSearchQuery = signal('');
  readonly modelSearchResults = signal<HfModel[]>([]);
  readonly modelSearching = signal(false);
  readonly selectedRepo = signal<string | null>(null);
  readonly repoFiles = signal<HfFile[]>([]);
  readonly repoFilesLoading = signal(false);
  readonly modelInstalling = signal(false);
  readonly modelDownloadProgress = signal<{ downloadedMb: number; totalMb: number | null; progressPct: number | null; elapsedSec: number | null } | null>(null);
  readonly modelRemoving = signal(false);
  readonly modelMessage = signal<string | null>(null);
  readonly modelMessageSuccess = signal(false);

  // Test prompt
  readonly testPrompt = signal('Hello, respond with one word.');
  readonly testRunning = signal(false);
  readonly testResult = signal<TestResult | null>(null);

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
    await Promise.all([this.loadStatus(), this.loadInstallStatus(), this.loadPrompts()]);
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
    } catch { this.status.set(null); }
  }

  async loadInstallStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<LlmInstallStatus>>(`${API}/admin/llm/install/status`));
      this.installStatus.set(res.data ?? null);
      if (res.data?.llamaCppVersion) {
        this.installedVersion.set(res.data.llamaCppVersion);
        // Pre-select installed version in dropdown if nothing selected yet
        if (!this.selectedVersion()) {
          this.selectedVersion.set(res.data.llamaCppVersion);
        }
      }
    } catch { this.installStatus.set(null); }
  }

  async refreshStatus(): Promise<void> {
    this.refreshing.set(true);
    await Promise.all([this.loadStatus(), this.loadInstallStatus()]);
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
      const res = await firstValueFrom(this.http.get<ApiResponse<{ versions: VersionInfo[]; installed: string | null }>>(`${API}/admin/llm/versions`));
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

  // ── Install binary ────────────────────────────────────────────────

  async runInstall(): Promise<void> {
    this.installing.set(true);
    this.installLog.set(null);
    this.showInstallLog.set(true);
    this.serverMessage.set(null);
    try {
      const version = this.selectedVersion() || undefined;
      const res = await firstValueFrom(this.http.post<ApiResponse<{ log: string; success: boolean }>>(`${API}/admin/llm/install`, { version }));
      this.installLog.set(res.data?.log ?? 'No output');
      this.serverMessage.set(res.data?.success ? 'Installation complete' : 'Installation failed');
      this.serverMessageSuccess.set(res.data?.success ?? false);
    } catch (err: any) {
      this.installLog.set(err?.error?.message ?? 'Install request failed');
      this.serverMessage.set('Installation failed');
      this.serverMessageSuccess.set(false);
    }
    await Promise.all([this.loadStatus(), this.loadInstallStatus()]);
    this.installing.set(false);
  }

  // ── Server start / stop ───────────────────────────────────────────

  async startServer(): Promise<void> {
    this.starting.set(true);
    this.serverMessage.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<{ started: boolean; message: string }>>(`${API}/admin/llm/start`, {}));
      this.serverMessage.set(res.data?.message ?? 'Unknown');
      this.serverMessageSuccess.set(res.data?.started ?? false);
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
      const res = await firstValueFrom(this.http.post<ApiResponse<{ stopped: boolean; message: string }>>(`${API}/admin/llm/stop`, {}));
      this.serverMessage.set(res.data?.message ?? 'Unknown');
      this.serverMessageSuccess.set(res.data?.stopped ?? false);
    } catch (err: any) {
      this.serverMessage.set(err?.error?.message ?? 'Stop request failed');
      this.serverMessageSuccess.set(false);
    }
    await this.loadStatus();
    this.llmHealth.refresh();
    this.stopping.set(false);
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
    this.repoFilesLoading.set(true);
    this.modelSearchResults.set([]);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<{ repoId: string; files: HfFile[]; maxModelSizeMb: number }>>(`${API}/admin/llm/models/files`, { params: { repoId } }));
      this.repoFiles.set(res.data?.files ?? []);
    } catch { this.repoFiles.set([]); }
    this.repoFilesLoading.set(false);
  }

  async installModel(repoId: string, filename: string): Promise<void> {
    this.modelInstalling.set(true);
    this.modelMessage.set('Starting download…');
    this.modelMessageSuccess.set(true);
    this.modelDownloadProgress.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<{ message: string }>>(`${API}/admin/llm/models/install`, { repoId, filename }));
      if (!res.success) {
        this.modelMessage.set((res as any).error ?? 'Install failed');
        this.modelMessageSuccess.set(false);
        this.modelInstalling.set(false);
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

      // Poll loop
      for (let i = 0; i < 300; i++) { // max 10 min (300 * 2s)
        await new Promise(r => setTimeout(r, 2000));
        const done = await poll();
        if (done) break;
      }
    } catch (err: any) {
      this.modelMessage.set(err?.error?.error ?? err?.error?.message ?? 'Install failed');
      this.modelMessageSuccess.set(false);
    }
    this.modelDownloadProgress.set(null);
    await Promise.all([this.loadStatus(), this.loadInstallStatus()]);
    this.modelInstalling.set(false);
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
    await Promise.all([this.loadStatus(), this.loadInstallStatus()]);
    this.modelRemoving.set(false);
  }

  // ── Tests ─────────────────────────────────────────────────────────

  async runTestPrompt(): Promise<void> {
    this.testRunning.set(true);
    this.testResult.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<TestResult>>(`${API}/admin/llm/test`, { prompt: this.testPrompt() }));
      this.testResult.set(res.data ?? null);
    } catch (err: any) {
      this.testResult.set({ success: false, durationMs: 0, input: this.testPrompt(), output: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null });
    }
    this.testRunning.set(false);
  }

  async runTestRfq(): Promise<void> {
    this.rfqRunning.set(true);
    this.rfqResult.set(null);
    try {
      const res = await firstValueFrom(this.http.post<ApiResponse<TestResult & { parsed: any }>>(`${API}/admin/llm/test-rfq`, { rfqText: this.rfqText() }));
      this.rfqResult.set(res.data ?? null);
    } catch (err: any) {
      this.rfqResult.set({ success: false, durationMs: 0, input: this.rfqText(), output: null, error: err?.error?.message ?? 'Request failed', tokensUsed: null, parsed: null });
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
