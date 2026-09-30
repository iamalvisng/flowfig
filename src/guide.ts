// The texts that `flowfig docs` and `flowfig init` print or write. Plain strings, so they ship in dist/.

/** The full guide, as Markdown. `flowfig docs` prints it. */
export const GUIDE = `# flowfig guide

flowfig draws animated flow figures. A figure has boxes, the edges between the boxes, and steps. In each step, a packet moves along
the edges. The output is one animated SVG with no script. The SVG plays in a GitHub README, in PR and issue comments, and in blog
posts. A figure is about 5 to 50 kB.

You write a JSON spec. You never write SVG by hand. The command \`npx flowfig\` checks the spec and renders it.

## What flowfig draws

A spec has three forms.

- The map (the default). The map shows the boxes and the edges. A packet moves along an edge in each beat.
- The map with a rail (\`"rail": true\`). The rail is a lifeline diagram under the map. It has one row for each message.
- The rail alone (\`"rail": "only"\`). Use it when the reader needs only the order of the messages, for example when the map is already in the same document.

Use the rail for a sequence of messages: a request lifecycle, an API call chain, or a Mermaid \`sequenceDiagram\`. Put each message on
an edge. Put each phase in a step. Put messages that run at the same time in one beat. Mark a message that does not wait for an
answer with \`"async": true\`.

## Scope: what flowfig draws and what it does not

flowfig draws how something works: parts, the messages between them, and the order of the messages.

| The user asks for                          | Draw                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| An architecture, a data flow, a pipeline   | The map. Group parts by service, network or trust boundary. \`store\` for data at rest.       |
| A request lifecycle, a call chain          | The map with \`"rail": true\`. One message per hop, with its real payload in \`data\`.          |
| A sequence diagram only                    | \`"rail": "only"\`.                                                                           |
| A state lifecycle, a state machine         | One box per state, one edge per transition, labeled with its event. One step per path. Mark each end state, for example with \`sub: "end state"\`. |
| A flowchart with branches                  | \`shape: "decision"\` for each branch. One step per path.                                     |

flowfig does not draw class or ER diagrams (fields, types, cardinality), Gantt charts, timelines with dates, charts of numbers,
or mind maps. If the user asks for one of these, say that flowfig does not draw it, suggest Mermaid (\`classDiagram\`,
\`erDiagram\`, \`gantt\`), and draw nothing with flowfig.

## Workflow

### 1. Pick the scope

If the code has more than one flow, name each flow in the reply. Then draw one flow, or draw one structure view and call it a
structure view. If the user asks for the whole system, draw one top view with groups, or a set of figures that together cover
every part. Keep each figure to 12 boxes or fewer.

### 2. Write the fact list

Before the spec, write a list of the facts that the figure must show. Take each fact from the code and from its wiring: config
files, compose files, route tables and queue bindings (or from the pasted Mermaid). Give each fact its \`file:line\`:

- every part (service, function, store, queue, external system);
- every call, in order, written as \`caller → callee: payload (file:line of the call)\`. The edge in the spec goes from that caller
  to that callee;
- every call that does not wait for an answer (fire and forget, a queue, a webhook, a callback), and every consumer of each queue
  or topic;
- every branch and every error path (a rejected input, a retry, a dead-letter path);
- every end state.

If the code does not show a fact, leave the fact out. Do not guess a part, a name or an order.

### 3. Write the spec

Each fact becomes a box, an edge, a beat, a \`data\` card or a \`show\` row. Use the real names from the code as labels, and
real example data from the code or its tests. Keep each fact that you leave out, with the reason, for the reply.

Mermaid mapping:

| Mermaid                                  | flowfig                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| \`participant\`                            | a box                                                              |
| \`A->>B: text\`                            | an edge from A to B, and a hop with \`data: "text"\`                 |
| \`B-->>A: text\` (a reply)                 | a hop on the same edge with \`back: true\`                           |
| \`A-)B: text\` (async)                     | a hop with \`async: true\`                                           |
| \`par ... and ... end\`                    | the hops of all branches in one beat                               |
| \`alt\` / \`opt\`                            | one step per path                                                  |
| \`stateDiagram\` states and transitions    | boxes, and edges labeled with the event                            |

### 4. Render, then fix

\`\`\`bash
npx flowfig - out.svg <<'SPEC'
{ "props": { "layout": ..., "edges": [...], "steps": [...] } }
SPEC
\`\`\`

The quoted \`<<'SPEC'\` heredoc passes the JSON with no change. The command checks the spec first. If the check finds an error, the
command writes no SVG and lists the faults. Fix each fault and render again.

- Fix a layout fault by changing the layout first: put parts in rows or columns, route an edge \`around\`, or change a gap.
  Never remove a fact from the fact list to pass the check. If you must remove one, name it in the reply.
- If \`small-text\` appears, the figure is too wide. Put the parts in two rows, move a detail from \`label\` to \`sub\`, or split
  the figure. Use more steps in one figure before you make a second figure. Keep the real name from the code in the label:
  \`ReportsController\` stays \`ReportsController\`, not \`Controller\`. Do not change \`--width\` to pass the check: the
  reader sees the figure at the real page width.
- Fix every other warning, or tell the user why it stays.
- Do not use \`--no-check\` to hide a fault.

### 5. Read the figure back

Run \`npx flowfig --spec out.svg\`. Compare the spec with the fact list. Check that each edge goes from the caller to the callee
that its fact names. Add each fact that is missing, fix each wrong edge, and render again.

### 6. Look at the SVG

The check estimates the text width, so it cannot see everything. If you can open a browser, open the SVG and take a
screenshot. Wait a few seconds and take a second screenshot to see a later beat. If you cannot open a browser, write "not
looked at" in the reply. Never report a look that you did not do. A browser tool can block \`file://\` URLs. If it does, serve the folder
with \`python3 -m http.server\`.

### 7. Write the reply

The reply has these parts, in this order:

1. the path of each SVG;
2. what each figure shows: the parts and the steps. Copy the counts from the \`figure:\` line of the check output. Copy every name
   from the read-back spec. Never count from memory;
3. the scope: the flow you drew, why, and the other flows that exist;
4. what the figure leaves out, and why;
5. the two check lines that the render printed, \`0 errors, 0 warnings\` and \`figure: ...\`, copied as printed, and whether
   you looked at the SVG.

To change an SVG later, print its spec with \`--spec\`, change the spec, and render again.

## Spec reference

\`props\` has these fields.

| Field      | Type                    | Meaning                                                                                        |
| ---------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| \`layout\`   | group                   | The boxes and how they line up. Required.                                                      |
| \`edges\`    | edge[]                  | The arrows between the boxes. Required.                                                        |
| \`steps\`    | step[]                  | The stories the figure tells. With no steps, the figure is a still map.                        |
| \`rail\`     | \`true\` or \`"only"\`      | Draw the steps as a lifeline rail under the map. \`"only"\` draws the rail without the map.      |
| \`speed\`    | number                  | Milliseconds a packet takes to cross one edge. Default: 900.                                   |
| \`theme\`    | object                  | Colors: \`accent\`, \`fg\`, \`muted\`, \`bg\`, \`surface\`, \`border\`, \`font\`. Each color you omit keeps its built-in value. |

### layout

The layout is a tree. A group has \`children\` and these optional fields.

- \`id\`: a name that an edge can use to reach the group as a whole.
- \`label\`: the title on the frame. Only a group with a \`label\` gets a frame.
- \`direction\`: \`"row"\` (the default) or \`"column"\`.
- \`gap\`: the space between children in px. Default: 28 for a column. For a row, the gap fits the widest edge label between two children (at least 56).
- \`align\`: \`"start"\`, \`"center"\` or \`"end"\`. This sets where the children line up across the direction.

Every other item is a box.

| Box field | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| \`id\`      | Required. The name that edges and steps use. It must be unique in the figure.                             |
| \`label\`   | Required. The title in the box.                                                                           |
| \`sub\`     | A smaller line under the label.                                                                           |
| \`shape\`   | \`"box"\` (default), \`"decision"\` (a diamond) or \`"store"\` (a database cylinder for data at rest).          |
| \`width\`   | Width in px. This overrides the width that the layout picks.                                              |
| \`lines\`   | The least number of text lines that a content card keeps. The card still grows to fit its content.        |

### edges

An edge has these fields.

- \`id\`: the name that steps use. Default: \`from->to\`.
- \`from\` and \`to\`: the \`id\` of a box or a group.
- \`label\`: text on the edge, drawn as a small pill.
- \`around\`: \`"above"\` or \`"below"\`. This routes the edge over or under the boxes in between (loops, skip-ahead edges).
- \`quiet\`: if \`true\`, the SVG draws the edge only while a step uses it.

### steps

A step has \`label\` and \`flow\`. It can also have \`caption\` (the line under the figure while no beat has a \`say\`) and \`nodes\` (ids of
boxes to highlight for the whole step).

\`flow\` is a list of beats. A beat is one of these:

- an edge id (a string);
- an array of edge ids, which run at the same time;
- an object \`{ edges?, say?, show?, light?, ms? }\`. A beat with no \`edges\` is a pause.

The beat fields:

- \`edges\`: an edge id, a hop object, or an array of these. A hop object is \`{ edge, back?, data?, async? }\`.
  - \`back: true\` runs the packet from the \`to\` box to the \`from\` box.
  - \`data\` is a small card that moves with the packet.
  - \`async: true\` marks a message that does not wait for an answer. The rail draws it dashed, with an \`async\` tag.
- \`say\`: the caption for the beat.
- \`show\`: \`{ boxId: [row, ...] }\`. This fills the content card of each named box. The card keeps the rows until the step ends.
- \`light\`: ids of boxes to highlight for this beat.
- \`ms\`: how long the beat lasts. Default: the time one packet needs to cross an edge.

A row of a content card is \`{ tag?, tone?, text, meta?, mark?, mono? }\`.

- \`tag\`: a short colored label at the start of the line.
- \`tone\`: the color of the tag: \`blue\` (default), \`purple\`, \`green\`, \`orange\` or \`gray\`.
- \`text\`: the main text.
- \`meta\`: muted text after the main text.
- \`mark\`: a mark at the right end of the line, such as a check or "new".
- \`mono\`: if \`true\`, the text uses a monospace font.

## Content rules

- Give every box a stable \`id\`.
- Use \`shape: "store"\` for data at rest (a database, a cache, a file, a queue). Use a plain box for a part that does work. Use \`shape: "decision"\` for a branch.
- Keep one clear main path, left to right. Put side parts in a \`column\` group.
- Use \`quiet: true\` on a long edge that crosses the picture. A quiet edge needs a beat that uses it, or the check reports
  \`hidden-edge\`.
- In a rail, draw an error reply as a hop back on the same edge, with the error in \`data\` (\`{ "edge": "login", "back": true,
  "data": "401 CREDENTIALS_INVALID" }\`). A call that stays inside one part (a hash check, a guard) is not a message: put it in
  \`say\` or in a \`show\` row of that part.
- Keep an SVG to one or two steps. The SVG plays every step in a loop, with no controls.
- Use the React player, \`<Flow {...props} />\` from \`flowfig\`, for a page that needs tabs, pause or hover.

## Example

\`\`\`json
{
  "props": {
    "layout": {
      "children": [
        { "id": "client", "label": "Browser" },
        { "id": "api", "label": "API Server" },
        { "id": "db", "label": "Database", "shape": "store" }
      ]
    },
    "edges": [
      { "id": "req", "from": "client", "to": "api", "label": "GET /users/42" },
      { "id": "q", "from": "api", "to": "db", "label": "SELECT" }
    ],
    "steps": [
      {
        "label": "read",
        "flow": [
          { "edges": { "edge": "req", "data": "GET /users/42" }, "say": "The browser asks for user 42." },
          { "edges": "q", "show": { "db": [{ "tag": "row", "tone": "gray", "text": "Ada Lovelace" }] }, "say": "The API server reads the row." },
          { "edges": { "edge": "req", "back": true, "data": "200 OK" }, "say": "The API server sends the user." }
        ]
      }
    ]
  }
}
\`\`\`

## Commands

\`\`\`bash
npx flowfig - out.svg < spec.json      # render a spec from stdin
npx flowfig spec.json out.svg          # render a spec file
npx flowfig figure.ts out.svg          # render a module whose default export is a spec
npx flowfig check <input> [--json]     # list the faults. The input can also be an SVG that flowfig wrote.
npx flowfig --spec out.svg             # print the spec that an SVG carries
npx flowfig docs                       # print this guide
npx flowfig init                       # write these instructions for the coding agents of a repo
\`\`\`

A render checks first and writes nothing on an error. \`--strict\` makes warnings errors. \`--width\` sets the page width.
\`--min-text\` sets the smallest text that the reader should get. \`--no-check\` skips the check.
`;

