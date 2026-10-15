# The CLI

This page holds the commands that draw, check, share and trace figures.

## Draw with one command

```bash
npx flowfig draw "how does login work"
```

`draw` runs Claude Code on the repo with the flowfig guide. It gives Claude Code the tools Read, Glob and Grep, and
`npx flowfig`. `draw` disallows the tools Edit, MultiEdit and NotebookEdit. Claude Code writes the figure. Then `draw`
checks the figure with `check --strict` and `verify`. `draw` prints the result, the reply of the agent and the cost of
the run.

`draw` needs Claude Code on the machine and a login. `draw` does not run on Windows yet. `--out` sets the path,
`--model` sets the model, `--max-turns` sets the turn cap (default 40), `--json` prints the result for scripts, and
`--open` opens the figure.

## Check a figure

`flowfig check` reads a spec and lists the faults. The input is `-` (stdin), a `.json` file, a `.ts` module or an SVG from the
CLI. A `.ts` module needs a Node version that strips types, such as Node 22.18 or later.

```console
$ npx flowfig check docs/checkout.svg
0 errors, 0 warnings
figure: 5 boxes, 3 groups, 4 edges, 2 steps, 6 messages
```

The last line gives the counts of the parts of the figure. Compare the counts with the parts that you planned.

`flowfig check` has 29 rules: 11 errors and 18 warnings.

| Rule                        | Severity | What it finds                                                                                                              |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `unknown-id`                | error    | An edge, step or beat names a box, group or edge that does not exist, or `carries.from` names no box and no group.         |
| `duplicate-id`              | error    | Two boxes, two groups or two edges have the same id.                                                                       |
| `hidden-edge`               | error    | A `quiet` edge that no beat uses, so the figure never shows it.                                                            |
| `text-overflow`             | error    | Text that needs more width than its box has.                                                                               |
| `edge-crosses-box`          | error    | An edge that goes through a box that is not one of its ends.                                                               |
| `label-overlap`             | error    | Two edge labels overlap, or a label covers a box or an edge, or a stub label crosses a lane border.                        |
| `low-contrast`              | error    | A text and background pair below 4.5:1, in the light, dark or custom theme, or on a tone tint.                             |
| `lanes-need-column`         | error    | The layout of a `lanes` or `timeline` figure is not a column group of labeled groups.                                      |
| `bad-at`                    | error    | An `at` value that is not an integer of 0 or more.                                                                         |
| `timeline-need-from`        | error    | A box in a timeline has no `from` date.                                                                                    |
| `bad-date`                  | error    | A `from`, `to` or `today` value is not a real YYYY-MM-DD date, or a `to` is before its `from`.                             |
| `bad-carries`               | warning  | An edge `carries` has an empty `thing`, a `form` that is not `box`, `barrel` or `notes`, or a `count` that is not 1 to 4.  |
| `thing-no-road`             | warning  | A thing edge starts and ends at the same actor, or one end has no actor.                                                   |
| `empty-step`                | warning  | A step with no beats.                                                                                                      |
| `small-text`                | warning  | At the page width, the smallest text is below the minimum size.                                                            |
| `bad-source`                | warning  | A `source` that is not `path` or `path#symbol`.                                                                            |
| `bad-detail`                | warning  | A `detail` that is not a relative path that ends in `.svg`.                                                                |
| `mark-count`                | warning  | A lifecycle has more than one `start` mark, or a `start` mark and no `end` mark.                                           |
| `lane-column-taken`         | warning  | Two boxes in one lane share a time column.                                                                                 |
| `lane-end-block`            | warning  | In wrapped lanes, an edge ends at a lane that no block on its side shows.                                                  |
| `stub-crosses-edge`         | warning  | In wrapped lanes, a stub line crosses another edge.                                                                        |
| `long-edge`                 | warning  | An edge at least 600 px long that is 1.6 times or more the straight distance between its ends.                             |
| `timeline-dependency-order` | warning  | In a timeline, an item does not start after the item that it depends on ends. An item may start on the day of a milestone. |
| `timeline-and-lanes`        | warning  | The figure sets `timeline` and `lanes`. The renderers draw the timeline and ignore `lanes`.                                |
| `font-estimated`            | warning  | `theme.font` is set. The SVG check estimates text width for the system font.                                               |
| `color-not-checked`         | warning  | A color that the check cannot read, so its contrast is not checked.                                                        |
| `plain-text`                | warning  | Text with a code name, a filler word, or a `say` or caption over 20 words.                                                 |
| `unknown-look`              | warning  | A box or a group has a `look` that is not one of the 12 pictures.                                                          |
| `auto-ignored`              | warning  | `auto` with `lanes` or `timeline`, `auto` on a nested group, or `around` on an edge with `auto`.                           |

