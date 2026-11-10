/**
 * README test for the voice-input spec (not part of check:dist).
 * Validates: Requirements 12.12, 14.10, 15.6, 16.1, 16.2, 16.8, 16.9
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE_DISCLOSURE_TEXT } from "../../src/shared/voice-disclosure";

const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8").replace(/\r\n/g, "\n");

/** Text of the "## Voice input" section, up to the next level-2 heading. */
function voiceSection(): string {
  const m = /^## Voice input[ \t]*$/m.exec(readme);
  if (!m) return "";
  const rest = readme.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

describe("README voice input documentation", () => {
  const section = voiceSection();

  it('has a "Voice input" section', () => {
    expect(section.length).toBeGreaterThan(0);
  });

  it("section contains Alt+M, the Permissions-Policy value and the disclosure verbatim", () => {
    expect(section).toContain("Alt+M");
    expect(section).toContain("Permissions-Policy: microphone=(self)");
    expect(section).toContain(VOICE_DISCLOSURE_TEXT);
  });

  it("no longer contains the removed sentence", () => {
    expect(readme).not.toContain("Later specs (microphone) may add a `Permissions-Policy`.");
  });

  it("names Permissions-Policy: microphone=(self) in the _headers paragraph", () => {
    const para = readme.split(/\n\s*\n/).find((p) => p.includes("public/_headers") && p.includes("Content-Security-Policy"));
    expect(para).toBeDefined();
    expect(para).toContain("Permissions-Policy: microphone=(self)");
  });

  it("documents the XYZZY rule (12.12)", () => {
    expect(section).toContain("DEFLECTION_LIMIT");
    expect(section).toMatch(/once per game/);
    expect(section).toMatch(/next typed XYZZY works normally/);
    expect(section).toMatch(/completable without a microphone/);
  });

  it("has checklist items (a) to (k), each marked not verified", () => {
    for (const letter of "abcdefghijk") {
      const re = new RegExp(`^- \\(${letter}\\) \\*\\*not verified\\.\\*\\*`, "m");
      expect(readme, `item (${letter})`).toMatch(re);
    }
  });

  it("contains the Requirement 14.10 phrases", () => {
    for (const phrase of [
      "voice input uses the speech recognition service",
      "maker of the browser",
      "never records or stores audio",
      "1976 mode never uses the microphone",
      "typing always works",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
    expect(readme.toLowerCase()).toContain("audio is sent to that service for recognition");
    expect(readme).toContain("depends on the browser");
  });

  it("states that _headers does not apply to the Functions or the Vite dev server (15.6)", () => {
    expect(section).toMatch(/`_headers` applies to static assets only/);
    expect(section).toMatch(/does not apply to the responses of the Functions under `\/api`/);
    expect(section).toMatch(/Vite dev server does not apply `_headers`/);
    expect(section).toMatch(/needs no new origin for speech recognition/);
  });

  it('lists the "not verified before release" points (15.10)', () => {
    expect(section).toContain("Not verified before release");
    expect(section).toContain("SpeechRecognition.start()");
    expect(section).toContain("connect-src");
  });
});