/** The short instruction text that `flowfig init` writes for each coding agent. */
export const AGENT_TEXT = `# Diagrams with flowfig

Use flowfig when the user wants a diagram of how something works: an architecture, a data flow or pipeline, a request lifecycle,
a call sequence, a state lifecycle, or a flowchart. flowfig also converts a pasted Mermaid flowchart, \`stateDiagram\` or
\`sequenceDiagram\`.

flowfig does not draw class or ER diagrams, Gantt charts or charts of numbers. For those, tell the user so, suggest Mermaid
(\`classDiagram\`, \`erDiagram\`, \`gantt\`), and draw nothing with flowfig.

1. Run \`npx flowfig docs\` and read it. If the command fails, stop: tell the user that flowfig is not available, give them
   \`npm install --save-dev flowfig\`, and draw nothing with another tool.
2. Pick the scope. If the code has more than one flow, name each flow in the reply, then draw one flow, or draw one structure
   view and call it a structure view. If the user asks for the whole system, draw one top view with groups, or a set of figures
   that together cover every part. Keep each figure to 12 boxes or fewer.
3. Write a fact list from the code and from its wiring (config, compose, route and queue files). Write each call as
   \`caller → callee: payload (file:line of the call)\`, in order. Include each async call and every consumer of a queue, each
   branch and error path, and each end state. Leave out what the code does not show.
4. Write the spec from the fact list, with the real names and data. Render it with \`npx flowfig - out.svg <<'SPEC'\` and the
   JSON in the heredoc. Fix every fault by changing the layout first (rows, \`around\`, the gap). Never remove a fact to pass
   the check; if you must remove one, name it in the reply. If \`small-text\` appears, use two rows or split the figure; keep
   the real names; do not change \`--width\`.
5. Run \`npx flowfig --spec out.svg\` and compare it with the fact list: each edge must go from the caller to the callee that the
   fact names. Fix each gap.
6. If you can open a browser, look at the SVG at two moments of the loop. If you cannot, write "not looked at" in the reply.
   Never report a look that you did not do.
7. Reply with: the SVG path; what it shows, with the counts copied from the \`figure:\` line and the names copied from the read-back spec; what it leaves out and why;
   the two lines the render printed, \`0 errors, 0 warnings\` and \`figure: ...\`, copied as printed.
`;

/** The description of the Claude skill: the words that make the agent load it. */
export const SKILL_DESCRIPTION =
  'Use when the user asks for a diagram, figure or animation of how code or a system works: an architecture, a data flow, a pipeline, a request lifecycle, a call sequence, a state lifecycle or a flowchart; when the user pastes a Mermaid flowchart, stateDiagram or sequenceDiagram to convert; or when the user asks for a class, ER or Gantt diagram.';
