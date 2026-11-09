# Implementation Plan: ai-parser

## Overview

This plan adds the AI parser to Haunted mode: a Cloudflare Pages Function (`POST /api/parse`) that asks Workers AI to map a sentence to one or two game-vocabulary words, a D1 gate for the per-IP rate limit and the daily cap, a lazily loaded client `AiParser`, and an asynchronous input-resolution stage in the `GameController`. Every failure falls back to the classic parser, and 1976 mode never calls the AI.

Order of work:

1. A verification spike, before any feature code, for the items the design could not verify (types under TypeScript 7.0.2, `AI.run` and `AbortSignal`, D1 SQL behavior, `wrangler d1 execute --local`), with a fallback plan recorded.
2. Prerequisites for the code issues the design found: the two engine visibility exports, the `translation` line kind with explicit `Transcript.tail` kinds, the `--translation` color token, the `ui-layering` test exception, and room-string sanitizing.
3. The no-network test guard, the autosave round trip with `translation` lines, and the injection corpus.
4. The pure shared modules in `src/shared`, each followed by its tests.
5. The server: `src/parse-api`, the D1 gate and its SQL, `functions/`, the Cloudflare configuration files, and their tests.
6. The client: `src/parser` and the `InputResolver` interface.
7. The UI: the `GameController` resolution stage, the view, `main.ts` lazy loading.
8. The isolation tests (1976 mode, upstream replays, the 430-point walkthrough).
9. Tooling and docs: credential patterns, `check:dist`, the repository scan, `measure:latency`, README and credits.
10. A final checkpoint, and an owner-only manual task for the deployment steps.

Language: TypeScript (strict). Tests run with `npx vitest --run` (single run, never watch mode). `original/` and `reference/` are read-only and are never edited. The engine is changed only by the two visibility-only exports in task 2.1.

Rules that apply to every task:

- No task runs `wrangler login`, `wrangler pages deploy`, `wrangler deploy`, `wrangler secret ...`, `wrangler d1 create`, `wrangler d1 migrations apply --remote`, `wrangler d1 execute --remote`, or any command that creates remote D1 or AI resources, publishes the site, applies a remote migration, sets a secret, or changes Cloudflare project settings. If a command asks for a login or tries to reach Cloudflare, STOP, do not log in, and use the recorded fallback. Those steps are owner steps described in the README and in task 13.
- `wrangler` may be used only for local, offline commands: `wrangler --version`, `wrangler types` if needed, and `wrangler d1 execute <name> --local ...` with a temporary `--persist-to` directory that is deleted afterwards.
- The agent never calls real Workers AI. No test reaches the network. Real `fetch` is replaced by the guard from task 3.1.
- `src/ui` imports nothing from `src/parser`, `src/shared`, `src/parse-api`, `src/haunt` or `src/voice`. Only `src/main.ts` may reference `src/parser`, and only through a dynamic `import()`.
- `src/shared` and `src/parse-api` contain no hand-written vocabulary list. Words come from `src/data` through the engine lookup.
- No `VITE_*` variable is read. No Provider key, token or account identifier exists anywhere in the repository. Strings that name the credential patterns are written only in `scripts/credential-patterns.ts` and in the spec documents (the README and the code must not spell them).
- `wrangler` and `@cloudflare/workers-types` are pinned exactly in `devDependencies`. No range operators.
- Property-based tests use fast-check with at least 100 runs, one file per property under `tests/ai-parser/properties/pNN-<name>.test.ts`, each tagged with a comment `// Feature: ai-parser, Property N: <title>`, so the files can run in parallel.
- Unit and example tests live next to the area they test under `tests/shared/`, `tests/parse-api/`, `tests/parser/`, `tests/ui/`, `tests/repo/`, `tests/scripts/` and `tests/setup/`.

Required versus optional: all implementation tasks are required. These tests are also required, because they guard the spec's core guarantees:

- the vocabulary-closure property (Property 1, task 4.6);
- the request/response codec round trip with context validity (Property 8, task 4.7);
- the eligibility partition, including zero fetch in 1976 mode (Property 5, task 8.6), and the 1976-isolation test with the AI parser installed: zero fetch for arbitrary lines, upstream replay and the walkthrough byte-identical (task 10.1);
- the injection-corpus test, at least 20 strings, including context-field injection (task 6.9);
- the rate-limit and daily-cap SQL tests on `node:sqlite`: 59, 60 and 61 s boundaries, exact cap, rollback (task 6.8);
- the Meta_Command classification test pinned against `ACTIONS` (task 4.5);
- the no-network test guard (task 3.1);
- the repository scan and the `dist` scan (tasks 11.2 and 11.3);
- the autosave round trip with the `translation` line kind, including older autosaves (task 3.2);
- the layering test exception (task 2.4).

The other property tests, unit tests, DOM tests and configuration tests are optional (marked `*`).

## Tasks

- [x] 1. Verification spike (do this before any feature code)
  - [x] 1.1 Verify `@cloudflare/workers-types` 5.x and `wrangler` under TypeScript 7.0.2
    - Confirm the versions with `npm view wrangler version` and `npm view @cloudflare/workers-types version`. Install `wrangler@4.158.0` and `@cloudflare/workers-types@5.20261109.1` as exact-pinned `devDependencies` (no `^` or `~`), or the versions `npm view` reports if they differ, and record the difference.
    - Create a scratch `functions/tsconfig.json` (strict, `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`, `noUncheckedIndexedAccess`, `noEmit`) and a scratch `functions/api/spike.ts` that uses `PagesFunction`, `D1Database` and `Ai` types. Run `npx tsc --noEmit -p functions/tsconfig.json` and the root `npm run typecheck`.
    - Check that the root project is not affected (the root `tsc` must not pick up `functions/`). Delete the scratch file. Keep the dependencies installed.
    - If workers-types 5.x does not typecheck under TypeScript 7.0.2, apply the fallback in order: (1) try the newest dated 5.x release; (2) write minimal local structural types in `functions/env.d.ts` for `PagesFunction`, `D1Database`, `D1PreparedStatement` and `Ai` (the design already isolates Cloudflare types in `functions/api/parse.ts`) and drop the package; (3) ask the user with the `user_input` tool.
    - Write the outcome (versions, commands, result, fallback chosen) to `.kiro/specs/ai-parser/spike-types.md`.
    - Never run `wrangler login`, `deploy`, or any remote command.
    - _Requirements: 12.5, 12.6_

  - [x] 1.2 Verify what the types say about `AI.run` and `AbortSignal`
    - Read `node_modules/@cloudflare/workers-types/index.d.ts` (and `latest/index.d.ts` if present) and record the signature of `Ai.run`, whether it accepts an options object with `signal`, and the type of the text-generation response.
    - Check the Cloudflare Workers AI docs for the same question (web search is allowed; call no AI endpoint). Do not call the real service.
    - The design does not rely on abort support: the handler races `provider.translate` against a timer and ignores a late result. Record that this stays the plan, and record the fallback if the types show `run` takes no options: the adapter passes `signal` only when the options argument exists, and the race alone enforces the 3500 ms limit.
    - Write the outcome to `.kiro/specs/ai-parser/spike-abort.md`.
    - _Requirements: 6.9, 10.1_

  - [x] 1.3 Verify D1 SQL behavior and `wrangler d1 execute --local` from a Pages config
    - Write the five gate statements (S0 to S4 of the design, numbered parameters `?1` to `?5`) in a scratch `.sql` file and run them on `node:sqlite` (`DatabaseSync`) to confirm numbered parameters, `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?5`, and `changes` for `INSERT ... SELECT`, `UPDATE ... WHERE ... EXISTS` and `DELETE ... NOT EXISTS`. Confirm `node:sqlite` loads without a flag on the repo's Node version and note the experimental warning.
    - Add a scratch `wrangler.toml` D1 binding (placeholder id) only if needed, then try `npx wrangler d1 execute advent-gate --local --persist-to <temp dir> --file=<scratch migration>` and a `--command` that reads `changes()`. Local mode only. If wrangler asks to log in, tries to reach Cloudflare, or fails because the project is a Pages project, STOP that attempt, do not log in, and record the failure.
    - Fallbacks to record: if `--local` does not work from the Pages config, `db:local` becomes a documented `--file` run with an explicit `--persist-to`, or is dropped from the README (the SQL is already covered by the `node:sqlite` tests in task 6.8). If numbered parameters or `meta.changes` differ on D1 (not verifiable offline), the fallback is to use positional `?` parameters only and to read the admit result from a `SELECT changes()` statement in the same batch. Record this as an unverified item that the owner step 13 checks.
    - Delete the scratch files and the temporary persist directory; make sure `.wrangler/` stays ignored.
    - Write the outcome to `.kiro/specs/ai-parser/spike-d1.md`.
    - _Requirements: 7.2, 7.13, 13.14_

  - [x] 1.4 Consolidate the spike results and the fallback plan
    - Combine `spike-types.md`, `spike-abort.md` and `spike-d1.md` into `.kiro/specs/ai-parser/spike-results.md` with a table: item, verified or not, result, fallback chosen, which later task is affected.
    - If a fallback changes the design (for example local Cloudflare types instead of the package, or no `db:local` script), update the matching paragraph of `design.md` and note which later tasks change. Do not change requirements.md; list any requirement wording that would need the user's approval.
    - Delete the three partial files after merging.
    - _Requirements: 12.5, 12.6_

