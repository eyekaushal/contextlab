# Design

Dark-first. Muted, not neon. Numbers are the content; chrome recedes.

## Palette

Warm charcoal since the sixth UI revision: near-black with the warm cast of
the sand rings, in place of the blue-grey slate the second revision took from
the Gotham reference. Not pure black — the page sits at `#171412` and cards a
step above it — so the surfaces still read as surfaces and a card still has an
edge.

Because contrast is a ratio against what sits behind a mark, changing the
surface voids every earlier check, so the sets were re-checked against these
exact surfaces. Darker surfaces help: every category and status colour now
clears 3:1 on all three surfaces, page, card and raised. On slate three had
fallen under on the raised surface (assistant-text 2.63:1, other 2.64:1,
critical 2.65:1), which is the surface behind every card header and hover row.

**Categories (eight hues):** hue separation is unchanged by a surface move —
CVD separation (worst adjacent pair ΔE 8.4 protan) and the normal-vision floor
(worst 19.3) hold from the slate run. Contrast on the card surface now runs
from 3.7:1 (assistant-text green, the weakest) to 5.6:1 (tool calls). The two
colours lifted for slate, assistant-text `#0d880b` and critical `#d43f3e`,
are kept: they pass here by a wider margin, and moving them back would repaint
every existing screenshot for no gain. The grey for *other* is a deliberate
neutral and is excluded from the hue checks; it is not a category colour.

**Status (four):** never colour alone — always an icon and a word — so only the
contrast check binds. All four clear 3:1 on every surface; the weakest is
critical at 3.7:1 on the card. Warning and serious sit 13.6 ΔE apart for
normal vision, under the 15 floor for a *categorical* set; they are not
categorical, ship with distinct icons, and were left as they are.

**Ink:** primary text 14:1 on the card, secondary 7.6:1, muted 4.3:1 — muted
is for labels and units beside a figure, never for a sentence.

Do not substitute colors by eye. If you change one, re-check the set against
`#1f1b18` and again against `#171412` and `#2a2521`.

**Chart rings (tool, project):** warm sand, five colours chosen by the
product owner — see DECISIONS "Rings … on nivo" for the validator run and why
it is kept despite failing it. The charcoal surfaces are tinted toward the
same hue, which is why they were chosen over a neutral grey. On charcoal four
of the five clear 3:1 on the card (the second, `hsl(14 38% 47%)`, was under on
slate); the darkest, `hsl(13 34% 39%)`, stays under at 2.6:1 and is carried
by the legend beside every ring. Severity and category rings do not use sand.

### Surfaces and ink

```css
--page           #171412   /* the window behind everything */
--surface        #1f1b18   /* cards, table bodies; the chart surface */
--raised         #2a2521   /* card headers, hover rows, the top bar */
--text-primary   #ede8e2
--text-secondary #b4aca4
--text-muted     #877d74   /* axis, labels */
--gridline       #332d29
--baseline       #443c36
--border         rgba(255,255,255,0.08)
```

The favicon at `apps/web/public/favicon.svg` is the wordmark's mark with
these values written in — a tab cannot read the page's custom properties. It
is the one file copy of the palette; if a token moves, it moves with it.

### Composition categories (assign in this fixed order — never cycle)

```css
--cat-system-prompt      #3987e5   /* blue    */
--cat-tool-definitions   #d95926   /* orange  */
--cat-tool-results       #199e70   /* aqua    */
--cat-tool-calls         #c98500   /* yellow  */
--cat-user-text          #d55181   /* magenta */
--cat-assistant-text     #0d880b   /* green   — lifted from #008300 for slate; kept */
--cat-thinking           #9085e9   /* violet  */
--cat-images             #e66767   /* red     */
--cat-other              #6e7681   /* grey    */
```

### Status (health, findings, alerts) — reserved, never used for a category

```css
--status-good      #0ca30c
--status-warning   #fab219
--status-serious   #ec835a
--status-critical  #d43f3e   /* lifted from #d03b3b for slate; kept */
```

A status color always ships with an icon + label. Never color alone.

## Chart rules

- 2px gap between stacked segments so boundaries read without relying on hue
- 4px rounded data-ends, anchored to the baseline
- Legend always present for 2+ series; direct-label up to 4
- Values and labels wear text tokens, never the series color
- Recessive grid and axes
- `tabular-nums` only in columns that must align; proportional figures elsewhere
- Hover tooltip on every mark. Tooltip renders **below/right of** the cursor,
  never covering the mark it describes.

## Component stack

```
Tailwind          styling
shadcn/ui         components — copied into the repo, owned, not a dependency
Recharts          bars, lines, stacked areas
d3-hierarchy      treemap layout only (render the rects ourselves)
Ink               terminal TUI for `contextlab watch`
```

## The four screens

### 1 · Sessions
List of every session. Columns: source, model, directory, turns, context %, cost,
health, trend, time.

- **Full-text search across message content** — not just session ID
- Multi-select → Compare
- Filters: source, model, tag, date

### 2 · Session Overview
- Stat row: context %, turn cost, output tokens, health
- **Composition** bar/treemap using the palette above
- **System prompt panel** — segmented (see below)
- **Findings** — each with the config fix
- **Context diff** — see fixes below

### 3 · Messages
Chronological list of every message with token counts and category color.
Right pane shows the selected message rendered + raw + metadata.

**The system prompt is Turn 0.** It is pinned at the top, expandable.

### 4 · Optimize
Ranked list of waste, most expensive first. Each row:

```
MCP server "playwright" was never used
12,400 tokens × 84 turns = 1,041,600 wasted  ·  $3.12

Fix — remove from .mcp.json:
  "playwright": { ... }                                    [Copy]
```

*Timeline and Compare are built after these four.*

## Problems in the prior tool that we are fixing

| Problem | Fix |
| :--- | :--- |
| **System prompt never rendered anywhere.** It is often the largest single block (47% in one observed session) and it is the part the user can actually control. | Pin as Turn 0 in Messages. Segment it: base prompt / CLAUDE.md / each MCP server / skill injections — each with its own token count. |
| **Context diff showed two near-identical full bars.** You could not see what changed. Tooltip covered the bars. | Show only the **delta**. One row per category: `Tool results +1.4K`. Tooltip never overlaps. |
| **Composition colors were neon and clashed.** | The validated palette above. |
| **Compare only handled 2 sessions, only at turn level.** No detail per turn. | N sessions. Click any turn to drill into that turn's composition. |
| **Search only matched session ID.** | FTS5 over all message content. |

## The system prompt panel

```
System prompt · 11,240 tokens · 47% of context
├── Base tool prompt        6,100    fixed — cannot change
├── CLAUDE.md               1,840    yours
├── MCP: playwright         2,300    yours — never called this session
├── MCP: postgres             740    yours
└── Skill injections          260
```

Rows the user controls are visually distinct from fixed rows. Diff across turns
shows what got injected mid-session.