| Option            | Effect                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `--strict`        | Every warning becomes an error.                                                                            |
| `--json`          | Print the findings as a JSON array, for scripts. Each finding has `rule`, `severity`, `ids` and `message`. |
| `--width <px>`    | The page width for `small-text` and for the lanes wrap. Default: 830.                                      |
| `--min-text <px>` | The smallest text size the reader must get. Default: 10.                                                   |
| `--scene <id>`    | A render only: draw the level inside the box with this id, as a plain figure.                              |
| `--script`        | A render only: add the script that opens a box with a click.                                               |

The exit code is 0 with no errors, 1 with one or more errors, and 2 for bad use, such as a missing input, an unknown flag, or a `--width` value that is not a number.

A render runs the same check first. If the check finds an error, the render writes nothing. `--no-check` skips the check.

In React, `<Flow check />` runs the same rules on the layout that the browser drew. The player prints each fault with
`console.warn`.

## Open and share a figure

`flowfig open` shows a figure in your default browser. On macOS, an `.svg` file often opens in a text editor or in Xcode. Thus
`open` writes an HTML page that holds the SVG, and opens that page.

```bash
npx flowfig open docs/checkout.svg
npx flowfig open docs/checkout.svg --html checkout.html    # also write the page to checkout.html
npx flowfig docs/checkout.json docs/checkout.svg --open    # render, then open
```

`flowfig gif` writes an animated GIF of the whole loop. A GIF plays in Slack, Notion, X and slide decks, where an SVG
animation does not play.

```bash
npx flowfig gif docs/checkout.svg                 # writes docs/checkout.gif
npx flowfig gif docs/checkout.svg --step 2        # only step 2: writes docs/checkout-step2.gif
npx flowfig gif docs/checkout.svg --dark --mp4    # the dark theme, and also docs/checkout.mp4
```

`gif` needs Chrome, Edge, Chromium or Brave in the standard install path. Set `CHROME_PATH` to use another browser program.
`--fps` sets the frames per second (1 to 50, default 20). `--scale` sets the pixel scale (default 2). `--mp4` needs `ffmpeg`
on the PATH. If a GIF is over 10 MB, `gif` prints a warning. Use `--step`, a lower `--fps` or a lower `--scale` to make the
file smaller.

`flowfig frames` writes one PNG contact sheet: the key frames of the loop, each with the frame number, the time, the step,
the beat and the boxes. It also prints one line per tile. The frame numbers match `flowfig gif` with the same `--fps`
and `--step`.

```bash
npx flowfig frames docs/checkout.svg               # writes docs/checkout-frames.png
npx flowfig frames docs/checkout.svg --step 2      # only step 2: writes docs/checkout-step2-frames.png
npx flowfig frames docs/checkout.svg --every 500   # one frame each 500 ms, in place of the key frames
```

## Trace the calls of a function

`flowfig trace` lists the calls that one function makes, and the calls that those calls make. Ask your coding agent to run it
before it writes a figure. Then the agent reads only the lines that the trace names. Each edge passes the same check as
`verify`.

`src/login.ts`:

```ts
import { verifyPassword } from './password.ts';
import { findUser } from './users.ts';

export function login(name: string, password: string) {
  const user = findUser(name);
  return verifyPassword(user, password);
}
```

`src/password.ts`:

```ts
export function verifyPassword(user: { hash: string }, password: string) {
  return user.hash === password.split('').reverse().join('');
}
```

`src/users.ts`:

```ts
export function findUser(name: string) {
  return { name, hash: 'drowssap' };
}
```

```console
$ npx flowfig trace src/login.ts#login
src/login.ts#login
  5  src/users.ts#findUser
  6  src/password.ts#verifyPassword
summary: 3 symbols, 2 found, 0 unsure, 0 open, 1 call outside the repo, 0.0 s
```

- A header line gives a caller as `file#symbol`. Each call line under it gives the line of the call, then the callee.
  The call is in the file of the caller. A callee in the same file shows only its symbol.
- `unsure`: trace cannot name the target. An example is a call of a parameter.
- `open`: the target is a name in a string, for example a route table entry. Read that line yourself.
- `stop`: the trace reached `--depth` or `--max`. The line gives the number of functions that it did not follow.
- A call into a package or the standard library gives no line. The summary line counts these calls.

A call that trace cannot see gives no line, for example a call through an interface with no known type.
trace reads code as text. In rare cases, two names that look the same can give a wrong edge. `flowfig verify` and your review of the figure still check each edge.

| Option         | Meaning                                            | Default            |
| -------------- | -------------------------------------------------- | ------------------ |
| `--depth <n>`  | The number of call levels to follow.               | 2                  |
| `--max <n>`    | The largest number of edges. Then the trace stops. | 40                 |
| `--root <dir>` | The repo root. The file path is relative to it.    | the current folder |
| `--json`       | Print one JSON object in place of the lines.       | off                |

The exit code is 1 if the file or the function is not found. It is also 1 if the language is not TypeScript,
JavaScript, Python, Go, Java, C# or Rust.

## Find stale figures

`flowfig coverage` reads each figure in the repo and gives it one state. It also shows the code that has no figure. Run
it each week, or in CI.