- [x] 2. Prerequisites for the code issues found by the design
  - [x] 2.1 Add the two visibility-only engine exports
    - In `src/engine/classic-parser.ts` export `strncaseeq` and `scanTwoWords` (add `export`, no logic change, keep their `C:` comments and the BSD-2 notice). If `src/engine/index.ts` re-exports a list of parser functions, leave it as is; the shared module imports from `src/engine/classic-parser`.
    - Run the existing suite (`npx vitest --run`) to confirm nothing changed, in particular the fidelity and walkthrough tests.
    - _Requirements: 2.5, 2.7, 8.9_

  - [x] 2.2 Add the `translation` line kind and explicit autosave tail kinds
    - `src/ui/types.ts`: add `'translation'` to `LineKind`.
    - `src/ui/autosave.ts`: add `'translation'` to `LINE_KINDS` (the decoder validation) and export `AUTOSAVE_LINE_KINDS = ['original','input','translation','notice','narrator']`. Keep the record at `v: 1`.
    - `src/ui/transcript.ts`: leave the default kinds of `tail` as `original, input, notice, narrator` so the narrator and voice tail never sees a `translation` line. Only touch the file if the types require it.
    - `src/ui/game-controller.ts`: change the autosave call to `this.transcript.tail(AUTOSAVE_MAX_LINES, AUTOSAVE_LINE_KINDS)`. No other controller change in this task.
    - `tests/ui/support/generators.ts`: add `'translation'` to `LINE_KINDS`.
    - Run the existing UI suite to confirm nothing else changed.
    - _Requirements: 4.12, 4.13, 4.14, 4.15_

  - [x] 2.3 Add the `--translation` color token and the translation and pending line styles
    - In `src/ui/crt.css` (or wherever the root custom properties live) add `--translation: #25c24d;`, `.line--translation`, `.line--pending`, the `::after` dots with the `pending-dots` keyframes, and the `prefers-reduced-motion: reduce` rule that disables the dots animation, exactly as in the design. Do not change `--fg` or `--fg-dim`.
    - The dots are decorative; the command text is never placed in a pseudo-element.
    - _Requirements: 4.2, 4.5, 4.6, 4.11_

  - [x] 2.4 Edit the layering test for the dynamic `import()` in `main.ts`
    - Edit `tests/ui-layering.test.ts`: keep the rule that `src/ui` imports nothing from `src/haunt`, `src/parser` or `src/voice`, and add `src/shared` and `src/parse-api` to its forbidden list. Allow `src/main.ts` one reference to `src/parser`, only as a dynamic `import()`; add an assertion that every specifier in `src/main.ts` that points into `src/parser` is dynamic, and that no static import into `src/parser` exists anywhere under `src/ui` or in `src/main.ts`.
    - Show with a planted in-memory fixture that a static import of `src/parser` from `src/main.ts` fails the assertion and a dynamic one passes (self-check).
    - The existing test still has to pass before `main.ts` changes.
    - _Requirements: 3.10, 1.2_

  - [x] 2.5 Create `src/shared/limits.ts` and the room-string sanitizing
    - `src/shared/limits.ts`: the constants from the design (`TEXT_MAX_CHARS` 200, `BODY_MAX_BYTES` 2048, `COMMAND_MAX_CHARS` 30, `ROOM_MAX_CHARS` 80, `OBJECTS_MAX` 12, `OBJECT_WORD_MAX` 12, `LAST_MAX` 2, `MAX_OUTPUT_TOKENS` 16, rate and timeout defaults, `DARK_ROOM`, `NO_COMMAND_TOKEN`).
    - `src/shared/context-rules.ts` (first part): the `GameContext` interface, `roomText(loc)` using `LOCATIONS[loc].small`, or the first line of `big` when `small` is null, with the sanitizing from Requirement 2.8 (typographic and double quotes to `'`, other characters outside letters, digits, space and `' . , / -` to a space, collapse spaces, trim, cut to 80), `ROOM_SET` (every location with text plus `pitch dark`) and `OBJECT_WORDS` (first word of each object with words). `validateContext` is added in task 4.4.
    - Port nothing from C here; derive only from `src/data`. Add no hand-written word or room list.
    - Verify in a quick check, not a committed test: `You're at "Y2".` becomes `You're at 'Y2'.`, all room strings fit 80 characters and the character set.
    - _Requirements: 2.8, 6.6_

