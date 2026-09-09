# contextlab

Local CLI + dashboard that shows what is actually filling the context window of AI
coding agents, what it costs, and **what to change to fix it**.

Sits between the coding tool and the LLM API as a local proxy. No SDK, no code
changes to the tool, nothing leaves the machine.

---

## Non-negotiables

These are settled. Do not re-litigate them.

1. **No LLM calls at runtime.** Every number is arithmetic. Every recommendation is
   a deterministic rule (if/else + template string). Same input → same output,
   offline, no API key. This is a selling point, not an omission.
2. **All tools supported from day one** — claude, codex, gemini, aider, cline,
   copilot, opencode. Not one tool first.
3. **SQLite, not flat files.** Search, history and aggregation are core features.
4. **The proxy package has zero external dependencies.** It handles API keys; it
   must be short enough for a stranger to read end to end. This is the trust story.
5. **Plain JavaScript + JSDoc types** (`checkJs: true`). No TypeScript syntax.
6. **npm is the distribution.** No Docker, no orchestration.

---

## Stack

```
Backend    Node 22 · Hono · better-sqlite3 (+FTS5)
Proxy      Node, zero external deps
Frontend   Vite · React · Tailwind · shadcn/ui
Charts     Recharts · d3-hierarchy (treemap)
CLI        commander · Ink (React for terminal TUI)
Tests      Vitest
Lint       Biome
Repo       pnpm workspaces (no Turbo/Nx)
```

---

## Folder map

```
packages/
  proxy/      zero-dep proxy: forward + capture
  core/       pure functions: parse, tokenize, compose, attribute, prescribe
  format/     JSON Schema + validator + OTLP converters (publishable alone)
  store/      SQLite + FTS5
  server/     Hono API + SSE
  cli/        commands + Ink TUI
apps/
  web/        React dashboard
docs/         committed project documentation
notes/        local working notes — gitignored
```

---

## The five CLI commands

```
contextlab watch      live TUI gauge in the terminal
contextlab cost       historical spend, by day / project
contextlab why        why was my last turn expensive?
contextlab optimize   ranked waste + the exact config change   ← the differentiator
contextlab doctor     preflight checks
```

---

## Where things are documented

| Question | File |
| :--- | :--- |
| What are we building and why? | `docs/PRODUCT.md` |
| How is the code organised? | `docs/ARCHITECTURE.md` |
| Colors, screens, UI spec | `docs/DESIGN.md` |
| Why did we choose X? | `docs/DECISIONS.md` |
| How do the provider APIs differ? | `notes/WIRE-FORMATS.md` ← read before writing parsers |
| What are we building today? | `notes/BUILD-PLAN.md` |
| What did the prior tool's UI look like, and what was wrong with it? | `notes/reference/INDEX.md` |

---

## Progress

- [x] npm name `contextlab` claimed
- [x] GitHub repo created, git identity configured, push verified
- [ ] Day 1 — foundation (proxy, capture, store, parsers)
- [ ] Day 2 — analysis (compose, attribute, rules, CLI)
- [ ] Day 3 — dashboard (4 screens)
- [ ] Day 4 — format spec, tests, docs, publish

---

## House rules

- Commit after each finished piece, not in batches. Conventional commit messages.
- Every non-obvious choice gets a short entry in `docs/DECISIONS.md`.
- `packages/core/` must stay pure — no file I/O, no network. It is the test surface.
- Never add a dependency to `packages/proxy/`.
