// Parser and policy check for Cloudflare Pages `_headers` files.
// Used by scripts/check-dist.ts and tests/scripts/headers-policy.test.ts.
// Pure: no file system, no network. Failure messages name the problem and the
// header or directive involved; they never echo header values.

export interface HeaderLine {
  name: string;
  value: string;
}

export interface HeadersBlock {
  pattern: string;
  headers: HeaderLine[];
}

/**
 * Parses a `_headers` file. A non-indented, non-comment, non-blank line starts a
 * block; indented `Name: value` lines belong to the current block; `#` starts a
 * comment line.
 */
export function parseHeadersFile(text: string): HeadersBlock[] {
  const blocks: HeadersBlock[] = [];
  let current: HeadersBlock | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      blocks.push(current);
      continue;
    }
    if (current === null) continue;
    const line = raw.trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    current.headers.push({
      name: line.slice(0, colon).trim(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return blocks;
}

const PERMISSIONS_POLICY = 'permissions-policy';
const CSP = 'content-security-policy';
const NOSNIFF = 'x-content-type-options';
const REFERRER = 'referrer-policy';

const EXPECTED_PERMISSIONS_POLICY = 'microphone=(self)';

const REQUIRED_DIRECTIVES: ReadonlyArray<readonly [string, string[]]> = [
  ['default-src', ["'self'"]],
  ['connect-src', ["'self'"]],
  ['img-src', ["'self'", 'data:']],
  ['style-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
];

const SELF_ONLY_DIRECTIVES = ['script-src', 'media-src', 'connect-src'];
const FORBIDDEN_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'];

function named(block: HeadersBlock, lowerName: string): HeaderLine[] {
  return block.headers.filter((h) => h.name.toLowerCase() === lowerName);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function checkCsp(value: string, failures: string[]): void {
  const directives = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t !== '');
    const first = tokens[0];
    if (first === undefined) continue;
    const name = first.toLowerCase();
    if (directives.has(name)) {
      failures.push(`Content-Security-Policy repeats directive ${name}`);
      continue;
    }
    directives.set(name, tokens.slice(1));
  }

  for (const [name, expected] of REQUIRED_DIRECTIVES) {
    const sources = directives.get(name);
    if (sources === undefined) {
      failures.push(`Content-Security-Policy is missing directive ${name}`);
    } else if (!sameList(sources.map((s) => s.toLowerCase()), expected)) {
      failures.push(`Content-Security-Policy directive ${name} must be exactly ${expected.join(' ')}`);
    }
  }

  for (const [name, sources] of directives) {
    for (const source of sources) {
      const lower = source.toLowerCase();
      if (FORBIDDEN_SCHEMES.some((s) => lower.startsWith(s)) || lower.startsWith('*')) {
        failures.push(`Content-Security-Policy directive ${name} has a forbidden http, https, ws, wss or wildcard source`);
      }
      if (lower === "'unsafe-inline'" || lower === "'unsafe-eval'") {
        failures.push(`Content-Security-Policy directive ${name} contains ${lower}`);
      }
      if (lower === 'data:' && name !== 'img-src') {
        failures.push(`Content-Security-Policy allows data: in ${name}; only img-src may`);
      }
    }
  }

  for (const name of SELF_ONLY_DIRECTIVES) {
    const sources = directives.get(name);
    if (sources !== undefined && !sameList(sources.map((s) => s.toLowerCase()), ["'self'"])) {
      failures.push(`Content-Security-Policy directive ${name} must allow only 'self'`);
    }
  }
}

/** Checks a `_headers` file against the voice-input header policy (R15.1 to 15.5, 15.9). */
export function checkHeadersPolicy(text: string): string[] {
  const failures: string[] = [];
  const blocks = parseHeadersFile(text);

  const main = blocks.filter((b) => b.pattern === '/*');
  if (main.length !== 1) {
    failures.push(`_headers must have exactly one /* block, found ${main.length}`);
  }
  const block = main[0];

  if (block !== undefined) {
    const pp = named(block, PERMISSIONS_POLICY);
    if (pp.length !== 1) {
      failures.push(`/* block must have exactly one Permissions-Policy header, found ${pp.length}`);
    } else if (pp[0]?.value !== EXPECTED_PERMISSIONS_POLICY) {
      failures.push('Permissions-Policy value must be exactly microphone=(self)');
    }

    const csp = named(block, CSP);
    if (csp.length !== 1) {
      failures.push(`/* block must have exactly one Content-Security-Policy header, found ${csp.length}`);
    } else {
      checkCsp(csp[0]?.value ?? '', failures);
    }

    const nosniff = named(block, NOSNIFF);
    if (nosniff.length !== 1 || nosniff[0]?.value !== 'nosniff') {
      failures.push('/* block must have exactly one X-Content-Type-Options: nosniff header');
    }

    const referrer = named(block, REFERRER);
    if (referrer.length !== 1 || referrer[0]?.value !== 'no-referrer') {
      failures.push('/* block must have exactly one Referrer-Policy: no-referrer header');
    }
  }

  // Cloudflare Pages merges (comma-joins) headers of all matching blocks (DD-10).
  for (const other of blocks) {
    if (other === block || other.pattern === '/*') continue;
    for (const [lower, label] of [
      [PERMISSIONS_POLICY, 'Permissions-Policy'],
      [CSP, 'Content-Security-Policy'],
      [NOSNIFF, 'X-Content-Type-Options'],
    ] as const) {
      if (named(other, lower).length > 0) {
        failures.push(`block ${other.pattern} must not repeat ${label}`);
      }
    }
  }

  return failures;
}
