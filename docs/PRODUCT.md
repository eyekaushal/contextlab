# Product

## The problem

Your coding agent tells you "142,000 tokens used, $3.20." That is the entire answer
you get.

It does not tell you that 60,000 of those tokens are one `npm install` log that got
stuck in the history on turn 3 — and that you have been re-uploading that log on
**every single turn since**.

The API is stateless. On every turn the tool re-sends the whole conversation from
scratch: system prompt + all tool definitions + every message + every tool result.
It is not a bucket that fills up. It is a full re-send that gets longer each time.

That is why waste compounds, and why a single bad turn keeps charging you.

## Who it is for

Developers who use AI coding agents daily — Claude Code, Codex, Gemini CLI, Aider,
Cline, Copilot, OpenCode — and who have no idea where their tokens go.

Free, local, no account.

## The wedge

Not "show me a breakdown." That already exists (see prior art).

**Attribution + prescription:**

> "MCP server `playwright` cost you 12,400 tokens per turn across 84 turns — $3.12
> this session. Remove it from `.mcp.json`."

Ranked by cost. Filtered to things the user can actually control. Every finding
ships with the exact change to make.

## Prior art — what already exists

| Tool | What it does | What it doesn't |
| :--- | :--- | :--- |
| **Claude Code `/context`** | Live per-category breakdown, built in, free | One tool, one moment, no history, no cost, no attribution |
| **`ccusage`** | Historical cost from local Claude Code logs | Cost only. No composition, no attribution, no fix |
| **`ctxlens`** (npm) | "du for tokens" — token budget analyzer, 23 models, offline | Static analysis of files, not live session capture |
| **Langfuse / Braintrust** | Full LLM observability + evals | Requires an SDK in code you own. Useless for closed binaries |
| **context-lens** | Proxy capture + composition treemap | Diagnostic only. No search, no history, no attribution, no fix |

The composition breakdown is table stakes now. **The gap is: cross-tool,
longitudinal, attributed, and actionable.**

## What we do that nothing else does

1. **Attribution** — cost per MCP server / tool / file / prompt segment, over time
2. **Prescription** — every finding carries the config change that fixes it
3. **Cross-tool** — all seven agents in one dashboard
4. **Full-text search** across every message ever captured
5. **Segmented system prompt** — base prompt vs CLAUDE.md vs each MCP server
6. **Subscription-aware cost** — "equivalent API cost" vs actual spend

## Non-goals

- No evals, no prompt versioning, no datasets. That is Langfuse's job.
- No cloud, no accounts, no telemetry.
- No LLM calls. Ever.
- No team/multi-user mode in v1.

## Scope

**v1** — all tools · SQLite + search · attribution · rules engine · 5 CLI commands ·
4 dashboard screens · budgets + alerts · turn diff · subscription-aware cost · exact
`count_tokens` · format spec + validator + OTLP converters

**v2** — RAG chunk analytics (chunk utilization, redundant chunks, k-tuning with a
price tag) · team mode
