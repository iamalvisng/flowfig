# flowfig

flowfig draws animated diagrams of how software works. You write one JSON spec. flowfig renders the spec as a self-contained
SVG for READMEs, PRs and docs, or as an interactive React player.

![An order checkout: the map of the parts, and a rail of the messages under it](docs/checkout.svg)

## Install

```bash
npm i flowfig
```

React (>=18) is a peer dependency. Only the React player needs React. The CLI and `flowfig/svg` do not need React. flowfig needs
Node 18 or later.

## Your first figure

Save this spec as `first.json`. The spec has 3 boxes, 2 edges and 1 step.

```json
{
  "layout": {
    "children": [
      { "id": "browser", "label": "Browser" },
      { "id": "api", "label": "API" },
      { "id": "db", "label": "Database", "shape": "store" }
    ]
  },
  "edges": [
    { "from": "browser", "to": "api", "label": "GET /user" },
    { "from": "api", "to": "db", "label": "SELECT" }
  ],
  "steps": [
    {
      "label": "Load a user",
      "flow": [
        { "edges": "browser->api", "say": "The browser asks the API for the user." },
        { "edges": "api->db", "say": "The API reads the row." },
        { "edges": { "edge": "api->db", "back": true }, "say": "The row comes back." },
        { "edges": { "edge": "browser->api", "back": true }, "say": "The API sends the user as JSON." }
      ]
    }
  ]
}
```

Render the spec:

```console
$ npx flowfig first.json
figure: 3 boxes, 0 groups, 2 edges, 1 step, 4 messages
first.svg — 8.8 kB
```

The command writes `first.svg`:

![A browser loads a user through an API from a database](docs/first.svg)

The SVG has no script and fetches no font. GitHub shows the SVG in a README, a PR or an issue. The SVG follows the light or dark
color scheme of the reader.

## Three forms

| Form          | Spec           | Use it when                                                             |
| ------------- | -------------- | ----------------------------------------------------------------------- |
| The map       | (default)      | The reader must see where each part runs and which parts talk.          |
| Map and rail  | `rail: true`   | The reader must see the parts, and also the order and payload of calls. |
| The rail only | `rail: "only"` | The order of the messages is the point, and the map adds nothing to it. |

The map:

![A request that misses the cache, then hits the cache](docs/cached-request.svg)

The map with the rail is the checkout figure at the top of this page. The rail draws one row for each message, with its payload.
Hops in one beat share a parallel band. An `async` hop has a dashed arrow and an `async` tag.

The rail only, from the same checkout spec:

![The checkout messages as a rail, without the map](docs/checkout-rail-only.svg)

Each SVG from the CLI carries its own spec. These commands made the rail-only figure from `docs/checkout.svg`:

```bash
npx flowfig --spec docs/checkout.svg > checkout.json   # print the spec in the SVG
# edit checkout.json: set "props.rail" to "only"
npx flowfig checkout.json docs/checkout-rail-only.svg
```

## The spec

A spec has a `layout`, `edges`, and optional `steps`. The full types have doc comments, so your editor shows each field. For the
full reference, run `npx flowfig docs`.

### Boxes

| Field   | Meaning                                                           | Default     |
| ------- | ----------------------------------------------------------------- | ----------- |
| `id`    | The name that edges and steps use. It must be unique.             | required    |
| `label` | The title in the box.                                             | required    |
| `sub`   | A smaller line under the label.                                   | none        |
| `shape` | `"box"`, `"decision"` (a diamond) or `"store"` (a data cylinder). | `"box"`     |
| `lines` | The least number of text lines that a content card keeps.         | none        |
| `width` | The width in px. This value replaces the width that layout picks. | from layout |

### Groups

`layout` is a group. A group holds boxes and other groups.

| Field       | Meaning                                                         | Default                                             |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `children`  | The boxes and groups in the group, in order.                    | required                                            |
| `id`        | The name that an edge can use to reach the whole group.         | none                                                |
| `label`     | The title of the frame. Only a group with a label has a frame.  | none                                                |
| `direction` | `"row"` puts the children side by side. `"column"` stacks them. | `"row"`                                             |
| `gap`       | The space between the children in px.                           | column: 28; row: fits the widest label, at least 56 |
| `align`     | `"start"`, `"center"` or `"end"`, across the direction.         | `"center"` (a column stretches)                     |

### Edges

| Field    | Meaning                                                                 | Default    |
| -------- | ----------------------------------------------------------------------- | ---------- |
| `from`   | The id of the box or group where the edge starts.                       | required   |
| `to`     | The id of the box or group where the edge ends.                         | required   |
| `id`     | The name that beats use.                                                | `from->to` |
| `label`  | The text on the edge.                                                   | none       |
| `around` | `"above"` or `"below"` routes the edge over or under the boxes between. | none       |
| `quiet`  | `true` draws the edge only while a step uses it.                        | `false`    |

