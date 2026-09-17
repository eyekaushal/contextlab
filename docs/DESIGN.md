# Design

Dark-first. Muted, not neon. Numbers are the content; chrome recedes.

## Palette

Slate, not black, since the second UI revision aligned the surfaces with the
Gotham reference. Because contrast is a ratio against what sits behind a mark,
changing the surface voids every earlier check — so the category and status
sets were re-run through the validator against these exact surfaces, not
carried over.

**Categories (eight hues):** all checks pass on both surfaces — lightness band,
chroma floor, CVD separation (worst adjacent pair ΔE 8.4 protan), normal-vision
floor (worst 19.3), and 3:1 contrast. One colour moved: assistant-text green
`#008300` fell to 2.83:1 on the card surface and was lifted along its own hue
to `#0d880b` (3.03:1). The grey for *other* is a deliberate neutral and is
excluded from the hue checks; it is not a category colour.

**Status (four):** never colour alone — always an icon and a word — so only the
contrast check binds. All four clear 3:1 on the card surface. One moved:
critical `#d03b3b` (2.91:1) to `#d43f3e` (3.05:1). Warning and serious sit
13.6 ΔE apart for normal vision, under the 15 floor for a *categorical* set;
they are not categorical, ship with distinct icons, and were left as they are.

Do not substitute colors by eye. If you change one, re-validate the set —
`scripts/validate_palette.js` from the dataviz skill, `--mode dark --surface
#222d38`, and again against `#1a222c`.

### Surfaces and ink

```css
--page           #1a222c   /* the window behind everything */
--surface        #222d38   /* cards, table bodies; the chart surface */
--raised         #2a3744   /* card headers, hover rows, the top bar */
--text-primary   #e6edf3
--text-secondary #a9b6c3
--text-muted     #7d8b99   /* axis, labels */
--gridline       #34424f
--baseline       #41515f
--border         rgba(255,255,255,0.08)
```

### Composition categories (assign in this fixed order — never cycle)

```css
--cat-system-prompt      #3987e5   /* blue    */
--cat-tool-definitions   #d95926   /* orange  */
--cat-tool-results       #199e70   /* aqua    */
--cat-tool-calls         #c98500   /* yellow  */
--cat-user-text          #d55181   /* magenta */
--cat-assistant-text     #0d880b   /* green   — lifted from #008300 for slate */
--cat-thinking           #9085e9   /* violet  */
--cat-images             #e66767   /* red     */
--cat-other              #6e7681   /* grey    */
```

### Status (health, findings, alerts) — reserved, never used for a category

```css
--status-good      #0ca30c
--status-warning   #fab219
--status-serious   #ec835a
--status-critical  #d43f3e   /* lifted from #d03b3b for slate */
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
