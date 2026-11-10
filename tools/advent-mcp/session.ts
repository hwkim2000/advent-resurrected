/*
 * Game session for the MCP server: engine + in-memory Storage, no MCP imports.
 *
 * New code; not ported from Open Adventure. It drives the engine only through
 * its public API (start / step / render) plus the pure helpers computeScore
 * and makeHintView / selectHintRule. Nothing here writes to disk or network.
 */
import {
  BIRD,
  BIRD_CAGED,
  BRIDGE_WRECKED,
  CHASM,
  CHEST,
  DRAGON,
  DRAGON_DEAD,
  GRATE,
  GRATE_OPEN,
  LAMP,
  LAMP_BRIGHT,
  NDEATHS,
  NDWARVES,
  SNAKE,
  SNAKE_CHASED,
  TROLL,
  TROLL_GONE,
} from '../../src/data/constants';
import { LOCATIONS, OBJECTS } from '../../src/data/dungeon';
import {
  newGame,
  render,
  serialize,
  start,
  step,
  type Env,
  type GameState,
  type OutputEvent,
  type Storage,
} from '../../src/engine/index';
import { computeScore } from '../../src/engine/score';
import { makeHintView } from '../../src/haunt/hint-view';
import { selectHintRule } from '../../src/haunt/hints';

export type PromptKind = 'command' | 'yesno' | 'filename';
export type GameMode = '1976' | 'haunted';

export const DEFAULT_SEED = 1;
export const MAX_INPUT_LENGTH = 1023;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
/** C: CARRIED (advent.h). */
const CARRIED = -1;
/** C: STATE_NOTFOUND (advent.h). */
const STATE_NOTFOUND = -1;

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/** SAVE / SUSPEND / RESUME go here, never to disk. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, string>();
  read(name: string): string | undefined {
    return this.files.get(name);
  }
  write(name: string, data: string): boolean {
    this.files.set(name, data);
    return true;
  }
}

export interface TurnResult {
  text: string;
  prompt: PromptKind;
  over: boolean;
  turns: number;
}

export type GhostResult =
  | { ghost: true; rule: string; hint: string }
  | { ghost: false; message: string };

function locationName(loc: number): string {
  const def = LOCATIONS[loc];
  if (def === undefined) return `location ${loc}`;
  if (def.small !== null) return def.small;
  const first = (def.big ?? '').split('\n')[0] ?? '';
  return first !== '' ? first : `location ${loc}`;
}

export class GameSession {
  private state: GameState | undefined;
  private mode: GameMode = '1976';
  private seed = DEFAULT_SEED;
  private prompt: PromptKind = 'command';
  private readonly storage = new MemoryStorage();

  /** The in-memory store used by SAVE / SUSPEND (exposed for tests). */
  get memory(): MemoryStorage {
    return this.storage;
  }

  /** Serialized engine state, for tests that check read-only behaviour. */
  serializeState(): string | undefined {
    return this.state === undefined ? undefined : serialize(this.state);
  }

  private env(): Env {
    return { storage: this.storage };
  }

  private absorb(events: readonly OutputEvent[]): string {
    for (const e of events) if (e.type === 'prompt') this.prompt = e.kind;
    return render(events as OutputEvent[], { echo: false });
  }

  private require(): GameState {
    if (this.state === undefined) throw new SessionError('No game started. Call new_game first.');
    return this.state;
  }

  private result(text: string): TurnResult {
    const state = this.require();
    return {
      text,
      prompt: this.prompt,
      over: state.session.status === 'over',
      turns: state.game.turns,
    };
  }

  /** C: main() start-up, via the engine's start(). */
  newGame(seed: number = DEFAULT_SEED, mode: GameMode = '1976'): TurnResult {
    if (!Number.isInteger(seed) || seed < INT32_MIN || seed > INT32_MAX) {
      throw new SessionError('Bad seed: it must be a signed 32-bit integer.');
    }
    if (mode !== '1976' && mode !== 'haunted') {
      throw new SessionError("Bad mode: use '1976' or 'haunted'.");
    }
    this.storage.files.clear();
    this.prompt = 'command';
    const fresh = newGame(seed, { oldstyle: mode === '1976' });
    const r = start(fresh, this.env());
    this.state = r.state;
    this.mode = mode;
    this.seed = seed;
    return this.result(this.absorb(r.events));
  }

  /** One line of input to the engine; classic output only. */
  send(text: string): TurnResult {
    const state = this.require();
    if (typeof text !== 'string') throw new SessionError('Input must be text.');
    if (text.length > MAX_INPUT_LENGTH) {
      throw new SessionError(`Input too long: at most ${MAX_INPUT_LENGTH} characters.`);
    }
    if (state.session.status === 'over') {
      throw new SessionError('The game is over. Call new_game to start again.');
    }
    const r = step(state, text, this.env());
    this.state = r.state;
    return this.result(this.absorb(r.events));
  }

  /**
   * Read-only summary. Score: computeScore(game, 'scoregame') from
   * src/engine/score.ts is pure (reads Game, returns a number) and is what the
   * engine's own finish() uses to emit `score` events, so calling it here gives
   * exactly the score the game would report now. It does not touch
   * session.reportedScore, which only the engine's step() updates.
   */
  getState(): Record<string, unknown> {
    const state = this.require();
    const g = state.game;
    const inventory: string[] = [];
    for (let i = 1; i < g.objects.length; i++) {
      if (g.objects[i]!.place === CARRIED) {
        const def = OBJECTS[i];
        inventory.push(def?.inventory ?? def?.words[0] ?? `object ${i}`);
      }
    }
    const { score, max } = computeScore(g, 'scoregame');
    return {
      location: { id: g.loc, name: locationName(g.loc) },
      inventory,
      score,
      maxScore: max,
      turns: g.turns,
      lamp: { lit: g.objects[LAMP]!.prop === LAMP_BRIGHT, life: g.limit },
      flags: {
        grateUnlocked: g.objects[GRATE]!.prop === GRATE_OPEN,
        birdCaged: g.objects[BIRD]!.prop === BIRD_CAGED,
        snakeGone: g.objects[SNAKE]!.prop === SNAKE_CHASED,
        dragonDead: g.objects[DRAGON]!.prop === DRAGON_DEAD,
        trollGone: g.objects[TROLL]!.prop === TROLL_GONE,
        bridgeWrecked: g.objects[CHASM]!.prop === BRIDGE_WRECKED,
        pirateSeen: g.dwarves[NDWARVES]!.seen,
        chestFound: g.objects[CHEST]!.prop !== STATE_NOTFOUND,
        caveClosing: g.closng,
      },
      lives: { used: g.numdie, max: NDEATHS },
      prompt: this.prompt,
      over: state.session.status === 'over',
      mode: this.mode,
      seed: this.seed,
    };
  }

  /** First variant of the rule the ghost would pick now. No counters, no engine call. */
  askGhost(): GhostResult {
    const state = this.require();
    if (this.mode === '1976') {
      return { ghost: false, message: 'The ghost only exists in Haunted mode. Start a game with mode "haunted".' };
    }
    const rule = selectHintRule(makeHintView(state));
    return { ghost: true, rule: rule.id, hint: rule.lines[0] ?? '' };
  }
}
