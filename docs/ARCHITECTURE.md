# Architecture

## Three processes

```
   contextlab CLI ── spawns + injects env vars
        │
        ├─► Proxy      :4040   sees API keys, does almost nothing
        ├─► Server     :4041   the brain + dashboard, never sees a key
        └─► your tool (claude / codex / ...) with patched env
```

The **split is deliberate**. The proxy is the only component that touches
credentials, so it is kept tiny and dependency-free — short enough that a stranger
can read the whole thing before trusting it. All analysis happens in the other
process, which only ever sees capture files.

## Capture: two transports

| Mode | How | Used for |
| :--- | :--- | :--- |
| **Reverse proxy** | The tool's base-URL env var points at `:4040` | anthropic, openai, gemini, aider, copilot |
| **MITM forward proxy** | `https_proxy` + CA cert, python addon POSTs to `/api/ingest` | codex (subscription), cline, opencode |

Some tools connect directly to their provider over HTTPS and cannot be redirected
by an env var. Those need mitmproxy. See `notes/WIRE-FORMATS.md`.

## Packages

| Package | Owns | Rules |
| :--- | :--- | :--- |
| `proxy/` | forward, capture, plugins | **Zero external dependencies. Never add one.** |
| `core/` | parse, tokenize, compose, attribute, prescribe, session-id | **Pure functions only.** No file I/O, no network. This is the test surface. |
| `format/` | JSON Schema, validator, OTLP + LHAR converters | Publishable standalone on npm |
| `store/` | SQLite schema, migrations, FTS5 queries | The only package that touches the DB |
| `server/` | Hono routes, SSE | Thin. Calls core + store, holds no logic |
| `cli/` | commands, Ink TUI | Thin. Calls core + store |
| `apps/web/` | React dashboard | Talks to server over HTTP + SSE |

## Data flow

```
claude ──HTTP──► Proxy :4040
                   ├─ forward ──HTTPS──► api.anthropic.com
                   │                      └── SSE streamed back untouched
                   └─ capture ──────────► ~/.contextlab/captures/*.json
                                              │
                            Server :4041 ◄────┘
                                │
        parse → tokenize → compose → attribute → price
                → detect session → run rules → store
                                │
                    ┌───────────┴───────────┐
              SQLite (~/.contextlab/data.db)   SSE → React dashboard
```

**Critical ordering:** the capture is written only *after* the response completes.
The request tells you what was sent; the response carries the provider's real token
counts. Without both there is no cost figure, only a guess.

## Storage

```
~/.contextlab/
├── config.toml          user settings
├── captures/*.json      temp — deleted after processing
└── data.db              SQLite. everything. one file.
```

One file, no server, no setup. Same simplicity as a flat file, but queryable —
which is what search, history and aggregation require.

FTS5 virtual table over message content powers `contextlab search`.

## Why the proxy has zero dependencies

The single biggest adoption barrier is trust: you are asking a developer to route
their API keys through software written by a stranger.

The answer is not a promise, it is a property — `packages/proxy/` is ~600 lines with
no third-party code. Anyone can read all of it in ten minutes. That claim only holds
if the rule is never broken.
