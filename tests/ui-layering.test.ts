/*
 * Static layering checks for the crt-terminal-ui spec (task 11.1).
 *
 * Reads source text only; never imports the code under test.
 * Requirements: 1.2, 1.5, 1.6, 5.9, 15.1, 15.6.
 *
 * Open Adventure is BSD-2-Clause, Copyright Eric S. Raymond.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const UI_DIR = join(SRC, "ui");
const ENGINE_DIR = join(SRC, "engine");
const MAIN_TS = join(SRC, "main.ts");

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join("/");
}

function read(p: string): string {
  return readFileSync(p, "utf8");
}

function isSourceTs(name: string): boolean {
  return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts");
}

/** Non-test .ts files under dir; recursive or only directly inside it. */
function tsFiles(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) out.push(...tsFiles(p, true));
    } else if (isSourceTs(e.name)) {
      out.push(p);
    }
  }
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* Lexer: removes comments; blanks string/template/regex contents.     */
/* (Same approach as tests/lint.test.ts.)                               */
/* ------------------------------------------------------------------ */

interface Stripped {
  code: string;
  withStrings: string;
}

function strip(src: string): Stripped {
  let code = "";
  let withStrings = "";
  let i = 0;
  let lastSig = "";
  const n = src.length;
  const emitBoth = (c: string): void => {
    code += c;
    withStrings += c;
  };
  const keepNl = (c: string): string => (c === "\n" ? "\n" : " ");
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
        if (src[i] === "\n") emitBoth("\n");
        i++;
      }
      i += 2;
      emitBoth(" ");
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      emitBoth(q);
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < n) {
          withStrings += src[i]! + src[i + 1]!;
          code += "  ";
          i += 2;
          continue;
        }
        withStrings += src[i]!;
        code += keepNl(src[i]!);
        i++;
      }
      emitBoth(q);
      i++;
      lastSig = q;
      continue;
    }
    if (c === "/" && (lastSig === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSig))) {
      emitBoth("/");
      i++;
      let inClass = false;
      while (i < n && (src[i] !== "/" || inClass) && src[i] !== "\n") {
        if (src[i] === "\\") {
          withStrings += src[i]! + (src[i + 1] ?? "");
          code += "  ";
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        withStrings += src[i]!;
        code += " ";
        i++;
      }
      emitBoth("/");
      i++;
      lastSig = "/";
      continue;
    }
    emitBoth(c);
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return { code, withStrings };
}

/** Module specifiers imported by a source file (static, dynamic, re-export, require). */
function importSpecifiers(withStrings: string): string[] {
  const specs: string[] = [];
  const res = [
    /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of res) {
    for (const m of withStrings.matchAll(re)) specs.push(m[1]!);
  }
  return specs;
}

/** Resolve a specifier from a file to an absolute path without extension, or undefined if bare. */
function resolveSpec(from: string, spec: string): string | undefined {
  let target: string;
  if (spec.startsWith(".")) target = resolve(dirname(from), spec);
  else if (/^(?:@\/)?src\//.test(spec)) target = resolve(ROOT, spec.replace(/^@\//, ""));
  else return undefined;
  return target.replace(/\.(?:[cm]?[jt]s)$/, "");
}

function isInside(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + sep);
}

const PARSER_DIR = join(SRC, "parser");

/** Import references with their kind: dynamic `import("x")` versus every static form. */
function importRefs(withStrings: string): Array<{ spec: string; dynamic: boolean }> {
  const refs: Array<{ spec: string; dynamic: boolean }> = [];
  const statics = [
    /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of statics) {
    for (const m of withStrings.matchAll(re)) refs.push({ spec: m[1]!, dynamic: false });
  }
  for (const m of withStrings.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    refs.push({ spec: m[1]!, dynamic: true });
  }
  return refs;
}

/** Specifiers in a source text that point into src/parser through a non-dynamic reference. */
function staticParserImports(file: string, text: string): string[] {
  const bad: string[] = [];
  for (const { spec, dynamic } of importRefs(strip(text).withStrings)) {
    if (dynamic) continue;
    const target = resolveSpec(file, spec);
    if (target !== undefined && isInside(target, PARSER_DIR)) bad.push(`${rel(file)} -> ${spec}`);
  }
  return bad;
}

const VOICE_DIR = join(SRC, "voice");
const HAUNT_DIR = join(SRC, "haunt");
const SHARED_DIR = join(SRC, "shared");
const PARSE_API_DIR = join(SRC, "parse-api");

/** Layers src/ui must never reference, in any import form (voice-input spec, task 2.2). */
const UI_FORBIDDEN_ANY = [VOICE_DIR, HAUNT_DIR, PARSER_DIR, SHARED_DIR, PARSE_API_DIR];
/** Layers src/main.ts may reach only through dynamic import(). */
const MAIN_DYNAMIC_ONLY = [VOICE_DIR, HAUNT_DIR, PARSER_DIR];
/** Layers src/main.ts must not import in any form. */
const MAIN_FORBIDDEN_ANY = [SHARED_DIR, PARSE_API_DIR];

