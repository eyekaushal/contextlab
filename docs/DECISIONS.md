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
