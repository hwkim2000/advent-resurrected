// ghost-voice task 6.3: public/voice/manifest.json must cover every Voice_Line (strict when the
// manifest exists, visibly skipped otherwise) and the audio must stay under 3 MB.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { voiceKey, voiceLines } from '../src/haunt/voice-lines';

const DIR = join(__dirname, '..', 'public', 'voice');
const MANIFEST = join(DIR, 'manifest.json');
const present = existsSync(MANIFEST);
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

interface Entry {
  file: string;
  bytes: number;
  text: string;
}

function load(): { entries: Record<string, Entry> } {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as { entries: Record<string, Entry> };
}

describe('voice manifest sync', () => {
  it.skipIf(!present)(
    'manifest covers every Voice_Line and lists nothing else (SKIPPED when public/voice/manifest.json is absent: audio not generated yet)',
    () => {
      const entries = load().entries;
      const lines = voiceLines();
      const missing = lines.filter((l) => entries[voiceKey(l)] === undefined);
      expect(missing).toEqual([]);
      const wanted = new Set(lines.map(voiceKey));
      expect(Object.keys(entries).filter((k) => !wanted.has(k))).toEqual([]);
      for (const l of lines) expect(entries[voiceKey(l)]?.text).toBe(l);
    },
  );

  it.skipIf(!present)(
    'every manifest file exists with the recorded size and total audio is under 3 MB (SKIPPED when public/voice/manifest.json is absent: audio not generated yet)',
    () => {
      let total = 0;
      for (const e of Object.values(load().entries)) {
        const file = join(DIR, e.file);
        expect(existsSync(file), e.file).toBe(true);
        const size = statSync(file).size;
        expect(size, e.file).toBe(e.bytes);
        total += size;
      }
      expect(total).toBeLessThan(MAX_TOTAL_BYTES);
    },
  );
});