function layerViolations(file: string, text: string, dirs: string[], dynamicAllowed: boolean): string[] {
  const bad: string[] = [];
  for (const { spec, dynamic } of importRefs(strip(text).withStrings)) {
    if (dynamic && dynamicAllowed) continue;
    const target = resolveSpec(file, spec);
    if (target !== undefined && dirs.some((d) => isInside(target, d))) bad.push(`${rel(file)} -> ${spec}`);
  }
  return bad;
}

/** Rule 1: src/ui file text referencing a forbidden layer in any form. */
function uiLayerViolations(file: string, text: string): string[] {
  return layerViolations(file, text, UI_FORBIDDEN_ANY, false);
}

/** Rule 2: main.ts text with static voice/haunt/parser imports, or any shared/parse-api import. */
function mainLayerViolations(file: string, text: string): string[] {
  return [
    ...layerViolations(file, text, MAIN_DYNAMIC_ONLY, true),
    ...layerViolations(file, text, MAIN_FORBIDDEN_ANY, false),
  ];
}

const UI_FILES = [...tsFiles(UI_DIR, true), ...(existsSync(MAIN_TS) ? [MAIN_TS] : [])];
const PURE_UI_FILES = tsFiles(UI_DIR, false);

/* ------------------------------------------------------------------ */
/* Import rules                                                         */
/* ------------------------------------------------------------------ */

