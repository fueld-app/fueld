// ═══════════════════════════════════════════════════════════════════════
//  LLM Client — Local Qwen via llama-server (OpenAI-compatible API)
//
//  Connects to a llama-server instance running locally.
//  Uses Bun's native fetch — no external dependencies.
//
//  Environment variables:
//    LLM_BASE_URL  — default: http://127.0.0.1:8081
//    LLM_TIMEOUT   — request timeout in ms, default: 30000
// ═══════════════════════════════════════════════════════════════════════

import type { ParsedRFQ, ParsedProduct } from '../modules/whatsapp/rfq-parser';
import { loadPrompt } from './prompt-loader';
import { webSearch, formatSearchContext, isSearchHealthy } from './web-search';

// ─── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content?: string;
    reasoning_content?: string;
  };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

type LlmThinkingMode = 'production' | 'thinking';

export interface LlmClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

// ─── Raw JSON schema the model must return for RFQ parsing ──────────

interface RfqLlmResponse {
  vesselName: string | null;
  imo: string | null;
  port: string | null;
  products: Array<{
    name: string;
    quantity: number | null;
    unit: string;
  }>;
  eta: string | null;
  confidence: number;
}

// ─── Client ──────────────────────────────────────────────────────────

export class LlmClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: LlmClientOptions) {
    this.baseUrl = (options?.baseUrl ?? process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:8081').replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? Number(process.env['LLM_TIMEOUT'] ?? 30_000);
  }

  // ── Health check ────────────────────────────────────────────────────

  /** Returns true if the llama-server is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Generic chat completion ─────────────────────────────────────────

  /**
   * Send a chat completion request to the local llama-server.
   * Uses the OpenAI-compatible /v1/chat/completions endpoint.
   */
  async chatCompletion(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      thinkingMode?: LlmThinkingMode;
      /** JSON schema to enforce structured output */
      responseFormat?: { type: 'json_object' } | { type: 'text' };
    },
  ): Promise<{ content: string; reasoning: string | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null }> {
    const thinkingMode = options?.thinkingMode ?? 'production';
    const body: Record<string, unknown> = {
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 1024,
      stream: false,
      chat_template_kwargs: {
        enable_thinking: thinkingMode === 'thinking',
      },
    };

    if (options?.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
  const reasoning = message?.reasoning_content?.trim() || null;
  const content = message?.content?.trim() || reasoning || '';

    if (!content) {
      throw new Error('LLM returned empty response');
    }

    const usage = data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
      : null;
    return { content, reasoning, usage };
  }

  // ── Search-augmented chat ───────────────────────────────────────────

  /** Check if web search (SearXNG) is available. */
  async isSearchAvailable(): Promise<boolean> {
    return isSearchHealthy();
  }

  /**
   * Search the web first, inject results as context, then ask the LLM.
   * Falls back to plain chat if search is unavailable.
   */
  async searchAndChat(
    userMessage: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      searchLimit?: number;
    },
  ): Promise<{ answer: string; searchResults: Array<{ title: string; url: string; snippet: string }>; usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null }> {
    let searchResults: Array<{ title: string; url: string; snippet: string }> = [];
    let searchContext = '';

    try {
      searchResults = await webSearch(userMessage, { limit: options?.searchLimit ?? 5 });
      searchContext = formatSearchContext(searchResults);
    } catch (err) {
      console.warn('[LLM] Web search failed, proceeding without:', err instanceof Error ? err.message : err);
    }

    const systemParts = [
      'You are a helpful assistant with access to current web search results.',
      'Answer the user\'s question using the search results provided below as context.',
      'Always cite your sources. If the search results don\'t contain enough information, say so.',
      `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    ];

    if (searchContext) {
      systemParts.push('', searchContext);
    } else {
      systemParts.push('', 'Note: Web search was unavailable. Answer based on your training data and clearly state that the information may not be current.');
    }

    const { content: answer, usage } = await this.chatCompletion(
      [
        { role: 'system', content: systemParts.join('\n') },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 1024,
      },
    );

    return { answer, searchResults, usage };
  }

  // ── RFQ Parsing ─────────────────────────────────────────────────────

  /**
   * Parse a raw RFQ message (e.g. WhatsApp, email) into structured data
   * using the local LLM. Falls back gracefully on parse errors.
   */
  async parseRFQ(
    rfqText: string,
    senderPhone: string = 'unknown',
    senderName: string | null = null,
  ): Promise<{ parsed: ParsedRFQ | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null }> {
    if (!rfqText || rfqText.trim().length < 10) return { parsed: null, usage: null };

    try {
      // Load the system prompt from the editable prompt file
      const systemPrompt = await loadPrompt('rfq-parsing');
      const today = new Date().toISOString().slice(0, 10);
      const { content, usage } = await this.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Today's date is ${today}. Extract the RFQ from the message below and return JSON only.\n\n${rfqText}`,
          },
        ],
        {
          temperature: 0,
          maxTokens: 384,
          thinkingMode: 'production',
          responseFormat: { type: 'json_object' },
        },
      );

      // Extract JSON from response — handle possible markdown fencing
      const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(jsonStr) as RfqLlmResponse;

      // Validate minimum structure
      if (!parsed || typeof parsed !== 'object') return { parsed: null, usage };

      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;

      if (confidence < 0.2) return { parsed: null, usage };

      // Normalise products
      const products: ParsedProduct[] = (parsed.products ?? [])
        .filter((p): p is { name: string; quantity: number | null; unit: string } =>
          typeof p?.name === 'string' && p.name.length > 0,
        )
        .map((p) => ({
          name: p.name.toUpperCase(),
          quantity: typeof p.quantity === 'number' ? p.quantity : null,
          unit: (p.unit ?? 'MT').toUpperCase(),
        }));

      return {
        parsed: {
          vesselName: typeof parsed.vesselName === 'string' ? parsed.vesselName.trim() : null,
          imo: typeof parsed.imo === 'string' && /^\d{7}$/.test(parsed.imo) ? parsed.imo : null,
          port: typeof parsed.port === 'string' ? parsed.port.trim() : null,
          products,
          eta: typeof parsed.eta === 'string' ? parsed.eta : null,
          rawText: rfqText,
          senderPhone,
          senderName,
          confidence,
        },
        usage,
      };
    } catch (err) {
      console.error('[LLM] parseRFQ failed:', err instanceof Error ? err.message : err);
      return { parsed: null, usage: null };
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance: LlmClient | null = null;

/** Get the shared LLM client instance. */
export function getLlmClient(): LlmClient {
  if (!_instance) {
    _instance = new LlmClient();
  }
  return _instance;
}
