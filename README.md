# contextlab

**See what is actually filling your AI coding agent's context window — and what
to change to fix it.**

Your agent tells you "142,000 tokens, $3.20." It does not tell you that 105,000
of those are one `npm install` log stuck in the history since turn 3, being
re-uploaded on every turn since.

contextlab does.

```
A 105,716-token result from Bash has been re-sent 6 times
105,716 tokens × 6 turns = 528,580 wasted  ·  $2.67

FIX
Start a fresh session once you have taken what you need from this output.
If it came from a command, redirect it to a file and read the part you need:

  npm install > /tmp/install.log 2>&1
  tail -50 /tmp/install.log
```

---

## Install and run

```bash
npx contextlab claude
```

That starts a local proxy, runs Claude Code through it, and captures every API
call. Work as normal. When you are done:

```bash
npx contextlab optimize     # ranked waste, and the exact change to make
npx contextlab dashboard    # the same thing, with charts
```

Nothing is installed globally, nothing runs in the background, and nothing
leaves your machine.

---

## The commands

| Command | Does |
| :--- | :--- |
| `contextlab <tool>` | run a coding agent through the proxy |
| `contextlab optimize` | ranked waste + the exact config change ← **the point** |
| `contextlab why` | why was my last turn expensive? |
| `contextlab cost` | historical spend, by day or project |
| `contextlab watch` | live context gauge in the terminal |
| `contextlab dashboard` | the web UI on `localhost:4041` |
| `contextlab doctor` | check everything is ready |

Anything that is not a known command is treated as a tool to launch, so
`contextlab -- python my_agent.py` works too.

---

## Supported agents

| Agent | How |
| :--- | :--- |
| Claude Code | base-URL environment variable |
| Aider | base-URL environment variable |
| Gemini CLI | base-URL environment variable |
| GitHub Copilot CLI | base-URL environment variable |
| Codex | mitmproxy — it talks to `chatgpt.com` directly |
| Cline | mitmproxy — OAuth routes through its own host |
| OpenCode | mitmproxy — several providers at once |

The first four need nothing installed. The last three cannot be redirected by an
environment variable, so they need `brew install mitmproxy` and a trusted
certificate — `contextlab doctor` checks both and prints the fix.

Per-tool support is a table, not logic. Adding an eighth is one entry in
`packages/core/src/tools.js`.

---

## What it measures

Every captured turn is broken down into **eleven categories** — system prompt,
tool definitions, tool calls, tool results, user text, assistant text, thinking,
system injections, images, cache markers, other — and then traced to something
you can act on:

- **per MCP server** — "playwright adds 7,985 tokens to every turn and you have
  never called it"
- **per tool** — which one produced the 105,000-token result
- **per file** — which file was read fifteen times
- **per prompt segment** — how much of your system prompt is CLAUDE.md

Ten rules then rank what is recoverable. Every finding names the exact change,
with the arithmetic behind its number so you can check it.

---

## Nothing leaves your machine

No account, no cloud, no telemetry. There is no server to send anything to.

**No LLM is called anywhere in the product.** Every number is arithmetic and
every recommendation is a deterministic rule — a comparison and a template
string. The same session produces the same advice twice, offline, with no API
key. Sending someone's entire context window to a third-party model in order to
analyse their context window is exactly what our users are avoiding.

**The proxy is auditable.** It is the only component that ever sees a
credential, so it is ~560 lines with **zero external dependencies** — short
enough to read completely before trusting it with a key. A test fails the build
if a dependency is ever added.

**Credentials never reach disk.** Header values are destroyed before a capture
is written; only the names survive. A test asserts that a real API key does not
appear anywhere in a capture file.

---

## Configuration

Optional, at `~/.contextlab/config.toml`:

```toml
[budget]
daily = 5.00
monthly = 100.00
warn_at = 0.8

[billing]
# api | subscription | auto
mode = "auto"
```

`auto` reads it from the request: an API key is metered, an OAuth token is a
plan. On a plan you are shown **equivalent API cost** rather than being told you
spent money you did not spend.

---

## Exporting

Sessions export as a **conformant profile of the OpenTelemetry GenAI semantic
conventions** — `gen_ai.*` attributes spelled exactly as OTel spells them, plus
our own namespace for what OTel does not model. It converts to OTLP traces with
no mapping layer.

```bash
curl 'localhost:4041/api/export' > sessions.ctxlab.json
curl 'localhost:4041/api/export?format=otlp' > traces.json
```

Exports carry message **previews** by default, not full text — a shared session
is your source code and your prompts. See
[`packages/format/SPEC.md`](packages/format/SPEC.md).

---

## Where things live

```
packages/
  proxy/      zero-dependency proxy: forward + capture
  core/       pure functions: parse, tokenize, compose, attribute, prescribe
  format/     JSON Schema + validator + OTLP converters (publishable alone)
  store/      SQLite + FTS5
  server/     Hono API + SSE
  cli/        commands + Ink TUI
apps/web/     React dashboard
```

| Question | File |
| :--- | :--- |
| What are we building and why? | [`docs/PRODUCT.md`](docs/PRODUCT.md) |
| How is the code organised? | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Colours, screens, UI spec | [`docs/DESIGN.md`](docs/DESIGN.md) |
| Why was X chosen? | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| The export format | [`packages/format/SPEC.md`](packages/format/SPEC.md) |

---

## Development

```bash
pnpm install
pnpm check                              # lint, typecheck, tests
pnpm coverage                           # enforced on packages/core

node scripts/seed-demo.mjs              # five demo sessions, no agent needed
CONTEXTLAB_HOME=~/.contextlab-demo \
  node packages/cli/bin/contextlab.js dashboard
```

Plain JavaScript with JSDoc types throughout — `checkJs`, no TypeScript syntax,
no build step outside the dashboard. `packages/core` is the test surface: pure
functions, no I/O, no network.

---

## Status

Under active development, and **not yet published to npm**. The analysis
pipeline is covered by 485 tests, but it has not yet been exercised against a
full day of real traffic across every supported agent. Treat the numbers as
good, not proven.

## License

MIT
