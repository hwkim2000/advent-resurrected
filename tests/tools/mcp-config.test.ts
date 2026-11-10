import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../tools/advent-mcp/server';

const CONFIG = resolve(__dirname, '../../.kiro/settings/mcp.json');

// The config file lives in .kiro/settings/, which the authoring session was not
// allowed to write; the suite checks it as soon as the file exists.
describe.skipIf(!existsSync(CONFIG))('.kiro/settings/mcp.json', () => {
  const config = () => JSON.parse(readFileSync(CONFIG, 'utf8'));

  it('registers the advent server', () => {
    const s = config().mcpServers.advent;
    expect(s.command).toBe('npx');
    expect(s.args).toEqual(['tsx', 'tools/advent-mcp/server.ts']);
    expect(s.disabled).toBe(false);
    expect(existsSync(resolve(__dirname, '../../', s.args[1]))).toBe(true);
  });

  it('auto-approves exactly the registered tools', () => {
    expect([...config().mcpServers.advent.autoApprove].sort()).toEqual([...TOOL_NAMES].sort());
  });
});
