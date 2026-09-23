# contextlab

**contextlab shows you where your tokens go when you use an AI coding agent, and what to change so you spend less.**

You run your agent through it. That is the whole setup:

```bash
npm install -g contextlab
cd your-project
contextlab claude        # or codex, gemini, aider, cline, copilot, opencode
```

Work as you normally would. When you are done, run `contextlab optimize` or
open the dashboard, and you get answers to three questions:

1. **What is filling the context window?** Not a total. A breakdown: system
   prompt, tool definitions, tool results, your messages, the model's replies,
   thinking, images. Then traced to the actual thing: which tool, which file,
   which MCP server.
2. **What did it cost?** Per turn, per session, per project, per day. If you
   are on a subscription plan it shows the equivalent API price instead of
   pretending you were charged.
3. **What should I change?** A ranked list of waste, and next to every item
   the exact fix: a line in a config file, a shell redirect, a model switch.
   Each one shows its own arithmetic so you can check it.

## Why this exists

Coding agents resend the whole conversation to the model on every turn. So
when a 100,000-token `npm install` log lands in the history on turn 3, you
pay for it again on turn 4, and 5, and every turn after that until the
session ends. Your agent reports "142,000 tokens, $3.20". It does not tell
you that most of that is one log file it keeps re-uploading.

contextlab sits between the agent and the API, keeps a copy of each request,
and does the arithmetic. It is a proxy and a database, nothing more.

## What it is not

- Not a cloud service. It runs on your machine, and nothing leaves it. No
  account, no telemetry.
- Not an AI tool analysing your AI tool. No model is called anywhere. Every
  number is counted and every recommendation is a fixed rule, so the same
  session gives the same answer twice, offline.
- Not a change to your agent. No plugin, no SDK, no config edits. The agent
  is pointed at a local address and does not know the difference.

Free and open source, MIT licensed.

---

## Install and run

contextlab is a single npm package. Install it once, globally, so the
`contextlab` command is on your path:

```bash
npm install -g contextlab
```

It needs Node 22 or newer. Check with `node --version`; if you are on an
older version, `nvm install 22` gets you there. Confirm the install:

```bash
contextlab --version
contextlab doctor          # checks Node, the certificate, the dashboard build
```

### Run an agent through it

Change into the project you are working on, then start your agent through
contextlab instead of directly:

```bash
cd ~/code/my-project
contextlab claude          # Claude Code
```

The same shape works for every supported agent:

```bash
contextlab codex
contextlab gemini
contextlab aider
contextlab cline
contextlab copilot
contextlab opencode
```

That starts a local proxy, runs the agent through it, and captures every API
call it makes. Work as normal. The project folder you started from is what
the dashboard files the session under, so run it from inside the project,
not from your home directory.

### Look at what it captured

When you are done, in the same folder:

```bash
contextlab why             # why was my last turn expensive?
contextlab optimize        # ranked waste, and the exact change to make
contextlab cost            # spend by day and by project
contextlab dashboard       # all of it, with charts, at http://localhost:4041
contextlab watch           # a live gauge while the agent runs
```

### Update

```bash
npm install -g contextlab@latest
contextlab --version
```

If a running dashboard still shows the old version afterwards, stop it with
Ctrl-C and start it again; the page is served by the process you started.

### Try it without installing

`npx` downloads the package into a cache and runs it in one step. Useful for a
first look, and it is what the launch video shows:

```bash
npx contextlab@latest claude
npx contextlab@latest dashboard
```

Pin `@latest` when you use `npx`: without it, npx happily reuses an older
cached copy.

### Uninstall

```bash
npm uninstall -g contextlab
rm -rf ~/.contextlab        # captures, database and config, if you want them gone too
```

Nothing runs in the background, nothing phones home, and nothing leaves your
machine.

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

Run it **inside the project's folder**. The session is filed under that
folder - that is how the dashboard groups by project - and it is where the
agent will work anyway. `--project <path>` overrides it.

---

## Supported agents

| Agent | How |
| :--- | :--- |
| Claude Code | base-URL environment variable |
| Aider | base-URL environment variable |
| Gemini CLI | base-URL environment variable |
| GitHub Copilot CLI | base-URL environment variable |
| Codex | mitmproxy - it talks to `chatgpt.com` directly |
| Cline | mitmproxy - OAuth routes through its own host |
| OpenCode | mitmproxy - several providers at once |

The first four need nothing installed. The last three cannot be redirected by an
environment variable, so they need `brew install mitmproxy` and a trusted
certificate - `contextlab doctor` checks both and prints the fix.

Per-tool support is a table, not logic. Adding an eighth is one entry in
`packages/core/src/tools.js`.

---

## What it measures

Every captured turn is broken down into **eleven categories** - system prompt,
tool definitions, tool calls, tool results, user text, assistant text, thinking,
system injections, images, cache markers, other - and then traced to something
you can act on:

- **per MCP server** - "playwright adds 7,985 tokens to every turn and you have
  never called it"
- **per tool** - which one produced the 105,000-token result
- **per file** - which file was read fifteen times
- **per prompt segment** - how much of your system prompt is CLAUDE.md

Ten rules then rank what is recoverable. Every finding names the exact change,
with the arithmetic behind its number so you can check it.

---

## Nothing leaves your machine

No account, no cloud, no telemetry. There is no server to send anything to.

**No LLM is called anywhere in the product.** Every number is arithmetic and
every recommendation is a deterministic rule - a comparison and a template
string. The same session produces the same advice twice, offline, with no API
key. Sending someone's entire context window to a third-party model in order to
analyse their context window is exactly what our users are avoiding.

**The proxy is auditable.** It is the only component that ever sees a
credential, so it is ~560 lines with **zero external dependencies** - short
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
conventions** - `gen_ai.*` attributes spelled exactly as OTel spells them, plus
our own namespace for what OTel does not model. It converts to OTLP traces with
no mapping layer.

```bash
curl 'localhost:4041/api/export' > sessions.ctxlab.json
curl 'localhost:4041/api/export?format=otlp' > traces.json
```

Exports carry message **previews** by default, not full text - a shared session
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

Plain JavaScript with JSDoc types throughout - `checkJs`, no TypeScript syntax,
no build step outside the dashboard. `packages/core` is the test surface: pure
functions, no I/O, no network.

---

## Status

Published - `npx contextlab@latest`. Version 0.1.x. The analysis pipeline is
covered by the test count above, and it has been exercised against Claude
Code, Gemini CLI and Aider on real traffic; Codex, Cline and OpenCode go
through mitmproxy and have not yet been run end to end. Treat the numbers as
good, not proven, and report anything that looks wrong.

## License

MIT