describe("ui layering: imports", () => {
  it("finds UI source files to check", () => {
    expect(UI_FILES.length).toBeGreaterThan(5);
    expect(PURE_UI_FILES.length).toBeGreaterThan(5);
  });

  it("src/ui and src/main.ts import the engine only through src/engine/index", () => {
    const bad: string[] = [];
    const ENGINE_INDEX = join(ENGINE_DIR, "index");
    for (const f of UI_FILES) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        const target = resolveSpec(f, spec);
        if (target === undefined) continue;
        if (isInside(target, ENGINE_DIR) && target !== ENGINE_INDEX && target !== ENGINE_DIR) {
          bad.push(`${rel(f)} -> ${spec}`);
        }
      }
    }
    expect(bad, `deep engine imports:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/ui imports nothing from src/voice, src/haunt, src/parser, src/shared or src/parse-api (static, type or dynamic)", () => {
    const bad: string[] = [];
    for (const f of tsFiles(UI_DIR, true)) bad.push(...uiLayerViolations(f, read(f)));
    expect(bad, `forbidden layer imports in src/ui:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/main.ts has no static import of src/voice, src/haunt or src/parser and imports src/shared and src/parse-api in no form", () => {
    expect(existsSync(MAIN_TS)).toBe(true);
    const bad = mainLayerViolations(MAIN_TS, read(MAIN_TS));
    expect(bad, `forbidden layer imports in main.ts:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/ui has no reference to src/parser, static or dynamic", () => {
    const bad: string[] = [];
    for (const f of tsFiles(UI_DIR, true)) {
      for (const { spec } of importRefs(strip(read(f)).withStrings)) {
        const target = resolveSpec(f, spec);
        if (target !== undefined && isInside(target, PARSER_DIR)) bad.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(bad, `src/ui references src/parser:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/main.ts reaches src/parser only through dynamic import()", () => {
    expect(existsSync(MAIN_TS)).toBe(true);
    const bad = staticParserImports(MAIN_TS, read(MAIN_TS));
    expect(bad, `static imports of src/parser in main.ts:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/engine imports nothing from src/ui", () => {
    const bad: string[] = [];
    for (const f of tsFiles(ENGINE_DIR, true)) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        const target = resolveSpec(f, spec);
        if (target !== undefined && (isInside(target, UI_DIR) || target === MAIN_TS.replace(/\.ts$/, ""))) {
          bad.push(`${rel(f)} -> ${spec}`);
        }
      }
    }
    expect(bad, `engine imports ui:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Purity of files directly in src/ui                                   */
/* ------------------------------------------------------------------ */

const BROWSER_NAMES = [
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
  "matchMedia",
  "visualViewport",
  "requestAnimationFrame",
  "setTimeout",
  "setInterval",
  "Date",
  "fetch",
  "XMLHttpRequest",
];

const PURE_FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  ...BROWSER_NAMES.map((name) => [new RegExp(`(?<![.\\w$])${name}\\b`), name] as const),
  [/\bMath\s*\.\s*random\b/, "Math.random"],
];

function scanLines(code: string, rules: ReadonlyArray<readonly [RegExp, string]>, file: string): string[] {
  const hits: string[] = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const [re, why] of rules) {
      if (re.test(lines[i]!)) hits.push(`${rel(file)}:${i + 1} ${why}: ${lines[i]!.trim()}`);
    }
  }
  return hits;
}

describe("ui purity: modules directly under src/ui are DOM-free", () => {
  for (const f of PURE_UI_FILES) {
    it(`${rel(f)} mentions no browser, timer, clock, random or network API in code`, () => {
      const hits = scanLines(strip(read(f)).code, PURE_FORBIDDEN, f);
      expect(hits, `forbidden references:\n  ${hits.join("\n  ")}`).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* No HTML injection under src/ui                                       */
/* ------------------------------------------------------------------ */

const HTML_SINKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\binnerHTML\b/, "innerHTML"],
  [/\bouterHTML\b/, "outerHTML"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
];

describe("ui safety: no HTML sinks under src/ui", () => {
  const files = tsFiles(UI_DIR, true);
  for (const f of files) {
    it(`${rel(f)} never uses innerHTML, outerHTML or insertAdjacentHTML`, () => {
      const hits = scanLines(strip(read(f)).code, HTML_SINKS, f);
      expect(hits, `HTML sinks:\n  ${hits.join("\n  ")}`).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Lexer / rule self-checks                                             */
/* ------------------------------------------------------------------ */

describe("ui layering: rule self-checks", () => {
  it("flags forbidden names in code but ignores comments and strings", () => {
    const bad = strip("const t = Date.now(); el.innerHTML = x; document.body;").code;
    expect(scanLines(bad, PURE_FORBIDDEN, "x.ts").length).toBeGreaterThanOrEqual(2);
    expect(scanLines(bad, HTML_SINKS, "x.ts").length).toBe(1);
    const ok = strip('// Date window\nconst s = "document innerHTML"; /* setTimeout */ const x = 1;').code;
    expect(scanLines(ok, PURE_FORBIDDEN, "x.ts")).toEqual([]);
    expect(scanLines(ok, HTML_SINKS, "x.ts")).toEqual([]);
  });

  it("planted fixture: a static import of src/parser from main.ts fails, a dynamic one passes", () => {
    const staticFixture = 'import { AiParser } from "./parser/ai-parser";\nexport const x = AiParser;\n';
    const typeFixture = 'import type { AiParser } from "./parser/ai-parser";\n';
    const sideEffectFixture = 'import "./parser/ai-parser";\n';
    const dynamicFixture = 'const m = await import("./parser/ai-parser");\nexport const x = m;\n';
    const commentFixture = '// import { A } from "./parser/ai-parser";\nconst s = 1;\n';
    expect(staticParserImports(MAIN_TS, staticFixture)).toHaveLength(1);
    expect(staticParserImports(MAIN_TS, typeFixture)).toHaveLength(1);
    expect(staticParserImports(MAIN_TS, sideEffectFixture)).toHaveLength(1);
    expect(staticParserImports(MAIN_TS, dynamicFixture)).toEqual([]);
    expect(staticParserImports(MAIN_TS, commentFixture)).toEqual([]);
    // The same dynamic import from a src/ui file is still a violation of the ui rule.
    const uiFile = join(UI_DIR, "x.ts");
    const refs = importRefs(strip('await import("../parser/ai-parser");').withStrings);
    expect(refs).toEqual([{ spec: "../parser/ai-parser", dynamic: true }]);
    expect(isInside(resolveSpec(uiFile, refs[0]!.spec)!, PARSER_DIR)).toBe(true);
  });

  it("planted fixture: dynamic import of src/voice fails in a src/ui file but passes in main.ts", () => {
    const dynamicVoice = 'const m = await import("../voice/browser");\nexport const x = m;\n';
    const mainDynamicVoice = 'const m = await import("./voice/browser");\nexport const x = m;\n';
    const uiFile = join(UI_DIR, "x.ts");
    const uiDomFile = join(UI_DIR, "dom", "x.ts");
    expect(uiLayerViolations(uiFile, dynamicVoice)).toHaveLength(1);
    expect(uiLayerViolations(uiDomFile, 'await import("../../haunt/x");')).toHaveLength(1);
    expect(uiLayerViolations(uiFile, 'import type { A } from "../voice/browser";')).toHaveLength(1);
    expect(uiLayerViolations(uiFile, 'import { A } from "../shared/limits";')).toHaveLength(1);
    expect(mainLayerViolations(MAIN_TS, mainDynamicVoice)).toEqual([]);
    expect(mainLayerViolations(MAIN_TS, 'await import("./haunt/x");')).toEqual([]);
    // Static and type-only imports in main.ts still fail.
    expect(mainLayerViolations(MAIN_TS, 'import { A } from "./voice/browser";')).toHaveLength(1);
    expect(mainLayerViolations(MAIN_TS, 'import type { A } from "./haunt/x";')).toHaveLength(1);
    // shared and parse-api are forbidden in main.ts even dynamically.
    expect(mainLayerViolations(MAIN_TS, 'await import("./shared/limits");')).toHaveLength(1);
    expect(mainLayerViolations(MAIN_TS, 'import { A } from "./parse-api/x";')).toHaveLength(1);
  });

  it("resolves deep engine specifiers", () => {
    const from = join(UI_DIR, "a.ts");
    expect(resolveSpec(from, "../engine/index")).toBe(join(ENGINE_DIR, "index"));
    expect(resolveSpec(from, "../engine/index.js")).toBe(join(ENGINE_DIR, "index"));
    expect(resolveSpec(from, "../engine/types")).toBe(join(ENGINE_DIR, "types"));
    expect(resolveSpec(from, "vitest")).toBeUndefined();
  });
});
