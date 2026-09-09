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
