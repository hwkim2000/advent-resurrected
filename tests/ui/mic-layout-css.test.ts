import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CSS-text checks for MIC visibility (haunting spec, Requirement 6.3). Real layout is
// measured by `npm run check:layout`; happy-dom has no layout engine.
const css = readFileSync(resolve(__dirname, '../../src/ui/crt.css'), 'utf8');

describe('MIC visibility CSS', () => {
  it('derives vertical padding and text size from the viewport height too', () => {
    expect(css).toContain('--screen-pad-block: clamp(0.5rem, 2vh, 1.5rem)');
    expect(css).toMatch(/padding:\s*var\(--screen-pad-block\) var\(--screen-pad\)/);
    expect(css).toMatch(/--text-size:\s*clamp\(18px, min\(2\.4vw, 3\.4vh\), 26px\)/);
  });

  it('keeps the disclosure visible but smaller, never display:none', () => {
    const rule = /\n\.voice-disclosure\s*\{(\s*flex[^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/font-size:\s*max\(14px, 0\.65em\)/);
    expect(rule?.[1]).not.toMatch(/display:\s*none/);
  });

  it('has a short-viewport media query and keeps inputs at 16px or more', () => {
    expect(css).toMatch(/@media \(max-height: 700px\)/);
    expect(css).toContain('font-size: max(16px, 1em)');
  });
});
