# The contextlab capture format

**Version 1.0.0** · a conformant profile of the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

A portable record of one or more agent sessions: what filled the context window,
what it cost, and what was wasted.

---

## Why a profile and not a new format

Inventing a format fragments the ecosystem and invites the obvious question —
why not OpenTelemetry?

So every attribute OTel already defines is spelled exactly as OTel spells it.
`gen_ai.request.model` is `gen_ai.request.model`. A document converts to OTLP
traces with no mapping layer, and a GenAI-aware backend understands the result
without being taught anything.

Our own namespace carries only what OTel does not model:

| Namespace | Holds |
| :--- | :--- |
| `gen_ai.*` | model, usage, finish reasons — verbatim from the conventions |
| `contextlab.context` | how the window was composed |
| `contextlab.cache` | cache reads and writes |
| `contextlab.cost` | actual and equivalent spend |
| `contextlab.composition` | the eleven categories |
| `contextlab.attribution` | cost traced to MCP servers, tools, files, prompt segments |
| `contextlab.findings` | what was wasted, and the fix |

Every document states which revision of the conventions it follows, in
`semconv`. The GenAI conventions are still moving, and a reader should never be
guessing which spelling they are looking at.

---

## Shape

```jsonc
{
  "format": "contextlab",
  "version": "1.0.0",
  "semconv": "1.37.0",
  "exportedAt": "2026-09-11T12:00:00.000Z",
  "content": "preview",
  "producer": { "name": "contextlab", "version": "0.1.0" },
  "pricing": { "source": "https://models.dev/api.json", "updatedAt": "2026-09-10" },

  "sessions": [
    {
      "id": "tag:a1b2c3d4",
      "attributes": {
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": "claude-opus-4-5"
      },
      "contextlab.tool": "claude",
      "contextlab.transport": "reverse-proxy",
      "contextlab.project": { "path": "/repo/contextlab", "name": "contextlab" },
      "startedAt": "2026-09-11T10:00:00.000Z",
      "endedAt": "2026-09-11T10:08:00.000Z",

      "contextlab.totals": {
        "turns": 8,
        "input_tokens": 1080000,
        "peak_context_tokens": 168400,
        "cost": { "currency": "USD", "actual": 6.08, "equivalent": 6.08 }
      },

      "contextlab.findings": [
        {
          "rule": "unused-mcp-server",
          "severity": "critical",
          "title": "MCP server \"playwright\" was never used",
          "fix": "Remove \"playwright\" from .mcp.json",
          "wasted_tokens": 47911,
          "wasted_cost": 0.24,
          "evidence": { "server": "playwright", "perTurn": 7985, "turns": 6 }
        }
      ],

      "turns": [
        {
          "id": "cap-0",
          "sequence": 0,
          "startTime": "2026-09-11T10:00:00.000Z",
          "durationMs": 3200,

          "attributes": {
            "gen_ai.operation.name": "chat",
            "gen_ai.system": "anthropic",
            "gen_ai.request.model": "claude-opus-4-5",
            "gen_ai.response.model": "claude-opus-4-5",
            "gen_ai.usage.input_tokens": 132000,
            "gen_ai.usage.output_tokens": 280,
            "gen_ai.response.finish_reasons": ["end_turn"]
          },

          "contextlab.context": {
            "tokens": 133000,
            "system_tokens": 21000,
            "tools_tokens": 8000,
            "messages_tokens": 104000,
            "limit": 200000
          },
          "contextlab.cache": { "read_tokens": 1000, "write_tokens": 0 },
          "contextlab.cost": { "currency": "USD", "actual": 0.66, "equivalent": 0.66 },

          "contextlab.composition": [
            { "category": "tool_results", "tokens": 104000, "percent": 78.2 }
          ],
          "contextlab.system_segments": [
            { "kind": "memory_file", "label": "CLAUDE.md", "tokens": 20800 }
          ],
          "contextlab.attribution": [
            {
              "entity_type": "mcp_server",
              "entity_name": "playwright",
              "tokens": 7985,
              "definition_tokens": 7985,
              "calls": 0,
              "cost": 0.04
            }
          ],
          "contextlab.messages": [
            {
              "index": 0,
              "role": "user",
              "tokens": 36,
              "blocks": [
                {
                  "type": "text",
                  "category": "user_text",
                  "tokens": 36,
                  "chars": 140,
                  "turns_present": 6,
                  "text": "the build is failing"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Invariants

A conforming document holds all of these. They are worth checking, because a
document that breaks one is one whose numbers contradict each other.

```
context.system_tokens + context.tools_tokens + context.messages_tokens
  === context.tokens

sum(composition[].tokens) === context.tokens

composition[].category ∈ the eleven, always
```

Attribution deliberately does **not** sum to `context.tokens`. One tool result
belongs to the tool that produced it, the file it read, and the MCP server it
came from — three entities, one set of tokens. Each needs the full cost of the
thing it names, so the shares overlap and exceed the whole. This is intentional
and is not a percentage.

---

## Content levels

`content` says how much message text a document carries.

| Level | Carries | For |
| :--- | :--- | :--- |
| `none` | no messages at all | sharing numbers with no content whatsoever |
| `preview` | first 200 characters per block | the default — enough to recognise a block |
| `full` | every block's complete text | your own archive |

**The default is `preview`,** deliberately. A shared session is somebody's
source code and prompts, and every number in the document survives without the
text.

---

## Cost

`actual` and `equivalent` are both always present.

A subscription user pays nothing marginal for a given turn, so `actual` is zero
and telling them otherwise would be false. But they still need `equivalent` —
what it would have cost at API rates — because that is the only way to compare
two sessions or rank what to fix. A consumer should show `actual` for spend and
`equivalent` for comparison.

Cache reads and writes are priced separately and are not in the OTel
conventions. At a typical 0.1× read rate, treating cached tokens as fresh input
overstates a well-cached session roughly tenfold.

---

## OTLP conversion

```js
import { toOtlp, fromOtlp } from '@contextlab/format'

const traces = toOtlp(document)      // OTLP/JSON, ready to POST
const back = fromOtlp(traces)        // and back again
```

- A **session** becomes a trace, with a parent span, so turns appear nested
  inside the conversation rather than as unrelated siblings.
- A **turn** becomes a client span named `chat <model>`.
- Trace and span ids are **derived from our ids**, so exporting the same session
  twice lands on the same trace and a re-export is idempotent in a backend.
- Composition is flattened to one attribute per category
  (`contextlab.composition.tool_results`), because a backend can group and chart
  a scalar and can do nothing with JSON inside a string.

`fromOtlp` reconstructs only spans it recognises. Somebody else's OTLP export
does not become a contextlab document by accident.

---

## Validating

```js
import { validate, assertValid, SCHEMA } from '@contextlab/format'

const { valid, errors } = validate(document)
// errors: [{ path: '/sessions/0/turns/0/attributes/...', message: '...' }]

assertValid(document)   // throws, listing everything wrong
```

The package ships the JSON Schema at
`@contextlab/format/schema` for anyone who would rather use their own validator.
The built-in one exists so that this package can stay dependency-free — a format
package has no business making a validation-library decision on its consumer's
behalf.

---

## Stability

`version` is the version of **this format**, not of the tool that wrote it.

Within `1.x`: fields may be added, and a consumer must ignore ones it does not
recognise. Nothing is removed and nothing changes meaning. The eleven
composition categories are fixed — RAG support in a later version will add
`retrieved_chunks` rather than redesigning the set.
