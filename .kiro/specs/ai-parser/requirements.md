# Requirements Document

## Introduction

The AI parser lets a player in Haunted mode type a natural English sentence (for example "I'll go inside") and have it mapped to an original two-word command (`ENTER BUILD`, because the game vocabulary table holds the five-letter spelling `BUILD` for the word the 1976 game prints as "building"). The translated command is shown dimmed under the player's input, and only the translated command is given to the engine. The language model is Cloudflare Workers AI, called from a Cloudflare Pages Function through a Pages `ai` binding, so that no API key, token or account identifier exists in the browser or in the repository. The Pages Function validates input size, rate limits per IP address, enforces a global daily request cap (both counted in a Cloudflare D1 database, the D1_Gate), and returns only a command string constrained to the game vocabulary.

To resolve pronouns such as "take it" or "go back", the client sends a minimal Game_Context with the normalized Player_Text: the current room's short description, the names of the objects visible in the room, and the last two successfully submitted commands. The Game_Context comes only from engine state and generated game data, never from free player text, and the Parse_Endpoint treats it as untrusted data.

The AI parser is an enhancement. Any AI failure or timeout falls back to the classic parser with the player's original text, and 1976 mode never calls the AI. Typed input that is already a valid classic command bypasses the AI entirely.

Findings from the existing code that shape these requirements:

- `ExtensionHooks.transformInput` is synchronous and already gated on Game_Mode `haunted`, with error isolation. A network call cannot run inside it, so the controller needs an asynchronous input-resolution stage (Requirement 3). `GameController.submit` already queues lines in order while output is pending.
- Engine prompts have kinds `command`, `yesno` and `filename`. Only the `command` prompt accepts game commands.
- The classic parser matches the first `TOKLEN` (5) characters of each word, ASCII case-folded, against the generated vocabulary in `src/data/dungeon.ts` (`MOTIONS`, `OBJECTS`, `ACTIONS`).
- `public/_headers` sets `connect-src 'self'`. A same-origin call to `/api/parse` is allowed by it without change. `_headers` applies only to static assets, not to Pages Function responses, so the Function sets its own headers.
- `wrangler.toml` currently holds only non-secret Pages settings, and the README deploy section says no secrets are needed. With Workers AI there is still no secret, but the README deploy section changes to describe enabling the AI_Binding, creating the D1 database for the D1_Gate (database id in `wrangler.toml`, one migration applied) and the rate-limit and cap settings.
- The Cloudflare Rate Limiting binding is not offered to Pages Functions and is per-location and approximate, and the free Workers KV plan allows only 1,000 writes per day and has no atomic increment. A D1 database is therefore the counter mechanism (Requirements 7.2 and 7.13).
- The steering documents say "Cloudflare Worker" and "Worker secrets". This spec uses a Cloudflare Pages Function (`functions/` directory), which fills the same role: a server-side proxy. Because the Provider is reached through a binding, this feature has no Provider secret at all; the "API keys never ship to the browser" rule is satisfied by the absence of any key.
- `LineKind` in `src/ui/types.ts` is `'original' | 'input' | 'notice' | 'narrator' | 'boot'`, and `decodeAutosave` in `src/ui/autosave.ts` validates lines against `LINE_KINDS`. Persisting the Translation_Line (Requirement 4.12) adds a new kind `translation` to both, which is a change to the crt-terminal-ui autosave record.
- Verified against the generated `ACTIONS` table (58 entries, two with empty word lists) and the dispatcher in `src/engine/actions.ts`: the session-control actions are `QUIT`, `SAVE` (words `suspe`, `pause`, `save`), `RESUME`, `SEED` and `WASTE` (Requirement 8.3).

## Glossary

