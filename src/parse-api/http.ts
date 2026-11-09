/**
 * HTTP helpers for the Parse_Endpoint. New code for this project.
 * Responses never carry Access-Control-* headers (Requirement 6.13).
 */
import { BODY_MAX_BYTES } from '../shared/limits';

/** Build a JSON response with the mandatory headers (Requirement 6.12). */
export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (!k.toLowerCase().startsWith('access-control-')) headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export type BodyResult = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'unreadable' };

/**
 * Read the request body as UTF-8 text, at most `maxBytes` bytes. A declared
 * Content-Length over the limit is rejected early; otherwise the stream is
 * counted and cancelled as soon as the count exceeds the limit, so at most
 * maxBytes plus one chunk are buffered.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number = BODY_MAX_BYTES,
): Promise<BodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: 'too_large' };
  }
  if (request.body === null) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(all) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
