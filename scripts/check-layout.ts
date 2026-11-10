/*
 * Layout check for the MIC / disclosure / input line (haunting spec, Requirement 6.3).
 * Usage: npm run build; npm run check:layout   (serves dist/ itself via vite preview)
 * Env: CHROME_PATH or EDGE_PATH to use a specific browser executable.
 * Local script, not part of CI. No browser is downloaded: it needs an installed Edge/Chrome.
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { preview } from 'vite';

interface Size {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly required: boolean;
}

const SIZES: readonly Size[] = [
  { name: '1280x720', width: 1280, height: 720, required: true },
  { name: '1366x768', width: 1366, height: 768, required: true },
  { name: '1024x600', width: 1024, height: 600, required: true },
  { name: '390x844', width: 390, height: 844, required: false },
  { name: '1536x864@1.25', width: 1229, height: 691, required: false },
  // Real browser windows lose 90-130px to tabs and toolbars; report-only.
  { name: '1366x650(chrome)', width: 1366, height: 650, required: false },
  { name: '1229x580(chrome@1.25)', width: 1229, height: 580, required: false },
  { name: '1024x480', width: 1024, height: 480, required: false },
  { name: '800x420', width: 800, height: 420, required: false },
];

async function launch(): Promise<Browser> {
  const explicit = process.env['CHROME_PATH'] ?? process.env['EDGE_PATH'];
  if (explicit !== undefined && explicit !== '') {
    if (!existsSync(explicit)) throw new Error(`Browser path from env does not exist: ${explicit}`);
    return chromium.launch({ executablePath: explicit });
  }
  const errors: string[] = [];
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      errors.push(`${channel}: ${(e as Error).message.split('\n')[0] ?? ''}`);
    }
  }
  throw new Error(`NO CHROMIUM-BASED BROWSER FOUND (tried msedge, chrome). Set CHROME_PATH. ${errors.join(' | ')}`);
}

interface Box { top: number; bottom: number; left: number; right: number; h: number }
interface Metrics {
  vw: number;
  vh: number;
  mic: Box | null;
  disc: Box | null;
  input: Box | null;
  transcriptH: number;
  lineH: number;
  fontPx: string;
  crtOverflow: string;
  crt: Box | null;
  bodyMode: string;
}

const f = (n: number): string => n.toFixed(1);

async function main(): Promise<void> {
  const server = await preview({ preview: { port: 4173, strictPort: true, host: '127.0.0.1' } });
  const url = 'http://127.0.0.1:4173/';
  const browser = await launch();
  let failed = false;
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      await page.addInitScript(() => {
        localStorage.clear();
      });
      await page.goto(url);
      await page.waitForSelector('#input');
      await page.keyboard.press('Space');
      await page.waitForTimeout(600);
      await page.keyboard.press('Space');
      await page.waitForTimeout(400);
      await page.evaluate(`
        ['mic', 'voice-status', 'mic-disclosure'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.removeAttribute('hidden');
        });
        var st = document.getElementById('voice-status');
        if (st) st.textContent = 'HEARD: ' + 'go in the building and take the keys then ask the lamp to light up now please ok'.slice(0, 80);
      `);
      await page.waitForTimeout(100);
      const m = await page.evaluate<Metrics>(`(() => {
        var box = function (sel) {
          var el = document.querySelector(sel);
          if (el === null) return null;
          var r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
        };
        var tr = document.querySelector('#transcript');
        var lineH = parseFloat(getComputedStyle(document.body).fontSize) * 1.15;
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          mic: box('#mic'),
          disc: box('#mic-disclosure'),
          input: box('.input-line'),
          transcriptH: tr === null ? 0 : tr.getBoundingClientRect().height,
          lineH,
          fontPx: getComputedStyle(document.body).fontSize,
          crtOverflow: getComputedStyle(document.querySelector('.crt')).overflow,
          crt: box('.crt'),
          bodyMode: document.documentElement.dataset.gameMode || '(none)',
        };
      })()`);
      const problems: string[] = [];
      const inside = (label: string, b: Box | null): void => {
        if (b === null) {
          problems.push(`${label} missing`);
          return;
        }
        if (b.top < 0 || b.left < 0 || b.bottom > m.vh + 0.5 || b.right > m.vw + 0.5 || b.h <= 0) {
          problems.push(`${label} outside viewport (top ${f(b.top)}, bottom ${f(b.bottom)} of ${m.vh})`);
        }
      };
      const clip = m.crt;
      if (clip !== null) {
        for (const [label, b] of [['#mic', m.mic], ['#mic-disclosure', m.disc], ['.input-line', m.input]] as const) {
          if (b !== null && (b.bottom > clip.bottom + 0.5 || b.top < clip.top - 0.5)) {
            problems.push(label + ' clipped by .crt (bottom ' + f(b.bottom) + ' > ' + f(clip.bottom) + ')');
          }
        }
      }
      inside('#mic', m.mic);
      inside('#mic-disclosure', m.disc);
      inside('.input-line', m.input);
      if (m.transcriptH < 3 * m.lineH) problems.push(`transcript ${f(m.transcriptH)}px < 3 lines (${f(3 * m.lineH)}px)`);
      if (m.bodyMode !== 'haunted') problems.push(`not a Haunted game (mode ${m.bodyMode})`);
      const tag = problems.length === 0 ? 'PASS' : size.required ? 'FAIL' : 'WARN';
      console.log(
        `${tag} ${size.name} font ${m.fontPx} transcript ${f(m.transcriptH)}px (3 lines ${f(3 * m.lineH)}px) ` +
          `mic ${m.mic ? `${f(m.mic.top)}-${f(m.mic.bottom)}` : 'n/a'} ` +
          `disc ${m.disc ? `${f(m.disc.top)}-${f(m.disc.bottom)} (h ${f(m.disc.h)})` : 'n/a'} ` +
          `input ${m.input ? `${f(m.input.top)}-${f(m.input.bottom)}` : 'n/a'} viewportH ${m.vh}`,
      );
      for (const p of problems) console.log(`    - ${p}`);
      if (problems.length > 0 && size.required) failed = true;
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
