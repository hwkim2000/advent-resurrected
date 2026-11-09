/**
 * Provider interface and the Workers AI adapter. New code; no Cloudflare types
 * here (the cast of env.AI to AiLike happens in functions/api/parse.ts).
 * The adapter sends one system and one user message: no tools, no history,
 * no client headers, no IP (Requirements 9.2, 9.3, 11.7).
 */
import { MAX_OUTPUT_TOKENS } from '../shared/limits';

export interface ProviderInput {
  system: string;
  user: string;
  signal: AbortSignal;
}

/** Returns a raw candidate (validated later by validateCommand); may throw. */
export interface Provider {
  translate(input: ProviderInput): Promise<unknown>;
}

export interface AiLike {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `response` if a string, else `choices[0].message.content` if a string, else undefined. */
function extractText(res: unknown): string | undefined {
  if (typeof res === 'string') return res;
  if (!isRecord(res)) return undefined;
  if (typeof res['response'] === 'string') return res['response'];
  const choices = res['choices'];
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const message = (choices[0] as Record<string, unknown>)['message'];
    if (isRecord(message) && typeof message['content'] === 'string') return message['content'];
  }
  return undefined;
}

export function workersAiProvider(ai: AiLike, model: string): Provider {
  return {
    async translate({ system, user, signal }: ProviderInput): Promise<unknown> {
      const body = {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
      };
      // signal is best effort: the handler's timer race enforces the time limit.
      const res = await ai.run(model, body, { signal });
      const text = extractText(res);
      if (text === undefined) throw new Error('provider returned no text');
      return text;
    },
  };
}
