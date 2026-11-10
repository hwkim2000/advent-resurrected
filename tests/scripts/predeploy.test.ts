import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findEntryScript, formatSizeReport, measure, parseBaseline } from '../../scripts/predeploy';

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/main-abc.js"></script>
<link rel="modulepreload" crossorigin href="/assets/crt-xyz.js">
</head><body></body></html>`;

describe('predeploy helpers', () => {
  it('finds the script, not the modulepreload chunk', () => {
    expect(findEntryScript(HTML)).toBe('assets/main-abc.js');
  });

  it('returns null without a script and ignores external scripts', () => {
    expect(findEntryScript('<link rel="modulepreload" href="/a.js">')).toBeNull();
    expect(findEntryScript('<script src="https://x.test/a.js"></script>')).toBeNull();
  });

  it('measures raw and default-level gzip', () => {
    const data = new TextEncoder().encode('abc'.repeat(1000));
    expect(measure(data)).toEqual({ raw: 3000, gzip: gzipSync(data).byteLength });
  });

  it('formats positive, negative and zero deltas', () => {
    const base = { raw: 100, gzip: 50 };
    expect(formatSizeReport('a.js', { raw: 110, gzip: 45 }, base)).toMatch(/delta \+10\)[\s\S]*delta -5\)/);
    expect(formatSizeReport('a.js', { raw: 100, gzip: 50 }, base)).toMatch(/delta \+0\)[\s\S]*delta \+0\)/);
  });

  it('handles a missing baseline', () => {
    expect(formatSizeReport('a.js', { raw: 1, gzip: 1 }, null)).toMatch(/none recorded/);
    expect(parseBaseline(null)).toBeNull();
    expect(parseBaseline('not json')).toBeNull();
    expect(parseBaseline('{"raw":1}')).toBeNull();
    expect(parseBaseline('{"raw":1,"gzip":2}')).toEqual({ raw: 1, gzip: 2 });
  });
});
