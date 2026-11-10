/*
 * Static layering and scan tests for the voice-input spec (task 13.4).
 *
 * Reads source text only; never imports the code under test.
 * Requirements: 3.3, 10.15, 14.13, 18.9, 18.10, 19.1, 19.4, 19.6, 19.9.
 *
 * Open Adventure is BSD-2-Clause, Copyright Eric S. Raymond.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const VOICE_DIR = join(SRC, "voice");
const HAUNT_DIR = join(SRC, "haunt");
const UI_DIR = join(SRC, "ui");
const UI_DOM_DIR = join(UI_DIR, "dom");
const ENGINE_DIR = join(SRC, "engine");
const PARSER_DIR = join(SRC, "parser");
const SHARED_DIR = join(SRC, "shared");
const DATA_DIR = join(SRC, "data");
const MAIN_TS = join(SRC, "main.ts");
const GAME_CONTROLLER = join(UI_DIR, "game-controller.ts");
const ADAPTER = join(VOICE_DIR, "web-speech-adapter.ts");
const MATCHER_MODULE = join(VOICE_DIR, "magic-match.ts");

const rel = (p: string): string => relative(ROOT, p).split(sep).join("/");
const read = (p: string): string => readFileSync(p, "utf8");

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/* Lexer: removes comments; `code` blanks string contents, `withStrings` keeps them. */
function strip(src: string): { code: string; withStrings: string } {
  let code = "";
  let ws = "";
  let i = 0;
  let lastSig = "";
  const n = src.length;
  const both = (c: string): void => {
    code += c;
    ws += c;
  };
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") both("\n");
        i++;
      }
      i += 2;
      both(" ");
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      both(c);
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < n) {
          ws += src[i]! + src[i + 1]!;
          code += "  ";
          i += 2;
          continue;
        }
        ws += src[i]!;
        code += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      both(c);
      i++;
      lastSig = c;
      continue;
    }
    if (c === "/" && (lastSig === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSig))) {
      both("/");
      i++;
      let inClass = false;
      while (i < n && (src[i] !== "/" || inClass) && src[i] !== "\n") {
        if (src[i] === "\\") {
          ws += src[i]! + (src[i + 1] ?? "");
          code += "  ";
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        ws += src[i]!;
        code += " ";
        i++;
      }
      both("/");
      i++;
      lastSig = "/";
      continue;
    }
    both(c);
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return { code, withStrings: ws };
}

interface Ref {
  spec: string;
  dynamic: boolean;
}

function importRefs(text: string): Ref[] {
  const ws = strip(text).withStrings;
  const refs: Ref[] = [];
  const statics = [
    /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of statics) for (const m of ws.matchAll(re)) refs.push({ spec: m[1]!, dynamic: false });
  for (const m of ws.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) refs.push({ spec: m[1]!, dynamic: true });
  return refs;
}

/** Absolute path of a relative specifier without extension, or undefined for bare specifiers. */
function resolveSpec(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  return resolve(dirname(from), spec).replace(/\.(?:[cm]?[jt]s)$/, "");
}

const inside = (t: string, dir: string): boolean => t === dir || t.startsWith(dir + sep);

/** Imports (any form) of `text` that land in one of `dirs`. */
function importsInto(file: string, text: string, dirs: string[]): string[] {
  const bad: string[] = [];
  for (const { spec } of importRefs(text)) {
    const t = resolveSpec(file, spec);
    if (t !== undefined && dirs.some((d) => inside(t, d))) bad.push(`${rel(file)} -> ${spec}`);
  }
  return bad;
}

/** Imports of `text` that leave `allowedSelf` and `allowedOthers` (relative imports only). */
function importsOutside(file: string, text: string, allowed: string[]): string[] {
  const bad: string[] = [];
  for (const { spec } of importRefs(text)) {
    const t = resolveSpec(file, spec);
    if (t !== undefined && !allowed.some((d) => inside(t, d))) bad.push(`${rel(file)} -> ${spec}`);
  }
  return bad;
}