### Steps

Each step is one story. The player shows one tab for each step. With no steps, the figure is a still map.

| Field     | Meaning                                               | Default  |
| --------- | ----------------------------------------------------- | -------- |
| `label`   | The tab title.                                        | required |
| `flow`    | The beats, in play order.                             | required |
| `caption` | The line under the figure while no beat has a `say`.  | none     |
| `nodes`   | The ids of the boxes to highlight for the whole step. | none     |

### Beats

A beat is an edge id, an array of edge ids that run at the same time, or an object:

| Field   | Meaning                                                                            | Default        |
| ------- | ---------------------------------------------------------------------------------- | -------------- |
| `edges` | One hop or an array of hops. A hop is an edge id or `{ edge, back, data, async }`. | none (a pause) |
| `say`   | The line of narration for the beat.                                                | none           |
| `show`  | `{ boxId: content }` fills the content card of a box until the step ends.          | none           |
| `light` | The ids of the boxes to highlight for this beat only.                              | none           |
| `ms`    | The length of the beat in ms.                                                      | `speed` (900)  |

In a hop, `back: true` runs the packet from `to` to `from`. `data` is a small card on the packet. `async: true` marks a message
that does not wait for an answer.

Content is an array of rows, or a React node in the player. A row is `{ text, tag, tone, meta, mark, mono }`. Only `text` is
required. The tones are `blue` (the default), `purple`, `green`, `orange` and `gray`.

### Figure options

| Field      | Meaning                                                                   | Default  |
| ---------- | ------------------------------------------------------------------------- | -------- |
| `rail`     | `true` draws the rail under the map. `"only"` draws the rail alone.       | `false`  |
| `speed`    | The time in ms for a packet to cross one edge.                            | 900      |
| `theme`    | `{ accent, fg, muted, bg, surface, border, font }`. Each key is optional. | built-in |
| `autoplay` | Start to play when the figure mounts. Only the React player reads it.     | `true`   |
| `check`    | Run the check rules in the browser. Only the React player reads it.       | `false`  |

## Check a figure

`flowfig check` reads a spec and lists the faults. The input is `-` (stdin), a `.json` file, a `.ts` module or an SVG from the
CLI. A `.ts` module needs a Node version that strips types, such as Node 22.18 or later.

```console
$ npx flowfig check docs/checkout.svg
0 errors, 0 warnings
figure: 5 boxes, 3 groups, 4 edges, 2 steps, 6 messages
```

The last line gives the counts of the parts of the figure. Compare the counts with the parts that you planned.

| Rule                | Severity | What it finds                                                                |
| ------------------- | -------- | ---------------------------------------------------------------------------- |
| `unknown-id`        | error    | An edge, step or beat names a box or edge that does not exist.               |
| `duplicate-id`      | error    | Two boxes, groups or edges have the same id.                                 |
| `hidden-edge`       | error    | A `quiet` edge that no beat uses, so the figure never shows it.              |
| `text-overflow`     | error    | Text that needs more width than its box has.                                 |
| `edge-crosses-box`  | error    | An edge that goes through a box that is not one of its ends.                 |
| `label-overlap`     | error    | Two edge labels overlap, or an edge label covers a box.                      |
| `low-contrast`      | error    | A text and background pair below 4.5:1, in the light, dark or custom theme.  |
| `empty-step`        | warning  | A step with no beats.                                                        |
| `small-text`        | warning  | At the page width, the smallest text is below the minimum size.              |
| `font-estimated`    | warning  | `theme.font` is set. The SVG check estimates text width for the system font. |
| `color-not-checked` | warning  | A color that the check cannot read, so its contrast is not checked.          |

| Option            | Effect                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `--strict`        | Every warning becomes an error.                                                                            |
| `--json`          | Print the findings as a JSON array, for scripts. Each finding has `rule`, `severity`, `ids` and `message`. |
| `--width <px>`    | The page width for `small-text`. Default: 830.                                                             |
| `--min-text <px>` | The smallest text size the reader must get. Default: 10.                                                   |

The exit code is 0 with no errors, 1 with one or more errors, and 2 for bad use, such as a missing input, an unknown flag, or a `--width` value that is not a number.

A render runs the same check first. If the check finds an error, the render writes nothing. `--no-check` skips the check.

In React, `<Flow check />` runs the same rules on the layout that the browser drew. The player prints each fault with
`console.warn`.

## Use in React

```tsx
import { Flow, type FlowProps } from 'flowfig';
import spec from './first.json';

export const LoadUser = () => <Flow {...(spec as FlowProps)} />;
```

The player has these controls:

- One tab for each step, with a progress line. A click on a tab starts that step.
- A pause button, and a speed button that changes between 1× and 2×.
- A full screen button. Esc closes full screen.
- A hover on a box highlights its edges. With the rail, a click on a row starts that message, and a hover highlights its edge.

