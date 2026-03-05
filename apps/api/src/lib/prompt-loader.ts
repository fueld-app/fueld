// ═══════════════════════════════════════════════════════════════════════
//  Prompt Loader — File-based prompt management for LLM workflows
//
//  Reads prompt templates from `apps/api/prompts/` directory.
//  Supports runtime editing via admin API without code changes.
//
//  Each prompt is a plain Markdown file (one per workflow).
//  The entire file content is used as the system message.
// ═══════════════════════════════════════════════════════════════════════

import { readdir, readFile, writeFile, stat, mkdir, unlink } from 'fs/promises';
import { join, basename, extname } from 'path';

// ─── Types ───────────────────────────────────────────────────────────

export interface PromptInfo {
  /** Slug derived from filename, e.g. "rfq-parsing" */
  id: string;
  /** Full filename, e.g. "rfq-parsing.md" */
  filename: string;
  /** Absolute path on disk */
  path: string;
  /** Last-modified timestamp (ISO) */
  updatedAt: string;
  /** File size in bytes */
  sizeBytes: number;
}

export interface PromptDetail extends PromptInfo {
  /** The raw content of the prompt file */
  content: string;
}

// ─── Cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  content: string;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

// ─── Helpers ─────────────────────────────────────────────────────────

/** Resolve the prompts directory (relative to this file's location). */
function getPromptsDir(): string {
  // This file lives at apps/api/src/lib/prompt-loader.ts
  // Prompts dir is at apps/api/prompts/
  return join(import.meta.dir, '../../prompts');
}

function slugFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * List all available prompt files.
 */
export async function listPrompts(): Promise<PromptInfo[]> {
  const dir = getPromptsDir();
  let files: string[];

  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const prompts: PromptInfo[] = [];

  for (const file of files.sort()) {
    if (!file.endsWith('.md')) continue;

    const filePath = join(dir, file);
    try {
      const st = await stat(filePath);
      prompts.push({
        id: slugFromFilename(file),
        filename: file,
        path: filePath,
        updatedAt: st.mtime.toISOString(),
        sizeBytes: st.size,
      });
    } catch {
      // skip unreadable files
    }
  }

  return prompts;
}

/**
 * Get a single prompt by slug (e.g. "rfq-parsing").
 * Returns null if not found.
 */
export async function getPrompt(id: string): Promise<PromptDetail | null> {
  const dir = getPromptsDir();
  const filePath = join(dir, `${id}.md`);

  try {
    const [content, st] = await Promise.all([
      readFile(filePath, 'utf-8'),
      stat(filePath),
    ]);

    return {
      id,
      filename: `${id}.md`,
      path: filePath,
      updatedAt: st.mtime.toISOString(),
      sizeBytes: st.size,
      content,
    };
  } catch {
    return null;
  }
}

/**
 * Update the content of a prompt file.
 * Throws if the file doesn't exist (no creating new prompts via this API).
 */
export async function updatePrompt(id: string, content: string): Promise<PromptDetail> {
  const dir = getPromptsDir();
  const filePath = join(dir, `${id}.md`);

  // Verify file exists first
  try {
    await stat(filePath);
  } catch {
    throw new Error(`Prompt "${id}" not found`);
  }

  await writeFile(filePath, content, 'utf-8');

  // Invalidate cache
  cache.delete(id);

  const st = await stat(filePath);
  return {
    id,
    filename: `${id}.md`,
    path: filePath,
    updatedAt: st.mtime.toISOString(),
    sizeBytes: st.size,
    content,
  };
}

/**
 * Create a new prompt file.
 * The id must be a valid slug (lowercase alphanumeric + hyphens).
 * Throws if a file with that id already exists.
 */
export async function createPrompt(id: string, content: string): Promise<PromptDetail> {
  // Validate slug
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) && !/^[a-z0-9]$/.test(id)) {
    throw new Error(`Invalid prompt id "${id}". Use lowercase letters, numbers, and hyphens.`);
  }

  const dir = getPromptsDir();
  const filePath = join(dir, `${id}.md`);

  // Check it doesn't already exist
  try {
    await stat(filePath);
    throw new Error(`Prompt "${id}" already exists`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) throw err;
    // File doesn't exist — good
  }

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  await writeFile(filePath, content, 'utf-8');

  const st = await stat(filePath);
  return {
    id,
    filename: `${id}.md`,
    path: filePath,
    updatedAt: st.mtime.toISOString(),
    sizeBytes: st.size,
    content,
  };
}

/**
 * Delete a prompt file.
 * Throws if the file doesn't exist.
 */
export async function deletePrompt(id: string): Promise<void> {
  const dir = getPromptsDir();
  const filePath = join(dir, `${id}.md`);

  try {
    await stat(filePath);
  } catch {
    throw new Error(`Prompt "${id}" not found`);
  }

  await unlink(filePath);
  cache.delete(id);
}

/**
 * Load a prompt's content with in-memory caching.
 * Automatically reloads when the file is modified on disk.
 *
 * This is the main function used by the LLM client at inference time.
 */
export async function loadPrompt(id: string): Promise<string> {
  const dir = getPromptsDir();
  const filePath = join(dir, `${id}.md`);

  try {
    const st = await stat(filePath);
    const cached = cache.get(id);

    // Return cached if file hasn't changed
    if (cached && cached.mtimeMs === st.mtimeMs) {
      return cached.content;
    }

    const content = await readFile(filePath, 'utf-8');
    cache.set(id, { content, mtimeMs: st.mtimeMs });
    return content;
  } catch (err) {
    throw new Error(`Failed to load prompt "${id}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