```console
$ npx flowfig coverage --entries 'src/geometry.ts'
docs/cached-request.svg        ok      3 of 3 boxes defined
docs/checkout-rail-only.svg    ok      4 of 4 boxes defined
docs/checkout.svg              ok      4 of 4 boxes defined
docs/first.svg                 none    no source links
docs/order-status.svg          none    no source links
docs/refund-process.svg        ok      6 of 6 boxes defined
docs/returns-process.svg       ok      8 of 8 boxes defined
docs/roadmap.svg               ok      8 of 8 boxes defined
uncovered src/geometry.ts: 1 of 1 files have no figure
  src/geometry.ts
summary: 9 figures: 6 ok, 0 stale, 0 fail, 3 none
```

- `fail`: `verify` finds an error, for example a symbol that is gone.
- `stale`: `verify` finds no error, but a linked file changed in a commit after the last commit of the SVG. A linked file
  with changes that are not committed counts as changed now.
- `ok`: `verify` finds no error, and no linked file changed after the SVG.
- `none`: the figure has no `source` link.

`coverage` reads the commit dates from git. If the folder is not in a git repo, `coverage` does not check `stale`. It
prints one line that says so.

A figure covers a code file if one of its links names that file. With `--entries`, `coverage` lists each matched code
file that no figure covers. With no `--entries`, it prints one count line for each top folder.
`coverage` does not count test files as code: `*.test.*`, `*.spec.*`, `__tests__/`, `test_*.py`, `*_test.py`, `*_test.go`,
`*Test.java`, `*Tests.java`, `*Test.cs`, `*Tests.cs`, and files under `tests/` or `src/test/`. An entry that `--entries` names in full still counts.

| Option             | Meaning                                                       | Default            |
| ------------------ | ------------------------------------------------------------- | ------------------ |
| `--figures <glob>` | The SVG files to read. Only an SVG with a figure spec counts. | `**/*.svg`         |
| `--entries <glob>` | The code files that must have a figure.                       | none               |
| `--root <dir>`     | The repo root.                                                | the current folder |
| `--strict`         | Exit 1 if a figure is `fail` or `stale`.                      | off                |
| `--json`           | Print one JSON object in place of the lines.                  | off                |

`coverage` skips `node_modules`, `dist` and each folder with a name that starts with a dot.

## One page for all figures

`flowfig atlas` writes one web page for each figure, and an index page. A box can link to a more detailed figure with
`detail`. The path starts at the repo root, as `source` does.

`docs/system.svg`:

```json
{
  "layout": {
    "children": [
      { "id": "up", "label": "Whole system", "detail": "docs/flows/orders.svg" },
      { "id": "db", "label": "Orders table" }
    ]
  },
  "edges": []
}
```

`docs/flows/orders.svg`:

```json
{
  "layout": {
    "children": [
      { "id": "web", "label": "Web app" },
      { "id": "orders", "label": "Order service", "detail": "docs/system.svg" }
    ]
  },
  "edges": []
}
```

`docs/system.svg` links down to the order flow. `docs/flows/orders.svg` links back up.

```console
$ npx flowfig atlas
/path/to/repo/atlas/index.html — 2 figure pages
```

The command prints the full path of `index.html`.

| Option             | Meaning                                                       | Default            |
| ------------------ | ------------------------------------------------------------- | ------------------ |
| `--figures <glob>` | The SVG files to read. Only an SVG with a figure spec counts. | `**/*.svg`         |
| `--root <dir>`     | The repo root. `detail` paths start here.                     | the current folder |
| `--out <dir>`      | The folder to write.                                          | `atlas`            |
| `--open`           | Open `index.html` in the default browser.                     | off                |

The command writes `index.html`, one `.html` page for each figure, and an empty `.nojekyll` file. It deletes nothing. If a file of the same name exists and the atlas did not write it, the command writes nothing and exits with 2.
All links are relative, so the pages work from a file, a sub-path or any file host. The exit code is 0 when the site is
written, whatever the health of the figures. It is 1 when no figure matches, and 2 for a bad flag.

The index lists each figure with its health from `coverage`: `ok`, `stale`, `fail` or `none`. A figure with a bad spec
has no page. Its row shows `fail` and the error.

Each figure page has these parts, in this order:

1. A link "All figures".
2. The figure path and its health.
3. The figure.
4. A "Details" list with one link for each box that has `detail`.
5. The transcript of the figure.

A link works in these places:

- In the README, an SVG is an image, so a box has no link. The README render does not change.
- On an atlas page, a click on a box opens the page of its `detail` figure. The mouse is the only way to use this link.
- The "Details" list has the same links with names. Use it with the keyboard and a screen reader.
- If the target figure is not in the atlas, the box has no link. The list row says "not in the atlas".

The atlas draws each spec with the installed flowfig and the default options. A page can differ from the committed SVG
if you drew that SVG with `--width` or `--min-text`. A figure that you remove keeps its old page in `--out`.

To publish the pages on GitHub Pages, run `npx flowfig atlas --out docs/atlas` and commit the result. Then set Pages to
"Deploy from a branch" with the folder `/docs`.