/** Identifier/pattern hits in comment-free text (strings kept), as file:line. */
function scan(file: string, text: string, rules: ReadonlyArray<readonly [RegExp, string]>, useCode = false): string[] {
  const s = strip(text);
  const lines = (useCode ? s.code : s.withStrings).split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    for (const [re, why] of rules) if (re.test(line)) hits.push(`${rel(file)}:${i + 1} ${why}: ${line.trim()}`);
  });
  return hits;
}

/** Resolve an extension-less target to an existing source file. */
function toFile(target: string, exists: (p: string) => boolean): string | undefined {
  for (const c of [`${target}.ts`, join(target, "index.ts")]) if (exists(c)) return c;
  return undefined;
}

/** Files reachable from `roots` through static imports only (dynamic import() is not followed). */
function staticClosure(
  roots: string[],
  readText: (f: string) => string = read,
  exists: (p: string) => boolean = existsSync,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    let text: string;
    try {
      text = readText(f);
    } catch {
      continue;
    }
    for (const { spec, dynamic } of importRefs(text)) {
      if (dynamic) continue;
      const t = resolveSpec(f, spec);
      const file = t === undefined ? undefined : toFile(t, exists);
      if (file !== undefined) stack.push(file);
    }
  }
  return seen;
}

const VOICE_FILES = tsFiles(VOICE_DIR);
const HAUNT_FILES = tsFiles(HAUNT_DIR);
const ALL_SRC = tsFiles(SRC);

/* ------------------------------------------------------------------ */

