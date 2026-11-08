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

  it("src/ui and src/main.ts import nothing from src/haunt, src/parser or src/voice", () => {
    const bad: string[] = [];
    const forbidden = ["haunt", "parser", "voice"].map((d) => join(SRC, d));
    for (const f of UI_FILES) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        const target = resolveSpec(f, spec);
        if (target === undefined) continue;
        if (forbidden.some((d) => isInside(target, d))) bad.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(bad, `forbidden layer imports:\n  ${bad.join("\n  ")}`).toEqual([]);
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

  it("resolves deep engine specifiers", () => {
    const from = join(UI_DIR, "a.ts");
    expect(resolveSpec(from, "../engine/index")).toBe(join(ENGINE_DIR, "index"));
    expect(resolveSpec(from, "../engine/index.js")).toBe(join(ENGINE_DIR, "index"));
    expect(resolveSpec(from, "../engine/types")).toBe(join(ENGINE_DIR, "types"));
    expect(resolveSpec(from, "vitest")).toBeUndefined();
  });
});
