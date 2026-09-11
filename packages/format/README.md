# @contextlab/format

A portable record of agent sessions: what filled the context window, what it
cost, and what was wasted.

**A conformant profile of the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)**
— not a new format. Attributes OTel defines are spelled exactly as OTel spells
them, so a document converts to OTLP traces with no mapping layer.

```bash
npm install @contextlab/format
```

```js
import { buildDocument, validate, toOtlp } from '@contextlab/format'

const document = buildDocument(sessions)
const { valid, errors } = validate(document)
const traces = toOtlp(document)          // OTLP/JSON, ready to POST
```

## What it adds to OTel

| Namespace | Holds |
| :--- | :--- |
| `gen_ai.*` | model, usage, finish reasons — verbatim from the conventions |
| `contextlab.context` | how the window was composed |
| `contextlab.cache` | cache reads and writes |
| `contextlab.cost` | actual and equivalent spend |
| `contextlab.composition` | the eleven categories |
| `contextlab.attribution` | cost traced to MCP servers, tools, files, prompt segments |
| `contextlab.findings` | what was wasted, and the fix |

## Zero dependencies

The JSON Schema ships at `@contextlab/format/schema` for anyone who already has
a validator. The built-in one exists so this package takes no dependency — a
format package has no business making a validation-library decision on its
consumer's behalf.

Errors carry a JSON Pointer:

```
/sessions/0/turns/0/attributes/gen_ai.usage.input_tokens: must be at least 0
```

## Full specification

[SPEC.md](./SPEC.md) — shape, invariants, content levels, cost semantics and
OTLP conversion.

MIT
