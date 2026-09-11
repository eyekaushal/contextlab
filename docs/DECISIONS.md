# Decisions

Why we chose what we chose. One entry per real decision. Add to this as the project
grows — a decision that isn't written down will have to be re-argued.

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
