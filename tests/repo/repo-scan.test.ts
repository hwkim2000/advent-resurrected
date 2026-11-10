// Repository scan: no credential pattern and no VITE_ AI variable in any tracked
// (or untracked-but-not-ignored) text file. Sample secrets below are assembled from
// fragments so that this file does not match the patterns itself.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findCredentials,
  findViteAiVariables,
} from "../../scripts/credential-patterns";

const ROOT = resolve(__dirname, "..", "..");

/** The only exemptions: these files must name the patterns. */
function isExempt(path: string): boolean {
  return (
    path === ".dev.vars.example" ||
    path === "scripts/credential-patterns.ts" ||
    path.startsWith(".kiro/specs/ai-parser/") ||
    path.startsWith(".kiro/specs/ghost-voice/")
  );
}

/**
 * Files in the repository: tracked files plus untracked files that are not ignored,
 * so the scan also works before the first commit.
 */
function listRepoFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
  ).toString("utf8");
  const files = out.split("\0").filter((f) => f.length > 0);
  return [...new Set(files)].filter((f) => existsSync(resolve(ROOT, f)));
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/** Returns offending file paths with the pattern sources that matched. */
function scanTexts(entries: Iterable<[string, string]>): string[] {
  const offenders: string[] = [];
  for (const [path, text] of entries) {
    const hits = [...findCredentials(text), ...findViteAiVariables(text)];
    if (hits.length > 0) offenders.push(`${path}: ${hits.join(" | ")}`);
  }
  return offenders;
}

describe("repository scan", () => {
  it("self-check: a planted credential is detected", () => {
    const planted = "Author" + "ization: Bea" + "rer abc123";
    const planted2 = "const k = 's" + "k-" + "A".repeat(24) + "'";
    expect(scanTexts([["fixture-a.txt", planted]])).toHaveLength(1);
    expect(scanTexts([["fixture-b.txt", planted2]])).toHaveLength(1);
  });

  it("self-check: a planted VITE_ AI variable is detected", () => {
    const planted = "VI" + "TE_AI_" + "MODEL=x";
    const planted2 = "import.meta.env.VI" + "TE_FOO";
    expect(scanTexts([["fixture-c.env", planted]])).toHaveLength(1);
    expect(scanTexts([["fixture-d.ts", planted2]])).toHaveLength(1);
  });

  it("self-check: clean text is not flagged", () => {
    expect(scanTexts([["clean.txt", "hello world"]])).toEqual([]);
  });

  it("enumerates a non-trivial set of repository files", () => {
    const files = listRepoFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("package.json");
    // Ignored output must not be scanned.
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist/"))).toBe(false);
  });

  it("no scanned file contains a credential or a VITE_ AI variable", () => {
    const entries: [string, string][] = [];
    for (const f of listRepoFiles()) {
      if (isExempt(f)) continue;
      const buf = readFileSync(resolve(ROOT, f));
      if (isBinary(buf)) continue;
      entries.push([f, buf.toString("utf8")]);
    }
    expect(scanTexts(entries)).toEqual([]);
  });
});
