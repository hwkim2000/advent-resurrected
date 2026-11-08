/*
 * Data_Generator: derives src/data/{constants,dungeon,travel}.ts from
 * original/adventure.yaml.
 *
 * This is a function-for-function port of Open Adventure's make_dungeon.py
 * (reference/open-adventure/make_dungeon.py), including `buildtravel` and its
 * legacy `cond*1000+dest` encoding.
 *
 * Run with: npm run gen:data
 *
 * SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 *
 * BSD 2-Clause License. Redistribution and use in source and binary forms,
 * with or without modification, are permitted provided that the following
 * conditions are met: (1) Redistributions of source code must retain the
 * above copyright notice, this list of conditions and the following
 * disclaimer. (2) Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer in
 * the documentation and/or other materials provided with the distribution.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. See original/COPYING.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

export const REGEN_COMMAND = "npm run gen:data";
export const YAML_RELATIVE_PATH = "original/adventure.yaml";
export const REQUIRED_SECTIONS = [
  "motions",
  "hints",
  "locations",
  "dwarflocs",
  "arbitrary_messages",
  "classes",
  "turn_thresholds",
  "objects",
  "obituaries",
  "actions",
] as const;

/** Error raised for any problem with the YAML input or the generation. */
export class GenerateError extends Error {}

// ---------------------------------------------------------------------------
// C string handling
// ---------------------------------------------------------------------------

/**
 * C: make_c_string (make_dungeon.py). Renders text to the body of a C string
 * literal (no surrounding quotes). Only newline, tab and both quote
 * characters are escaped; backslashes are deliberately left alone, so a
 * literal backslash-n in the YAML text becomes a C newline escape.
 */
export function makeCStringBody(text: string): string {
  return text
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  "\\": "\\",
  '"': '"',
  "'": "'",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
};

/**
 * Decodes the body of a C string literal the way a C compiler would
 * (the "C escape pass", design clarification C-1). Throws GenerateError on any
 * escape that is not supported.
 */
export function decodeCEscapes(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    if (i >= body.length) throw new GenerateError("trailing backslash in string");
    const e = body.charAt(i);
    const simple = SIMPLE_ESCAPES[e];
    if (simple !== undefined) {
      out += simple;
    } else if (e >= "0" && e <= "7") {
      let digits = e;
      while (digits.length < 3 && i + 1 < body.length && /[0-7]/.test(body.charAt(i + 1))) {
        digits += body.charAt(++i);
      }
      const code = parseInt(digits, 8);
      if (code === 0 || code > 0xff) throw new GenerateError(`unsupported octal escape \\${digits}`);
      out += String.fromCharCode(code);
    } else if (e === "x") {
      let digits = "";
      while (i + 1 < body.length && /[0-9a-fA-F]/.test(body.charAt(i + 1))) {
        digits += body.charAt(++i);
      }
      if (digits === "") throw new GenerateError("\\x escape with no hex digits");
      const code = parseInt(digits, 16);
      if (code === 0 || code > 0xff) throw new GenerateError(`unsupported hex escape \\x${digits}`);
      out += String.fromCharCode(code);
    } else {
      throw new GenerateError(`unsupported escape \\${e}`);
    }
  }
  return out;
}

/** The text the C program would hold for a YAML string (make_c_string + compile). */
export function cString(text: string): string {
  return decodeCEscapes(makeCStringBody(text));
}

/** Like cString but keeps NULL (null) distinct from the empty string. */
function optStr(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new GenerateError(`${where}: expected a string or null, got ${typeof value}`);
  }
  try {
    return cString(value);
  } catch (err) {
    throw new GenerateError(`${where}: ${(err as Error).message} in string ${JSON.stringify(value)}`);
  }
}

function reqStr(value: unknown, where: string): string {
  const s = optStr(value, where);
  if (s === null) throw new GenerateError(`${where}: expected a string, got null`);
  return s;
}

// ---------------------------------------------------------------------------
// YAML access helpers (parsed with mapAsMap, so every mapping is a Map)
// ---------------------------------------------------------------------------

type YMap = Map<unknown, unknown>;

function isMap(v: unknown): v is YMap {
  return v instanceof Map;
}