const SPEECH_RECOGNITION_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bSpeechRecognition\w*/, "SpeechRecognition*"],
  [/\bwebkitSpeechRecognition\b/, "webkitSpeechRecognition"],
];
const OUTPUT_AND_CAPTURE_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bspeechSynthesis\b/, "speechSynthesis"],
  [/\bSpeechSynthesisUtterance\b/, "SpeechSynthesisUtterance"],
  [/\bgetUserMedia\b/, "getUserMedia"],
  [/\bMediaRecorder\b/, "MediaRecorder"],
  [/\bcreateMediaStreamSource\b/, "createMediaStreamSource"],
];
const VOICE_INPUT_AUDIO_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAudioContext\b/, "AudioContext"],
  [/\bwebkitAudioContext\b/, "webkitAudioContext"],
  [/\bMediaStream\w*/, "MediaStream*"],
  [/\bmediaDevices\b/, "mediaDevices"],
  [/\bAudioWorklet\w*/, "AudioWorklet*"],
  [/\bScriptProcessor\w*/, "ScriptProcessor*"],
];
const STORAGE_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/i, "indexedDB"],
  [/\bIDBFactory\b/, "IDBFactory"],
  [/\bdocument\s*\.\s*cookie\b/, "document.cookie"],
  [/\bcookieStore\b/, "cookieStore"],
  [/\bKeyValueStore\b/, "KeyValueStore"],
  [/\bcaches\s*\.\s*(?:open|put|match)\b/, "Cache API"],
];
const NETWORK_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch("],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "sendBeacon"],
  [/\bnew\s+(?:Shared)?Worker\b/, "Worker"],
];
const DIALOG_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![.\w$])alert\s*\(/, "alert("],
  [/\bwindow\s*\.\s*alert\b/, "window.alert"],
  [/(?<![.\w$])confirm\s*\(/, "confirm("],
  [/\bwindow\s*\.\s*confirm\b/, "window.confirm"],
  [/(?<![.\w$])prompt\s*\(/, "prompt("],
  [/\bwindow\s*\.\s*prompt\b/, "window.prompt"],
  [/<dialog/i, "<dialog"],
  [/["'`]dialog["'`]/, "createElement('dialog')"],
];
const SECOND_META_LIST_RULE: ReadonlyArray<readonly [RegExp, string]> = [
  [/["'`]\s*(?:quit|save|resume|seed|waste)\s*["'`]/i, "Meta word literal"],
];

/** Voice/haunt layer import rule: only own directory, src/shared, src/engine, src/data. */
function voiceHauntImportViolations(file: string, text: string): string[] {
  const own = file.startsWith(VOICE_DIR + sep) ? VOICE_DIR : HAUNT_DIR;
  const forbidden = importsInto(file, text, [UI_DIR, PARSER_DIR, MAIN_TS.replace(/\.ts$/, "")]);
  const other = own === VOICE_DIR ? HAUNT_DIR : VOICE_DIR;
  forbidden.push(...importsInto(file, text, [other]));
  forbidden.push(...importsOutside(file, text, [own, SHARED_DIR, ENGINE_DIR, DATA_DIR]));
  return [...new Set(forbidden)];
}

describe("voice layering: imports", () => {
  it("finds the voice and haunt sources", () => {
    expect(VOICE_FILES.length).toBeGreaterThan(8);
    expect(VOICE_FILES).toContain(ADAPTER);
    expect(HAUNT_FILES.length).toBeGreaterThan(0);
  });

  it("src/voice and src/haunt import nothing from src/ui, src/parser or each other, and otherwise only src/shared, src/engine and src/data", () => {
    const bad: string[] = [];
    for (const f of [...VOICE_FILES, ...HAUNT_FILES]) bad.push(...voiceHauntImportViolations(f, read(f)));
    expect(bad, `forbidden imports:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/engine imports nothing from src/voice or src/haunt", () => {
    const bad: string[] = [];
    for (const f of tsFiles(ENGINE_DIR)) bad.push(...importsInto(f, read(f), [VOICE_DIR, HAUNT_DIR]));
    expect(bad, `engine imports voice/haunt:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("the module exporting matchMagicWords is not statically reachable from src/parser, game-controller, src/engine or src/main.ts", () => {
    expect(read(MATCHER_MODULE)).toMatch(/export\s+function\s+matchMagicWords\b/);
    // Exactly one source module exports it.
    const exporters = ALL_SRC.filter((f) => /\bexport\s+(?:function|const)\s+matchMagicWords\b/.test(strip(read(f)).code));
    expect(exporters.map(rel)).toEqual([rel(MATCHER_MODULE)]);
    const roots = [...tsFiles(PARSER_DIR), GAME_CONTROLLER, ...tsFiles(ENGINE_DIR), MAIN_TS];
    const reach = staticClosure(roots);
    expect(reach.has(GAME_CONTROLLER)).toBe(true);
    expect(reach.has(MATCHER_MODULE), "matcher reachable through static imports").toBe(false);
    // Whole src/ui (not only game-controller) stays clear of the voice layer too.
    const uiReach = staticClosure(tsFiles(UI_DIR));
    expect(uiReach.has(MATCHER_MODULE)).toBe(false);
  });
});

describe("voice scans: identifiers", () => {
  it("SpeechRecognition* and webkitSpeechRecognition appear (outside comments and tests) only in web-speech-adapter.ts", () => {
    const hits: string[] = [];
    for (const f of ALL_SRC) if (f !== ADAPTER) hits.push(...scan(f, read(f), SPEECH_RECOGNITION_RULE));
    expect(hits, `identifier outside the adapter:\n  ${hits.join("\n  ")}`).toEqual([]);
    expect(scan(ADAPTER, read(ADAPTER), SPEECH_RECOGNITION_RULE).length).toBeGreaterThan(0);
  });

  it("speechSynthesis, SpeechSynthesisUtterance, getUserMedia, MediaRecorder and createMediaStreamSource appear nowhere under src/voice, src/ui, src/haunt or src/main.ts", () => {
    const hits: string[] = [];
    for (const f of [...VOICE_FILES, ...tsFiles(UI_DIR), ...HAUNT_FILES, MAIN_TS]) {
      hits.push(...scan(f, read(f), OUTPUT_AND_CAPTURE_RULE));
    }
    expect(hits, `speech output or capture API:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("src/voice has no audio capture, media stream or microphone node API", () => {
    const hits: string[] = [];
    for (const f of VOICE_FILES) hits.push(...scan(f, read(f), VOICE_INPUT_AUDIO_RULE));
    expect(hits, `audio API in voice input:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("src/voice uses no storage, cookie or KeyValueStore", () => {
    const hits: string[] = [];
    for (const f of VOICE_FILES) hits.push(...scan(f, read(f), STORAGE_RULE));
    expect(hits, `storage use in voice:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("src/voice adds no fetch, socket, beacon or Worker use", () => {
    const hits: string[] = [];
    for (const f of VOICE_FILES) hits.push(...scan(f, read(f), NETWORK_RULE));
    expect(hits, `network use in voice:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("no alert(, confirm(, prompt( or <dialog in the voice and DOM modules", () => {
    const hits: string[] = [];
    for (const f of [...VOICE_FILES, ...tsFiles(UI_DOM_DIR)]) hits.push(...scan(f, read(f), DIALOG_RULE));
    expect(hits, `blocking dialog use:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("voice files use isMetaWord from src/shared and define no second Meta list", () => {
    const finalResult = read(join(VOICE_DIR, "final-result.ts"));
    expect(finalResult).toMatch(/import\s*\{[^}]*\bisMetaWord\b[^}]*\}\s*from\s*["']\.\.\/shared\/meta-commands["']/);
    const hits: string[] = [];
    for (const f of VOICE_FILES) hits.push(...scan(f, read(f), SECOND_META_LIST_RULE));
    expect(hits, `Meta word literals in voice:\n  ${hits.join("\n  ")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Planted-fixture self-checks                                          */
/* ------------------------------------------------------------------ */

describe("voice layering: rule self-checks", () => {
  const voiceFile = join(VOICE_DIR, "x.ts");
  const hauntFile = join(HAUNT_DIR, "x.ts");

  it("voice/haunt import rule flags ui, parser, cross-layer and unknown-layer imports in any form", () => {
    expect(voiceHauntImportViolations(voiceFile, 'import { a } from "../ui/types";')).toHaveLength(1);
    expect(voiceHauntImportViolations(voiceFile, 'import type { a } from "../parser/x";')).toHaveLength(1);
    expect(voiceHauntImportViolations(voiceFile, 'await import("../ui/dom/x");')).toHaveLength(1);
    expect(voiceHauntImportViolations(voiceFile, 'import { a } from "../haunt/x";')).toHaveLength(1);
    expect(voiceHauntImportViolations(hauntFile, 'import { a } from "../voice/x";')).toHaveLength(1);
    expect(voiceHauntImportViolations(hauntFile, 'import "../main";')).toHaveLength(1);
    expect(voiceHauntImportViolations(voiceFile, 'import { a } from "../parse-api/x";')).toHaveLength(1);
    expect(voiceHauntImportViolations(voiceFile, 'import { a } from "../shared/limits";\nimport { b } from "./clean";')).toEqual([]);
    expect(voiceHauntImportViolations(hauntFile, 'import { a } from "../engine/index";\nimport { b } from "../shared/vocabulary";')).toEqual([]);
    expect(voiceHauntImportViolations(voiceFile, '// import { a } from "../ui/types";')).toEqual([]);
    expect(voiceHauntImportViolations(voiceFile, 'import react from "react";')).toEqual([]);
  });

  it("engine rule flags voice and haunt imports", () => {
    const engineFile = join(ENGINE_DIR, "x.ts");
    expect(importsInto(engineFile, 'import { a } from "../voice/magic-match";', [VOICE_DIR, HAUNT_DIR])).toHaveLength(1);
    expect(importsInto(engineFile, 'import type { a } from "../haunt/x";', [VOICE_DIR, HAUNT_DIR])).toHaveLength(1);
    expect(importsInto(engineFile, 'import { a } from "./types";', [VOICE_DIR, HAUNT_DIR])).toEqual([]);
  });

  it("identifier scans flag code but ignore comments", () => {
    expect(scan("x.ts", "const r = new SpeechRecognition();", SPEECH_RECOGNITION_RULE)).toHaveLength(1);
    expect(scan("x.ts", "const r = window.webkitSpeechRecognition;", SPEECH_RECOGNITION_RULE)).toHaveLength(1);
    expect(scan("x.ts", "type T = SpeechRecognitionLikeResult;", SPEECH_RECOGNITION_RULE)).toHaveLength(1);
    expect(scan("x.ts", "// SpeechRecognition\n/* webkitSpeechRecognition */\nconst a = 1;", SPEECH_RECOGNITION_RULE)).toEqual([]);
    for (const code of [
      "speechSynthesis.speak(u);",
      "new SpeechSynthesisUtterance('x');",
      "navigator.mediaDevices.getUserMedia({});",
      "new MediaRecorder(s);",
      "ctx.createMediaStreamSource(s);",
    ]) {
      expect(scan("x.ts", code, OUTPUT_AND_CAPTURE_RULE), code).toHaveLength(1);
    }
    expect(scan("x.ts", "// getUserMedia\nconst a = 1;", OUTPUT_AND_CAPTURE_RULE)).toEqual([]);
    expect(scan("x.ts", "const c = new AudioContext();", VOICE_INPUT_AUDIO_RULE)).toHaveLength(1);
  });

  it("storage, network, dialog and Meta-list scans flag planted code", () => {
    for (const code of [
      "localStorage.setItem('a','b');",
      "sessionStorage.getItem('a');",
      "indexedDB.open('x');",
      "document.cookie = 'a=b';",
      "let s: KeyValueStore;",
    ]) {
      expect(scan("x.ts", code, STORAGE_RULE), code).toHaveLength(1);
    }
    expect(scan("x.ts", "// localStorage\nconst a = 1;", STORAGE_RULE)).toEqual([]);
    expect(scan("x.ts", "await fetch('/x');", NETWORK_RULE)).toHaveLength(1);
    expect(scan("x.ts", "new Worker('w.js');", NETWORK_RULE)).toHaveLength(1);
    expect(scan("x.ts", "alert('x');", DIALOG_RULE)).toHaveLength(1);
    expect(scan("x.ts", "if (window.confirm('x')) {}", DIALOG_RULE).length).toBeGreaterThanOrEqual(1);
    expect(scan("x.ts", "const h = '<dialog open>';", DIALOG_RULE)).toHaveLength(1);
    expect(scan("x.ts", "el.confirmButton(); obj.alert(1);", DIALOG_RULE)).toEqual([]);
    expect(scan("x.ts", "const META = ['quit', 'save'];", SECOND_META_LIST_RULE)).toHaveLength(1);
    expect(scan("x.ts", "const a = 'quitting time';", SECOND_META_LIST_RULE)).toEqual([]);
  });

  it("the closure walk follows static imports (including type and re-exports) and skips dynamic ones", () => {
    const fake: Record<string, string> = {
      [join(SRC, "parser", "a.ts")]: 'import { b } from "../ui/b";',
      [join(SRC, "ui", "b.ts")]: 'export { m } from "../voice/magic-match";',
      [join(SRC, "main.ts")]: 'const x = await import("./voice/magic-match");',
    };
    const reader = (f: string): string => {
      const t = fake[f];
      if (t === undefined) throw new Error("missing");
      return t;
    };
    const exists = (p: string): boolean => p in fake || p === MATCHER_MODULE;
    const reachStatic = staticClosure([join(SRC, "parser", "a.ts")], reader, exists);
    expect(reachStatic.has(join(SRC, "ui", "b.ts"))).toBe(true);
    expect(reachStatic.has(MATCHER_MODULE)).toBe(true);
    const dynamicOnly = staticClosure([join(SRC, "main.ts")], reader, exists);
    expect(dynamicOnly.has(MATCHER_MODULE)).toBe(false);
    // Direct planted static re-export is seen by importRefs.
    expect(importRefs('export { m } from "../voice/magic-match";')).toEqual([{ spec: "../voice/magic-match", dynamic: false }]);
    expect(importRefs('import type { m } from "../voice/magic-match";')).toEqual([{ spec: "../voice/magic-match", dynamic: false }]);
    expect(importRefs('await import("../voice/magic-match");')).toEqual([{ spec: "../voice/magic-match", dynamic: true }]);
  });
});