- **AI_Parser**: The client-side module in `src/parser` that decides whether to call the Parse_Endpoint, builds the Game_Context, calls the endpoint, validates the result and returns either a Translated_Command or a fallback outcome.
- **Parse_Endpoint**: The Cloudflare Pages Function at `POST /api/parse`, implemented under `functions/`.
- **Classic_Parser**: The exact two-word parser in `src/engine/classic-parser.ts`. It matches the first 5 characters of each word, case-folded.
- **Game_Vocabulary**: The set of motion, object and action words generated into `src/data/dungeon.ts` from `original/adventure.yaml`.
- **Classic_Command**: A line of one or two words in which every word resolves in the Game_Vocabulary using Classic_Parser matching.
- **Meta_Command**: A command whose word resolves to an `ACTIONS` entry that controls the session rather than playing the game. The verified list is: `QUIT` (word `quit`), `SAVE` (words `suspe`, `pause`, `save`; the engine's suspend flow), `RESUME` (words `resum`, `resta`), `SEED` (word `seed`) and `WASTE` (word `waste`). Requirement 8.3 records the judgement calls behind this list.
- **Canonical_Spelling**: The spelling of a word as it appears in the generated vocabulary table in `src/data/dungeon.ts`, in upper case. The table may hold a word truncated to five letters, for example `BUILD`, `INSID` or `RESUM`.
- **Translated_Command**: A Classic_Command, in upper case with Canonical_Spelling for every word (for example `ENTER BUILD`), that is not a Meta_Command and was produced from a player sentence by the Parse_Endpoint.
- **Player_Text**: The raw line the player submitted, after the controller's 1023-character truncation.
- **Game_Context**: The object `{room, objects, last}` sent with the normalized Player_Text, defined in Requirement 2.8. `room` is a string, `objects` is an array of strings and `last` is an array of strings.
- **Haunted_Mode**: The Game_Mode of the running game when the engine option `oldstyle` is false.
- **Mode_1976**: The Game_Mode of the running game when `oldstyle` is true.
- **Command_Prompt**: The engine prompt of kind `command`.
- **Translation_Line**: The dimmed line shown directly under the echoed Player_Text that displays the Translated_Command.
- **Provider**: Cloudflare Workers AI, a third-party model service running on Cloudflare, reached through the AI_Binding. It is hidden behind the Provider_Interface.
- **AI_Binding**: The Cloudflare Pages `ai` binding that gives the Function access to the Provider. It needs no API key, token or account identifier in the repository or the bundle.
- **Model_Name**: The identifier of the small, fast instruct model the Provider runs. It is a plain non-secret variable in `wrangler.toml`; the design chooses and verifies it.
- **Provider_Interface**: A provider-agnostic function contract used by the Parse_Endpoint: given sanitized Player_Text, a validated Game_Context and an abort signal, it returns raw candidate text.
- **D1_Gate**: The Cloudflare D1 database bound to the Function (database `advent-gate`, one migration) that holds the per-IP sliding-window hit log and the per-UTC-day request counter. It replaces the Rate Limiting binding and Workers KV, which cannot meet Requirements 7.2 and 7.13.
- **Rate_Limiter**: The component that counts Parse_Endpoint requests per client IP address in a time window, using the D1_Gate.
- **Daily_Cap**: The maximum number of Provider-bound requests per UTC day across all clients, set by a non-secret variable in `wrangler.toml` and counted in the D1_Gate.
- **Cap_Margin**: The stated maximum number of requests (25) by which the Daily_Cap may be exceeded under concurrency. The D1_Gate is expected to exceed the Daily_Cap by 0; the margin is a tolerance.
- **Availability_Problem**: A Fallback cause that means the AI could not be asked or did not answer: network error, timeout, status 429, 5xx or 503, `navigator.onLine` false, an open circuit, or a response that fails the response contract or client-side validation.
- **AI_Budget**: The 4000 ms limit from the moment the AI_Parser sends the request to the moment it must have a validated result. The value is configurable without a code change to the Function (Requirement 12.11).
- **Upstream_Timeout**: The 3500 ms limit on the Provider call inside the Parse_Endpoint. It is a plain variable in `wrangler.toml`.
- **Fallback**: Submitting the unmodified Player_Text to the Classic_Parser, with no Translation_Line.
- **Credential_Pattern**: A string matching any of: `Authorization:` followed by `Bearer`, the names `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `account_id`, or a key-shaped string `sk-` followed by 20 or more letters and digits. The design may extend this list.
- **Dev_Vars_File**: The `.dev.vars` file used by `wrangler pages dev` for local non-secret overrides. It is not committed.
- **Offline_Notice**: The line `THE SPIRITS ARE NOT ANSWERING. CLASSIC PARSER IN USE.`, printed only for an Availability_Problem (Requirement 5.6).

## Requirements

### Requirement 1: Mode and prompt gating

**User Story:** As a player, I want the AI to act only where it makes sense, so that 1976 mode stays pure and prompts like yes/no and file names are never altered.

#### Acceptance Criteria

1. WHILE the Game_Mode is Mode_1976, THE AI_Parser SHALL make zero network requests, for any Player_Text.
2. WHILE the Game_Mode is Mode_1976, THE System SHALL load no AI_Parser code path that can issue a request, so that the 1976 pipeline is identical to the pipeline before this feature.
3. WHILE the engine prompt kind is `yesno` or `filename`, THE AI_Parser SHALL make zero network requests and pass the Player_Text to the engine byte-for-byte unchanged.
4. WHILE the engine prompt kind is `command`, the Game_Mode is Haunted_Mode, the game phase is not `over`, and the Player_Text is eligible under Requirement 2, THE AI_Parser SHALL attempt exactly one translation request per submitted Player_Text.
5. WHEN the player changes the selected mode in settings during a running game, THE AI_Parser SHALL continue to use the Game_Mode that was active when the game started, and SHALL apply the newly selected mode only when the next new game starts.
6. WHEN the Player_Text is empty or contains only whitespace, THE AI_Parser SHALL make zero network requests and pass the Player_Text to the engine byte-for-byte unchanged.
7. WHEN the Player_Text consists only of digits, whitespace and an optional leading `+` or `-` sign, THE AI_Parser SHALL make zero network requests and pass the Player_Text to the engine byte-for-byte unchanged, so that numeric answers such as seed values are never altered.
8. WHEN the game phase is `over`, THE AI_Parser SHALL make zero network requests and pass the Player_Text to the engine byte-for-byte unchanged.
9. IF the prompt kind, the Game_Mode, or the game phase cannot be determined when Player_Text is submitted, THEN THE AI_Parser SHALL make zero network requests and pass the Player_Text to the engine byte-for-byte unchanged.

### Requirement 2: Eligibility, exact classic commands and game context

**User Story:** As a player who knows the classic commands, I want valid commands to run instantly and for free, and as a player who types sentences, I want "take it" and "go back" to work, so that the AI adds help without adding latency to input that already works.

#### Acceptance Criteria

1. WHEN the Player_Text is a Classic_Command, THE AI_Parser SHALL make zero network requests, pass the Player_Text to the engine unchanged (byte-for-byte, without normalization applied), and display no Translation_Line.
2. WHEN the Player_Text is not a Classic_Command and the normalized Player_Text is between 1 and 200 characters inclusive, THE AI_Parser SHALL send the normalized Player_Text together with the Game_Context to the Parse_Endpoint.
3. IF the normalized Player_Text is longer than 200 characters, THEN THE AI_Parser SHALL perform the Fallback without making a network request.
4. IF the normalized Player_Text is empty (zero characters, including input consisting only of whitespace), THEN THE AI_Parser SHALL make zero network requests, display no Translation_Line, and pass the Player_Text to the Classic_Parser unchanged.
5. THE AI_Parser SHALL decide whether the Player_Text is a Classic_Command by calling the same vocabulary lookup that the Classic_Parser uses, so that the two cannot disagree.
6. THE AI_Parser SHALL normalize Player_Text before the length check and before sending it, in this order: apply Unicode NFKC, replace typographic apostrophes and typographic quotation marks with their ASCII equivalents, collapse each run of one or more whitespace characters to a single space, and trim leading and trailing whitespace.
7. FOR ALL Player_Text strings, THE AI_Parser SHALL treat the string as a Classic_Command if and only if the Classic_Parser resolves every word of it in the Game_Vocabulary and the string has at most the number of words the Classic_Parser accepts (consistency property).
8. THE AI_Parser SHALL build the Game_Context from engine state and generated game data only, with these fields:
   - `room`: the sanitized short location description from `src/data` (`LOCATIONS[loc].small`, or the first line of `LOCATIONS[loc].big` when `small` is null) of the player's current location, or the literal `pitch dark` while the player cannot see. Sanitizing replaces typographic and double quotation marks with `'`, replaces every other character outside letters, digits, space and `' . , / -` with a space, collapses runs of spaces to one space, trims, and cuts the result to at most 80 characters (for example `You're at "Y2".` becomes `You're at 'Y2'.`);
   - `objects`: the Canonical_Spelling of the first word from `OBJECTS[i].words` of each object at the player's current location that the player can see, without duplicates, in object-index order, at most 12 entries, each 1 to 12 letters, and an empty array while the player cannot see;
   - `last`: the last at most 2 commands that the engine was given from the player at a command prompt in the current game, oldest first, each in upper case with Canonical_Spelling for every word, each a Classic_Command of at most 30 characters, and none a Meta_Command.
9. THE Game_Context SHALL NOT contain the inventory, score, turn count, seed, transcript, Player_Text, or any text that did not originate from `src/data` (after the room sanitizing in criterion 8) or from a command given to the engine.
10. WHEN the Player_Text contains a pronoun such as "it" or a phrase such as "go back", THE Parse_Endpoint SHALL resolve it only from `last` and `objects`, because inventory names are excluded: an object the player names in the sentence is resolved from Player_Text itself, and adding inventory names would require a change to criterion 8 and to Requirement 11.6.
11. WHEN a new game starts, THE AI_Parser SHALL reset `last` to an empty array. THE AI_Parser SHALL NOT save `last` with the autosave, so that after a page reload `last` starts as an empty array.
12. FOR ALL engine states, THE Game_Context built by the AI_Parser SHALL pass the server-side Game_Context validation defined in Requirement 6.6 (context-closure property).

### Requirement 3: Asynchronous input resolution in the submit flow

**User Story:** As a player, I want my lines to be handled in the order I typed them even while the AI is thinking, so that the game never runs commands out of order.

#### Acceptance Criteria

1. THE GameController SHALL provide an asynchronous input-resolution stage that runs after the input echo and before `step`, and that resolves to the text given to the engine.
2. WHEN a line is submitted while an input resolution is pending, THE GameController SHALL append the line to a FIFO queue, and SHALL process queued lines one at a time in submission order, starting the next line only after the previous line's `step` call has returned.
3. WHEN a line has been resolved, THE GameController SHALL call the engine's `step` exactly once with the resolved text, and SHALL NOT call `step` more than once for any submitted line.
4. IF the input-resolution stage throws or rejects, THEN THE GameController SHALL log the error to the console, use the Player_Text as the resolved text, call `step` once with it, and continue processing the remaining queued lines.
5. WHEN the player starts a new game while a resolution is pending, THE GameController SHALL discard the pending result, SHALL discard all queued lines, and SHALL NOT call `step` on the new game with any text from before the restart.
6. IF a resolution completes after the engine prompt kind has changed away from `command`, THEN THE GameController SHALL discard the translated text and call `step` once with the Player_Text.
7. WHEN a line is submitted while no earlier line is being resolved and no earlier output is still being typed, THE GameController SHALL echo the unmodified Player_Text synchronously within the same event-loop turn as the submission, before the input-resolution stage is started and before any AI result is known. WHEN a line is submitted while an earlier line is being resolved or its output is still being typed, THE GameController SHALL echo the unmodified Player_Text when that line's turn comes, immediately before its input resolution starts, so that the transcript order for every line is input, Translation_Line, response.
8. IF a resolution has not settled within 10 seconds of starting, THEN THE GameController SHALL treat it as a failure under criterion 4 so that the queue cannot stall indefinitely.
9. THE input-resolution stage SHALL contain no DOM access and no network calls in `src/ui`; the network call SHALL be made only by the AI_Parser in `src/parser` through an injected fetch function.
10. THE engine SHALL contain no import from `src/parser`, `src/haunt` or `src/voice`, and `src/ui` SHALL reach the AI_Parser only through an injected interface.
11. WHEN the input-resolution stage starts for a line, THE AI_Parser SHALL build the Game_Context from the engine state at that moment, which is after the previous queued line's `step` call has returned, so that a queued line sees the effects of the lines before it.

### Requirement 4: Translated-command display

**User Story:** As a player, I want to see what the game understood from my sentence, so that I can learn the real commands and trust the result.

#### Acceptance Criteria

1. WHEN the AI_Parser returns a Translated_Command, THE terminal SHALL show a Translation_Line directly under the echoed Player_Text and before the Original_Text response, containing the Translated_Command in upper case.
2. THE Translation_Line SHALL be rendered with lower luminance than the Original_Text while keeping a WCAG contrast ratio of at least 4.5:1 against the terminal background, measured with the scanline overlay and flicker at their worst-case dimming as defined in the crt-terminal-ui spec.
3. THE Translation_Line SHALL be a distinct line kind and SHALL NOT be part of the Original_Text, the engine output events or the narrator lines.
4. WHEN a Translation_Line is shown, THE terminal SHALL announce "Interpreted as" followed by the Translated_Command through a polite live region, exactly once per Translation_Line.
5. THE terminal SHALL expose the Translation_Line to assistive technology as text in the document, not as an image or a CSS pseudo-element.
6. WHILE a translation is pending for longer than 400 ms, THE terminal SHALL show a pending indicator under the echoed Player_Text.
7. WHEN the AI_Parser returns a result or the Fallback occurs, THE terminal SHALL remove the pending indicator within 100 ms.
8. IF the Fallback occurs, THEN THE terminal SHALL show no Translation_Line and SHALL pass the Player_Text to the classic parser unchanged.
9. WHEN the AI_Parser returns a Translated_Command, THE GameController SHALL pass only the Translated_Command to the engine and SHALL store the Player_Text, not the Translated_Command, in input history.
10. THE voice output SHALL NOT read the Translation_Line aloud.
11. WHERE the user's reduced-motion preference is enabled, THE terminal SHALL render the pending indicator without animation.
12. WHEN a Translation_Line is shown, THE GameController SHALL record it in the transcript with the new line kind `translation`, immediately after the echoed `input` line of the same submission, so that the autosave transcript tail contains the Translation_Line and a resumed session reads the same as the live session.
13. THE autosave record SHALL extend the crt-terminal-ui `LineKind` and the `decodeAutosave` line-kind validation with the kind `translation`, AND FOR ALL autosave records that contain lines of kind `translation`, `decodeAutosave(encodeAutosave(x))` SHALL equal `x` (round-trip property).
14. WHEN `decodeAutosave` reads an autosave record written before the kind `translation` existed, THE decoder SHALL accept it and produce the same lines as before this feature.
15. THE Translation_Line SHALL NOT be counted by the transcript tail operation that selects lines for the narrator or for voice output, so that the line is displayed and saved but never spoken.

### Requirement 5: Fallback to the classic parser and timeout

**User Story:** As a player, I want the game to keep working when the AI is slow, down or wrong, so that typing always works.

#### Acceptance Criteria

1. IF the Parse_Endpoint does not return a validated result within the AI_Budget of 4000 ms, measured from the moment the request is sent, THEN THE AI_Parser SHALL abort the request, discard any response that arrives later, and perform the Fallback.
2. IF the request fails with a network error, a non-200 status other than 422 and 429, a non-JSON body, or a body that does not match the response contract, THEN THE AI_Parser SHALL perform the Fallback.
3. IF the Parse_Endpoint responds with `no_command` (status 422), THEN THE AI_Parser SHALL perform the Fallback so that the Classic_Parser produces its own "I don't understand" style reply, and THE AI_Parser SHALL NOT count this response toward the consecutive-failure count in criterion 7.
4. IF the command string in a 200 response fails client-side validation under Requirement 8, THEN THE AI_Parser SHALL perform the Fallback.
5. WHEN the Fallback occurs, THE GameController SHALL give the unmodified Player_Text to the engine, and the Original_Text produced SHALL be byte-identical to the Original_Text produced for the same Player_Text, state and seed in a session with the AI_Parser absent.
6. WHEN the Fallback occurs because of an Availability_Problem and no notice has been printed since the page loaded or since the last successful translation, THE terminal SHALL print exactly one notice line, the Offline_Notice `THE SPIRITS ARE NOT ANSWERING. CLASSIC PARSER IN USE.`, and SHALL print no further such notice until a translation has succeeded. THE terminal SHALL print no Offline_Notice for a Fallback caused by `no_command` (status 422), by Player_Text longer than 200 characters, or by an abort, because in those cases the AI is available and the sentence is simply not translated.
7. IF three consecutive requests each end in a Fallback caused by network error, timeout or status 5xx, THEN THE AI_Parser SHALL make no requests for 60 seconds from the third failure and SHALL perform the Fallback immediately, without a network request, for every line submitted in that period. WHEN the 60 seconds have elapsed, THE AI_Parser SHALL resume sending requests, and a successful translation SHALL reset the consecutive-failure count to 0.
8. IF the Parse_Endpoint responds with status 429, THEN THE AI_Parser SHALL perform the Fallback and SHALL make no further requests until the number of seconds in the `Retry-After` header has elapsed, using 30 seconds when the header is missing, non-numeric or less than 1, and capping the wait at 120 seconds when the header value is greater than 120.
9. WHILE `navigator.onLine` is false, THE AI_Parser SHALL perform the Fallback without a network request and without printing more than the single notice allowed by criterion 6.
10. FOR ALL combinations of response status, body, delay and thrown error from an injected fetch, THE AI_Parser SHALL resolve to either a valid Translated_Command or a Fallback and SHALL NOT throw (resilience property).
11. IF the Parse_Endpoint responds with status 503 `unavailable` because the Daily_Cap is reached or the AI_Binding is not available, THEN THE AI_Parser SHALL perform the Fallback and SHALL count the response toward the consecutive-failure count in criterion 7.

### Requirement 6: Pages Function contract

**User Story:** As a developer, I want a small, strict HTTP contract, so that the client and server can be tested independently and nothing sensitive leaks.

#### Acceptance Criteria

1. THE Parse_Endpoint SHALL accept only `POST /api/parse` with `Content-Type: application/json` (an optional `; charset=utf-8` parameter is permitted) and a body of the form `{"text": <string>, "context": {"room": <string>, "objects": [<string>...], "last": [<string>...]}}`.
2. WHEN the request is valid and the Provider output passes validation, THE Parse_Endpoint SHALL respond with status 200, `Content-Type: application/json` and the body `{"command": "<WORD>"}` or `{"command": "<WORD> <WORD>"}`, where each `<WORD>` is a word from the known game vocabulary, and no other fields.
3. IF the request method is not POST, THEN THE Parse_Endpoint SHALL respond with status 405, an `Allow: POST` header, and error code `method`, without calling the Provider.
4. IF the `Content-Type` is missing or is not `application/json`, THEN THE Parse_Endpoint SHALL respond with status 415 and error code `media_type`, without calling the Provider.
5. IF the request body is larger than 2048 bytes (measured on the raw bytes, including when the `Content-Length` header is absent or understated), THEN THE Parse_Endpoint SHALL respond with status 413 and error code `too_large`, without calling the Provider and without buffering more than 2048 bytes plus one read chunk.
6. IF the body is not valid JSON, is not a JSON object, has any field other than `text` and `context` at the top level, or violates the strict schema, THEN THE Parse_Endpoint SHALL respond with status 400 and error code `bad_request`, without calling the Provider. The schema is violated when any of these holds:
   - `text` is missing, is not a string, is empty, is longer than 200 characters, or contains control characters (U+0000 to U+001F and U+007F);
   - `context` is missing, is not an object, or has any field other than `room`, `objects` and `last`;
   - `room` is not a string, is longer than 80 characters, contains characters outside letters, digits, space and the characters `' . , / -`, or is not exactly one of the sanitized room strings that `src/data` yields under Requirement 2.8 (including `pitch dark`);
   - `objects` is not an array, has more than 12 entries, or has an entry that is not 1 to 12 letters or whose canonical word is not the first word of an `OBJECTS` entry;
   - `last` is not an array, has more than 2 entries, or has an entry that is longer than 30 characters, does not match `^[A-Z]+( [A-Z]+)?$`, is not a Classic_Command, or contains a Meta_Command word.
7. IF the Provider output cannot be mapped to a Translated_Command, THEN THE Parse_Endpoint SHALL respond with status 422 and error code `no_command`.
8. IF the Provider returns an error or an unusable response, THEN THE Parse_Endpoint SHALL respond with status 502 and error code `upstream`.
9. IF the Provider does not respond within the Upstream_Timeout of 3500 ms, THEN THE Parse_Endpoint SHALL abandon the call and respond with status 504 and error code `timeout`.
10. IF the AI_Binding is not available in the Function environment or is not callable, THEN THE Parse_Endpoint SHALL respond with status 503 and error code `unavailable`, without calling the Provider.
11. THE Parse_Endpoint SHALL return every non-200 response with `Content-Type: application/json` and a body of exactly `{"error": "<code>"}`, where `<code>` is one of `bad_request`, `method`, `media_type`, `too_large`, `no_command`, `rate_limited`, `forbidden`, `upstream`, `timeout`, `unavailable`, and SHALL include no Provider message, stack trace, header, key, Player_Text or Game_Context in any response.
12. THE Parse_Endpoint SHALL set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on every response, including 2xx, 4xx and 5xx responses, because `_headers` does not apply to Function responses.
13. THE Parse_Endpoint SHALL send no `Access-Control-Allow-Origin` header on any response and SHALL answer `OPTIONS` requests with status 405 and error code `method`, so that only same-origin browser callers can read responses.
14. IF a request carries an `Origin` header whose value differs from the request's own origin, or a `Sec-Fetch-Site` header with the value `cross-site`, THEN THE Parse_Endpoint SHALL respond with status 403 and error code `forbidden`, without calling the Provider.
15. THE request encoder and response decoder SHALL satisfy the round-trip property: FOR ALL valid request objects (text of 1 to 200 characters without control characters, and a Game_Context that satisfies criterion 6) and success responses, decode(encode(x)) SHALL equal x.
16. THE request codec SHALL add no error code beyond the set in criterion 11; WHERE a new error code or a distinct client behavior is introduced, THE set in criterion 11, the client handling in Requirement 5 and the tests in Requirement 13 SHALL be updated together.

### Requirement 7: Rate limiting, daily cap and cost guard

**User Story:** As the project owner, I want the endpoint protected against abuse and kept inside the free tier, so that a bot cannot exhaust the quota or run up a bill.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL identify the client by the value of the `CF-Connecting-IP` header.
2. WHEN a Parse_Endpoint request passes the method, origin, content-type and size checks, THE Rate_Limiter SHALL count it against its client IP in the D1_Gate regardless of whether the Provider call succeeds, fails, or times out, and SHALL admit at most 30 counted requests per client IP in any 60-second window, using a half-open sliding window in which a request counted at time h counts at time t while h is later than t minus 60 seconds (so a request exactly 60 seconds after the first of 30 is admitted). THE Rate_Limiter SHALL NOT use the Cloudflare Rate Limiting binding or Workers KV.
3. IF a client IP's 31st counted request falls within a 60-second window, THEN THE Parse_Endpoint SHALL respond with status 429, the code `rate_limited`, and a `Retry-After` header holding a whole number of seconds from 1 to 60, without calling the Provider.
4. WHEN a request reaches the Parse_Endpoint, THE Rate_Limiter SHALL make its admit/reject decision after the method and size checks and before the Provider call and before any parsing of the request body beyond the size check.
5. IF the Rate_Limiter or the Daily_Cap counter is unavailable, throws, or does not return a decision, THEN THE Parse_Endpoint SHALL respond with status 503 and the code `unavailable`, SHALL NOT call the Provider, and SHALL NOT count the request against any client IP (fail closed).
6. IF the request has no `CF-Connecting-IP` header or the header is empty, and the Function is not running under `wrangler pages dev`, THEN THE Parse_Endpoint SHALL respond with status 400 and SHALL NOT call the Provider.
7. THE Rate_Limiter SHALL NOT write the raw client IP address to any log or persistent store; THE Rate_Limiter SHALL key the D1_Gate hit log by a salted hash of the IP, using a salt held in the plain variable `IP_HASH_SALT`, AND IF `IP_HASH_SALT` is missing THEN THE Parse_Endpoint SHALL respond under criterion 5. THE D1_Gate SHALL delete hit rows once their window has passed.
8. THE Parse_Endpoint SHALL enforce a Daily_Cap on Provider-bound requests: WHEN the number of Provider-bound requests in the current UTC day has reached the Daily_Cap, THE Parse_Endpoint SHALL respond to each further request that day with status 503 and the code `unavailable` without calling the Provider, until the count resets at 00:00 UTC. The client then performs the Fallback under Requirement 5.11.
9. WHILE an AI_Parser request is in flight, THE AI_Parser SHALL NOT send a second Parse_Endpoint request.
10. FOR ALL sequences of request timestamps for one IP, THE Rate_Limiter logic SHALL admit no more than 30 requests in any 60-second window (rate-limit property, tested with an injected clock, including requests at exactly 0 s, 59 s, 60 s and 61 s boundaries).
11. THE Daily_Cap SHALL be a non-secret variable in `wrangler.toml` with a value chosen so that the Daily_Cap multiplied by the measured or documented per-request cost of the chosen Model_Name is at most 80 percent of the Workers AI free daily allocation, AND the README SHALL show that arithmetic.
12. IF the Daily_Cap variable is missing, is not a positive integer, or cannot be read, THEN THE Parse_Endpoint SHALL treat the cap as reached and respond under criterion 8.
13. THE Daily_Cap counter SHALL reserve a slot in the D1_Gate before the Provider call, in the same atomic D1 batch that counts the request against the client IP, so that the request is either counted against both, counted against neither, or counted against the IP only when it is rejected by the rate limit. The number of Provider-bound requests admitted in one UTC day SHALL NOT exceed the Daily_Cap (the D1_Gate update is conditional on the count being below the cap), and in any case SHALL NOT exceed it by more than the Cap_Margin of 25 requests. The design documents the mechanism and its limits.
14. FOR ALL interleavings of up to 200 concurrent admit decisions against a test double of the counter, THE admitted count SHALL NOT exceed the Daily_Cap plus the Cap_Margin (cap property).

### Requirement 8: Output validation and context validation

**User Story:** As a player, I want the AI only ever to produce real game commands, so that a confused or manipulated model cannot break the game.

#### Acceptance Criteria

1. WHEN the Parse_Endpoint receives Provider output, THE Parse_Endpoint SHALL reduce it to a candidate by trimming leading and trailing whitespace, removing one pair of surrounding quotes or backticks, converting it to upper case, and then requiring that the result is 1 to 30 characters long and matches `^[A-Z]+( [A-Z]+)?$`.
2. WHEN a candidate has been produced, THE Parse_Endpoint SHALL accept it only if each word resolves in the Game_Vocabulary using Classic_Parser matching, and SHALL replace each word by its Canonical_Spelling from the vocabulary table (which may be truncated to five letters, so that a model answer `ENTER BUILDING` becomes `ENTER BUILD`).
3. IF a candidate contains a Meta_Command word, THEN THE Parse_Endpoint SHALL reject it and return no command, so that the AI cannot quit, save, resume, seed or waste turns in a game; the player must type those commands exactly. The Meta_Command list is exactly `QUIT`, `SAVE`, `RESUME`, `SEED` and `WASTE`, as listed in the Glossary, and rests on these verified findings and judgement calls:
   - `QUIT`, `SAVE` (the suspend flow) and `RESUME` open yes/no or file-name prompts or replace the whole game state, so they are session control.
   - `SEED` and `WASTE` are test and setup actions that take a numeric argument and change the random seed or burn lamp turns. The candidate pattern in criterion 1 cannot carry a number, so a bare `SEED` or `WASTE` would only produce a confusing prompt; they are excluded as a judgement call.
   - `SCORE`, `BRIEF`, `INVENTORY`, `FIND`, `HELP`, `INFO`, `NEWS`, `VERSION` and the other message-only actions are harmless and are allowed.
   - `WAKE` (disturb the dwarves) and `BLAST` (the rod-and-dynamite ending) are gameplay actions and are allowed; `BLAST` can end the game, which is a judgement call in favor of allowing a command the player explicitly asked for in a sentence.
   - `ATTACK` and `THROW` are allowed. The dragon "bare hands" question and the hint offers are yes/no prompts, which Requirement 1.3 keeps outside the AI, so the AI cannot answer them for the player.
   - The magic words (`XYZZY`, `PLUGH`, `PLOVER`, `FEE`, `FIE`, `FOE`, `FOO`, `FUM`) are allowed by this spec. Whether a typed or translated `XYZZY` is acceptable under the haunt spec's "spoken aloud" rule is decided by that spec, not here.
4. IF Provider output is empty, is longer than 30 characters after trimming, contains a newline, contains more than two words, contains punctuation other than a single space between two words, or contains any word that does not resolve in the Game_Vocabulary, THEN THE Parse_Endpoint SHALL reject it and return no command.
5. WHEN the AI_Parser receives a 200 response, THE AI_Parser SHALL repeat the same validation on the returned command before use, and SHALL NOT trust the server.
6. IF validation rejects Provider output or a 200 response command, THEN THE AI_Parser SHALL hand the player's original typed or spoken text to the Classic_Parser, SHALL NOT change game state from the rejected output, and SHALL NOT display a translated command.
7. FOR ALL strings the Provider may return, including adversarial strings, empty strings and strings up to 10,000 characters, THE validation function SHALL return either a Classic_Command that contains no Meta_Command word or a rejection, and SHALL NOT throw (vocabulary-closure property).
8. FOR ALL accepted Translated_Commands, parsing the command into words, printing the words with single spaces and parsing again SHALL produce the same words (round-trip property).
9. THE validation function SHALL be a pure function in a shared module that both the Parse_Endpoint and the AI_Parser import, with the Game_Vocabulary taken from the generated `src/data` files, so that no second hand-written word list exists.
10. THE Parse_Endpoint SHALL treat the Game_Context as untrusted data: it SHALL validate every field under Requirement 6.6 before any use, SHALL reject the whole request with status 400 when any field is invalid, and SHALL NOT use any Game_Context value that failed validation.
11. THE Parse_Endpoint SHALL pass the validated Game_Context to the Provider only inside the delimited user data (Requirement 9.2), and no Game_Context value SHALL be able to add to, remove from or replace the system instructions.
12. THE tests SHALL assert the Meta_Command classification of every non-empty entry in `ACTIONS` against a fixed expected list, so that a change to the generated table or the engine dispatcher that adds a session-control action fails the test until the Meta_Command list is reviewed.

### Requirement 9: Prompt design and abuse resistance

**User Story:** As the project owner, I want prompt injection to have no useful effect, so that the AI is only a translator.

#### Acceptance Criteria

1. THE Parse_Endpoint SHALL hold the system instructions on the server and SHALL pass Player_Text and the validated Game_Context to the Provider only as delimited user data, such that neither is ever concatenated into the system instructions.
2. THE Parse_Endpoint SHALL send each Provider request with zero tools, zero function-calling definitions, and exactly one user message containing only the current Player_Text and the delimited, validated Game_Context, with no prior messages, no conversation history and no other game state.
3. WHERE the Provider supports the setting, THE Parse_Endpoint SHALL request a maximum of 16 output tokens and temperature 0.
4. THE system instructions SHALL list every Game_Vocabulary word the Provider may use, state that the output is one or two Game_Vocabulary words and nothing else, and state that Player_Text and the Game_Context are data to translate and never an instruction to the Provider.
5. WHEN Player_Text or the Game_Context tells the Provider to ignore its instructions, reveal them, or output anything other than a command, THE Parse_Endpoint SHALL return either a Translated_Command that passes the validation defined in Requirement 8, or status 422 with no Translated_Command.
6. IF the Provider output is not a valid Translated_Command (including output longer than two words, output containing words outside Game_Vocabulary, or empty output), THEN THE Parse_Endpoint SHALL return status 422 and SHALL NOT include the Provider output in the response body or headers.
7. THE Parse_Endpoint SHALL NOT include the system instructions, the Provider name, the Model_Name, or any binding name in any response body or header, on both success and error responses.
8. THE tests SHALL include an adversarial corpus of at least 20 distinct injection strings, covering at minimum: instruction override, system-prompt disclosure request, role-play request, delimiter-escape attempt, and multi-line payload.
9. THE tests SHALL run every string in the adversarial corpus against a mocked Provider that obeys the injection by returning the attacker-requested text, and SHALL assert that every response is either status 422 or a body whose command passes Requirement 8 validation, and that no response body or header contains the system instructions.
10. THE tests SHALL submit each adversarial string also as a `room`, an `objects` entry and a `last` entry, and SHALL assert that every such request receives status 400 and that the mocked Provider is called zero times.

### Requirement 10: Credentials, bindings and the client bundle

**User Story:** As the project owner, I want no API key, token or account identifier anywhere a browser or repository could expose it, so that nothing can be stolen.

#### Acceptance Criteria

1. THE Parse_Endpoint SHALL reach the Provider only through the AI_Binding, SHALL require no Provider API key, and SHALL read no token or account identifier from any source.
2. IF the AI_Binding is absent or not callable at request time, THEN THE Parse_Endpoint SHALL return the error response defined in Requirement 6.10, SHALL NOT call the Provider, and SHALL NOT include the binding name in the response body, so that the client falls back to the classic parser.
3. THE repository SHALL contain no Provider key, token or account identifier in source files, `wrangler.toml`, committed `.env*` files, test fixtures or documentation. The D1 `database_id` in `wrangler.toml` is a resource identifier, not a credential or account identifier; the committed value MAY be a placeholder that the project owner replaces.
4. THE client code and the Vite configuration SHALL NOT read any `VITE_*` variable and SHALL NOT import from `functions/`.
5. THE `.gitignore` SHALL exclude `.dev.vars` and `.dev.vars.*`, except a committed `.dev.vars.example`, so that local overrides never enter version control.
6. WHEN `check:dist` runs, THE build check SHALL scan every file in `dist/` (including `.js`, `.html`, `.css`, `.map` and `.json` files) and SHALL exit with a non-zero status, naming each offending file, IF any file contains a Credential_Pattern.
7. WHEN the test suite runs, THE repository scan test SHALL scan every file tracked by git, other than `.dev.vars.example`, `scripts/credential-patterns.ts` and the spec documents under `.kiro/specs/ai-parser/` (which must name the patterns), and SHALL fail, naming each offending file, IF the file contains a Credential_Pattern or a `VITE_` variable used for the AI.
8. THE repository scan test SHALL include a self-check that detects a planted sample Credential_Pattern and a planted sample `VITE_` AI variable in an in-memory fixture, so that a scan which never matches fails the test.
9. THE Model_Name, the Daily_Cap, the rate-limit values, the Upstream_Timeout and the `IP_HASH_SALT` SHALL each be a plain variable in `wrangler.toml` and SHALL NOT be a secret.
10. THE agent and the CI workflow SHALL NOT run `wrangler pages deploy` or any command that publishes the site, creates remote resources, applies remote migrations or changes Cloudflare project settings; THE README SHALL tell the project owner to enable the AI_Binding manually, to create the D1 database `advent-gate`, to put its id in `wrangler.toml` as the `database_id` of the D1 binding, and to apply the migration `migrations/0001_gate.sql` to it.
11. THE Parse_Endpoint SHALL operate with zero Pages secrets configured.

### Requirement 11: Privacy

**User Story:** As a player, I want to know what leaves my browser, so that I can choose whether to use Haunted mode.

#### Acceptance Criteria

1. WHEN the AI_Parser sends a request to the Parse_Endpoint, THE AI_Parser SHALL include in the request body only the normalized Player_Text and the Game_Context defined in Requirement 2.8, and SHALL include no inventory, score, identifiers, cookies, storage contents or transcript.
2. WHEN the AI_Parser sends a request to the Parse_Endpoint, THE AI_Parser SHALL set `credentials: "omit"` and `referrerPolicy: "no-referrer"` on that request.
3. THE Parse_Endpoint SHALL NOT write Player_Text, Game_Context, Provider output or the client IP address to any log.
4. WHERE the Parse_Endpoint writes a log entry, THE Parse_Endpoint SHALL include only the response status code, an error code and the elapsed time in milliseconds.
5. THE `wrangler.toml` SHALL NOT enable logging or tracing that captures request bodies.
6. THE credits page and the README SHALL each state all of the following: (a) in Haunted mode, sentences that are not classic commands are sent, together with the current room's short description, the names of the objects visible in the room and the last two accepted commands, to Cloudflare Workers AI, a third-party model service running on Cloudflare, for processing; (b) 1976 mode sends no player input to any service; (c) classic commands typed by the player are never sent as input to be translated; (d) nothing else about the player or the game is sent.
7. WHEN the Parse_Endpoint calls the Provider, THE Parse_Endpoint SHALL include in the Provider request only the normalized Player_Text, the validated Game_Context and the fixed system instructions, and SHALL NOT forward the client IP address, the `User-Agent` header or any other client-supplied header.
8. IF the Parse_Endpoint fails to process a request, THEN THE Parse_Endpoint SHALL return an error response that contains no Player_Text, no Game_Context and no Provider output, and SHALL write no log entry other than the one permitted by criterion 4.

### Requirement 12: Local development, deployment configuration and latency measurement

**User Story:** As a developer, I want to run and test the Function locally and measure it after deployment, so that I can iterate safely and tune the timeouts with data.

#### Acceptance Criteria

1. THE repository SHALL provide an `npm` script that builds the site and then runs `wrangler pages dev dist` with the AI_Binding enabled for local development, and THE script SHALL exit with a non-zero status without starting the dev server IF the build step fails.
2. THE repository SHALL provide `.dev.vars.example` that lists every variable name the Function reads from its environment, one per line, each with a non-secret example value, and THE `.dev.vars.example` file SHALL contain no credential values.
3. THE repository SHALL exclude the Dev_Vars_File (`.dev.vars`) from version control via `.gitignore`, and THE `.dev.vars.example` file SHALL remain tracked.
4. WHEN `npm run dev` (Vite only) is used, THE project SHALL provide no proxy for `/api`; AND WHEN a request to `/api/parse` returns a non-2xx response, a network error, or no response within the AI_Budget, THE AI_Parser SHALL fall back to the Classic_Parser for that command, AND THE game SHALL remain playable with typed input for all commands.
5. THE `wrangler` and `@cloudflare/workers-types` packages added for this feature SHALL be listed in `devDependencies` with exact versions (no `^`, `~`, or range operators) and SHALL NOT appear in `dependencies`.
6. WHEN `npm run typecheck` is executed, THE TypeScript project SHALL typecheck every `.ts` file in the `functions/` directory in strict mode, AND THE command SHALL exit with a non-zero status IF any file in `functions/` has a type error.
7. THE `public/_headers` file SHALL keep `connect-src 'self'` in its Content-Security-Policy, AND no Provider origin SHALL appear anywhere in the CSP, because the browser calls only the same origin.
8. WHEN a request path begins with `/api/`, THE route configuration SHALL invoke the Function, AND WHEN a request path does not begin with `/api/`, THE route configuration SHALL serve the static asset without invoking the Function.
9. THE README deploy section SHALL NOT contain the sentence "No environment variables or secrets are needed", SHALL contain steps for enabling the AI_Binding, setting the Model_Name and Daily_Cap variables, creating the D1 database for the D1_Gate with its id in `wrangler.toml` and applying the migration, and testing locally with the `npm` script from criterion 1, AND SHALL state that deployment is performed manually by the project owner.
10. THE CI workflow SHALL run exactly these steps: typecheck, tests, build, and `check:dist`; THE CI workflow SHALL contain no deploy step, AND no CI step SHALL send a network request to the Provider.
11. THE AI_Budget SHALL be a single named constant in one client configuration module, AND the Upstream_Timeout SHALL be a plain variable in `wrangler.toml`, AND the AI_Budget SHALL be at least 500 ms greater than the Upstream_Timeout, so that either value can be adjusted from measurements without a secret or a change to other code.
12. THE repository SHALL provide an `npm` script `measure:latency` that takes a base URL argument, sends 20 sample sentence requests to `/api/parse` spaced at least 2100 ms apart, and prints the p50 and p95 of the round-trip time in milliseconds plus the count of each status code.
13. THE README SHALL document how to run `measure:latency` against a deployed URL, how to read the p50 and p95 values, and how to adjust the AI_Budget and the Upstream_Timeout from them.
14. THE implementation plan (`tasks.md`) for this spec SHALL contain a task that adds the `measure:latency` script and its README section, AND a final owner step, performed manually after deployment, that runs the measurement and records the p50 and p95 in the README.

### Requirement 13: Testing

**User Story:** As a developer, I want the feature testable offline, so that the suite is deterministic and free.

#### Acceptance Criteria

1. WHEN any test in the suite runs, THE test suite SHALL replace the Provider with a mock through the Provider_Interface, SHALL replace `fetch` in client tests with an injected fake, and SHALL make zero real network requests.
2. IF a test calls the real global `fetch`, THEN THE test setup guard SHALL fail that test with an error indicating a real network request was attempted.
3. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that for arbitrary Player_Text (0 to 500 characters, including empty and non-ASCII strings) and arbitrary mocked Provider output (including empty, over-length, non-string, and malformed values), the pipeline result is either Fallback or a Classic_Command that contains no Meta_Command word.
4. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that for arbitrary lines in Mode_1976, the injected fetch is called 0 times.
5. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that for arbitrary lines while the prompt kind is `yesno` or `filename`, the injected fetch is called 0 times and the engine receives the line byte-for-byte unchanged.
6. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that for every Classic_Command generated from the Game_Vocabulary, the injected fetch is called 0 times.
7. WHEN fake timers advance to the AI_Budget, THE test suite SHALL verify that the pipeline returns Fallback exactly once, that the pending request's abort signal is aborted, and that no Fallback occurs when the fake timers are advanced to 1 ms before the AI_Budget.
8. THE test suite SHALL drive the GameController with a fake view and a mocked AI_Parser to verify echo order, queue order, new-game discard (Requirement 3.5), and the first-failure notice (Requirement 5.6), asserting the exact sequence of view calls for each.
9. THE test suite SHALL test the Parse_Endpoint handler as a pure function of a Request and an injected environment, with at least one test for every status code defined in Requirement 6, asserting the status code and that the response body contains only a command string or an error indication.
10. THE test suite SHALL confirm that the upstream replay suite (`reference/open-adventure/tests`, every `.log` compared against its `.chk`) and the 430-point walkthrough produce output byte-identical to the results without the AI_Parser, when the AI_Parser is installed in Mode_1976.
11. WHEN `vitest --run` is executed with no network access and no AI_Binding, THE test suite SHALL complete with every test in this requirement passing, and no test SHALL depend on wall-clock time, real timers, or the real Provider.
12. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that for arbitrary engine states the built Game_Context passes server-side validation (Requirement 2.12), and a property that for arbitrary Game_Context objects with an extra field, an over-length value or an out-of-set value the Parse_Endpoint responds 400 and the mocked Provider is called 0 times.
13. THE test suite SHALL include a fast-check property, run for at least 100 generated cases, that `decodeAutosave(encodeAutosave(x))` equals `x` for autosave records containing lines of kind `translation` (Requirement 4.13).
14. THE test suite SHALL test the Daily_Cap logic with an injected clock and a test double of the counter, covering the reset at 00:00 UTC, a missing cap variable, and the Cap_Margin property of Requirement 7.14, AND SHALL run the D1_Gate SQL against a real SQL engine (`node:sqlite`) to verify the sliding-window boundaries at 59 s, 60 s and 61 s, the exact daily cap, and the rollback of a failed batch.

### Requirement 14: Resilience and scope boundaries

**User Story:** As a player, I want typing to work in every circumstance, so that no enhancement can block play.

#### Acceptance Criteria

1. IF the AI_Parser module fails to load or initialize, THEN THE application SHALL start with the Classic_Parser path only, SHALL log the error, SHALL accept typed input within the same startup time as a session without the AI_Parser plus no more than 50 ms, and SHALL NOT display an error message to the player in the game output.
2. WHEN the player submits any line while the AI is unreachable, THE game SHALL deliver the Classic_Parser response within the response time of a session without the AI_Parser plus no more than the AI_Budget on the first failure, and plus no more than 50 ms while the circuit is open under Requirement 5.7.
3. THE AI_Parser SHALL work on the current stable release and the previous stable release of Chrome, Edge and Safari, and SHALL depend only on the `fetch`, `AbortController` and `Promise` browser APIs.
4. IF the Player_Text is not English, or the Provider cannot map the Player_Text to a command in the known vocabulary, THEN THE AI_Parser SHALL return the Fallback, and THE game SHALL process the original Player_Text with the Classic_Parser.
5. WHERE the voice-input spec delivers a transcript, THE AI_Parser SHALL treat the transcript as Player_Text submitted through the same pipeline as typed input, and magic-word fuzzy matching SHALL run in the voice layer before submission.
6. THE AI_Parser SHALL NOT alter, translate or suppress Original_Text, and narrator lines SHALL be rendered as lines separate from the Translation_Line.
7. WHEN a failure of the AI_Parser, the Provider, or the network occurs, THE game SHALL keep the current game state unchanged by that failure and SHALL keep the input field enabled and focusable throughout, so that the player can submit the next line without reloading.

## Open Questions

### Decided

1. **Provider: Decided.** Cloudflare Workers AI through a Pages `ai` binding; no external key and no Provider secret. A small, fast instruct model sits behind the Provider_Interface.
2. **Timeouts: Decided.** AI_Budget 4000 ms and Upstream_Timeout 3500 ms stay; a latency measurement script, README guidance and an owner step are required (Requirement 12.11 to 12.14).
3. **Rate limit and cap: Decided.** A D1 database (the D1_Gate) counts both, because the Rate Limiting binding is not offered to Pages Functions and Workers KV is neither atomic nor write-sufficient on the free plan; 30 requests per 60 seconds per IP as a half-open sliding window; a REQUIRED Daily_Cap with a 25-request Cap_Margin and a 503 `unavailable` response when reached (Requirement 7).
4. **Game context: Decided.** Room short description, visible object names and the last two accepted commands are sent; inventory is excluded (Requirement 2.8 to 2.10).
5. **Translation line in autosave: Decided.** Saved with the echoed input as the new line kind `translation` (Requirement 4.12 to 4.14).
6. **Meta_Command list: Decided.** `QUIT`, `SAVE`, `RESUME`, `SEED`, `WASTE`, verified against `ACTIONS` and the dispatcher; the judgement calls are in Requirement 8.3.
7. **Vite dev proxy: Decided.** No proxy; plain Vite development falls back to the classic parser (Requirement 12.4).
8. **Offline notice: Decided.** `THE SPIRITS ARE NOT ANSWERING. CLASSIC PARSER IN USE.`, printed only for availability problems (Requirement 5.6). The narrator may comment on it in the haunt spec.
9. **Provider output spelling: Decided.** Translated commands use the vocabulary table's spelling (`ENTER BUILD`), not a model's longer spelling (Requirement 8.2).
10. **Room text: Decided.** The room string in the Game_Context is sanitized (Requirement 2.8).
11. **Echo timing: Decided.** Immediate when the controller is idle, otherwise when the queued line's turn comes (Requirement 3.7).

### Still open

1. **Exact Model_Name.** The design picks `@cf/ibm-granite/granite-4.0-h-micro`; its output quality is unmeasured and is checked with `measure:latency`.
2. **Measured latency.** The p50 and p95 of the deployed endpoint are known only after the owner runs `measure:latency`; the AI_Budget and Upstream_Timeout may then change.
3. **Daily_Cap value.** The design sets `DAILY_CAP` to 2000 from the Workers AI free allocation and the Model_Name's per-request cost; it changes together with the Model_Name.
4. **Local AI_Binding behavior.** `wrangler pages dev` reaches the real Workers AI service and may incur usage; the README documents this.