function asMap(v: unknown, where: string): YMap {
  if (!isMap(v)) throw new GenerateError(`${where}: expected a mapping`);
  return v;
}

function asList(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new GenerateError(`${where}: expected a list`);
  return v;
}

function field(m: YMap, key: string, where: string): unknown {
  if (!m.has(key)) throw new GenerateError(`${where}: missing required key '${key}'`);
  return m.get(key);
}

function asInt(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new GenerateError(`${where}: expected an integer`);
  }
  return v;
}

/** Python `dict(omap)`-style access: an omap becomes a Map of name -> body. */
function omapEntries(v: unknown, where: string): [string, unknown][] {
  const m = asMap(v, where);
  const out: [string, unknown][] = [];
  for (const [k, body] of m) {
    if (typeof k === "string") {
      out.push([k, body]);
    } else if (typeof k === "boolean") {
      // YAML 1.1 reads an unquoted NO/YES key as a boolean (the actions section
      // has a `NO:` entry). PyYAML does the same and make_dungeon.py then
      // formats it with str(), so the C enum constant is literally
      // "False"/"True". Reproduce that so indices and names match upstream.
      out.push([k ? "True" : "False", body]);
    } else {
      throw new GenerateError(`${where}: non-string key ${JSON.stringify(k)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Constants taken from templates/dungeon.h.tpl
// ---------------------------------------------------------------------------

const SILENT = -1;

const COND_NAMES: readonly [string, number][] = [
  ["LIT", 0],
  ["OILY", 1],
  ["FLUID", 2],
  ["NOARRR", 3],
  ["NOBACK", 4],
  ["ABOVE", 5],
  ["DEEP", 6],
  ["FOREST", 7],
  ["FORCED", 8],
  ["ALLDIFFERENT", 9],
  ["ALLALIKE", 10],
  ["HBASE", 11],
  ["HCAVE", 12],
  ["HBIRD", 13],
  ["HSNAKE", 14],
  ["HMAZE", 15],
  ["HDARK", 16],
  ["HWITT", 17],
  ["HCLIFF", 18],
  ["HWOODS", 19],
  ["HOGRE", 20],
  ["HJADE", 21],
];
const COND_BIT = new Map<string, number>(COND_NAMES);

// enum condtype_t / enum desttype_t
const COND_GOTO = 0;
const COND_PCT = 1;
const COND_CARRY = 2;
const COND_WITH = 3;
const COND_NOT = 4;
const DEST_GOTO = 0;
const DEST_SPECIAL = 1;
const DEST_SPEAK = 2;

// ---------------------------------------------------------------------------
// Generated data model
// ---------------------------------------------------------------------------

export interface TravelOpData {
  motion: number;
  condtype: number;
  condarg1: number;
  condarg2: number;
  desttype: number;
  destval: number;
  nodwarves: boolean;
  stop: boolean;
}

interface Dungeon {
  arbitraryMessages: (string | null)[];
  classes: { threshold: number; message: string | null }[];
  turnThresholds: { threshold: number; pointLoss: number; message: string }[];
  locations: { small: string | null; big: string | null; sound: number; loud: boolean }[];
  objects: {
    words: string[];
    inventory: string | null;
    plac: number;
    fixd: number;
    isTreasure: boolean;
    descriptions: (string | null)[] | null;
    sounds: (string | null)[] | null;
    texts: (string | null)[] | null;
    changes: (string | null)[] | null;
  }[];
  obituaries: { query: string; yesResponse: string }[];
  hints: { number: number; turns: number; penalty: number; question: string; hint: string }[];
  conditions: number[];
  motions: { words: string[] }[];
  actions: { words: string[]; message: string | null; noaction: boolean }[];
  ignore: string;
  dwarflocs: number[];
  travel: TravelOpData[];
  tkey: number[];
  /** name -> numeric value for every C #define / enum constant. */
  constants: [string, number][];
}

// ---------------------------------------------------------------------------
// Table builders (one per make_dungeon.py function)
// ---------------------------------------------------------------------------

function stringGroup(v: unknown, where: string): string[] {
  // C: get_string_group. A !!null word list becomes an empty group.
  if (v === null || v === undefined) return [];
  return asList(v, where).map((s, i) => reqStrOrNull(s, `${where}[${i}]`));
}

function reqStrOrNull(v: unknown, where: string): string {
  return reqStr(v, where);
}

function messageList(v: unknown, where: string): (string | null)[] | null {
  if (v === null || v === undefined) return null;
  return asList(v, where).map((s, i) => optStr(s, `${where}[${i}]`));
}

// C: get_refs (as constants, in order)
function enumConstants(names: string[], out: Map<string, number>, kind: string): void {
  names.forEach((name, i) => defineConstant(out, name, i, kind));
}

function defineConstant(out: Map<string, number>, name: string, value: number, kind: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new GenerateError(`${kind}: '${name}' is not a valid identifier`);
  }
  if (out.has(name)) throw new GenerateError(`${kind}: duplicate constant name '${name}'`);
  out.set(name, value);
}

function indexOfName(names: string[], name: unknown, where: string): number {
  if (typeof name !== "string") throw new GenerateError(`${where}: expected a name`);
  const idx = names.indexOf(name);
  if (idx < 0) throw new GenerateError(`${where}: unknown name '${name}'`);
  return idx;
}

/** C: bigdump is only formatting; the tkey values are emitted as a number list. */

/** C: buildtravel */
function buildtravel(
  locs: [string, unknown][],
  objs: [string, unknown][],
  motionEntries: [string, unknown][],
  names: { loc: string[]; msg: string[]; obj: string[]; motion: string[] },
): { travel: TravelOpData[]; tkey: number[] } {
  if (locs.length > 300) throw new GenerateError("buildtravel: more than 300 locations");
  if (objs.length > 100) throw new GenerateError("buildtravel: more than 100 objects");

  // verbmap: uppercase word -> motion index (later motions override earlier)
  const verbmap = new Map<string, number>();
  motionEntries.forEach(([, body], i) => {
    const words = asMap(body, `motions[${i}]`).get("words");
    if (words === null || words === undefined) return; // Python: TypeError, ignored
    for (const w of asList(words, `motions[${i}].words`)) {
      verbmap.set(String(w).toUpperCase(), i);
    }
  });

  const dencode = (action: unknown[], name: string): number => {
    const kind = action[0];
    if (kind === "goto") {
      return indexOfName(names.loc, action[1], `unknown location in goto clause of ${name}`);
    }
    if (kind === "special") {
      return 300 + asInt(action[1], `special clause of ${name}`);
    }
    if (kind === "speak") {
      return 500 + indexOfName(names.msg, action[1], `unknown message in speak clause of ${name}`);
    }
    throw new GenerateError(`unknown action kind '${String(kind)}' in ${name}`);
  };

  const cencode = (cond: unknown, name: string): number => {
    if (cond === null || cond === undefined) return 0;
    const c = asList(cond, `cond of ${name}`);
    if (c.length === 1 && c[0] === "nodwarves") return 100;
    if (c[0] === "pct") return asInt(c[1], `pct clause of ${name}`);
    if (c[0] === "carry") {
      return 100 + indexOfName(names.obj, c[1], `unknown object in carry clause of ${name}`);
    }
    if (c[0] === "with") {
      return 200 + indexOfName(names.obj, c[1], `unknown object in with clause of ${name}`);
    }
    if (c[0] === "not") {
      const obj = indexOfName(names.obj, c[1], `unknown object in not clause of ${name}`);
      const body = asMap(objs[obj]![1], `object ${c[1]}`);
      const states = body.get("states");
      const stateList = Array.isArray(states) ? states : [];
      let state = -1;
      if (typeof c[2] === "number") {
        state = c[2];
      } else if (stateList.includes(c[2])) {
        state = stateList.indexOf(c[2]);
      } else {
        const descs = body.get("descriptions");
        if (Array.isArray(descs)) {
          for (let i = 0; i < descs.length; i++) {
            const d = descs[i];
            if (Array.isArray(d) && d[0] === c[2]) {
              state = i;
              break;
            }
          }
        }
        if (state < 0) {
          throw new GenerateError(`unmatched state symbol ${String(c[2])} in not clause of ${name}`);
        }
      }
      return 300 + obj + 100 * state;
    }
    throw new GenerateError(`unknown condition '${String(c[0])}' in ${name}`);
  };

  // Stage 1: compile the YAML into the Section 3 form of the old data file.
  const ltravel: (number)[][] = [];
  locs.forEach(([name, body], i) => {
    const lm = asMap(body, `locations.${name}`);
    if (!lm.has("travel")) return;
    for (const r of asList(lm.get("travel"), `locations.${name}.travel`)) {
      const rule = asMap(r, `locations.${name}.travel rule`);
      const action = asList(field(rule, "action", `locations.${name}.travel rule`), `action of ${name}`);
      const verbs = asList(field(rule, "verbs", `locations.${name}.travel rule`), `verbs of ${name}`);
      const dest = dencode(action, name) + 1000 * cencode(rule.get("cond"), name);
      const tt: number[] = [i, dest];
      for (const e of verbs) {
        const vi = verbmap.get(String(e));
        if (vi === undefined) throw new GenerateError(`unknown verb '${String(e)}' in travel of ${name}`);
        // Python emits the motion *name*, which the C enum maps back to its index.
        tt.push(vi);
      }
      if (verbs.length === 0) tt.push(1); // Magic dummy entry for null rules
      ltravel.push(tt);
    }
  });

  // Stage 2: unpack into the travel array.
  const decodeCondition = (cond: number): [number, number, number] => {
    if (cond === 0) return [COND_GOTO, 0, 0];
    if (cond < 100) return [COND_PCT, cond, 0];
    if (cond === 100) return [COND_GOTO, 100, 0];
    if (cond <= 200) return [COND_CARRY, cond - 100, 0];
    if (cond <= 300) return [COND_WITH, cond - 200, 0];
    return [COND_NOT, cond % 100, Math.floor((cond - 300) / 100)];
  };

  const decodeDestination = (dest: number): [number, number] => {
    if (dest <= 300) return [DEST_GOTO, dest];
    if (dest > 500) return [DEST_SPEAK, dest - 500];
    return [DEST_SPECIAL, dest - 300];
  };

  const travel: TravelOpData[] = [
    {
      motion: 0,
      condtype: 0,
      condarg1: 0,
      condarg2: 0,
      desttype: 0,
      destval: 0,
      nodwarves: false,
      stop: false,
    },
  ];
  const tkey: number[] = [0];
  let oldloc = 0;

  for (const entry of ltravel) {
    const rule = entry.slice();
    const loc = rule.shift()!;
    const newloc = rule.shift()!;
    if (loc !== oldloc) {
      tkey.push(travel.length);
      oldloc = loc;
    } else {
      const last = travel[travel.length - 1]!;
      last.stop = !last.stop;
    }
    while (rule.length > 0) {
      const cond = Math.floor(newloc / 1000);
      const nodwarves = cond === 100;
      const [condtype, condarg1, condarg2] = decodeCondition(cond);
      const [desttype, destval] = decodeDestination(newloc % 1000);
      travel.push({
        motion: rule.shift()!,
        condtype,
        condarg1,
        condarg2,
        desttype,
        destval,
        nodwarves,
        stop: false,
      });
    }
    travel[travel.length - 1]!.stop = true;
  }
  return { travel, tkey };
}

/** Builds the whole Dungeon model from the parsed YAML top-level mapping. */
function buildDungeon(db: YMap): Dungeon {
  const section = (name: string) => field(db, name, "adventure.yaml");

  const locEntries = omapEntries(section("locations"), "locations");
  const msgEntries = omapEntries(section("arbitrary_messages"), "arbitrary_messages");
  const objEntries = omapEntries(section("objects"), "objects");
  const motionEntries = omapEntries(section("motions"), "motions");
  const actionEntries = omapEntries(section("actions"), "actions");

  const locnames = locEntries.map((e) => e[0]);
  const msgnames = msgEntries.map((e) => e[0]);
  const objnames = objEntries.map((e) => e[0]);
  const motionnames = motionEntries.map((e) => e[0]);
  const actionnames = actionEntries.map((e) => e[0]);

  // C: get_arbitrary_messages
  const arbitraryMessages = msgEntries.map(([n, m]) => optStr(m, `arbitrary_messages.${n}`));

  // C: get_class_messages
  const classes = asList(section("classes"), "classes").map((c, i) => {
    const m = asMap(c, `classes[${i}]`);
    return {
      threshold: asInt(field(m, "threshold", `classes[${i}]`), `classes[${i}].threshold`),
      message: optStr(field(m, "message", `classes[${i}]`), `classes[${i}].message`),
    };
  });

  // C: get_turn_thresholds
  const turnThresholds = asList(section("turn_thresholds"), "turn_thresholds").map((c, i) => {
    const w = `turn_thresholds[${i}]`;
    const m = asMap(c, w);
    return {
      threshold: asInt(field(m, "threshold", w), `${w}.threshold`),
      pointLoss: asInt(field(m, "point_loss", w), `${w}.point_loss`),
      message: reqStr(field(m, "message", w), `${w}.message`),
    };
  });

  // C: get_locations
  const locations = locEntries.map(([name, body]) => {
    const w = `locations.${name}`;
    const m = asMap(body, w);
    const d = asMap(field(m, "description", w), `${w}.description`);
    const sound = m.has("sound") && m.get("sound") !== null && m.get("sound") !== undefined
      ? m.get("sound")
      : "SILENT";
    return {
      small: optStr(field(d, "short", `${w}.description`), `${w}.description.short`),
      big: optStr(field(d, "long", `${w}.description`), `${w}.description.long`),
      sound: sound === "SILENT" ? SILENT : indexOfName(msgnames, sound, `${w}.sound`),
      loud: Boolean(m.get("loud")),
    };
  });

  // C: get_objects (and the state #defines)
  const stateDefines: [string, number][] = [];
  let maxState = 0;
  const objects = objEntries.map(([name, body]) => {
    const w = `objects.${name}`;
    const attr = asMap(body, w);
    const words = attr.has("words") ? stringGroup(attr.get("words"), `${w}.words`) : [];
    const inventory = optStr(field(attr, "inventory", w), `${w}.inventory`);
    const descRaw = field(attr, "descriptions", w);
    const descriptions = messageList(descRaw, `${w}.descriptions`);
    if (descriptions !== null) {
      const states = attr.get("states");
      if (Array.isArray(states)) {
        states.forEach((label, n) => {
          stateDefines.push([String(label), n]);
          maxState = Math.max(maxState, n);
        });
      }
    }
    const sounds = messageList(attr.get("sounds"), `${w}.sounds`);
    const texts = messageList(attr.get("texts"), `${w}.texts`);
    const changes = messageList(attr.get("changes"), `${w}.changes`);

    const immovable = Boolean(attr.get("immovable") ?? false);
    let locs: unknown = attr.has("locations") ? attr.get("locations") : ["LOC_NOWHERE", "LOC_NOWHERE"];
    if (typeof locs === "string") locs = [locs, immovable ? -1 : 0];
    const pair = asList(locs, `${w}.locations`);
    if (pair.length < 2) throw new GenerateError(`${w}.locations: expected a name or two entries`);
    const place = (v: unknown, what: string): number =>
      typeof v === "number" ? v : indexOfName(locnames, v, `${w}.locations ${what}`);
    return {
      words,
      inventory,
      plac: place(pair[0], "plac"),
      fixd: place(pair[1], "fixd"),
      isTreasure: Boolean(attr.get("treasure")),
      descriptions,
      sounds,
      texts,
      changes,
    };
  });

  // C: get_obituaries
  const obituaries = asList(section("obituaries"), "obituaries").map((o, i) => {
    const w = `obituaries[${i}]`;
    const m = asMap(o, w);
    return {
      query: reqStr(field(m, "query", w), `${w}.query`),
      yesResponse: reqStr(field(m, "yes_response", w), `${w}.yes_response`),
    };
  });

  // C: get_hints
  const hintsRaw = asList(section("hints"), "hints");
  const hints = hintsRaw.map((member, i) => {
    const w = `hints[${i}]`;
    const item = asMap(field(asMap(member, w), "hint", w), `${w}.hint`);
    return {
      number: asInt(field(item, "number", w), `${w}.number`),
      penalty: asInt(field(item, "penalty", w), `${w}.penalty`),
      turns: asInt(field(item, "turns", w), `${w}.turns`),
      question: reqStr(field(item, "question", w), `${w}.question`),
      hint: reqStr(field(item, "hint", w), `${w}.hint`),
    };
  });

  // C: get_condbits
  const conditions = locEntries.map(([name, body]) => {
    const w = `locations.${name}`;
    const m = asMap(body, w);
    const flags = asMap(field(m, "conditions", w), `${w}.conditions`);
    let bits = 0;
    for (const [flag, on] of flags) {
      if (!on) continue;
      const bit = COND_BIT.get(`${String(flag)}`);
      if (bit === undefined) throw new GenerateError(`${w}.conditions: unknown flag '${String(flag)}'`);
      bits |= 1 << bit;
    }
    const hl = m.get("hints");
    if (hl !== null && hl !== undefined) {
      for (const h of asList(hl, `${w}.hints`)) {
        const hm = asMap(h, `${w}.hints entry`);
        const hn = `H${String(field(hm, "name", `${w}.hints entry`))}`;
        const bit = COND_BIT.get(hn);
        if (bit === undefined) throw new GenerateError(`${w}.hints: unknown hint name '${hn}'`);
        bits |= 1 << bit;
      }
    }
    return bits;
  });

  // C: get_motions / get_actions (including the `ignore` string)
  let ignore = "";
  const addIgnore = (contents: YMap, words: string[]): void => {
    if (contents.has("oldstyle") ? !contents.get("oldstyle") : false) {
      for (const word of words) if (word.length === 1) ignore += word.toUpperCase();
    }
  };
  const motions = motionEntries.map(([name, body]) => {
    const w = `motions.${name}`;
    const m = asMap(body, w);
    const words = stringGroup(field(m, "words", w), `${w}.words`);
    addIgnore(m, words);
    return { words };
  });
  const actions = actionEntries.map(([name, body]) => {
    const w = `actions.${name}`;
    const m = asMap(body, w);
    const words = stringGroup(field(m, "words", w), `${w}.words`);
    const message = optStr(field(m, "message", w), `${w}.message`);
    const noaction = m.has("noaction") && m.get("noaction") !== null && m.get("noaction") !== undefined;
    addIgnore(m, words);
    return { words, message, noaction };
  });

  // dwarflocs
  const dwarflocs = asList(section("dwarflocs"), "dwarflocs").map((n, i) =>
    indexOfName(locnames, n, `dwarflocs[${i}]`),
  );

  // C: buildtravel
  const { travel, tkey } = buildtravel(locEntries, objEntries, motionEntries, {
    loc: locnames,
    msg: msgnames,
    obj: objnames,
    motion: motionnames,
  });

  // 0-origin index of the bird's last song.
  const bird = objEntries.find(([n]) => n === "BIRD");
  if (!bird) throw new GenerateError("objects: BIRD is missing");
  const birdSounds = asMap(bird[1], "objects.BIRD").get("sounds");
  const birdEndstate = asList(birdSounds, "objects.BIRD.sounds").length - 1;

  // Constants (the #defines and enums of dungeon.h)
  const consts = new Map<string, number>();
  defineConstant(consts, "SILENT", SILENT, "dungeon.h");
  for (const [n, v] of COND_NAMES) defineConstant(consts, `COND_${n}`, v, "dungeon.h");
  defineConstant(consts, "NDWARVES", dwarflocs.length, "dungeon.h");
  defineConstant(consts, "NLOCATIONS", locEntries.length, "dungeon.h");
  defineConstant(consts, "NOBJECTS", objEntries.length, "dungeon.h");
  defineConstant(consts, "NHINTS", hints.length, "dungeon.h");
  defineConstant(consts, "NCLASSES", classes.length, "dungeon.h");
  defineConstant(consts, "NDEATHS", obituaries.length, "dungeon.h");
  defineConstant(consts, "NTHRESHOLDS", turnThresholds.length, "dungeon.h");
  defineConstant(consts, "NMOTIONS", motions.length, "dungeon.h");
  defineConstant(consts, "NACTIONS", actions.length, "dungeon.h");
  defineConstant(consts, "NTRAVEL", travel.length, "dungeon.h");
  defineConstant(consts, "NKEYS", tkey.length, "dungeon.h");
  defineConstant(consts, "BIRD_ENDSTATE", birdEndstate, "dungeon.h");
  enumConstants(msgnames, consts, "arbitrary_messages");
  enumConstants(locnames, consts, "locations");
  enumConstants(objnames, consts, "objects");
  enumConstants(motionnames, consts, "motions");
  enumConstants(actionnames, consts, "actions");
  for (const [label, n] of stateDefines) defineConstant(consts, label, n, "object states");
  defineConstant(consts, "MAX_STATE", maxState, "dungeon.h");

  return {
    arbitraryMessages,
    classes,
    turnThresholds,
    locations,
    objects,
    obituaries,
    hints,
    conditions,
    motions,
    actions,
    ignore,
    dwarflocs,
    travel,
    tkey,
    constants: [...consts],
  };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const LICENSE_BLOCK = `SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
SPDX-License-Identifier: BSD-2-Clause

BSD 2-Clause License. Redistribution and use in source and binary forms, with
or without modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE. See
original/COPYING for the full text.`;

function header(description: string): string {
  return `/*
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * ${description}
 * Generated from ${YAML_RELATIVE_PATH} by scripts/generate-data.ts.
 * Regenerate with: ${REGEN_COMMAND}
 *
 * ${LICENSE_BLOCK.split("\n").join("\n * ").replace(/ +\n/g, "\n")}
 */
`;
}

/** One JSON literal per line, so diffs and reviews stay readable. */
function arrayLiteral(items: unknown[]): string {
  if (items.length === 0) return "[]";
  return `[\n${items.map((x) => `  ${JSON.stringify(x)},`).join("\n")}\n]`;
}

function numberRows(values: number[], perRow: number): string {
  const rows: string[] = [];
  for (let i = 0; i < values.length; i += perRow) {
    rows.push(`  ${values.slice(i, i + perRow).join(", ")},`);
  }
  return `[\n${rows.join("\n")}\n]`;
}

export interface GeneratedFiles {
  "constants.ts": string;
  "dungeon.ts": string;
  "travel.ts": string;
}

function emit(d: Dungeon): GeneratedFiles {
  const constants =
    header("Flat numeric constants for every C #define / enum constant in dungeon.h.") +
    "\n" +
    d.constants.map(([n, v]) => `export const ${n} = ${v};`).join("\n") +
    "\n";

  const dungeon =
    header("Game_Data tables, same shapes and indices as the C tables in dungeon.c.") +
    `
export interface ObjectDef {
  readonly words: readonly string[];
  readonly inventory: string | null;
  readonly plac: number;
  readonly fixd: number;
  readonly isTreasure: boolean;
  readonly descriptions: readonly (string | null)[] | null;
  readonly sounds: readonly (string | null)[] | null;
  readonly texts: readonly (string | null)[] | null;
  readonly changes: readonly (string | null)[] | null;
}

export interface LocationDef {
  readonly small: string | null;
  readonly big: string | null;
  readonly sound: number;
  readonly loud: boolean;
}

export const ARBITRARY_MESSAGES: readonly (string | null)[] = ${arrayLiteral(d.arbitraryMessages)};

export const CLASSES: readonly { readonly threshold: number; readonly message: string | null }[] = ${arrayLiteral(d.classes)};

export const TURN_THRESHOLDS: readonly {
  readonly threshold: number;
  readonly pointLoss: number;
  readonly message: string;
}[] = ${arrayLiteral(d.turnThresholds)};

export const LOCATIONS: readonly LocationDef[] = ${arrayLiteral(d.locations)};

export const OBJECTS: readonly ObjectDef[] = ${arrayLiteral(d.objects)};

export const OBITUARIES: readonly { readonly query: string; readonly yesResponse: string }[] = ${arrayLiteral(d.obituaries)};

export const HINTS: readonly {
  readonly number: number;
  readonly turns: number;
  readonly penalty: number;
  readonly question: string;
  readonly hint: string;
}[] = ${arrayLiteral(d.hints)};

/** Base condition bits from the YAML; the FORCED bit is added by the engine. */
export const CONDITIONS: readonly number[] = ${numberRows(d.conditions, 10)};

export const MOTIONS: readonly { readonly words: readonly string[] }[] = ${arrayLiteral(d.motions)};

export const ACTIONS: readonly {
  readonly words: readonly string[];
  readonly message: string | null;
  readonly noaction: boolean;
}[] = ${arrayLiteral(d.actions)};

export const IGNORE: string = ${JSON.stringify(d.ignore)};

export const DWARFLOCS: readonly number[] = ${JSON.stringify(d.dwarflocs)};
`;

  const travel =
    header("The flattened travel table (TRAVEL) and its per-location index (TKEY).") +
    `
export interface TravelOp {
  readonly motion: number;
  readonly condtype: number;
  readonly condarg1: number;
  readonly condarg2: number;
  readonly desttype: number;
  readonly destval: number;
  readonly nodwarves: boolean;
  readonly stop: boolean;
}

export const TRAVEL: readonly TravelOp[] = ${arrayLiteral(d.travel)};

export const TKEY: readonly number[] = ${numberRows(d.tkey, 10)};
`;

  return { "constants.ts": constants, "dungeon.ts": dungeon, "travel.ts": travel };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Validates the YAML bytes and returns the text of every generated file.
 * Throws GenerateError on any problem. Performs no file system access.
 */
export function generate(yamlBytes: Uint8Array): GeneratedFiles {
  for (let i = 0; i < yamlBytes.length; i++) {
    if ((yamlBytes[i] ?? 0) > 0x7f) {
      throw new GenerateError(`non-ASCII byte 0x${(yamlBytes[i] ?? 0).toString(16)} at offset ${i}`);
    }
  }
  const text = Buffer.from(yamlBytes).toString("latin1");
  const doc = parseDocument(text, { version: "1.1", merge: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new GenerateError(`invalid YAML: ${doc.errors[0]!.message}`);
  }
  if (doc.warnings.length > 0) {
    throw new GenerateError(`YAML warning: ${doc.warnings[0]!.message}`);
  }
  const db = doc.toJS({ mapAsMap: true }) as unknown;
  if (!isMap(db)) throw new GenerateError("top level of the YAML is not a mapping");
  const missing = REQUIRED_SECTIONS.filter((s) => !db.has(s));
  if (missing.length > 0) {
    throw new GenerateError(`missing required section(s): ${missing.join(", ")}`);
  }
  return emit(buildDungeon(db));
}

/**
 * Reads the YAML under `rootDir`, generates the files and writes them to
 * `outDir`. Everything is written to temporary names first and renamed only
 * after every file is complete, so a failure leaves previous output intact.
 */
export function run(rootDir: string, outDir: string = join(rootDir, "src", "data")): string[] {
  const yamlPath = join(rootDir, YAML_RELATIVE_PATH);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(yamlPath);
  } catch (err) {
    throw new GenerateError(`cannot read ${yamlPath}: ${(err as Error).message}`);
  }
  let files: GeneratedFiles;
  try {
    files = generate(bytes);
  } catch (err) {
    if (err instanceof GenerateError) throw new GenerateError(`${yamlPath}: ${err.message}`);
    throw err;
  }
  mkdirSync(outDir, { recursive: true });
  const names = Object.keys(files) as (keyof GeneratedFiles)[];
  const temps: string[] = [];
  try {
    for (const n of names) {
      const tmp = join(outDir, `${n}.tmp-${process.pid}`);
      temps.push(tmp);
      writeFileSync(tmp, files[n], { encoding: "utf8" });
    }
    for (const n of names) renameSync(join(outDir, `${n}.tmp-${process.pid}`), join(outDir, n));
  } catch (err) {
    for (const t of temps) if (existsSync(t)) rmSync(t, { force: true });
    throw err;
  }
  return names.map((n) => join(outDir, n));
}

function main(): void {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const written = run(rootDir);
    for (const f of written) console.log(`wrote ${f}`);
  } catch (err) {
    console.error(`generate-data: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
