import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGame, render, serialize, start, step, type Env, type GameState } from '../../src/engine/index';
import { GameSession, MemoryStorage, SessionError } from '../../tools/advent-mcp/session';

const memEnv = (): Env => ({ storage: new MemoryStorage() });

describe('GameSession', () => {
  it('opening text equals the engine start output', () => {
    const s = new GameSession();
    const r = s.newGame(1, '1976');
    const direct = start(newGame(1, { oldstyle: true }), memEnv());
    expect(r.text).toBe(render(direct.events, { echo: false }));
    expect(r.prompt).toBe('yesno');
    expect(r.over).toBe(false);
  });

  it('matches direct step calls for a scripted sequence', () => {
    const s = new GameSession();
    s.newGame(7, 'haunted');
    let state: GameState = start(newGame(7, { oldstyle: false }), memEnv()).state;
    for (const line of ['no', 'in', 'take lamp', 'light lamp', 'out']) {
      const r = step(state, line, memEnv());
      state = r.state;
      expect(s.send(line).text).toBe(render(r.events, { echo: false }));
    }
    expect(s.serializeState()).toBe(serialize(state));
  });

  it('getState and askGhost leave the engine state unchanged', () => {
    const s = new GameSession();
    s.newGame(1, 'haunted');
    s.send('no');
    s.send('in');
    const before = s.serializeState();
    const st = s.getState();
    const g1 = s.askGhost();
    const g2 = s.askGhost();
    expect(s.serializeState()).toBe(before);
    expect(g1).toEqual(g2);
    expect(g1.ghost).toBe(true);
    expect(st.score).toBe(32);
    expect((st.location as { id: number }).id).toBeGreaterThan(0);
  });

  it('tracks inventory, lamp and prompt kind', () => {
    const s = new GameSession();
    s.newGame(1, '1976');
    expect(s.getState().prompt).toBe('yesno');
    for (const c of ['no', 'in', 'take lamp', 'light lamp']) s.send(c);
    const st = s.getState();
    expect(st.inventory).toEqual(['Brass lantern']);
    expect((st.lamp as { lit: boolean }).lit).toBe(true);
    expect(st.prompt).toBe('command');
    expect(st.mode).toBe('1976');
  });

  it('ghost is unavailable in 1976 mode', () => {
    const s = new GameSession();
    s.newGame(1, '1976');
    const g = s.askGhost();
    expect(g.ghost).toBe(false);
  });

  it('rejects bad input with SessionError', () => {
    const s = new GameSession();
    expect(() => s.send('x')).toThrow(SessionError);
    expect(() => s.getState()).toThrow(SessionError);
    expect(() => s.askGhost()).toThrow(SessionError);
    expect(() => s.newGame(1.5)).toThrow(SessionError);
    expect(() => s.newGame(2 ** 31)).toThrow(SessionError);
    s.newGame(1);
    expect(() => s.send('a'.repeat(1024))).toThrow(/too long/);
    expect(() => s.send('a'.repeat(1023))).not.toThrow();
  });

  it('refuses commands after game over', () => {
    const s = new GameSession();
    s.newGame(1);
    s.send('no');
    s.send('quit');
    s.send('yes');
    expect(s.getState().over).toBe(true);
    expect(() => s.send('look')).toThrow(/over/);
  });

  it('keeps SAVE data in memory only', () => {
    const s = new GameSession();
    s.newGame(1);
    for (const c of ['no', 'in']) s.send(c);
    expect(s.send('save').prompt).toBe('yesno');
    expect(s.send('yes').prompt).toBe('filename');
    const name = 'advent-mcp-test-memory-only.sav';
    s.send(name);
    expect([...s.memory.files.keys()]).toEqual([name]);
    expect(existsSync(name)).toBe(false);
  });
});
