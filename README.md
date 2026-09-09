# contextlab

**See what is actually filling your AI coding agent's context window — and what to
change to fix it.**

Your agent tells you "142,000 tokens, $3.20." It does not tell you that 60,000 of
those are one `npm install` log stuck in the history since turn 3, being re-uploaded
on every turn since.

contextlab does.

```bash
npx contextlab claude
```

Runs a local proxy, captures every API call, and shows you where the tokens and the
money actually went. Works with Claude Code, Codex, Gemini CLI, Aider, Cline,
Copilot and OpenCode — no code changes, no SDK.

## Status

Under active development.

## Principles

- **No LLM calls.** Every number is arithmetic; every recommendation is a
  deterministic rule. Reproducible, offline, no API key.
- **Nothing leaves your machine.** No account, no cloud, no telemetry.
- **The proxy is auditable.** It handles your API keys, so it has zero external
  dependencies and is short enough to read end to end.

## License

MIT