- [x] 3. Test guard and shared test support
  - [x] 3.1 Add the no-network test guard
    - Create `tests/setup/no-network.ts` that replaces `globalThis.fetch` with a function throwing `Error('real network request attempted in test')`, and register it in `vitest.config.ts` through `setupFiles` (keep every existing setting, including the DOM test configuration). If the config uses `projects`, register the file for each project.
    - Create `tests/setup/no-network.test.ts` asserting that calling global `fetch` throws that error, in both the Node and the happy-dom environment.
    - Run the whole suite to confirm no existing test used real `fetch`.
    - _Requirements: 13.1, 13.2, 13.11_

  - [x] 3.2 Test the autosave round trip with `translation` lines and older autosaves
    - File `tests/ai-parser/properties/p19-autosave-translation.test.ts`: **Property 19: Autosave round trip with translation lines.** For any autosave record (running state, prompt, and transcript lines of any kind including `translation`, built with `arbTranscriptLine` that now includes `translation`), `decodeAutosave(encodeAutosave(x))` gives back the same state, prompt and non-boot lines (last 200).
    - File `tests/ui/autosave-translation.test.ts`: an old-format fixture (an autosave record written before the kind existed, with `original`, `input`, `notice`, `narrator` lines) decodes to the same lines as before this feature; the default `Transcript.tail` excludes `translation` lines; the autosave call with `AUTOSAVE_LINE_KINDS` includes them; a record with an unknown kind is still rejected.
    - **Validates: Requirements 4.13, 4.14, 4.15, 13.13**
    - _Requirements: 4.12, 4.13, 4.14, 4.15, 13.13_

  - [x] 3.3 Create the injection corpus and the adversarial generators
    - `tests/support/injection-corpus.ts`: an exported array of at least 22 distinct strings, each under 200 characters and free of control characters except where a test needs a multi-line variant (export those separately as `MULTILINE_PAYLOADS`), covering five tagged categories: instruction override, system-prompt disclosure request, role-play request, delimiter escape (`</player_text>`, JSON closers, code fences, quote and brace breakouts), and multi-line payload. Include look-alike non-ASCII strings and strings that ask for Meta_Commands (`QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE`). Export `CORPUS_BY_CATEGORY`.
    - `tests/support/ai-generators.ts`: fast-check arbitraries for adversarial strings (empty, whitespace, up to 10,000 characters, non-ASCII, NUL), arbitrary provider output (string, empty, over-length, non-string, malformed), and context mutations (extra field, wrong type, over-length, out-of-set values).
    - _Requirements: 9.8, 13.3, 13.12_

- [x] 4. Shared pure modules (`src/shared`)
  - [x] 4.1 Implement `src/shared/normalize.ts`
    - `normalizePlayerText` (NFKC, typographic apostrophes and quotation marks to ASCII, collapse whitespace runs including U+00A0 to one space, trim, in that order), `hasControlChars` (U+0000 to U+001F and U+007F) and `hasLoneSurrogate` (a loop, no lookbehind). Cite no C function; this is new code.
    - _Requirements: 2.6, 6.6_

  - [x] 4.2 Implement `src/shared/vocabulary.ts` and `src/shared/meta-commands.ts`
    - `lookupWord` (delegating to the engine's `getMotionVocabId`, `getObjectVocabId`, `getActionVocabId`, then `strncaseeq` with `TOKLEN` to find the canonical table word, uppercase; `oldstyle` false; the reservoir word is not a vocabulary word) and `scanWords` (mirrors the engine's `wordCount` and `scanTwoWords`).
    - `META_WORDS` (`quit`, `suspe`, `pause`, `save`, `resum`, `resta`, `seed`, `waste`), `META_ACTION_IDS` computed at load, and `isMetaWord`.
    - _Requirements: 2.5, 8.2, 8.3, 8.9_

  - [x] 4.3 Implement `src/shared/command-validation.ts`
    - `validateCommand` (total, never throws: non-strings rejected; trim; remove one pair of matching surrounding `"`, `'` or backtick; ASCII-only uppercase; length 1 to 30 and `^[A-Z]+( [A-Z]+)?$`; every word resolves; no Meta_Command word; return canonical words joined by one space), `isClassicCommandText(text, zzword, oldstyle)` (same lookup as the engine: `wordCount` 1 to 2 and every scanned word has a type other than `NO_WORD_TYPE`), and `isContextCommand`.
    - `NOCOMMAND` must reject. `ENTER BUILDING` must yield `ENTER BUILD`.
    - _Requirements: 2.5, 2.7, 8.1, 8.2, 8.3, 8.4, 8.9_

  - [x] 4.4 Implement `validateContext` and `src/shared/protocol.ts`
    - Add `validateContext` to `src/shared/context-rules.ts`: exact key set `room`, `objects`, `last`; `room` in `ROOM_SET`; `objects` at most 12 entries, each in `OBJECT_WORDS` and 1 to 12 letters; `last` at most 2 entries, each passing `isContextCommand`, at most 30 characters, matching `^[A-Z]+( [A-Z]+)?$`, no Meta_Command word.
    - `src/shared/protocol.ts`: `ERROR_CODES` (exactly the ten codes), `ParseRequest`, `encodeRequest` (fixed key order), `decodeRequest` (strict: exact keys, text 1 to 200 characters, no control characters or lone surrogates, valid context), `encodeSuccess`, `decodeSuccess` (exactly one key `command`, a string), `decodeErrorBody`.
    - _Requirements: 6.1, 6.2, 6.6, 6.11, 6.15, 6.16, 8.10_

  - [x] 4.5 Write the Meta_Command classification test pinned against `ACTIONS`
    - File `tests/shared/meta-commands.test.ts` (required). Read the generated `ACTIONS` table and write a fixed expected list in the test: for every non-empty `ACTIONS` entry, its joined word string and whether it is a Meta_Command (exactly the five session-control actions `QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE`; ids 18, 34, 35, 39, 40 as recorded in the design, re-verify them from `src/data/dungeon.ts`).
    - Assert the table has exactly those entries (count included, the two empty entries excluded), that each word of `META_WORDS` resolves to an action in `META_ACTION_IDS`, that no non-meta entry is classified as meta, and that `WAKE`, `BLAST`, `SCORE`, `ATTACK`, `THROW` and the magic words are allowed. A change to the generated table or to the dispatcher in `src/engine/actions.ts` that adds a session-control action must fail this test until the list is reviewed.
    - _Requirements: 8.3, 8.12_

  - [x] 4.6 Write property test for vocabulary closure
    - File `tests/ai-parser/properties/p01-vocabulary-closure.test.ts` (required, at least 100 runs, strings up to 10,000 characters, plus the adversarial corpus as examples).
    - **Property 1: Vocabulary closure**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 6.2**

  - [x] 4.7 Write property test for the request and response codec round trip with context validity
    - File `tests/ai-parser/properties/p08-codec-round-trip.test.ts` (required). Generate valid requests with text of 1 to 200 characters without control characters and contexts that pass `validateContext` (built from `ROOM_SET`, `OBJECT_WORDS` and canonical `last` commands). Assert `decodeRequest(JSON.parse(encodeRequest(x)))` equals `x`, the encoded body is at most 2,048 bytes (include the worst case: 200 four-byte characters with a 12-object context and two 30-character `last` entries), every generated context passes `validateContext`, and `decodeSuccess(JSON.parse(encodeSuccess(c)))` equals `c` for arbitrary accepted commands.
    - **Property 8: Codec round trip and size bound**
    - **Validates: Requirements 6.15, 6.5**

  - [ ]* 4.8 Write property test for validation round trip
    - File `tests/ai-parser/properties/p02-validation-round-trip.test.ts`.
    - **Property 2: Validation round trip**
    - **Validates: Requirements 8.8**

  - [ ]* 4.9 Write property test for classic-command oracle agreement
    - File `tests/ai-parser/properties/p03-classic-oracle.test.ts`. Compare `isClassicCommandText` with the engine's own `wordCount` and `tokenize` (read from `src/engine`) for arbitrary strings and states.
    - **Property 3: Classic-command oracle agreement**
    - **Validates: Requirements 2.5, 2.7**

  - [ ]* 4.10 Write property test for normalization
    - File `tests/ai-parser/properties/p04-normalization.test.ts`.
    - **Property 4: Normalization shape and idempotence**
    - **Validates: Requirements 2.6**

  - [ ]* 4.11 Write unit tests for the shared modules
    - Files `tests/shared/command-validation.test.ts`, `tests/shared/context-rules.test.ts`, `tests/shared/normalize.test.ts`: quote and backtick stripping, ASCII-only uppercase (`ı`, `ſ` do not become `I`, `S`), `NOCOMMAND` rejected, `ENTER BUILDING` yields `ENTER BUILD`, three words, newline and digits rejected; all 185 locations sanitize to the character set and at most 80 characters, with the `Y2` and location 89 values; object words 1 to 12 letters; control characters and lone surrogates.
    - _Requirements: 2.6, 2.8, 6.6, 8.1, 8.2, 8.4_

