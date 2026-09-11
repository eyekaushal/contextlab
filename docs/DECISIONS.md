# Decisions

Why we chose what we chose. One entry per real decision. Add to this as the project
grows — a decision that isn't written down will have to be re-argued.

Entries are in the order they were made — that record is worth keeping — so this
index groups them by area instead.

**Settled at the start**

- [SQLite instead of flat files](#sqlite-instead-of-flat-files)
- [No LLM calls anywhere in the product](#no-llm-calls-anywhere-in-the-product)
- [Plain JavaScript with JSDoc types, not TypeScript](#plain-javascript-with-jsdoc-types-not-typescript)
- [The proxy package has zero external dependencies](#the-proxy-package-has-zero-external-dependencies)
- [A format that is a profile of OpenTelemetry GenAI, not a new format](#a-format-that-is-a-profile-of-opentelemetry-genai-not-a-new-format)
- [All coding tools supported from day one](#all-coding-tools-supported-from-day-one)
- [npm as the distribution, no Docker](#npm-as-the-distribution-no-docker)
- [`engines` floor is Node 20.9, not Node 22](#engines-floor-is-node-209-not-node-22)

**Capture and the proxy**

- [The capture is a copy, never the thing being forwarded](#the-capture-is-a-copy-never-the-thing-being-forwarded)
- [Utility endpoints are forwarded but not captured](#utility-endpoints-are-forwarded-but-not-captured)
- [Billing mode is read from header names, which survive redaction](#billing-mode-is-read-from-header-names-which-survive-redaction)

**Storage**

- [Content is stored once per session, not once per turn](#content-is-stored-once-per-session-not-once-per-turn)
- [Session totals are derived, never incremented](#session-totals-are-derived-never-incremented)
- [Prices live in SQLite, not a second JSON file](#prices-live-in-sqlite-not-a-second-json-file)

**Counting and composition**

- [Parsers measure characters, not tokens](#parsers-measure-characters-not-tokens)
- [Images get a flat 1,600-token estimate and are never measured](#images-get-a-flat-1600-token-estimate-and-are-never-measured)
- [Estimate first, then correct against the provider's count](#estimate-first-then-correct-against-the-providers-count)
- [Categories are computed from the final numbers, never tracked alongside them](#categories-are-computed-from-the-final-numbers-never-tracked-alongside-them)
- [Token abbreviation starts at a thousand](#token-abbreviation-starts-at-a-thousand)
- [Exact count_tokens exists but is not on the ingest path](#exact-count_tokens-exists-but-is-not-on-the-ingest-path)

**Cost and pricing**

- [Three layers of price, so a cost figure is never blocked](#three-layers-of-price-so-a-cost-figure-is-never-blocked)
- [Both cost figures are always computed; the caller picks](#both-cost-figures-are-always-computed-the-caller-picks)
- [Budgets are stated in equivalent cost, not actual spend](#budgets-are-stated-in-equivalent-cost-not-actual-spend)
- [config.toml is parsed by a small parser that refuses what it cannot read](#configtoml-is-parsed-by-a-small-parser-that-refuses-what-it-cannot-read)

**Attribution and the rules**

- [Attribution joins tool results back to their calls](#attribution-joins-tool-results-back-to-their-calls)
- [Entities deliberately overlap, so the shares do not add to 100%](#entities-deliberately-overlap-so-the-shares-do-not-add-to-100)
- [Definition tokens are tracked separately from result tokens](#definition-tokens-are-tracked-separately-from-result-tokens)
- [A finding must name the change, not the problem](#a-finding-must-name-the-change-not-the-problem)
- [Waste is what the user could have avoided, never the total](#waste-is-what-the-user-could-have-avoided-never-the-total)
- [Rules are ranked by money, and are total functions](#rules-are-ranked-by-money-and-are-total-functions)
- [Every finding shows its working out](#every-finding-shows-its-working-out)
- [Optimize recomputes rather than reading cached findings](#optimize-recomputes-rather-than-reading-cached-findings)

**CLI**

- [The CLI ingests on every command, with no background service](#the-cli-ingests-on-every-command-with-no-background-service)
- [The watch TUI degrades to a snapshot outside a terminal](#the-watch-tui-degrades-to-a-snapshot-outside-a-terminal)
- [Ink without JSX](#ink-without-jsx)

**Server**

- [The API speaks camelCase, the database speaks snake_case](#the-api-speaks-camelcase-the-database-speaks-snake_case)
- [The server polls for captures instead of watching the filesystem](#the-server-polls-for-captures-instead-of-watching-the-filesystem)
- [SSE is a hint to refetch, not a data channel](#sse-is-a-hint-to-refetch-not-a-data-channel)
- [The turn endpoint returns only what changed](#the-turn-endpoint-returns-only-what-changed)
- [One process serves the API and the dashboard](#one-process-serves-the-api-and-the-dashboard)
- [Block text is fetched one at a time, never in the list](#block-text-is-fetched-one-at-a-time-never-in-the-list)

**Dashboard**

- [Vite is pinned to 6 because of the Node version, not by preference](#vite-is-pinned-to-6-because-of-the-node-version-not-by-preference)
- [The palette lives in CSS, and the code looks it up by name](#the-palette-lives-in-css-and-the-code-looks-it-up-by-name)
- [The dashboard is tested by rendering it to a string](#the-dashboard-is-tested-by-rendering-it-to-a-string)
- [Search returns evidence, not just a shorter list](#search-returns-evidence-not-just-a-shorter-list)
- [The sparkline is hand-written SVG, not a chart library](#the-sparkline-is-hand-written-svg-not-a-chart-library)
- [Filter options come from the data, not a hardcoded list](#filter-options-come-from-the-data-not-a-hardcoded-list)
- [The overview shows one turn, not the session total](#the-overview-shows-one-turn-not-the-session-total)
- [The system prompt panel folds tool definitions in](#the-system-prompt-panel-folds-tool-definitions-in)
- [Deltas use centre-anchored bars and a real minus sign](#deltas-use-centre-anchored-bars-and-a-real-minus-sign)
- [The system prompt is pinned as Turn 0, not hidden behind a tab](#the-system-prompt-is-pinned-as-turn-0-not-hidden-behind-a-tab)
- [Repetition is stated in the message list, not only in findings](#repetition-is-stated-in-the-message-list-not-only-in-findings)
- [Empty states state a result, not an absence](#empty-states-state-a-result-not-an-absence)

**The format**

- [The format package ships its own validator rather than taking a dependency](#the-format-package-ships-its-own-validator-rather-than-taking-a-dependency)
- [Exports default to previews, not full text](#exports-default-to-previews-not-full-text)
- [Trace ids are derived from session ids, not generated](#trace-ids-are-derived-from-session-ids-not-generated)
- [An export computes findings if none are cached](#an-export-computes-findings-if-none-are-cached)

**Testing**

- [Coverage is measured and enforced on `core`, and nowhere else](#coverage-is-measured-and-enforced-on-core-and-nowhere-else)
- [The gaps coverage found were the parsers, and that was the point](#the-gaps-coverage-found-were-the-parsers-and-that-was-the-point)

---

## SQLite instead of flat files

The tool that inspired this stores everything in a newline-delimited text file
(JSONL). That works for append-only writing, but you cannot search it, and you
cannot ask "how much did I spend last week" without reading and parsing the entire
file.

SQLite is still one file on disk with no server and no setup — the same simplicity —
but it is queryable, and FTS5 gives full-text search for free.

**Cost:** adds a dependency that compiles native code.
**Accepted**, because search, history and aggregation are core features, not extras.

---

## No LLM calls anywhere in the product

Every number here is arithmetic — token counts, ratios, cost, deltas, rankings. Every
recommendation is a deterministic rule: a comparison and a template string.

Calling an LLM would add an API key requirement, latency, per-use cost, and
nondeterminism in a **measurement** tool — the same session must produce the same
number twice.

There is also a privacy inversion: sending someone's entire context window to a
third-party model in order to analyse their context window is exactly what our users
are trying to avoid.

**Consequence:** works offline, no account, reproducible. This is advertised.

*(Note: local embeddings for chunk-similarity in the RAG phase are a numeric
operation, not an LLM call. That is not a violation.)*

---

## Plain JavaScript with JSDoc types, not TypeScript

This codebase is fundamentally a parser for six unstable, undocumented JSON wire
formats. When a provider silently renames a field, an untyped codebase produces a
**silently wrong number on a dashboard** — the worst possible failure for an accuracy
tool.

`allowJs` + `checkJs` gives real type checking and editor support with zero new
syntax to learn. Types live in JSDoc comments; the files stay `.js`.

**Rejected:** full TypeScript (learning cost during a short build window),
runtime-only validation with zod (catches bad data but gives no editor help).

---

## The proxy package has zero external dependencies

The largest adoption barrier is trust: we are asking developers to route API keys
through software written by a stranger.

That cannot be solved with a promise. It is solved by making the credential-handling
code short enough to read completely — around 600 lines, no third-party code.

**Consequence:** the rule is absolute. Any convenience library added to
`packages/proxy/` destroys the claim.

---

## A format that is a profile of OpenTelemetry GenAI, not a new format

We need a portable file format for captured sessions. Inventing one from scratch
fragments the ecosystem and invites the obvious question: "why not OpenTelemetry?"

Instead the format is a **conformant profile**: the base layer uses OTel GenAI
semantic-convention attributes verbatim (`gen_ai.*`, which now cover inference,
embeddings, retrieval, tools and agents), and our own namespace carries what OTel
does not model — context composition, cost attribution, waste.

Ships with a JSON Schema, a validator, a conformance suite, and bidirectional OTLP
converters, so files drop into existing observability pipelines.

**Rejected:** a bespoke format (no interop, weak rationale).

---

## All coding tools supported from day one

Per-tool support is a configuration table, not logic — each entry is the base-URL
environment variable that tool honours. The three tools that cannot be redirected by
env var share one mitmproxy addon.

Shipping one tool first would mean shipping something a developer with two agents
cannot use. The cost of all seven is a couple of hours.

---

## npm as the distribution, no Docker

This is a local developer tool. `npx contextlab claude` is the entire install story.

Docker exists in comparable tools for people who want an always-on background
service on a NAS or server — a real but secondary use case. Shipping container
orchestration for a localhost CLI would be complexity without a matching need.

**Deferred:** an optional Dockerfile, if users ask.

---

## `engines` floor is Node 20.9, not Node 22

We target Node 22 and develop on it. The published `engines` floor is `>=20.9.0`
anyway, because nothing we use requires 22 — `node:sqlite`, the one built-in that
would have forced it, is not in play since we ship `better-sqlite3` for FTS5.

An unnecessary engine floor on a CLI is a support ticket: it turns "your tool
doesn't work" into a version argument on an LTS release that a lot of people are
still on.

**Consequence:** no Node-22-only syntax or built-ins anywhere. If we ever want one,
the floor moves deliberately and this entry gets rewritten.

---

## The capture is a copy, never the thing being forwarded

The proxy sits in the request path of somebody's coding agent. The worst failure
available to it is not a missing number — it is breaking a request that would
otherwise have worked.

So forwarding and capturing never share a code path:

- The request body is buffered **whole**, with no size cap, and forwarded exactly
  as received. Only the *copy* kept for the capture file is capped.
- Response chunks are written to the tool first, then appended to the capture
  buffer. If the capture buffer hits its ceiling we stop collecting and keep
  forwarding.
- Everything from building the capture to writing it sits inside a `try/catch`
  that runs after the response has already been delivered. A capture failure is
  logged and dropped.

**Consequence:** a capture can be truncated, or absent, and the agent still gets a
correct answer. The reverse — a complete capture and a corrupted API call — is not
a trade we are willing to make.

---

## Utility endpoints are forwarded but not captured

`count_tokens`, `loadCodeAssist`, `retrieveUserQuota` and friends are API calls, so
they must be forwarded or the tool breaks. They are not conversation turns, so
recording them would invent sessions that never happened and skew every average.

The list lives in `IGNORED_PATH_MARKERS`, next to the routing table, and is applied
in `shouldCapture` — one place, easy to audit when a provider adds another one.

---

## Content is stored once per session, not once per turn

Coding agents resend the entire conversation on every turn. Storing each turn's
messages as its own rows means a 50-turn session writes the same 60,000-token
`npm install` log fifty times — the database grows quadratically with session
length, for no new information.

So `blocks` holds each distinct piece of content once per session, keyed by
`(session_id, hash)`, and `turn_blocks` records which turns contained it.

The size saving is a side effect. The real reason is that the product's single
best insight — *"this tool result has been re-sent 34 times and cost you $4.10"* —
becomes `COUNT(*)` on an indexed join instead of a scan-and-compare across turns.
The schema makes the flagship feature cheap.

**Consequence:** ingesting a turn must hash content before writing. That work
happens in `core`, where it is a pure function and testable.

---

## Session totals are derived, never incremented

`refreshSessionTotals` recomputes a session's row from its turns after every
insert, rather than adding to a running total.

Incrementing is faster and wrong in exactly the situation that will happen: a
capture gets ingested twice, or a turn is deleted, and the session row quietly
disagrees with the turns beneath it. A tool whose headline number contradicts its
own detail view is worse than one that is slow.

At the scale of one developer's sessions the recompute is a few hundred
microseconds on an indexed column.

---

## Parsers measure characters, not tokens

`parse/` returns `chars` on every block and no token counts at all. Tokenizing
happens one step later, in its own module.

Two reasons. Tokenization needs a model name to pick an encoder, and the model
is not reliably known until the response has been read — Gemini keeps it in the
URL, and every provider may serve a more specific version than was requested. And
a parser that tokenizes cannot be tested without loading an encoder, which turns
a microsecond test into a slow one.

Characters are also the honest intermediate: they are exactly what a tokenizer
would consume, so nothing is lost by deferring.

---

## Images get a flat 1,600-token estimate and are never measured

Image data arrives as base64 inside the JSON body. Stringifying a screenshot to
count it inflates the number roughly a hundredfold — one pasted image reads as
400,000 tokens and the entire composition chart becomes fiction.

So image blocks carry no text at all through the parser. They are counted, not
measured, at 1,600 tokens each — about one 512x512 tile.

Real screenshots run 2,000-6,400, so this under-counts. That is deliberate: for a
tool whose job is to tell you what is expensive, inventing cost is a worse failure
than slightly understating it.

**Revisit** when we can read image dimensions cheaply, which would let us apply
each provider's real tile formula.

---

## Estimate first, then correct against the provider's count

Composition runs twice on every turn. `composeRequest` counts tokens locally
with js-tiktoken; `rescaleToActual` then scales every part so the total is
exactly what the provider says it billed.

Neither half is sufficient alone. The local count is available while the request
is still in flight, which is what makes a live gauge possible, but it is 5-10%
off for Anthropic and Gemini because their tokenizers are proprietary. The
provider's count is exact but arrives only as a single total — it says 142,314
input tokens, not how they were spent.

Scaling proportionally keeps the shape of the breakdown, which is what the user
reads, while making the headline exactly right, which is what they pay.

**Invariants, enforced by `distribute` and asserted in tests:**

```
totalTokens    === systemTokens + toolsTokens + messagesTokens
messagesTokens === sum(message.tokens)
message.tokens === sum(block.tokens)
sum(categories) === totalTokens
```

Rounding each part independently drifts by a few tokens and breaks all four. So
`distribute` floors every part and hands the remainder out largest-first: the sum
is exact, and a part that was zero never gains a token it did not earn.

---

## Categories are computed from the final numbers, never tracked alongside them

The eleven-way breakdown is derived in `withBreakdown` from the same block
tokens the totals come from, after any rescaling.

The alternative — maintaining a running tally as blocks are classified — creates
a second source of truth that has to be kept in step through every correction.
The first time it drifts, the pie chart disagrees with the number above it, and
a measurement tool that contradicts itself is worth nothing.

Deriving costs one pass over blocks we have already walked.

---

## Prices live in SQLite, not a second JSON file

The working notes suggested caching the refreshed price table to
`~/.contextlab/pricing.json`. It goes in SQLite instead.

`ARCHITECTURE.md` says `~/.contextlab` holds a config file, a temporary capture
directory, and one database — "SQLite. everything. one file." A second file that
has to be read, parsed and version-checked on every cost calculation is exactly
the flat-file pattern non-negotiable #3 rejects.

The bundled snapshot stays a JS module, because it is source, not state.

---

## Three layers of price, so a cost figure is never blocked

```
bundled snapshot   packages/core/src/pricing/snapshot.js   470 models, generated
stored table       SQLite, refreshed weekly from models.dev
user override      config.toml (later)
```

`currentPriceTable` returns the newest of these synchronously and never touches
the network, so `contextlab cost` works on a plane, on first run, and when
models.dev is down. `refreshPricingInBackground` improves the answer afterwards
and cannot throw — a price list we failed to reach is not something to interrupt
someone about.

The snapshot is regenerated with `node scripts/update-pricing-snapshot.mjs`, and
`fromModelsDev` is shared between that script and the runtime refresher, so their
two copies of the format cannot drift apart.

---

## Both cost figures are always computed; the caller picks

`computeCost` returns `actual` and `equivalent` on every turn.

A Claude Max or ChatGPT Plus user pays nothing extra for a given turn — showing
them "$3.20" is simply false. But they still need the equivalent API figure,
because it is the only way to compare two sessions or rank what to fix. Choosing
one number at the arithmetic layer would force the UI to recompute the other.

Cache rates matter here more than they look: at Anthropic's 0.1x read rate, a
100,000-token cached read is $0.03, not $0.30. Pricing cached tokens as fresh
input makes a well-cached session look ten times worse than it was — and coding
agents cache aggressively, so this is the common case, not an edge one.

---

## Attribution joins tool results back to their calls

A tool result arrives as its own content block carrying nothing but the id of
the call it answers. The 60,000-token `npm install` log does not say it came
from `Bash`, and the file contents do not say which file they are.

So attribution walks the conversation in order, remembers every `tool_use` by
id, and joins each result back to it. That join is what turns "tool results are
91% of your context" into "the Bash call on turn 3 is 89% of your context, and
it has been re-sent on every turn since".

Without it every result lands in one anonymous pile and the feature is a
restatement of the composition chart.

---

## Entities deliberately overlap, so the shares do not add to 100%

One `Read` result is attributed three times: to the tool `Read`, to the file
`/repo/src/auth.js`, and — if it came from an MCP server — to that server.

This is intentional. The four entity types answer four different questions, and
each needs the full cost of the thing it names. Splitting a result between them
would make every individual number too small to act on.

`attributedTokens` is therefore larger than `totalTokens` and is not a
percentage. `share` is each entity's fraction of the context window, and the
shares are not expected to sum to one.

---

## Definition tokens are tracked separately from result tokens

Every attributed entity records `definitionTokens`, `callTokens` and
`resultTokens` alongside the total, and migration 3 adds the same three columns
to the stored table.

The distinction is the entire product. An MCP server whose tokens are *all*
definitions and whose call count is zero is pure waste — its schema is re-sent
on every turn for nothing, and the fix is one line in `.mcp.json`. The same
number of tokens spent on results is work the user asked for, and removing it
would be wrong.

A single `tokens` column cannot tell those two apart, and the recommendation
would be a coin flip.

---

## A finding must name the change, not the problem

Every rule returns `title`, `detail`, `fix`, `wastedTokens` and `wastedCostUsd`.
The `fix` field is the reason the engine exists, and it is checked by a test that
asserts every finding carries one.

"Your context is large" is a restatement of the gauge the user is already looking
at. "Remove playwright from .mcp.json — it adds 10,876 tokens to every turn and
you have never called it" is a change they can make in ten seconds. A rule that
cannot produce the second sentence does not belong in the engine.

This is also why the rules read a `SessionSummary` rather than the raw data: the
summary already has the joins — result to call, call to file, tool to server —
that let a rule name a specific thing.

---

## Waste is what the user could have avoided, never the total

Each rule claims a deliberately narrow number:

- a stuck tool result claims the **re-sends**, not the first legitimate send
- a bloated memory file claims the **excess** over a reasonable size, not the file
- a repeated read claims the **repeat**, not the first read
- an unused MCP server claims **all** of it, because none of it was ever used
- approaching the context limit claims **nothing** — it is a warning, and nothing
  has been spent badly yet

Inflating waste by claiming the whole number would make the headline larger and
the tool untrustworthy the first time someone checked the arithmetic. The
conservative figure is the one that survives scrutiny.

---

## Rules are ranked by money, and are total functions

`runRules` sorts by `wastedCostUsd` because "what should I fix first" is a
question about cost, not about severity. Severity only breaks ties, so a
zero-cost warning still outranks a zero-cost note.

A rule that throws is skipped and reported through an `onError` callback rather
than taking the report down with it. Nine findings and one logged failure is a
better outcome than a stack trace, and these rules run against wire formats that
change without notice.

---

## The CLI ingests on every command, with no background service

Each command opens the database and folds in whatever the proxy has captured
since last time, before reading anything.

The alternative is a daemon that watches the capture directory. That means a
process to start, supervise, and explain — and a class of bug where the numbers
are stale because something died quietly. Ingest costs milliseconds for a
handful of files, so paying it on every command buys away the whole problem.

**Consequence:** `contextlab why` is correct the moment an agent exits, with
nothing running in between. The server on :4041 exists for the dashboard, not
because the CLI needs it.

---

## The watch TUI degrades to a snapshot outside a terminal

Ink takes over the screen and reads keys in raw mode. Neither exists when stdout
is a pipe, and Ink throws rather than degrading — so `contextlab watch | tee log`
crashed with "Raw mode is not supported".

`watch` now checks `process.stdout.isTTY` and prints the same numbers as plain
lines when there is no terminal. A tool that dies when you pipe it is a tool
people stop trusting for scripts.

---

## Ink without JSX

The watch screen is built with `createElement` rather than JSX.

JSX needs a build step, and the project ships plain JavaScript that runs from
source — that is what makes the proxy auditable and the install `npx contextlab`.
Adding a bundler for one terminal screen would trade that away for syntax sugar.

**Cost:** the render tree is more verbose. **Accepted**, because it is one shallow
screen and the alternative changes how the whole project is built.

---

## The API speaks camelCase, the database speaks snake_case

Every route serialises rows through `toCamel` before returning them, so the
dashboard never sees a column name.

It is one small function, and it buys a real boundary: renaming `turn_count`
becomes a change in the store and the serializer rather than in every component
that happened to read it. A test asserts the leak does not happen —
`expect(session).not.toHaveProperty('turn_count')`.

---

## The server polls for captures instead of watching the filesystem

`startServer` runs `ingestDirectory` on a one-second interval rather than using
`fs.watch`.

Filesystem events are inconsistent across platforms, miss files written by
another process in some configurations, and fire before a write completes — for
a directory that one process writes and another reads, that is a race we would
have to defend against anyway. A directory listing of a handful of small files
costs well under a millisecond, so polling is both simpler and more reliable.

The proxy writes each capture to a temporary name and renames it into place, so
a poll can never read a half-written file.

---

## SSE is a hint to refetch, not a data channel

The event hub keeps no history, guarantees no delivery, and sends only the
session id that changed.

The dashboard can always re-fetch the truth from the API, so a dropped event
costs a stale second rather than a wrong number. Streaming the actual data would
mean two paths that can disagree — one over HTTP, one over SSE — and the bug
that follows is a screen showing something the API would not return.

A subscriber that throws (a browser tab closed mid-write) is caught and ignored
so it cannot take down the ingest loop or the other listeners.

---

## The turn endpoint returns only what changed

`/api/sessions/:id/turns/:turnId` includes a `delta` array of categories whose
token count moved, and nothing else.

The prior tool drew two near-identical full bars side by side and left the
reader to spot the difference — which, at a glance, is impossible when both bars
are 140,000 tokens and one category moved by 1,400. Computing the delta in SQL
means the screen cannot get it wrong, and the first turn honestly returns an
empty array rather than a diff against nothing.

---

## Vite is pinned to 6 because of the Node version, not by preference

Vite 8 is current. It imports `styleText` from `node:util`, which arrives in
Node 20.12, and the development machine runs Node 20.9 — so `vite build` fails
at module load before it does anything.

Vite 6 supports `^20.0.0` and everything else in the stack (Tailwind 4,
`@vitejs/plugin-react` 5) supports Vite 6, so the pin costs nothing today.

**This is debt with a one-line payoff.** After `nvm install 22`, moving to Vite 8
is a version bump in `apps/web/package.json`. The engines floor of the published
packages stays at 20.9 — it is only the dashboard's build tooling that wants a
newer Node, and that is a developer concern rather than a user one.

---

## The palette lives in CSS, and the code looks it up by name

`styles.css` holds every validated colour once. `categoryColor('tool_results')`
returns `var(--cat-tool_results)` rather than a hex value, so no component ever
holds a colour and the validated set cannot drift by someone picking a shade
that looked close enough.

A check confirms all twenty colours in `docs/DESIGN.md` are present, unchanged,
and survive into the built CSS.

Tailwind 4 configures its theme in CSS with `@theme`, which is also why Biome
needed `css.parser.tailwindDirectives` — without it every stylesheet is a parse
error.

---

## The dashboard is tested by rendering it to a string

`apps/web/test/render.test.jsx` renders components with `renderToString`.

Effects do not run, so there is no browser, no DOM, no network and no test
harness to maintain — but it still catches the failures that actually happen
while building screens: a bad import path, invalid JSX, a hook used wrongly, or
a component that throws on its first paint with no data. A build alone catches
none of those, because a module that compiles can still explode on render.

It also caught a real one immediately: `currentPath()` read `window` during
render, which made the whole app unrenderable outside a browser.

---

## One process serves the API and the dashboard

The built files are mounted on the same Hono server as the API, after the
routes, so `/api` can never resolve to a file and a missing build just leaves
the API working alone.

One origin means no CORS in production, one port to explain, and one thing to
start. In development the dashboard runs on Vite's port and proxies `/api`
across, so the app's fetch calls stay origin-relative and the same code works in
both places.

---

## Search returns evidence, not just a shorter list

A query filters the session list and each surviving row carries `matches` and a
highlighted `snippet` of what was found.

A filtered list on its own is a claim the reader has to take on trust — five
sessions became two, and you cannot see why. Showing the matched text with the
term marked turns the result into something checkable, and it is what makes
searching message content better than searching session ids rather than merely
different.

FTS5 returns its snippets with matches wrapped in brackets; the screen renders
those as `<mark>` elements rather than printing literal square brackets.

---

## The sparkline is hand-written SVG, not a chart library

Recharts is in the stack and will draw the composition and cost charts. The
trend column is 64 pixels wide and appears once per row, fifty times.

A charting library there would bring a responsive container, an axis system and
a tooltip layer to render eight line segments — per row. The hand-written
version is forty lines, has no per-row runtime cost, and carries an `aria-label`
saying in words what the line shows, which a canvas-based chart would not.

It turns red once the window is above 90% full, because at that point the trend
has stopped being a curiosity and is the thing about to interrupt the session.

---

## Filter options come from the data, not a hardcoded list

`/api/filters` returns the distinct tools, models and projects that have
actually been captured.

A fixed list of the seven supported tools would offer choices that return
nothing, which reads as a broken filter rather than an empty result. The
dropdowns are also hidden entirely until there is more than one of something to
choose between — a filter with one option is furniture.

---

## The overview shows one turn, not the session total

The session total is what you spent. The context window is what you are living
inside right now, and it is a per-turn thing — so the stat row, the composition
bar, the system prompt panel and the diff all describe a single turn, with a
picker to move between them. The latest turn is the default.

A session-summed composition bar is misleading in a specific way: it counts the
same 105,000-token tool result once per turn it was re-sent, so the chart claims
a window far larger than any that existed. The session total belongs in the cost
column, not in a picture of the window.

---

## The system prompt panel folds tool definitions in

Our model counts tool schemas as `tool_definitions`, a category of their own.
The panel shows them anyway, beside the prompt segments.

From where the reader sits they are the same thing: a fixed preamble re-sent on
every single turn, part of which they control. Splitting them across two panels
because of an internal taxonomy would make someone add the numbers up themselves.

Each row is marked **yours** or **fixed**, and the panel ends with the only
number that leads anywhere: how many tokens of the preamble are in the reader's
hands. A server that was never called says so on its own row, which is the most
actionable line the screen prints.

---

## Deltas use centre-anchored bars and a real minus sign

The context diff draws each category's change from a centre line: growth to the
right, shrinkage to the left. Two bars of equal length pointing opposite ways
read as opposites; two left-aligned bars of equal length read as the same thing.

Numbers use `−`, the minus sign, rather than a hyphen. At eleven pixels a
hyphen is easily read as a dash or missed entirely, and a cost figure that might
be negative is exactly where that matters.

---

## Token abbreviation starts at a thousand

`tokens()` in the dashboard abbreviated only above ten thousand, so a delta of
1,400 printed as "1,400" where `docs/DESIGN.md` shows "+1.4K" — and the CLI's
own formatter already abbreviated from a thousand.

Two formatters disagreeing about the same number is how a product starts looking
untrustworthy. They now agree. Where the digits genuinely matter — a waste
figure someone might check — the code calls `exact()` instead.

---

## Block text is fetched one at a time, never in the list

`/api/sessions/:id/messages` returns previews; `/api/blocks/:id` returns one
block's full text when a reader selects it.

The list was shipping every block's content, and the thing this product exists
to find is precisely a block that is enormous — so the payload for a single turn
of a real session was **136KB, of which 84,600 characters were one stuck npm
log**. Splitting it took the list to **7KB**, a 95% cut, and the full text still
arrives instantly when asked for, because the server is on localhost.

Measuring a tool for wasting tokens while wasting bandwidth to draw the chart
would be a poor joke.

---

## The system prompt is pinned as Turn 0, not hidden behind a tab

`docs/DESIGN.md` lists "system prompt never rendered anywhere" as the prior
tool's defining flaw: it is often the largest single thing in the window, and it
is the part a reader can actually change.

Putting it behind a tab would repeat the mistake in a politer form. It sits above
the conversation as Turn 0, collapsed by default with its token count always
visible, and expands into its segments. A reader who never clicks it still sees
what it costs.

---

## Repetition is stated in the message list, not only in findings

Every block row shows a `4×` badge when its content appears in more than one
turn, and the detail pane spells out the arithmetic: *sent 4 times — 422,864
tokens in total, for 105,716 tokens of content.*

The findings screen ranks waste for someone who came looking for it. The badge
puts the same fact in front of someone who was reading a conversation for another
reason entirely, which is how most people will meet it.

---

## Every finding shows its working out

`docs/DESIGN.md` writes the line explicitly:

```
12,400 tokens × 84 turns = 1,041,600 wasted  ·  $3.12
```

So the screen prints it, built from the `evidence` each rule already emits. It is
the difference between a claim and a calculation: a reader who doubts the
headline can check it against the two numbers that produced it, and a reader who
believes it now understands *why* it is so large — the multiplication, not the
size of any single thing.

Rules whose evidence does not contain a multiplication print no line at all.
Inventing one would be worse than omitting it.

---

## Optimize recomputes rather than reading cached findings

`/api/optimize` runs the rules over recent sessions on every request, and caches
what it finds as a side effect.

The rules are deterministic and pure, so recomputing is cheap and cannot
disagree with itself. Reading a cache instead would mean a screen that shows
findings from before the last three turns landed — and the one thing an optimize
screen cannot afford is to be quietly out of date about what is currently
expensive.

The cache still earns its place: the per-session view and the sessions list read
it, so nothing else pays for the computation.

---

## Empty states state a result, not an absence

"Nothing to fix. None of the ten rules matched. That is a real result, not an
empty state."

A tool that prints "no data" when it has checked and found nothing is throwing
away the most reassuring thing it can say. The distinction matters here because
the rules are exhaustive and deterministic — a clean session genuinely is clean,
not merely unexamined.

---

## The format package ships its own validator rather than taking a dependency

`@contextlab/format` is meant to be published on its own, so that someone
writing a different tool can produce or read the format without installing
contextlab.

A format package that drags in ajv makes a validation-library decision on its
consumer's behalf — in a package whose entire purpose is to be easy to adopt.
So the schema is ordinary JSON Schema, shipped at `@contextlab/format/schema`
for anyone who already has a validator, and the built-in one is roughly 150
lines covering the subset our schema actually uses.

Errors carry a JSON Pointer, because "expected integer" with no location is not
a diagnostic.

---

## Exports default to previews, not full text

`content` is one of `none`, `preview` or `full`, and **preview** is the default.

A session's message content is somebody's source code, their prompts, and
whatever their agent read off disk. The moment a format becomes shareable, the
default has to be the safe one — and every number in the document survives
without the text, because composition, attribution, cost and findings are all
derived figures rather than quotations.

`full` remains available for an archive of your own sessions. The export menu
labels it "includes your prompts and code" rather than leaving someone to work
that out.

---

## Trace ids are derived from session ids, not generated

`toOtlp` hashes our session and turn ids into the fixed-width hex OTLP requires,
rather than minting random ones.

Exporting the same session twice therefore lands on the same trace, so a
re-export updates a backend rather than creating a duplicate conversation beside
the original. Idempotency is worth more here than uniqueness.

Composition is flattened to one attribute per category rather than embedded as
JSON, because a trace backend can group and chart
`contextlab.composition.tool_results` and can do nothing at all with a blob.

---

## An export computes findings if none are cached

Findings are stored when a screen asks for them, so a session nobody has opened
has none on disk.

An export that silently omitted them would be quietly incomplete in a way the
reader could not detect — the document would look fine. Since the rules are pure
and deterministic, `buildExport` simply runs them when the cache is empty.

---

## Billing mode is read from header names, which survive redaction

The proxy destroys header *values* and keeps the names. That turns out to carry
real information: a request with `x-api-key` is a metered key, and one with
`anthropic-beta: …oauth-2025-04-20…` is an account subscription. Neither is a
credential, so a capture says how the caller authenticated without ever having
stored how they authenticated.

This is why a Claude Max user now sees `actual = $0.00` beside
`equivalent = $0.01` rather than being told they spent money they did not spend.
Getting that wrong is the kind of wrong that makes someone distrust every other
number on the screen.

`billing.mode` in config.toml overrides the heuristic, because detection reads
headers we do not control and a user who knows should be able to say so once.

---

## Budgets are stated in equivalent cost, not actual spend

A budget in actual spend reads zero forever on a subscription, which makes the
feature useless to exactly the people most likely to be burning tokens without
noticing.

Equivalent API cost means the same thing on both, so "am I spending more than
usual today" has an answer either way. The panel says so explicitly when the
session is on a plan, rather than letting someone think they are being billed.

---

## config.toml is parsed by a small parser that refuses what it cannot read

`ARCHITECTURE.md` specifies TOML. The config is sections, numbers, strings,
booleans and flat arrays — so `core` parses that subset directly rather than
taking a dependency into the pure test surface.

It errors with a line number on anything outside the subset. A config parser
that silently misreads `daily = five dollars` as nothing at all is worse than
one that refuses the file, because the budget then quietly never fires.

If the config ever needs inline tables or multi-line strings, take the
dependency rather than extending this.

---

## Exact count_tokens exists but is not on the ingest path

Anthropic's `count_tokens` endpoint is free and exact, and `countTokensExact`
calls it.

It is deliberately not wired into ingest. Every capture is written after the
response completes, so the provider's real usage is already there and our
estimate is already corrected against it — calling a second endpoint would add a
network round trip to improve a number we are about to overwrite anyway.

Where it earns its place is the turns that carry *no* usage: a 429, a dropped
stream, a request that failed. Those are stuck with the cl100k approximation,
and they are disproportionately the ones someone is staring at when something
has gone wrong. It needs a key, which contextlab does not hold, so the caller
supplies one.

---

## Coverage is measured and enforced on `core`, and nowhere else

`vitest.config.js` sets thresholds — 98% statements, lines and functions, 80%
branches — scoped to `packages/core/src` alone.

`core` is where a wrong number originates: parsing six unstable wire formats,
counting tokens, rescaling, attributing cost, deciding what is wasted. It is
pure, so every branch is reachable from a plain function call with no fixtures,
no server and no database.

A threshold over the proxy, the store or the dashboard would push us toward
testing wiring — that a route returns 200, that a component renders — which
raises a number without raising confidence. Those packages are tested by
behaviour instead: a real proxy against a real upstream, a real database, a real
export validated against the schema.

The generated price snapshot is excluded. It is data.

---

## The gaps coverage found were the parsers, and that was the point

Before this block the suite was 363 tests and looked thorough. Coverage said
otherwise:

```
openai-responses.js   54.6%
openai-chat.js        63.9%
gemini.js             80.7%
```

Day 1 had tested the seven traps from WIRE-FORMATS §3 — the cases that produce a
silently wrong number — and stopped there. The rest of each format, the item
types and role shapes a real session actually contains, was untested.

That is exactly the code least able to afford it: three undocumented formats that
change without notice. Fifty-two tests later they sit at 98-99%, and a field
renamed upstream now surfaces as a failing assertion rather than a dashboard
that is confidently wrong.

Writing tests to raise a number is waste. Measuring to find out *where* the
tests should have been is not the same activity.
