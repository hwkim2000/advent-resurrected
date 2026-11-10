// ghost-voice task 5.3: no text-to-speech model id may appear in client or server code
// (the model id lives only in scripts/gen-voice.ts, which runs at build time).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const IDS = ['melotts', '@cf/myshell', 'aura-1'];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

describe('no text-to-speech model id at runtime', () => {
  for (const dir of ['src', 'functions']) {
    it(`${dir}/ contains none of ${IDS.join(', ')}`, () => {
      const hits: string[] = [];
      for (const f of files(join(ROOT, dir))) {
        if (!/\.(ts|tsx|js|json|css|html|md)$/.test(f)) continue;
        const text = readFileSync(f, 'utf8').toLowerCase();
        for (const id of IDS) if (text.includes(id)) hits.push(`${f}: ${id}`);
      }
      expect(hits).toEqual([]);
    });
  }
});