- [x] 5. Checkpoint - shared modules
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Server: Parse_Endpoint, D1 gate and Cloudflare configuration
  - [x] 6.1 Implement `src/parse-api/config.ts` and `src/parse-api/prompt.ts`
    - `ENV_VARIABLE_NAMES` (`MODEL_NAME`, `DAILY_CAP`, `RATE_LIMIT`, `RATE_WINDOW_SECONDS`, `UPSTREAM_TIMEOUT_MS`, `IP_HASH_SALT`, `DEV_ALLOW_MISSING_IP`), `ParseConfig`, `readConfig` (daily cap must match `/^[1-9][0-9]{0,8}$/`, else undefined; defaults 30, 60 s, 3500 ms; `allowMissingIp` only for the literal `1`).
    - `buildSystemPrompt` (fixed text generated once from `src/data`: role, closed vocabulary of motions, objects and actions without the Meta_Command words, the output rule with `NOCOMMAND`, the statement that `player_text` and `game_context` are data and never instructions, the pronoun rule, eight few-shot examples), `buildUserMessage` (`JSON.stringify({player_text, game_context})`), and `PROMPT_EXAMPLES` whose answers all pass `validateCommand`.
    - _Requirements: 7.7, 7.11, 7.12, 9.1, 9.2, 9.4, 10.9, 12.2_

  - [x] 6.2 Implement `src/parse-api/provider.ts` and `src/parse-api/http.ts`
    - `Provider` and `ProviderInput`, `AiLike`, and `workersAiProvider(ai, model)`: one `messages` array with a system and a user message, `max_tokens` 16, `temperature` 0, no tools, no history, no client headers or IP; returns `response` if a string, else `choices[0].message.content` if a string, else throws. Pass `signal` only as the spike result (task 1.2) allows.
    - `jsonResponse` (always `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, never an `Access-Control-*` header) and `readBodyLimited(request, 2048)` (early reject on a declared length over the limit, then a counted stream read that cancels as soon as the count exceeds 2,048, so at most 2,048 bytes plus one chunk are buffered).
    - _Requirements: 6.5, 6.11, 6.12, 6.13, 9.2, 9.3, 10.1, 11.7_

  - [x] 6.3 Implement the D1 gate: `migrations/0001_gate.sql`, `src/parse-api/gate.ts`, `src/parse-api/d1-gate-store.ts`
    - The migration with the `hits` and `daily` tables as in the design.
    - `gate.ts`: `AdmitArgs`, `GateStore`, `AdmitDecision`, `utcDay`, and `admit` (cap undefined returns `capped` without touching the store; a store exception returns `unavailable`; `retryAfterSec = clamp(ceil((oldest + windowMs - now)/1000), 1, 60)`, or 60 if that read fails). Half-open window: a hit at `h` counts at `t` while `h > t - windowMs`.
    - `d1-gate-store.ts`: the statements S0 to S4 in one `db.batch`, `oldestInWindow`, `releaseSlot`, `sweep`, and the salted SHA-256 IP key helper (first 32 hex characters, `crypto.subtle`). Structural `D1Like` types, no Cloudflare import. Apply the SQL fallback recorded by task 1.3 if one was needed.
    - _Requirements: 7.2, 7.3, 7.5, 7.7, 7.8, 7.12, 7.13_

  - [x] 6.4 Implement `src/parse-api/handler.ts`
    - `handleParse(request, env, deps)` with the pipeline of the design: method (405 + `Allow: POST`, OPTIONS included), origin and `Sec-Fetch-Site` (403), content type (415), size (413), availability of provider, store, model and salt (503), client IP or dev flag (400), `admit` (429 + `Retry-After`, 503 for cap or store error), JSON and strict schema (400, slot released), provider race against `upstreamMs` (504 on timeout, 502 on throw or non-string), `validateCommand` (422 `no_command`), then 200. A top-level catch returns 502 `upstream`.
    - Only `{status, code, ms}` is logged for non-2xx responses. No request data, IP or provider output in any log, body or header. Error bodies are exactly `{"error": code}`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 7.1, 7.3, 7.4, 7.5, 7.6, 7.8, 9.5, 9.6, 9.7, 11.3, 11.4, 11.8_

  - [x] 6.5 Add the Pages Function entry, its tsconfig and the package scripts
    - `functions/api/parse.ts`: export `onRequest` (all methods go to `handleParse`), wiring `AI`, `DB`, `crypto.randomUUID`, timers, `waitUntil` and the log function. This is the only file with Cloudflare types.
    - `functions/tsconfig.json` as in the design (strict, workers-types, includes `../src/shared`, `../src/parse-api`, `../src/engine`, `../src/data`).
    - `package.json` scripts: `typecheck` = `tsc --noEmit && tsc --noEmit -p functions/tsconfig.json`, `dev:pages` = `npm run build && wrangler pages dev dist`, `db:local` = per the task 1.3 outcome. `build` still runs `typecheck`. Keep every dependency pinned.
    - Run `npm run typecheck`. Do not run `dev:pages` (long-running; it also reaches the real AI service).
    - _Requirements: 12.1, 12.5, 12.6_

  - [x] 6.6 Add the Cloudflare configuration files
    - `wrangler.toml`: keep the existing non-secret Pages settings; add `[ai] binding = "AI"`, `[[d1_databases]]` (`DB`, `advent-gate`, placeholder `database_id` of zeros, `migrations_dir`), and `[vars]` (`MODEL_NAME`, `DAILY_CAP = "2000"`, `RATE_LIMIT`, `RATE_WINDOW_SECONDS`, `UPSTREAM_TIMEOUT_MS = "3500"`, `IP_HASH_SALT`). No observability, logpush, tail or `DEV_ALLOW_MISSING_IP`.
    - `public/_routes.json` = `{"version":1,"include":["/api/*"],"exclude":[]}`. Leave `public/_headers` unchanged (`connect-src 'self'`).
    - `.dev.vars.example` with all seven names from `ENV_VARIABLE_NAMES`, non-secret values, `DEV_ALLOW_MISSING_IP=1`.
    - `.gitignore`: add `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`, `.wrangler/`; keep `node_modules/`, `dist/`, `.env*`.
    - _Requirements: 7.11, 10.3, 10.5, 10.9, 10.11, 11.5, 12.2, 12.3, 12.7, 12.8_

  - [x] 6.7 Create the server test doubles
    - `tests/support/ai-fakes.ts`: `FakeProvider` (scripted output, call counter, can obey an injection, can hang), `MemoryGateStore` (atomic `admit` with an injected scheduler), `NonAtomicGateStore` (read-then-write negative control), and `NodeSqliteD1` (a `D1Like` over `node:sqlite` `DatabaseSync`; `batch` runs `BEGIN`/`COMMIT`/`ROLLBACK`; fault injection per call and per statement index; applies `migrations/0001_gate.sql`).
    - A helper that builds a valid `Request` and a `ParseDeps` with an injected clock, id source and timers.
    - _Requirements: 13.1, 13.9, 13.14_

  - [x] 6.8 Write the rate-limit and daily-cap SQL tests on `node:sqlite`
    - File `tests/parse-api/d1-gate-store.test.ts` (required). Run the real statements through `NodeSqliteD1`:
      - Sliding window with 30 hits at t=0: a request at 59 s is rejected, at 60 s and 61 s admitted (half-open window); the 31st request within a window is rejected; `oldestInWindow` yields a `Retry-After` from 1 to 60 and a request at that time is admitted.
      - Exact daily cap: with cap N, exactly N slots are reserved and request N+1 is capped; the capped request is uncounted against the IP (S3); midnight UTC rollover resets the count; a cap of zero or a missing cap admits nothing.
      - Rollback: an injected failure at each statement of the batch leaves `hits` and `daily` unchanged and `admit` returns `unavailable` and no provider call follows.
      - `releaseSlot` never goes below zero; `sweep` removes expired hits and old days; the raw IP is never stored (only the hashed key appears in the tables).
    - _Requirements: 7.2, 7.3, 7.5, 7.7, 7.8, 7.10, 7.12, 7.13, 13.14_

  - [x] 6.9 Write the injection-corpus test
    - File `tests/parse-api/injection.test.ts` (required). For every string of the corpus (task 3.3, at least 20, all five categories, asserted by a meta-test on corpus size and categories):
      - send it as `text` through `handleParse` with a `FakeProvider` that obeys the injection by returning the attacker-requested text; assert every response is status 422 or a 200 whose command passes `validateCommand` with no Meta_Command, and that no body or header contains the system prompt, the model name or a binding name;
      - send it as `room`, as an `objects` entry and as a `last` entry (separately); assert every response is 400 and the provider is called 0 times.
    - Also assert the provider input has exactly one user message built by `buildUserMessage`, no tools, `max_tokens` 16 and `temperature` 0.
    - _Requirements: 8.10, 8.11, 9.1, 9.2, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [ ]* 6.10 Write example tests for every handler status
    - File `tests/parse-api/handler.test.ts`: one example per status 200, 400, 403, 405 (GET and OPTIONS, `Allow: POST`), 413 (2,048 and 2,049 bytes, no `Content-Length`, bounded read), 415, 422, 429, 502, 503, 504 (3,499 and 3,500 ms with fake timers); headers on every response; gate runs after the size check and before JSON parsing (call log); missing IP with and without the dev flag; provider and store absent; only the permitted log entry.
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 7.4, 7.6, 11.4, 13.9_

  - [ ]* 6.11 Write prompt tests and the prompt-isolation property
    - File `tests/parse-api/prompt.test.ts`: every non-meta table word appears in the system prompt; the data-not-instructions statement; every example answer validates.
    - File `tests/ai-parser/properties/p10-prompt-isolation.test.ts`: **Property 10: Prompt isolation**
    - **Validates: Requirements 8.11, 9.1**

  - [ ]* 6.12 Write property test for invalid context or request rejected before the provider
    - File `tests/ai-parser/properties/p07-invalid-context.test.ts`.
    - **Property 7: Invalid context or request rejected before the provider**
    - **Validates: Requirements 6.6, 8.10, 9.10, 13.12**

  - [ ]* 6.13 Write property test for handler totality and response hygiene
    - File `tests/ai-parser/properties/p09-handler-hygiene.test.ts`.
    - **Property 9: Handler totality and response hygiene**
    - **Validates: Requirements 6.2, 6.7, 6.11, 6.12, 6.13, 9.5, 9.6, 9.7, 11.3, 11.8**

  - [ ]* 6.14 Write property test for the sliding-window rate limit
    - File `tests/ai-parser/properties/p11-rate-limit.test.ts`. Run against `MemoryGateStore` and against `NodeSqliteD1`; include times at exactly 0, 59, 60 and 61 s.
    - **Property 11: Sliding-window rate limit**
    - **Validates: Requirements 7.2, 7.3, 7.10**

  - [ ]* 6.15 Write property test for the daily cap under concurrency
    - File `tests/ai-parser/properties/p12-daily-cap.test.ts`. Caps 1 to 300, up to 200 concurrent admits scheduled by fast-check, against `MemoryGateStore` and `NodeSqliteD1` (admitted count never exceeds the cap); the `NonAtomicGateStore` negative control must exceed the margin for at least one generated schedule; midnight reset; invalid cap values admit nothing and do not touch the store.
    - **Property 12: Daily cap under concurrency**
    - **Validates: Requirements 7.8, 7.12, 7.13, 7.14, 13.14**

  - [ ]* 6.16 Write property test for fail closed
    - File `tests/ai-parser/properties/p13-fail-closed.test.ts`. Inject a failure at every store call (before, during, after the batch) and a missing store or provider, against `MemoryGateStore` and `NodeSqliteD1`.
    - **Property 13: Fail closed**
    - **Validates: Requirements 7.5, 6.10**

- [x] 7. Checkpoint - server
  - Run `npx vitest --run` and `npm run typecheck` (includes `functions/`). Ensure all tests pass, ask the user if questions arise. Do not run wrangler against Cloudflare.

- [x] 8. Client AI parser (`src/parser`)
  - [x] 8.1 Implement `src/parser/config.ts` and `src/parser/eligibility.ts`
    - `AI_BUDGET_MS = 4000` as the single named constant, `ENDPOINT`, breaker and Retry-After constants, `MAX_RESPONSE_CHARS`.
    - `classifyInput(line, input)` with the order of tests from the design: any undefined field, mode not `haunted`, prompt not `command`, engine pending tag not `command`, or phase not `ready` gives `pass`; empty, whitespace or numeric lines give `pass`; a classic command gives `pass` with the unnormalized line; normalized text empty gives `pass`; over 200 characters, a control character or a lone surrogate gives `fallback-no-request`; otherwise `ask`.
    - _Requirements: 1.1, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 12.11_

  - [x] 8.2 Implement `src/parser/game-context.ts`
    - `buildGameContext(state, last)`: `room` is `pitch dark` when `isDarkHere`, else `roomText(game.loc)`; `objects` is empty while dark, otherwise the walk over `atloc` and `link` as the engine's `listObjects` does (twin entries mapped to the base object, `STEPS` skipped while the nugget is carried, not-yet-found objects skipped when closed, objects without words skipped), first word, deduplicated, ordered by object index, at most 12, never carried objects. Read-only.
    - `CommandMemory`: `reset`, `note` (records the canonical command only when `validateCommand` succeeds and `isContextCommand` holds, so numbers, the reservoir word, Meta_Commands and unknown words are never recorded), `last` (at most 2, oldest first). Not persisted.
    - Cite the engine function mirrored in a comment.
    - _Requirements: 2.8, 2.9, 2.11, 2.12_

  - [x] 8.3 Implement `src/parser/ai-parser.ts` and `src/parser/browser.ts`
    - `AiParser` with `needsTranslation`, `translate` (never rejects; in-flight guard; offline, open circuit and Retry-After wait checks; request with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`, `redirect: 'error'`; a budget timer that aborts; the outcome table of the design including which causes count toward the breaker and when the notice is returned), `startGame`, `accepted`. 200 bodies are re-validated with `decodeSuccess` and `validateCommand`; bodies over 1,024 characters and non-JSON are fallbacks.
    - `createBrowserAiParser(log)` binds `window.fetch`, `performance.now`, `setTimeout`, `clearTimeout`, `navigator.onLine`. Uses only `fetch`, `AbortController`, `Promise`, timers, `performance` and `navigator.onLine`.
    - _Requirements: 1.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 7.9, 8.5, 8.6, 11.1, 11.2, 14.3, 14.4_

  - [x] 8.4 Create `src/ui/input-resolver.ts`
    - Types only: `GamePhase`, `ResolveContext`, `TranslateOutcome`, `InputResolver` as in the design. Imports only engine types and `Mode`, `PromptKind` from `src/ui/types.ts`.
    - Add a type-level assertion (in a test or in `src/parser/ai-parser.ts` through `satisfies`) that `AiParser` is assignable to `InputResolver`, without `src/ui` importing `src/parser`.
    - _Requirements: 3.9, 3.10_

  - [x] 8.5 Create the client test doubles
    - `tests/support/ai-client-fakes.ts`: `FakeFetch` (scripted status, body, delay with fake timers, throw; records every call and its init; honors `signal`), `FakeResolver` (scheduler-controlled promises that implement `InputResolver`; records `startGame` and `accepted`), and arbitraries for fetch behaviors.
    - _Requirements: 13.1, 13.7, 13.8_

  - [x] 8.6 Write property test for the eligibility partition
    - File `tests/ai-parser/properties/p05-eligibility-partition.test.ts` (required, at least 100 runs). Drive the real `AiParser` with a `FakeFetch` over arbitrary lines, modes, prompt kinds, pending tags, phases and states (including undefined). Assert zero requests in every case except the single eligible one, which sends exactly one request whose body has only `text` and `context`, with `text` equal to the normalized line; assert the line given on is byte-for-byte unchanged in every zero-request case; assert zero fetch calls in 1976 mode for arbitrary lines, zero for `yesno` and `filename` prompts, and zero for every classic command generated from the vocabulary.
    - **Property 5: Eligibility partition**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 11.1, 13.4, 13.5, 13.6**

  - [ ]* 8.7 Write property test for Game_Context closure
    - File `tests/ai-parser/properties/p06-context-closure.test.ts`. Engine states from random classic command sequences and seeds, including dark and lit rooms; `buildGameContext` passes `validateContext`, lists only objects at the location, none while dark or carried.
    - **Property 6: Game_Context closure**
    - **Validates: Requirements 2.8, 2.9, 2.12, 13.12**

  - [ ]* 8.8 Write property test for client resilience
    - File `tests/ai-parser/properties/p14-client-resilience.test.ts`.
    - **Property 14: Client resilience**
    - **Validates: Requirements 5.2, 5.4, 5.10, 8.5, 13.3**

  - [ ]* 8.9 Write property test for the circuit breaker, Retry-After and notice
    - File `tests/ai-parser/properties/p15-circuit-breaker.test.ts`, with an injected clock.
    - **Property 15: Circuit breaker, Retry-After and notice**
    - **Validates: Requirements 5.3, 5.6, 5.7, 5.8, 5.11**

  - [ ]* 8.10 Write unit tests for the client parser
    - Files under `tests/parser/`: budget at 3,999 and 4,000 ms with fake timers (the abort signal is aborted and Fallback happens exactly once; none at 3,999); late response ignored; offline; in-flight guard; `credentials: 'omit'` and `referrerPolicy: 'no-referrer'` on the request; open circuit resolves in the same tick; notice printed once and re-armed by a success; no notice for `no_command`, over-long text and aborts; type-level assignability to `InputResolver`.
    - _Requirements: 5.1, 5.6, 5.7, 5.9, 7.9, 11.2, 13.7_

