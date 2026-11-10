// @vitest-environment happy-dom
// Feature: voice-input, task 9.2. Validates Requirements 14.4, 14.6, 16.5, 17.11.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE_DISCLOSURE_TEXT } from "../../src/shared/voice-disclosure";

// Strip <link> and <script> so the parser never tries to load assets.
const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8")
  .replace(/<link\b[^>]*>/g, "")
  .replace(/<script\b[^>]*><\/script>/g, "");
const doc = new DOMParser().parseFromString(html, "text/html");

describe("index.html voice markup", () => {
  it("#mic-disclosure text equals the constant, with no child markup or aria-hidden", () => {
    const el = doc.getElementById("mic-disclosure")!;
    expect(el).not.toBeNull();
    expect((el.textContent ?? "").trim()).toBe(VOICE_DISCLOSURE_TEXT);
    expect(el.children.length).toBe(0);
    expect(el.hasAttribute("aria-hidden")).toBe(false);
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("disclosure is short and names the speech service, maker and no storage", () => {
    expect(VOICE_DISCLOSURE_TEXT.length).toBeLessThanOrEqual(140);
    expect(VOICE_DISCLOSURE_TEXT).toContain("browser's speech service");
    expect(VOICE_DISCLOSURE_TEXT).toContain("maker of your browser");
    expect(VOICE_DISCLOSURE_TEXT).toContain("stores no audio");
  });

  it("mic accessible name contains the visible label and the words hold and talk", () => {
    const mic = doc.getElementById("mic")!;
    const name = mic.getAttribute("aria-label")!;
    expect(name).toBe("Mic: hold to talk");
    expect(name.toLowerCase()).toContain((mic.textContent ?? "").trim().toLowerCase());
    expect(name).toMatch(/\bhold\b/);
    expect(name).toMatch(/\btalk\b/);
    expect(mic.hasAttribute("hidden")).toBe(true);
    expect(mic.getAttribute("aria-describedby")).toBe("mic-disclosure");
  });

  it("#voice-live is a separate, empty, polite and atomic live region", () => {
    const live = doc.getElementById("voice-live")!;
    expect(live).not.toBeNull();
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(live.textContent).toBe("");
    expect(live.children.length).toBe(0);
    for (const id of ["live", "live-interpreted"]) {
      const other = doc.getElementById(id)!;
      expect(other.contains(live)).toBe(false);
      expect(live.contains(other)).toBe(false);
    }
  });

  it("every id in index.html is unique", () => {
    const ids = Array.from(doc.querySelectorAll("[id]")).map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(doc.querySelectorAll("#voice-live").length).toBe(1);
  });

  it("voice-bar siblings exist and no element carries a style attribute", () => {
    const bar = doc.getElementById("voice-bar")!;
    for (const id of ["mic", "voice-status", "mic-disclosure", "mic-unavailable"]) {
      expect(doc.getElementById(id)!.parentElement).toBe(bar);
    }
    expect(doc.querySelectorAll("[style]").length).toBe(0);
  });
});
