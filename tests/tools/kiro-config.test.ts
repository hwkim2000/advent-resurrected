// kiro-tooling task 3.3: structure of every .kiro/hooks/*.json. (.kiro/settings/mcp.json is
// validated by tests/tools/mcp-config.test.ts.)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', '..', '.kiro', 'hooks');
const TRIGGERS = new Set([
  'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit', 'PreTaskExec',
  'PostTaskExec', 'PreCompact', 'PostCompact', 'PostFileCreate', 'PostFileSave', 'PostFileDelete',
  'Manual',
]);

interface Hook {
  name: string;
  trigger: string;
  matcher?: string;
  action: { type: string; command?: string };
  timeout?: number;
  description?: string;
}
interface HookFile { version: string; hooks: Hook[] }

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const parsed = files.map((f) => ({ f, data: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as HookFile }));
const byFile = (f: string): Hook => parsed.find((p) => p.f === f)!.data.hooks[0]!;

describe('.kiro/hooks structure', () => {
  it('has the three expected hook files', () => {
    expect(files).toEqual(['engine-fidelity.json', 'line-lint.json', 'predeploy.json']);
  });

  for (const { f, data } of parsed) {
    it(`${f}: v1 shape, valid trigger, command action, valid matcher`, () => {
      expect(data.version).toBe('v1');
      expect(data.hooks.length).toBeGreaterThan(0);
      for (const h of data.hooks) {
        expect(typeof h.name).toBe('string');
        expect(h.name.length).toBeGreaterThan(0);
        expect(TRIGGERS.has(h.trigger), h.trigger).toBe(true);
        expect(h.action.type).toBe('command');
        expect(typeof h.action.command).toBe('string');
        expect(h.timeout ?? 60).toBeGreaterThan(0);
        if (h.matcher !== undefined) expect(() => new RegExp(h.matcher!)).not.toThrow();
      }
    });
  }

  it('hook names are unique across files', () => {
    const names = parsed.flatMap((p) => p.data.hooks.map((h) => h.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('the manual hook is alone in its file, runs predeploy, and says it cannot be run from the CLI', () => {
    const p = parsed.find((x) => x.f === 'predeploy.json')!;
    expect(p.data.hooks).toHaveLength(1);
    const h = p.data.hooks[0]!;
    expect(h.trigger).toBe('Manual');
    expect(h.action.command).toBe('npm run predeploy');
    expect(h.description).toMatch(/cannot be invoked from the Kiro CLI/);
  });

  it('only the manual hook is Manual; the others are PostFileSave', () => {
    expect(byFile('engine-fidelity.json').trigger).toBe('PostFileSave');
    expect(byFile('line-lint.json').trigger).toBe('PostFileSave');
  });

  describe('matchers accept both separator styles', () => {
    const fidelity = new RegExp(byFile('engine-fidelity.json').matcher!);
    const lint = new RegExp(byFile('line-lint.json').matcher!);
    const variants = (p: string) => [p, p.replace(/\//g, '\\'), `c:\\Users\\marti\\dev\\advent-resurrected\\${p.replace(/\//g, '\\')}`, `/work/repo/${p}`];

    for (const p of ['src/engine/actions.ts', 'src/data/dungeon.ts', 'original/adventure.yaml', 'scripts/generate-data.ts']) {
      it(`engine-fidelity matches ${p}`, () => {
        for (const v of variants(p)) expect(fidelity.test(v), v).toBe(true);
      });
    }
    for (const p of ['src/haunt/lines.ts', 'src/haunt/hints.ts', 'src/haunt/yes-no.ts', 'src/haunt/spoken-word-rule.ts', 'src/haunt/voice-lines.ts']) {
      it(`line-lint matches ${p}`, () => {
        for (const v of variants(p)) expect(lint.test(v), v).toBe(true);
      });
    }
    for (const p of ['src/ui/crt.css', 'src/engine-notes.md', 'src/haunt/narrator.ts', 'scripts/generate-datax.ts', 'tests/haunt/line-lint.test.ts']) {
      it(`neither matches ${p}`, () => {
        for (const v of variants(p)) {
          expect(fidelity.test(v), v).toBe(false);
          expect(lint.test(v), v).toBe(false);
        }
      });
    }
  });
});