- [x] 9. UI integration (`GameController`, view, `main.ts`)
  - [x] 9.1 Extend `TerminalPort` and the `FakeTerminal`
    - `src/ui/types.ts`: add `showPending(): void`, `hidePending(): void` and `announceInterpretation(command: string): void` to `TerminalPort`.
    - `tests/ui/support/fakes.ts`: `FakeTerminal` records the three new calls.
    - _Requirements: 4.4, 4.6, 4.7_

  - [x] 9.2 Add the asynchronous input-resolution stage to `src/ui/game-controller.ts`
    - Implement as in the design: `setInputResolver`, `processLine` splitting into the synchronous path (exactly the previous behavior for 1976 mode, `yesno`, `filename`, classic commands) and `beginResolution`, strictly FIFO processing (`resolving` blocks the queue loop), `onResolved` (stale-token check, prompt change or changed state uses the Player_Text, `translation` line emitted and `announce` skipped for it, Offline_Notice `NOTICE_AI_OFFLINE` when `notice` is true), `onResolveFailed` (logged, line delivered unchanged), `deliver` (transform hook, `step` once, `resolver.accepted(text)` after a successful `command` step), the 10 s watchdog and the 400 ms pending indicator driven by `tick`, `startFresh` and restore discarding the pending result and the queue and calling `resolver.startGame()`.
    - The input history stores the Player_Text, never the translated command. `onRevealed` calls `view.announceInterpretation(text.trim())` for a `translation` block and returns before `hooks.notifyOutput` and `view.announce`. No DOM, timer or network call is added to the controller (it keeps using `tick`).
    - The synchronous path must remain byte-identical in timing and output to before; run the existing UI and engine suites.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 4.1, 4.4, 4.6, 4.7, 4.9, 4.10, 4.12, 5.5, 5.6, 14.2, 14.7_

  - [x] 9.3 Update `src/ui/dom/terminal-view.ts` and `index.html`
    - `showPending`, `hidePending` (new lines are inserted before the pending element; `clear()` drops it), `announceInterpretation` writing `Interpreted as <command>` to a second polite live region `#live-interpreted` (optional in `TerminalViewElements`, falling back to `#live`). The translation line is a `div.line.line--translation` with the command as text content. Text only; no `innerHTML`.
    - `index.html`: add `<div id="live-interpreted" class="sr-only" aria-live="polite" aria-atomic="true"></div>` after `#live`.
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11_

  - [x] 9.4 Load the AI parser lazily in `src/main.ts`
    - Add `loadAiParser(ctl, log, load = () => import('./parser/browser'))` exactly as in the design and call it with `void` after `startBoot()`. Export it for the test. A load failure is logged and prints nothing in the game output.
    - Run `tests/ui-layering.test.ts` (task 2.4) to confirm the only reference to `src/parser` is dynamic. Run `npm run build` and confirm the parser is a separate chunk.
    - _Requirements: 1.2, 3.10, 14.1_

  - [ ]* 9.5 Write example tests for the controller with a fake resolver
    - File `tests/ui/game-controller-ai.test.ts`: exact view-call sequences for echo order, queue order (a second line waits and is echoed at its turn), new-game discard, first-failure notice and no second notice, watchdog at 10 s, pending indicator at 399 and 400 ms and its removal on settle, prompt change before resolution, translation-line placement, resolver throwing or rejecting, context built after the previous step, 1976 mode never consults the resolver.
    - _Requirements: 3.2, 3.5, 3.6, 3.7, 3.8, 3.11, 4.6, 4.7, 5.6, 13.8_

  - [ ]* 9.6 Write property test for ordered, exactly-once resolution
    - File `tests/ai-parser/properties/p16-ordered-resolution.test.ts`.
    - **Property 16: Ordered, exactly-once resolution**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

  - [ ]* 9.7 Write property test for translation display and history
    - File `tests/ai-parser/properties/p17-translation-display.test.ts`.
    - **Property 17: Translation display and history**
    - **Validates: Requirements 4.1, 4.4, 4.9, 4.10, 4.12**

  - [ ]* 9.8 Write property test for fallback transparency
    - File `tests/ai-parser/properties/p18-fallback-transparency.test.ts`. Real `AiParser` with a failing `FakeFetch` through the real controller, compared with a session without a resolver.
    - **Property 18: Fallback transparency**
    - **Validates: Requirements 4.8, 5.5, 5.6, 8.6, 14.6, 14.7**

  - [ ]* 9.9 Write view and contrast tests
    - Files `tests/ui/dom/translation-view.test.ts` (happy-dom docblock as in the existing DOM tests) and `tests/ui/translation-contrast.test.ts`: `line--translation` text equals the command; pending element is `aria-hidden`; `#live-interpreted` text; reduced-motion rule present. The contrast test recomputes the ratio from `crt.css` under the design's worst-case model and fails if `--translation` is missing, not dimmer than `--fg`, or below 4.5:1.
    - _Requirements: 4.2, 4.4, 4.5, 4.11_

  - [ ]* 9.10 Write the load-failure test
    - File `tests/ui/main-load.test.ts`: `loadAiParser` with a loader that rejects logs the error, installs no resolver, prints nothing to the game output, and typed input still works.
    - _Requirements: 14.1_

