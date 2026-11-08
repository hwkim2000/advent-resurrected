# Structure

Planned layout (create as needed):

```
original/            Upstream Open Adventure data. READ-ONLY, never modify.
  adventure.yaml
  ATTRIBUTION.md
  COPYING
reference/           Upstream references. READ-ONLY, never modify.
  open-adventure/    Unmodified Open Adventure: C sources, tests/ (.log/.chk), COPYING
scripts/             Build-time tools (e.g. YAML -> generated game data)
src/
  engine/            Pure TypeScript port of Open Adventure logic (no DOM)
  data/              Generated game data (do not hand-edit)
  parser/            Classic two-word parser + AI-parser client and fallback
  haunt/             Narrator lines, lamp dimming, glitch effects, XYZZY voice rule
  voice/             Speech recognition and robotic speech synthesis wrappers
  ui/                Terminal rendering, boot sequence, teletype typing, CRT styling
  main.ts            Entry point
worker/              Cloudflare Worker (AI parser proxy); holds the only secrets
tests/               Vitest + fast-check tests (or colocated *.test.ts)
public/              Static assets (original or license-clean only)
.kiro/steering/      These steering docs (never gitignore .kiro/)
```

## Conventions
- Dependency direction: `ui` -> `haunt`/`parser`/`voice` -> `engine`. The engine imports nothing from the others.
- Narrator output is separate from original game text: the original text is always printed first and unchanged; narrator lines are appended as distinct, styled lines.
- 1976 mode bypasses `haunt`, `voice`, and the AI parser entirely.
- Files: `kebab-case.ts`; types `PascalCase`; constants `UPPER_SNAKE_CASE`.
- Generated files carry a header comment saying how to regenerate them.
- Ported code notes the corresponding Open Adventure C function in a comment.
- Keep `.gitignore` excluding `node_modules/`, `dist/`, `.env*`.
