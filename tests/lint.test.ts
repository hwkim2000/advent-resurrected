/*
 * Static provenance and layering checks (game-engine spec, task 12.1).
 *
 * These tests read source text only; they never import the engine.
 *
 * Open Adventure is BSD-2-Clause, Copyright Eric S. Raymond.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_DIR = join(ROOT, "src", "engine");
const DATA_DIR = join(ROOT, "src", "data");

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join("/");
}

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.ts$/.test(name);
}

/** Non-test .ts files directly under a directory, sorted. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".ts") && !isTestFile(n))
    .sort()
    .map((n) => join(dir, n));
}

function read(p: string): string {
  return readFileSync(p, "utf8");
}

/* ------------------------------------------------------------------ */
/* A small lexer: removes comments and (optionally) string contents.   */
/* ------------------------------------------------------------------ */

interface Stripped {
  /** Comments removed, string/template/regex contents blanked. */
  code: string;
  /** Comments removed, string contents kept. */
  withStrings: string;
}

function strip(src: string): Stripped {
  let code = "";
  let withStrings = "";
  let i = 0;
  let lastSig = ""; // last significant (non-space) code character
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
      // regex literal
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

/* ------------------------------------------------------------------ */
/* Provenance: BSD-2 notice                                             */
/* ------------------------------------------------------------------ */

const BSD_RE = /BSD[ -]2[ -]Clause|BSD-2/i;

function hasBsdNotice(text: string): boolean {
  // The notice must be in the leading comment block (first 4000 characters).
  return BSD_RE.test(text.slice(0, 4000));
}

describe("provenance: BSD-2 notice", () => {
  it("the engine directory contains ported source files", () => {
    expect(sourceFiles(ENGINE_DIR).length).toBeGreaterThan(0);
  });

  it("every ported source file under src/engine has the BSD-2 notice", () => {
    const missing = sourceFiles(ENGINE_DIR)
      .filter((f) => !hasBsdNotice(read(f)))
      .map(rel);
    expect(missing, `files lacking the BSD-2 notice: ${missing.join(", ")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Provenance: `C: <function>` comment on each ported function          */
/* ------------------------------------------------------------------ */

/**
 * Top-level function declarations in src/engine that are TypeScript-only
 * helpers with no Open Adventure C counterpart. Every other top-level
 * function must carry a `C: <name>` reference in its leading comment block
 * (`//`, `/* *\/` or JSDoc) or in a comment on the first line of its body.
 * Keys are `<file>:<function>`.
 */
const TS_ONLY_FUNCTIONS: ReadonlySet<string> = new Set([
  "classic-parser.ts:foldChar",
  "classic-parser.ts:passesIgnore",
  "index.ts:finish",
  "index.ts:step",
  "index.ts:endOfInput",
  "init.ts:emptyWord",
  "init.ts:cloneValue",
  "init.ts:cloneState",
  "init.ts:deepFreeze",
  "io.ts:pushText",
  "io.ts:formatPrintf",
  "main-loop.ts:makeMachine",
  "main-loop.ts:processOne",
  "main-loop.ts:applyAndCheck",
  "main-loop.ts:finishAction",
  "main-loop.ts:afterHints",
  "main-loop.ts:postGame",
  "main-loop.ts:mainStep",
  "main-loop.ts:mainEndOfInput",
  "save-resume.ts:canonical",
  "save-resume.ts:isRec",
  "save-resume.ts:isInt",
  "save-resume.ts:isBool",
  "save-resume.ts:isIntArray",
  "save-resume.ts:hasGameShape",
  "save-resume.ts:hasWordShape",
  "save-resume.ts:hasPendingShape",
  "save-resume.ts:hasSessionShape",
  "save-resume.ts:deserialize",
  "save-resume.ts:exitSession",
  "travel.ts:tr",
]);

const C_REF_RE = /\bC:\s*\S/;
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
const FUNC_DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;

interface FuncInfo {
  file: string;
  name: string;
  line: number;
  hasCRef: boolean;
}

/** Find every top-level function declaration and whether it has a C: reference. */
function findFunctions(file: string): FuncInfo[] {
  const lines = read(file).split(/\r?\n/);
  const out: FuncInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FUNC_DECL_RE.exec(lines[i]!);
    if (!m) continue;
    let block = "";
    for (let j = i - 1; j >= 0 && COMMENT_LINE_RE.test(lines[j]!); j--) {
      block = lines[j]! + "\n" + block;
    }
    const first = lines[i + 1];
    if (first !== undefined && COMMENT_LINE_RE.test(first)) block += first;
    out.push({
      file: rel(file),
      name: m[1]!,
      line: i + 1,
      hasCRef: C_REF_RE.test(block),
    });
  }
  return out;
}

describe("provenance: `C: <function>` comments", () => {
  const funcs = sourceFiles(ENGINE_DIR).flatMap(findFunctions);

  it("finds ported functions in the engine", () => {
    expect(funcs.filter((f) => f.hasCRef).length).toBeGreaterThan(10);
  });

  it("every top-level engine function has a `C:` comment or is a listed TypeScript-only helper", () => {
    const bad = funcs
      .filter((f) => !f.hasCRef && !TS_ONLY_FUNCTIONS.has(`${f.file.replace("src/engine/", "")}:${f.name}`))
      .map((f) => `${f.file}:${f.line} ${f.name}()`);
    expect(bad, `ported functions lacking a "C: <name>" comment:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("the TypeScript-only allowlist has no stale entries", () => {
    const present = new Set(funcs.map((f) => `${f.file.replace("src/engine/", "")}:${f.name}`));
    const stale = [...TS_ONLY_FUNCTIONS].filter((k) => !present.has(k));
    expect(stale, `allowlist entries naming no function: ${stale.join(", ")}`).toEqual([]);
  });

  it("allowlisted helpers are not secretly annotated (remove them from the allowlist)", () => {
    const redundant = funcs
      .filter((f) => f.hasCRef && TS_ONLY_FUNCTIONS.has(`${f.file.replace("src/engine/", "")}:${f.name}`))
      .map((f) => `${f.file}:${f.name}`);
    expect(redundant).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* package.json dependency pinning                                      */
/* ------------------------------------------------------------------ */

describe("package.json: exact pinned versions", () => {
  const pkg = JSON.parse(read(join(ROOT, "package.json"))) as Record<string, unknown>;
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const EXACT_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  it("no dependency version is a range, tag or `latest`", () => {
    const bad: string[] = [];
    for (const s of sections) {
      const deps = pkg[s] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (!EXACT_RE.test(version)) bad.push(`${s}.${name}@${version}`);
      }
    }
    expect(bad, `non-exact dependency versions: ${bad.join(", ")}`).toEqual([]);
  });

  it("pins the required toolchain packages", () => {
    const all = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>;
    for (const name of ["typescript", "vite", "vitest", "fast-check", "yaml"]) {
      expect(all[name], `${name} must be a dependency`).toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Engine layering and purity                                           */
/* ------------------------------------------------------------------ */

const FORBIDDEN_LAYERS = ["ui", "haunt", "parser", "voice"].map((d) => join(ROOT, "src", d));

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

describe("engine layering", () => {
  const files = sourceFiles(ENGINE_DIR);

  it("src/engine imports nothing from src/ui, src/haunt, src/parser or src/voice", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        if (!spec.startsWith(".")) {
          if (/^(?:@\/)?src\/(ui|haunt|parser|voice)(\/|$)/.test(spec)) bad.push(`${rel(f)} -> ${spec}`);
          continue;
        }
        const target = resolve(dirname(f), spec);
        for (const dir of FORBIDDEN_LAYERS) {
          if (target === dir || target.startsWith(dir + sep)) bad.push(`${rel(f)} -> ${spec}`);
        }
      }
    }
    expect(bad, `forbidden imports:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("src/engine relative imports stay inside src/engine or src/data", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        if (!spec.startsWith(".")) continue;
        const target = resolve(dirname(f), spec);
        const ok =
          target.startsWith(ENGINE_DIR + sep) || target.startsWith(DATA_DIR + sep);
        if (!ok) bad.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(bad, `imports escaping engine/data: ${bad.join(", ")}`).toEqual([]);
  });

  it("src/engine imports no Node built-in or third-party module", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of importSpecifiers(strip(read(f)).withStrings)) {
        if (!spec.startsWith(".")) bad.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(bad, `bare-module imports: ${bad.join(", ")}`).toEqual([]);
  });
});

/** Identifier -> why it is banned in the engine. */
const FORBIDDEN_GLOBALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bMath\s*\.\s*random\b/, "Math.random (use the ported LCG)"],
  [/(?<![.\w$])Date\b/, "Date (wall clock)"],
  [/(?<![.\w$])performance\b/, "performance (wall clock)"],
  [/(?<![.\w$])crypto\b/, "crypto (nondeterminism)"],
  [/(?<![.\w$])(?:document|window|navigator|location|localStorage|sessionStorage|indexedDB|HTMLElement|globalThis|self)\b/, "DOM/global API"],
  [/(?<![.\w$])(?:fetch|XMLHttpRequest|WebSocket|EventSource|Request|Response|navigator\.sendBeacon)\b/, "network API"],
  [/(?<![.\w$])(?:setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|requestAnimationFrame|requestIdleCallback|queueMicrotask)\b/, "timer API"],
  [/(?<![.\w$])(?:process|require|Buffer|__dirname|__filename)\b/, "Node API"],
  [/(?<![.\w$])fs\b/, "fs API"],
];

describe("engine purity: no nondeterministic or I/O APIs", () => {
  for (const f of sourceFiles(ENGINE_DIR)) {
    it(`${rel(f)} uses no Math.random, Date, performance, crypto, DOM, network, timer or fs APIs`, () => {
      const { code } = strip(read(f));
      const lines = code.split("\n");
      const hits: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        for (const [re, why] of FORBIDDEN_GLOBALS) {
          if (re.test(lines[i]!)) hits.push(`${rel(f)}:${i + 1} ${why}: ${lines[i]!.trim()}`);
        }
      }
      expect(hits, `forbidden API references:\n  ${hits.join("\n  ")}`).toEqual([]);
    });
  }

  it("the lexer self-check: forbidden names in comments and strings are ignored, in code are found", () => {
    const s = strip('// Math.random\nconst a = "Date"; /* fetch */ const b = Date.now();');
    expect(FORBIDDEN_GLOBALS.some(([re]) => re.test(s.code))).toBe(true);
    const t = strip('// Math.random\nconst a = "Date"; /* fetch */ const q = /Date/.test(a);');
    expect(FORBIDDEN_GLOBALS.some(([re]) => re.test(t.code))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* No YAML content literals in engine source                            */
/* ------------------------------------------------------------------ */

/** Collect every string value in the parsed YAML (Maps, arrays, objects). */
function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v instanceof Map) {
    for (const [k, x] of v) {
      collectStrings(k, out);
      collectStrings(x, out);
    }
  } else if (v !== null && typeof v === "object") {
    for (const x of Object.values(v)) collectStrings(x, out);
  }
}

const MIN_CONTENT_LINE = 20; // ignore short fragments that coincide with code text

function normalize(s: string): string {
  return s.replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim();
}

describe("engine contains no copied YAML content", () => {
  it("no engine string literal repeats a line of text from original/adventure.yaml", () => {
    const yamlPath = join(ROOT, "original", "adventure.yaml");
    const text = Buffer.from(readFileSync(yamlPath)).toString("latin1");
    const doc = parseDocument(text, { version: "1.1", merge: true, uniqueKeys: true });
    expect(doc.errors).toEqual([]);
    const strings: string[] = [];
    collectStrings(doc.toJS({ mapAsMap: true }), strings);

    const needles = new Set<string>();
    for (const s of strings) {
      for (const line of s.split("\n")) {
        const t = normalize(line);
        if (t.length >= MIN_CONTENT_LINE) needles.add(t);
      }
    }
    expect(needles.size).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const f of sourceFiles(ENGINE_DIR)) {
      // Only the contents of string literals: comments are removed first.
      const haystack = normalize(strip(read(f)).withStrings);
      for (const needle of needles) {
        if (haystack.includes(needle)) offenders.push(`${rel(f)}: "${needle.slice(0, 60)}"`);
      }
    }
    expect(offenders, `YAML text copied into engine source:\n  ${offenders.slice(0, 20).join("\n  ")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* .gitignore                                                           */
/* ------------------------------------------------------------------ */

describe(".gitignore", () => {
  const lines = read(join(ROOT, ".gitignore"))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

  it("excludes node_modules/, dist/ and .env*", () => {
    expect(lines.some((l) => /^\/?node_modules\/?$/.test(l)), "node_modules/ missing").toBe(true);
    expect(lines.some((l) => /^\/?dist\/?$/.test(l)), "dist/ missing").toBe(true);
    expect(
      lines.some((l) => l === ".env*" || l === ".env"),
      ".env missing",
    ).toBe(true);
    expect(
      lines.some((l) => l === ".env*" || l === ".env.*"),
      ".env.* missing",
    ).toBe(true);
  });

  it("does not exclude .kiro/", () => {
    const bad = lines.filter((l) => /^!?\/?\*{0,2}\/?\.kiro(\/.*)?$/.test(l) && !l.startsWith("!"));
    expect(bad, `.kiro/ is ignored by: ${bad.join(", ")}`).toEqual([]);
    expect(lines.filter((l) => l === ".*" || l === ".*/"), "a dot-file wildcard would ignore .kiro/").toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Generated files carry the regeneration header                        */
/* ------------------------------------------------------------------ */

describe("generated files: regeneration header", () => {
  const generated = existsSync(DATA_DIR) ? sourceFiles(DATA_DIR) : [];

  it("src/data contains the three generated files", () => {
    const names = generated.map((f) => rel(f));
    for (const n of ["src/data/constants.ts", "src/data/dungeon.ts", "src/data/travel.ts"]) {
      expect(names).toContain(n);
    }
  });

  for (const f of generated) {
    it(`${rel(f)} has the generated notice, the regeneration command and the BSD-2 notice`, () => {
      const head = read(f).slice(0, 4000);
      expect(/GENERATED FILE/i.test(head), `${rel(f)}: missing "GENERATED FILE - DO NOT EDIT" notice`).toBe(true);
      expect(/Regenerate with:\s*npm run gen:data/.test(head), `${rel(f)}: missing regeneration command`).toBe(true);
      expect(BSD_RE.test(head), `${rel(f)}: missing BSD-2 notice`).toBe(true);
    });
  }
});