- [x] 10. 1976 isolation and fidelity with the AI parser installed
  - [x] 10.1 Write the 1976-isolation test
    - File `tests/ui/ai-isolation.test.ts` (required). Use the real `AiParser` with a fetch spy, installed in the real `GameController`:
      - fast-check property (at least 100 runs): for arbitrary lines in 1976 mode (including text that is not a classic command), the fetch spy is called 0 times and the `original` output equals that of a controller with no resolver;
      - every upstream `.log` in `reference/open-adventure/tests/` replayed through the controller in 1976 mode with the options and seed the existing fidelity harness uses, twice (no resolver, then with the AI parser installed): identical `original` text, zero fetch calls, and where the harness compares to a `.chk` the output equals it byte for byte;
      - the 430-point walkthrough played through the controller with the AI parser installed: identical output to the run without it, final score 430 read from the `game-over` event (not the last `score` event), zero fetch calls;
      - a Haunted-mode run of classic commands with an always-failing fetch gives the same `original` text as the run without a resolver.
    - Do not edit `tests/fidelity.test.ts` or `tests/walkthrough.test.ts`; reuse their helpers or copy the harness setup.
    - _Requirements: 1.1, 1.2, 5.5, 13.4, 13.10_

- [x] 11. Tooling, scans, latency script and documentation
  - [x] 11.1 Create `scripts/credential-patterns.ts` and extend `scripts/check-dist.ts`
    - `credential-patterns.ts` exports `CREDENTIAL_PATTERNS`, `VITE_AI_PATTERNS` and `findCredentials(text)`; the pattern strings are assembled by concatenation so the module does not match itself. Patterns: the authorization-bearer header form, `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `account_id`, key-shaped `sk-` strings with 20 or more letters and digits; and for AI variables, `VITE_` names containing `AI`, `PARSE`, `MODEL`, `KEY`, `TOKEN`, `CLOUDFLARE` or `CF`, plus `import.meta.env.VITE_`.
    - `check-dist.ts`: scan every text file under `dist/` (`.js .html .css .map .json .txt`, `_headers`, `_routes.json`), list each offending file and exit non-zero; require `dist/_routes.json` with `include` exactly `["/api/*"]`; require the privacy statements (a) to (d) in the credits bundle; fail if the bundle contains `@cf/`. Keep the checks that already exist.
    - _Requirements: 10.4, 10.6, 11.6, 12.7, 12.8_

  - [x] 11.2 Write the repository scan test
    - File `tests/repo/repo-scan.test.ts` (required). Scan every file from `git ls-files` (skip binary files and `.dev.vars.example`, `scripts/credential-patterns.ts` and `.kiro/specs/ai-parser/*`, which are the only exemptions) with `findCredentials` and the `VITE_` AI patterns, and fail naming each offending file. Include the self-check: an in-memory fixture with a planted sample credential and a planted sample `VITE_` AI variable must be detected, so a scan that never matches fails.
    - If an existing tracked file legitimately contains a pattern, fix the file (reword) rather than widening the exemptions; report any case where that is not possible.
    - _Requirements: 10.3, 10.4, 10.7, 10.8_

  - [x] 11.3 Write the `dist` scan test
    - File `tests/scripts/check-dist.test.ts` (required). Run the `check-dist` logic (import its function, or spawn it with `tsx`) against temporary `dist` directories: a clean one passes; one with a planted credential pattern in a `.js`, a `.map` and a `.json` file fails and names each file; a missing or wrong `_routes.json` fails; a bundle containing `@cf/` fails; a missing privacy statement fails. Remove the temporary directories.
    - _Requirements: 10.6, 11.6, 12.8_

  - [x] 11.4 Add the `measure:latency` script
    - `scripts/measure-latency.ts`: pure exported `summarize(samples)` (nearest-rank percentiles `sorted[ceil(q*n) - 1]`, count per status code) and `runMeasurement({fetch, now, sleep, baseUrl, sentences})` (20 requests with valid contexts, at least 2,100 ms apart, printing p50, p95, the status counts and the returned command per sentence); the CLI entry is guarded by `import.meta.url` and takes the base URL argument.
    - Add the `measure:latency` entry to `package.json` (`tsx scripts/measure-latency.ts`). The agent never runs it against a real URL.
    - Its tests are in the optional task 11.8; here, run `npm run typecheck`.
    - _Requirements: 12.12, 12.14_

  - [x] 11.5 Update the README and the credits page
    - README deploy section: remove the sentence "No environment variables or secrets are needed"; state that deployment is performed manually by the project owner; describe enabling the AI binding, setting `MODEL_NAME` and `DAILY_CAP`, creating the D1 database `advent-gate` (`wrangler d1 create advent-gate`, owner runs it), putting its id in `wrangler.toml`, applying `migrations/0001_gate.sql` remotely, deploying, and local testing (`npm run db:local` if kept, `.dev.vars` from `.dev.vars.example`, `npm run dev:pages`) with the warning that the local AI binding calls the real service and uses the owner's free allocation.
    - Document `measure:latency`: how to run it against a deployed URL, how to read p50 and p95, and how to adjust `AI_BUDGET_MS` and `UPSTREAM_TIMEOUT_MS` (`UPSTREAM_TIMEOUT_MS` about 1.5 x p95 rounded up to 100; `AI_BUDGET_MS` at least 500 ms above it). Show the cost arithmetic (3.1 Neurons per request, `DAILY_CAP` 2000 gives 6,200 of 10,000, 62 percent, under the 80 percent limit; cap at most 2,580). Optional dashboard rate-limiting rule as a flood guard. A placeholder for the measured p50 and p95 that the owner fills in (task 13).
    - README and `credits.html` each state all four privacy statements (a) to (d) of Requirement 11.6 in plain words.
    - Do not write the credential pattern strings (such as the names of tokens or `account_id`) in the README; say "no keys, tokens or account identifiers" instead. Do not add a CI deploy step; do not change `.github/workflows/ci.yml` (its steps stay typecheck, tests, build, `check:dist`).
    - _Requirements: 7.11, 10.10, 11.6, 12.1, 12.9, 12.10, 12.13, 12.14_

  - [ ]* 11.6 Write repository and configuration tests
    - Files under `tests/repo/`: `wrangler.toml` variables, no observability or logging keys, no `DEV_ALLOW_MISSING_IP`, placeholder `database_id`; `.dev.vars.example` lists every `ENV_VARIABLE_NAMES` entry and has no credential; `_routes.json`; `_headers` CSP keeps `connect-src 'self'` and has no provider origin; `.gitignore` entries; `package.json` pins `wrangler` and `@cloudflare/workers-types` exactly in `devDependencies` (no `^`, `~`) and not in `dependencies`; `typecheck` script covers `functions/tsconfig.json`; `ci.yml` steps are exactly typecheck, tests, build, `check:dist` with no deploy and no `wrangler` call; README does not contain the removed sentence and contains the owner-step and privacy text; `AI_BUDGET_MS - UPSTREAM_TIMEOUT_MS >= 500`; cost arithmetic recomputed from `wrangler.toml`, a unit-price table in the test and the real `buildSystemPrompt()` length, asserting the 80 percent bound and that the README shows the numbers.
    - _Requirements: 7.11, 10.5, 10.9, 10.10, 11.5, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11_

  - [ ]* 11.7 Write the AI-parser layering test
    - File `tests/ai-parser-layering.test.ts`: `src/shared` imports only `src/data`, `src/engine/classic-parser` and itself; `src/parse-api` imports only `src/shared` and `src/data`; `src/parser` imports no `src/ui`; `functions/` imports only `src/parse-api` and `src/shared`; no file under `src/` or `vite.config.ts` imports `functions/`; `src/parser` uses no browser API outside `fetch`, `AbortController`, `Promise`, timers, `performance` and `navigator.onLine`; `src/shared` and `src/parse-api` hold no quoted vocabulary word list (other than the fixed Meta words, the prompt examples and `NOCOMMAND`); the engine imports nothing from `src/parser`, `src/haunt` or `src/voice`.
    - _Requirements: 3.9, 3.10, 8.9, 10.4, 14.3_

  - [ ]* 11.8 Write property test and unit test for the latency summary
    - File `tests/ai-parser/properties/p20-percentile-summary.test.ts`: **Property 20: Percentile summary**. File `tests/scripts/measure-latency.test.ts`: 20 requests, gaps of at least 2,100 ms with an injected sleep, the printed summary.
    - **Validates: Requirements 12.12**

- [x] 12. Final checkpoint - everything green
  - Run `npx vitest --run`, `npm run typecheck`, `npm run build` and `npm run check:dist`. Ensure all tests pass, ask the user if questions arise. Remind the user that no deployment, remote D1 creation, remote migration or login was performed, and that task 13 is theirs.

- [ ] 13. OWNER STEP - MANUAL, NOT EXECUTABLE BY THE AGENT (do not run, do not mark done on the owner's behalf)
  - The agent must skip this task. It needs the owner's Cloudflare account and login, creates remote resources and publishes the site. Nothing here is run by any agent task, test or CI step.
  - Steps for the project owner, in order (the README from task 11.5 repeats them):
    1. Log in to Cloudflare in the owner's own terminal (`wrangler login`).
    2. Create the D1 database: `wrangler d1 create advent-gate`. Put the returned id into `wrangler.toml` as the `database_id` of the `DB` binding.
    3. Apply the migration to the remote database: `wrangler d1 migrations apply advent-gate --remote` (or `wrangler d1 execute advent-gate --remote --file=migrations/0001_gate.sql`).
    4. Enable the Workers AI binding for the Pages project, and confirm the `[vars]` (`MODEL_NAME`, `DAILY_CAP`, `RATE_LIMIT`, `RATE_WINDOW_SECONDS`, `UPSTREAM_TIMEOUT_MS`, `IP_HASH_SALT`). Do not set `DEV_ALLOW_MISSING_IP`.
    5. Deploy the site: `wrangler pages deploy dist` (after `npm run build`).
    6. Check the unverified items from the spike on the real service: that `INSERT ... SELECT`, numbered parameters and `meta.changes` behave on D1 as in the tests (a few requests; the 31st within 60 seconds from one IP returns 429), and that a request with the AI binding disabled returns 503 `unavailable`.
    7. Run `npm run measure:latency -- https://<project>.pages.dev` (20 requests, about 42 seconds). Read the returned commands for translation quality; if poor, change `MODEL_NAME` and `DAILY_CAP` together.
    8. Record the p50 and p95 in the README measurement section, and adjust `UPSTREAM_TIMEOUT_MS` and `AI_BUDGET_MS` by the rule in the README if the numbers call for it (keep the 500 ms gap).
  - _Requirements: 10.10, 12.9, 12.13, 12.14_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required tests: the vocabulary-closure property (4.6), the codec round trip with context validity (4.7), the eligibility partition with zero fetch in 1976 mode (8.6), the 1976-isolation test (10.1), the injection corpus (6.9), the SQL gate tests (6.8), the Meta_Command classification (4.5), the no-network guard (3.1), the repository and `dist` scans (11.2, 11.3), the autosave round trip with `translation` and older autosaves (3.2), and the layering exception (2.4).
- Each task references specific requirements for traceability. Checkpoints ensure incremental validation.
- No task logs in, deploys, creates remote resources, applies remote migrations or sets secrets. Those steps are in task 13 and in the README.
- Property tests are in separate files under `tests/ai-parser/properties/` so tasks run in parallel. Tasks that write the same file are in different waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.3"] },
    { "id": 4, "tasks": ["3.2", "4.1", "4.2", "8.4", "9.1", "11.1"] },
    { "id": 5, "tasks": ["4.3", "4.5", "8.5", "9.2", "9.3", "11.2", "11.3"] },
    { "id": 6, "tasks": ["4.4", "4.6", "4.8", "4.9", "4.10", "6.1", "8.1", "8.2", "9.5", "9.6", "9.7", "9.9"] },
    { "id": 7, "tasks": ["4.7", "4.11", "6.2", "6.3", "6.6", "6.11", "8.3", "8.7"] },
    { "id": 8, "tasks": ["6.4", "6.7", "8.6", "8.8", "8.9", "8.10", "9.4", "9.8", "10.1"] },
    { "id": 9, "tasks": ["6.5", "6.8", "6.9", "6.10", "6.12", "6.13", "6.14", "6.15", "6.16", "9.10"] },
    { "id": 10, "tasks": ["11.4", "11.7"] },
    { "id": 11, "tasks": ["11.5", "11.8"] },
    { "id": 12, "tasks": ["11.6"] }
  ]
}
```
