# contextlab

**See what is actually filling your AI coding agent's context window — and what
to change to fix it.**

Your agent tells you "142,000 tokens, $3.20." It does not tell you that 105,000
of those are one `npm install` log stuck in the history since turn 3, being
re-uploaded on every turn since.

```bash
npx contextlab claude       # run your agent through a local proxy
npx contextlab optimize     # then: what to change, ranked by money
```

```
A 105,716-token result from Bash has been re-sent 6 times
105,716 tokens × 6 turns = 528,580 wasted  ·  $2.67

FIX
Start a fresh session once you have taken what you need from this output.
```

## Commands

| Command | Does |
| :--- | :--- |
| `contextlab <tool>` | run a coding agent through the proxy |
| `contextlab optimize` | ranked waste + the exact config change |
| `contextlab why` | why was my last turn expensive? |
| `contextlab cost` | historical spend, by day or project |
| `contextlab watch` | live context gauge in the terminal |
| `contextlab dashboard` | the web UI on `localhost:4041` |
| `contextlab doctor` | check everything is ready |

## Agents

Claude Code, Aider, Gemini CLI and Copilot CLI work with nothing installed.
Codex, Cline and OpenCode cannot be redirected by an environment variable and
need `brew install mitmproxy` — `contextlab doctor` checks the certificate too.

## Nothing leaves your machine

No account, no cloud, no telemetry, and **no LLM is called anywhere in the
product**. Every number is arithmetic; every recommendation is a deterministic
rule. It works offline.

The proxy is the only component that sees a credential, so it is ~560 lines with
zero dependencies — short enough to read before trusting it. Header values are
destroyed before any capture reaches disk.

---

Full documentation, architecture and the export format:
**https://github.com/eyekaushal/contextlab**

MIT
