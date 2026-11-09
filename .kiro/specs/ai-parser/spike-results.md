# Spike results (task 1): ai-parser

Consolidates the outcomes of tasks 1.1 (types), 1.2 (`Ai.run` and `AbortSignal`) and 1.3 (D1 SQL and `wrangler d1 execute --local`).
Environment: Node v22.23.4, TypeScript 7.0.2, wrangler 4.158.0, `@cloudflare/workers-types` 5.20261109.1, Windows.
No login, no remote command and no AI call was made. Scratch files were deleted (see Housekeeping).

Overall: no design assumption failed. Nothing requires a change to `requirements.md`. `design.md` and `tasks.md` were not edited; the items that downstream tasks must handle are in "Notes for downstream tasks".

## Summary table

| # | Item | Status | Result | Fallback chosen | Later tasks affected |
| --- | --- | --- | --- | --- | --- |
| 1 | `wrangler` and `@cloudflare/workers-types` 5.x typecheck under TypeScript 7.0.2 | Verified | `npx tsc --noEmit -p functions/tsconfig.json` exit 0, also with `--skipLibCheck false`; root `npm run typecheck` exit 0. Negative control (`const bad: number = 'x'`) failed as expected. Pins: `wrangler` 4.158.0, `@cloudflare/workers-types` 5.20261109.1, same as `npm view`, exact, in `devDependencies`. | None needed (local structural types and "ask the user" not triggered) | 6.5, 6.6 |
| 2 | Root `tsc` does not pick up `functions/` and has no type clash | Verified | Root `include` excludes `functions/`; root `types` (`node`, `vite/client`) do not clash. | None | 6.5 |
| 3 | `wrangler --version` works offline | Verified | `4.158.0`, no login prompt | None | n/a |
| 4 | `Ai.run` accepts a third options argument with `signal` | Verified in types only | `AiOptions.signal?: AbortSignal` exists in the 5.20261109.1 `index.d.ts`. | Adapter passes `{ signal }` as best effort; the race enforces the limit | 6.2, 6.4 |
| 5 | Text-generation response shape | Verified in types only | `@cf/ibm-granite/granite-4.0-h-micro` is a known key; output `{ response?: string; tool_calls?; usage? }`. `response` is optional; there is no typed `choices`. | Adapter checks `typeof response === 'string'` first; `choices[0].message.content` stays a defensive branch on `unknown` | 6.2 |
| 6 | Real `Ai` is assignable to the design's `AiLike` | Not assignable as is (overloads and model generics) | The model string needs a cast (hit in 1.1 and 1.2). | Cast in `functions/api/parse.ts` (see notes) | 6.2, 6.5 |
| 7 | Production runtime honors `signal` for non-streaming `run` | Not verifiable offline | A public issue (`cloudflare/ai` #640) reports streams ignoring abort; this project does not stream. | The plan never depends on abort: race against `UPSTREAM_TIMEOUT_MS` (3500 ms) and ignore a late result. Hanging `FakeProvider` tests prove the 504 path. | 6.2, 6.4, 13 (`measure:latency` shows it indirectly) |
| 8 | Real Granite runtime response shape (`{response: string}`) | Not verifiable offline | Types agree with the design. | Defensive extraction as in item 5 | 6.2, 13 |
| 9 | `node:sqlite` loads without a flag on this Node | Verified | Works on 22.23.4; prints `ExperimentalWarning` on stderr. PowerShell reports it as a NativeCommandError (exit 1) when stderr is merged. | None; tests ignore the warning | 6.8 |
| 10 | Numbered parameters `?1` to `?5` (per-statement numbering) | Verified on SQLite, not on real D1 | S2 uses `?1..?5`, S3 uses `?1..?4`; works with `prepare(sql).run(...)`. | If real D1 differs: positional `?` only (item 14) | 6.3, 6.8, 13 |
| 11 | `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?5` and `changes` for S1 to S4 | Verified on SQLite, not on real D1 | S1 1/0 admitted/full; S2 1/0 reserved/not; S3 1 when uncounted; S4 count of expired hits. | See item 14 | 6.3, 6.8, 13 |
| 12 | Window boundary is half-open | Verified | 30 hits at t=0, limit 30: t=59000 rejected `[0,0,0,0,0]`; t=60000 admitted `[0,1,1,0,30]`. Cap exceeded: second request `[0,1,0,1,0]` (counted, then uncounted, daily unchanged). | None | 6.3, 6.8 |
| 13 | `wrangler d1 execute --local` from the Pages config | Verified, but only with a `[[d1_databases]]` block | Without it: `Couldn't find a D1 DB with the name or binding 'advent-gate'` (no login prompt, no network). With `binding="DB"`, `database_name="advent-gate"` and a placeholder id, `--file` and `--command ... SELECT changes()` worked, and the Pages project type did not block them. | `db:local` stays as `wrangler d1 execute advent-gate --local --persist-to <dir> --file migrations/0001_gate.sql`, which needs the D1 block in `wrangler.toml` | 6.5, 6.6 |
| 14 | D1 behaves like SQLite for items 10 and 11 | Not verifiable offline | Local `wrangler d1 execute` runs on SQLite (miniflare), so it is a second SQLite check, not D1 proof. | Positional `?` parameters only, and read each admit result from a `SELECT changes()` placed directly after S1 and S2 in the same batch. Owner step 13 checks it. | 6.3, 13 |
| 15 | `wrangler d1 migrations apply --local` | Not tested (not required) | n/a | n/a | n/a |
| 16 | `.wrangler/` is gitignored | Not yet true | `.gitignore` does not list `.wrangler/` (the directory exists, only an empty `tmp`). | Task 6.6 adds it | 6.6 |

## Which design assumptions held

- Workers types 5.x work with TypeScript 7.0.2 (item 1) and stay isolated from the root project (item 2).
- `AI.run` takes an optional third options argument with `signal` (item 4), and `response` is the primary output field (item 5).
- The five gate statements work as designed on SQLite, including numbered parameters, `changes` per statement and the half-open 60 s window (items 10 to 12).
- `wrangler d1 execute --local` runs offline for a Pages project (item 13), given the D1 binding.

## Which were not verifiable offline

- Whether the production runtime honors `signal` (item 7). The plan does not depend on it.
- The real runtime Granite response shape (item 8).
- Numbered parameters and `meta.changes` on real D1 inside `db.batch` (items 10, 11, 14). Owner step 13 checks them.
- `wrangler d1 migrations apply --local` (item 15).

## Fallbacks recorded

1. Types package fails: newest dated 5.x, then local structural types in `functions/env.d.ts`, then ask the user. Not triggered.
2. `run` has no options argument or ignores `signal`: the adapter passes `signal` only when it can, and the 3500 ms race alone enforces the limit.
3. `--local` does not work: documented `--file` run with explicit `--persist-to`, or drop `db:local` from the README (SQL is already covered by the `node:sqlite` tests in 6.8). Not needed once the D1 block exists.
4. D1 differs on numbered parameters or `meta.changes`: positional `?` plus `SELECT changes()` directly after S1 and S2. Unverified; owner step 13 checks it.

## Notes for downstream tasks

None of these edits `design.md` or `tasks.md`; each task owner applies them when reached.

1. Ai cast location (6.2, 6.5). The real `Ai` is not assignable to `AiLike { run(model: string, input: unknown, options?: unknown): Promise<unknown> }` because of the overloads and model-name generics. Keep the cast in `functions/api/parse.ts`, the only file with Cloudflare types, for example `{ run: (m, i, o) => env.AI.run(m as never, i as never, o as AiOptions | undefined) }` or `env.AI as unknown as AiLike`. `workersAiProvider` in `src/parse-api` stays free of Cloudflare types.
2. Late-rejection swallow in the handler (6.4). After the race loses to the timer, the handler must attach a no-op `catch` to the losing `provider.translate` promise, so a late rejection is not an unhandled rejection, and it must never use or log a late result. Add a test with a provider that rejects after the 504.
3. Adapter output extraction (6.2). Check `typeof response === 'string'` first, because `response` is optional in the typed output. Treat `choices[0].message.content` as an untyped defensive fallback. Pass `{ signal }` as a best-effort third argument only.
4. `wrangler.toml` needs a `[[d1_databases]]` block for `db:local` (6.5, 6.6). Binding `DB`, `database_name = "advent-gate"`, with a placeholder `database_id` committed (the real id is an owner step, never committed as a secret). Without it `db:local` fails with "Couldn't find a D1 DB". Always pass an explicit `--persist-to` outside the repo or in a gitignored directory, and delete it afterwards.
5. `SELECT changes()` placement (6.3, only if the D1 fallback is used). It returns the count of the most recent statement, so it must directly follow S1 (for the admit result) and S2 (for the reserve result) in the batch. Placed after S4 it would report S4. The batch order and the result indexes used by the handler must be updated together in that case.
6. `.gitignore` (6.6). Add `.wrangler/`. It is not listed yet.
7. `functions/tsconfig.json` (6.5). The scratch `functions/` directory was deleted completely, so 6.5 must recreate `functions/tsconfig.json` (strict, ES2022, Bundler resolution, `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`, `noUncheckedIndexedAccess`, `skipLibCheck`, `isolatedModules`, `noEmit`, `include: ["./**/*.ts"]`) and extend `npm run typecheck` to also run `tsc --noEmit -p functions/tsconfig.json`. Never leave `functions/` with an empty `include`.
8. Experimental warning (6.8, 11.x scripts). `node:sqlite` prints an `ExperimentalWarning`. Vitest tests are unaffected. Any script or CI step that merges stderr under PowerShell may see exit 1. Do not merge stderr in such commands.
9. Owner step 13. Add to the checklist: verify numbered parameters and `meta.changes` on real D1, and read `measure:latency` output for the late-timeout behavior.
10. Versions. Pins are `wrangler` 4.158.0 and `@cloudflare/workers-types` 5.20261109.1 (identical to what the tasks text names), already installed. There is no `latest/` directory in the types package, only `index.d.ts`, `index.ts` and `experimental/`.

No requirement wording needs the user's approval.

## Housekeeping

- Scratch files: `functions/` scratch (tsconfig and spike file) deleted; D1 scratch in `%TEMP%\spike-d1` (including the persist directory) deleted. The repo `wrangler.toml` was not modified.
- Kept: the two exact-pinned devDependencies (`package.json`, `package-lock.json`).
- The three partial files `spike-types.md`, `spike-abort.md` and `spike-d1.md` were merged into this file and deleted.