The player props are the spec fields. `theme` sets the colors, `speed` sets the packet time, and `autoplay={false}` stops the
auto start. `check` runs the check rules. If a figure is wider than its container, the player shrinks the figure to half size at
most, then scrolls. If the reader asks for reduced motion, the player shows the last beat and does not move packets.

The player has no dark theme of its own. For dark mode, set the `--fig-*` CSS variables on `.flowfig`:

```css
@media (prefers-color-scheme: dark) {
  .flowfig {
    --fig-accent: #1f78c8;
    --fig-fg: #e3e3e3;
    --fig-muted: #9aa0a6;
    --fig-bg: #1b1b1d;
    --fig-surface: #242526;
    --fig-border: #3a3b3c;
  }
}
```

These are the built-in dark colors. `flowfig` exports them as `DARK`, and the light colors as `LIGHT`.

## Use from Node

`flowfig/svg` needs no React and no browser.

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { check, toSvg } from 'flowfig/svg';

const spec = JSON.parse(readFileSync('first.json', 'utf8'));
for (const f of check(spec)) console.log(f.severity, f.rule, f.message);
writeFileSync('first.svg', toSvg(spec));
```

- `toSvg(spec, options)` returns the SVG string. The options are `speed`, `padding` (default 24) and `theme`.
- `check(spec, options)` returns the findings. It also takes `width` and `minText`.
- `render(spec, options)` returns `{ svg, scene }`. The scene is the layout that the check reads. Its shape can change.

`toSvg` does not put the spec in the SVG. Only the CLI adds the spec, which `--spec` reads back.

## Use with your coding agent

`npx flowfig init` writes flowfig instructions for the coding agents of a repo. The instructions tell the agent how to write a
spec, check the spec, and render the SVG.

```bash
npx flowfig init            # the current directory
npx flowfig init path/to/repo
```

On a terminal, `init` shows a picker. The picker selects the agents that the repo already uses. If it finds none, it selects
`AGENTS.md`. Type the numbers to toggle agents, press Enter to write, or type `q` to quit.

| Id         | Agent          | File                              | How                                  |
| ---------- | -------------- | --------------------------------- | ------------------------------------ |
| `claude`   | Claude Code    | `.claude/skills/figure/SKILL.md`  | whole file (a skill)                 |
| `agents`   | AGENTS.md      | `AGENTS.md`                       | section (for Codex, Amp, Jules, ...) |
| `cursor`   | Cursor         | `.cursor/rules/flowfig.mdc`       | whole file                           |
| `copilot`  | GitHub Copilot | `.github/copilot-instructions.md` | section                              |
| `gemini`   | Gemini CLI     | `GEMINI.md`                       | section                              |
| `windsurf` | Windsurf       | `.windsurf/rules/flowfig.md`      | whole file                           |
| `kiro`     | Kiro           | `.kiro/steering/flowfig.md`       | whole file                           |

| Flag             | Effect                                                        |
| ---------------- | ------------------------------------------------------------- |
| `--agents <ids>` | Write for these agents, for example `--agents claude,cursor`. |
| `--all-agents`   | Write for all 7 agents.                                       |
| `-y`, `--yes`    | Write for the agents that the repo uses, with no picker.      |
| `--global`       | Write only the Claude Code skill, to your home directory.     |
| `--dry-run`      | Print what `init` would write, and write nothing.             |
| `--list-agents`  | Print the agent ids.                                          |

With no terminal and no `-y`, `--agents` or `--all-agents`, `init` prints the agent ids and exits with code 2.

A section sits between `<!-- flowfig:start -->` and `<!-- flowfig:end -->`. A second run replaces that section and keeps the rest
of the file. A second run also replaces a whole file that `init` wrote. If a whole file exists and did not come from `init`,
`init` skips the file. `init` also skips a section file that has a start marker and no end marker.

`npx flowfig docs` prints the full guide as Markdown.

An agent can use flowfig well for these reasons:

- The spec is plain JSON. An agent writes it with no drawing tool.
- Each SVG from the CLI carries its own spec. `npx flowfig --spec figure.svg` prints the spec, so an agent can edit an old figure.
- `flowfig check` gives the faults as JSON with `--json`, exit codes, and a counts line. A script or an agent can read all three.

## What flowfig does not draw

flowfig draws parts, the messages between the parts, and their order. flowfig does not draw class diagrams, ER diagrams, Gantt
charts, timelines with dates, charts of numbers or mind maps. Use Mermaid or a chart library for those.

## License

MIT. See [LICENSE](LICENSE).

## Development

```bash
npm install
npm run dev            # the gallery: each file in figures/ is one figure
npm test               # build, then run the unit tests
npm run typecheck
npm run format:check
```

A change to the layout, the routing or the SVG output needs a unit test in `src/*.test.ts`.
