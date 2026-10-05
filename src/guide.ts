export const PLAIN_EXAMPLES = [
  {
    field: 'label',
    rule: 'A box label names the role in 1 to 4 plain words.',
    bad: 'authRateLimiter',
    good: 'Rate limiter',
  },
  { field: 'sub', rule: 'A `sub` line holds a short plain detail.', bad: 'redis.incr()', good: '5 tries a minute' },
  { field: 'edge', rule: 'An edge label names the action or the data.', bad: 'validateCredentials()', good: 'check password' },
  {
    field: 'say',
    rule: 'No code names in labels or sentences. The code name goes in `source` and shows on hover.',
    bad: 'loginHandler calls findUserByEmail',
    good: 'The API finds the user by email',
  },
  {
    field: 'say',
    rule: 'A `say` line or a caption has 15 words or fewer, with the actor first. The check warns above 20 words.',
    bad: 'A session is made after the password check',
    good: 'The API makes a session',
    style: true,
  },
  {
    field: 'step',
    rule: 'A step label has 1 to 4 words. The check skips this rule.',
    bad: 'How a user logs in',
    good: 'Log in',
    style: true,
  },
  {
    field: 'say',
    rule: 'No filler words: seamless, robust, powerful, leverage, effortless.',
    bad: 'seamless lookups',
    good: 'cached lookups',
  },
  {
    field: 'data',
    rule: 'Data shows real values from the code. The check skips this rule.',
    bad: 'an error response',
    good: '401 bad_credentials',
    style: true,
  },
];

const plainBullet = ({ field, rule, bad, good }: { field: string; rule: string; bad: string; good: string }) => {
  const q = (t: string) => (field === 'say' || field === 'step' ? `"${t}"` : `\`"${t}"\``);
  return `- ${rule} Bad: ${q(bad)}. Good: ${q(good)}.`;
};

export const GUIDE = `# flowfig guide

flowfig draws animated flow figures. A figure has boxes, the edges between the boxes, and steps. In each step, a packet moves
along the edges. The output is one animated SVG of 5 to 50 kB, with no script. The SVG plays in a GitHub README, in PR and issue
comments, and in blog posts.

You write a JSON spec. You never write SVG by hand. \`npx flowfig\` checks the spec, renders it and prints the figure back.

## Scope

flowfig draws how something works: parts, the messages between them, and the order of the messages.

- An architecture, a data flow or a pipeline: the map of boxes and edges. Group parts by service, network or trust boundary.
- A flowchart with branches: \`shape: "decision"\` for each branch, one step per path.

flowfig does not draw class or ER diagrams (fields, types, cardinality), charts of numbers or mind maps. If the user asks for one
of these, say so and suggest Mermaid (\`classDiagram\`, \`erDiagram\`). Draw nothing with flowfig.

## Topics

A topic gives the detail for one kind of figure. Before you write that kind of spec, print its topic with
\`npx flowfig docs <topic>\`.

- \`rail\`: a request lifecycle, a call chain or a Mermaid \`sequenceDiagram\`.
- \`marks\`: a state lifecycle, a state machine or a Mermaid \`stateDiagram\`.
- \`timeline\`: a roadmap, a plan with dates or a Mermaid \`gantt\`.
- \`lanes\`: a process that several roles do (a ticket, an order, a refund), or an SOP.
- \`verify\`: a verify finding in the render output, or a check in CI.

## Workflow

### 1. Pick the scope

If the code has more than one flow, name each flow in the reply. Draw one flow or one structure view. For the whole
system, draw one top view with groups, or a set of figures that covers every part. Keep each figure to 12 boxes or fewer.

### 2. Write the fact list

Before the spec, list the facts that the figure must show. Use the code and its wiring (config, compose, route
and queue files) or the pasted Mermaid. Give each fact its \`file:line\`:

- every part (service, function, store, queue, external system);
- every call, in order, as \`caller → callee: payload (file:line of the call)\`;
- every call that does not wait for an answer, and every consumer of each queue or topic;
- every branch, every error path and every end state;
- for an SOP, the facts in the \`lanes\` topic.

If the code does not show a fact, leave it out. Do not guess a part, a name or an order.

### 3. Write the spec

Each fact becomes a box, an edge, a beat, a \`data\` card or a \`show\` row. Write each text in plain words (see "Plain text").
Use real example data from the code or its tests.

Give each box and edge that draws code a \`source\` from the fact list: \`"src/auth/login.ts#verifyPassword"\`. The code name goes
in \`source\`, and the reader sees it on hover. A method uses \`Owner.name\`: \`"src/auth/session.ts#Session.refresh"\`. An edge
\`source\` names the function that makes the call. An edge needs no \`source\` when the code of its \`from\` box makes the call.

An edge across a process gets \`via\`: the name that both sides use in the code. The \`via\` is the queue or topic
(\`"order-paid"\`), the HTTP path (\`"/internal/users"\`), or the store name of the caller (\`"sales_facts"\`). A store box (a
table, a file, a cache key) may have no \`source\`. An edge to a store box still needs \`via\`. A route handler with no name keeps a file \`source\`. An
edge into it uses \`via\` with the route path. An edge out of it in the same process uses no \`via\`.

Mark a hop that does not wait for an answer with \`"async": true\`. This rule covers every send to a queue or topic, every
emitted event, and every call without \`await\`. A pasted Mermaid design wins over this rule: keep each arrow as the Mermaid draws it.

### 4. Render, then fix

Run the render from the repo root.

\`\`\`bash
npx flowfig - out.svg <<'SPEC'
{ "props": { "layout": ..., "edges": [...], "steps": [...] } }
SPEC
\`\`\`

If the check finds an error, the render writes no SVG. The render prints the check lines. Next come one line per edge
(\`from -> to: label\`) and one line per step (\`step "<label>": N hops\`). Last come the verify findings and counts. This
output is the read-back: you need no other command.

Fix the figure and render again:

- Compare the edge lines with the fact list. Each edge goes from the caller to the callee that its fact names.
- Fix each verify finding. The \`verify\` topic explains each one.
- Fix a layout fault in the layout first: rows, columns, \`around\` or a gap. Never remove a fact to pass the check.
- \`small-text\`: the figure is too wide. Use two rows, more steps, or two figures. Do not change \`--width\`.
- \`text-overflow\`: give the box a larger \`width\`, or move a detail to \`sub\` or \`say\`. Never cut a fact, a number or a
  unit: "within 30 days of delivery" does not become "within 30 days".
- \`plain-text\`: write the text again in plain words. The message names the reason. Keep a product name.
- Fix every other warning, or tell the user why it stays. Never use \`--no-check\` to hide a fault.

### 5. Look at the SVG

If you can open a browser, take two screenshots of the SVG a few seconds apart. If the browser blocks \`file://\` URLs, run
\`python3 -m http.server\`. If you cannot open a browser, write "not looked at" in the reply. Never report a look that you did
not do.

### 6. Write the reply

The reply has these parts, in this order:

1. the path of each SVG;
2. what each figure shows, with the counts and names copied from the \`figure:\`, edge and step lines;
3. the flow you drew, why, and the other flows that exist;
4. each fact that the figure leaves out, and why;
5. the lines \`0 errors, 0 warnings\` and \`figure: ...\`, copied as printed, and whether you looked at the SVG;
6. the verify count line, copied as printed;
7. at the end, one line \`npx flowfig open <path>\` for each SVG. Do not run it yourself.

To change an SVG later, print its spec with \`npx flowfig --spec out.svg\`.

## Spec reference

\`props\` has \`layout\` (required), \`edges\` (required), \`steps\`, \`speed\` and \`theme\`. \`speed\` is the ms for a packet to
cross one edge (default 900). \`theme\` sets \`accent\`, \`fg\`, \`muted\`, \`bg\`, \`surface\`, \`border\` and \`font\`. The topics
give \`rail\`, \`lanes\`, \`timeline\` and \`today\`.

A layout group has \`children\`, and optional \`id\` (an edge target), \`label\` (a framed title), \`direction\`, \`gap\` (px),
\`align\`. \`direction\` is \`"row"\` or \`"column"\`. \`align\` is \`"start"\`, \`"center"\` or \`"end"\`. Every other layout item
is a box.

A box has a unique \`id\` and a \`label\` (both required). Its optional fields are \`sub\` (a smaller line), \`shape\`,
\`width\` (px), \`source\`, \`lines\` and \`tone\`. \`shape\` is \`"box"\`, \`"decision"\` or \`"store"\`. \`source\` is
\`path#Owner.name\`, from the repo root. \`lines\` is the least lines of a content card. \`tone\` is \`blue\`, \`purple\`,
\`green\`, \`orange\`, \`red\` or \`gray\`. The topics give \`at\`, \`from\`, \`to\`
and \`mark\`.

An edge has \`from\` and \`to\` (a box or group \`id\`), and optional \`id\` (default \`from->to\`), \`label\`, \`source\` and \`via\`.
\`around: "above"\` or \`"below"\` routes it over or under the boxes between. \`quiet: true\` draws it only while a step uses it.

A step has \`label\` and \`flow\`, and optional \`caption\` and \`nodes\` (boxes to highlight). \`flow\` is a list of beats. A
beat is an edge id or an array of edge ids that run at the same time. A beat can also be
\`{ edges?, say?, show?, light?, ms? }\`.

- \`edges\`: an edge id, a hop, or an array of these. A hop is \`{ edge, back?, data?, tone?, async?, source?, via? }\`.
  \`back: true\` runs the packet from \`to\` to \`from\`. \`data\` is a card that moves with the packet. \`tone\` is \`green\`
  (success), \`orange\` (a retry), \`red\` (an error), \`gray\` (idle) or \`purple\` (async).
- \`say\`: the caption for the beat. \`light\`: boxes to highlight. \`ms\`: the beat length.
- \`show\`: \`{ boxId: [{ tag?, tone?, text, meta?, mark?, mono? }] }\`. The rows fill the content card of each box until the
  step ends.

## Content rules

- Use \`shape: "store"\` for data at rest and \`shape: "decision"\` for a branch.
- Keep one main path, left to right. Put side parts in a \`column\` group.
- A \`quiet: true\` edge needs a beat that uses it.
- Keep an SVG to one or two steps: it loops with no controls. For tabs or pause, use the React player \`<Flow {...props} />\`.

### Plain text

The reader does not know the code.

${PLAIN_EXAMPLES.map(plainBullet).join('\n')}

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
      { "id": "q", "from": "api", "to": "db", "label": "read user" }
    ],
    "steps": [
      {
        "label": "Read a user",
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
npx flowfig spec.json out.svg      # render a spec file, or a .ts module whose default export is a spec
npx flowfig check <input> [--json] # list the faults of a spec or an SVG
npx flowfig --spec out.svg         # print the spec that an SVG carries
npx flowfig gif out.svg [out.gif]  # write an animated GIF (needs Chrome, Edge, Chromium or Brave)
npx flowfig docs [topic]           # print this guide, or one topic
\`\`\`

\`--strict\` makes warnings errors. \`--width\` sets the page width. \`--no-check\` skips the check.
`;

export const TOPICS = {
  rail: `# flowfig topic: rail

Read this topic for a request lifecycle, an API call chain or a Mermaid \`sequenceDiagram\`.

A spec has three forms.

- The map (the default). The map shows the boxes and the edges. A packet moves along an edge in each beat.
- The map with a rail (\`"rail": true\` in \`props\`). The rail is a lifeline diagram under the map. It has one row for each message.
- The rail alone (\`"rail": "only"\`). Use it when the reader needs only the message order, for example when the document
  already has the map.

Rules for a rail:

- Put each message on an edge. Put each phase in a step. Put messages that run at the same time in one beat.
- Give each hop its real payload in \`data\`: \`"POST /login"\`, \`"sid cookie"\`.
- Mark a message that does not wait for an answer with \`"async": true\` on the hop. This rule covers every send to a queue or
  topic, every emitted event, and every call without \`await\`. The rail draws such a message dashed, with an \`async\` tag.
- Draw a reply as a hop back on the same edge, with \`"back": true\`.
- Draw an error reply the same way, with the error in \`data\`. Example:
  \`{ "edge": "login", "back": true, "data": "401 bad_credentials" }\`.
- A call that stays inside one part (a hash check, a guard) is not a message. Put it in \`say\` or in a \`show\` row of that part.

A Mermaid \`sequenceDiagram\` maps this way:

- \`participant\`: a box.
- \`A->>B: text\`: an edge from A to B, and a hop with \`"data": "text"\`.
- \`B-->>A: text\` (a reply): a hop on the same edge with \`"back": true\`.
- \`A-)B: text\`: a hop with \`"async": true\`.
- \`par ... and ... end\`: the hops of all branches in one beat.
- \`alt\` and \`opt\`: one step per path.

A pasted design wins over the async rule: keep each arrow as the Mermaid draws it. \`A->>B\` stays a plain hop, also for a send
to a queue. If you think the design is wrong, say so in the reply.
`,
  timeline: `# flowfig topic: timeline

Read this topic for a roadmap, a plan with dates or a Mermaid \`gantt\`. Read the dates from the document.

- Set \`"timeline": true\` in \`props\`.
- Put one labeled group per track in a \`column\` group.
- Give each item box \`from\` and \`to\`, as YYYY-MM-DD. \`from\` is the first day of the item. \`to\` is the last day.
- A milestone is a box with \`from\` only.
- Draw a dependency as an edge from the first item to the dependent item. A dependent item starts after its source ends.
- Set \`today\` in \`props\`, as YYYY-MM-DD, to stop the today line at that date. Default: the last date of the items.
- A Mermaid \`gantt\` section becomes a track. Each task becomes an item, and each \`after\` becomes an edge.
`,
  lanes: `# flowfig topic: lanes

Read this topic for a process that several roles do: a ticket, an order, a refund or an SOP.

- Set \`"lanes": true\` in \`props\`.
- Put one labeled group per role in a \`column\` group.
- Put each step box in the lane of the role that does it.
- The boxes run left to right in step order. The box field \`at\` sets the time column of a box, 0 first. Default: the order in
  which the steps first reach the box.
- Give the outcomes of one decision the same \`at\`.
- Link each step box with \`source\` to the SOP heading: \`"docs/sop/refunds.md#step-3-approve-the-refund"\`. The part after
  \`#\` is the heading as a GitHub anchor.
- If the steps do not fit the width, flowfig wraps the time columns into blocks. Labeled stubs link the blocks. Keep the
  whole process in one figure.
- An SOP gives more facts: every deadline, message to a person, choice by a person, and wait for a reply.
  Put each one in a box \`sub\`, a step \`say\` or a \`data\` card. Draw each path to its end, and give each path its own step.
`,
  marks: `# flowfig topic: marks

Read this topic for a state lifecycle or a state machine.

- Draw one box per state. Draw one edge per transition, and label the edge with its event in plain words.
- Give each path through the states its own step.
- Mark the first state with \`"mark": "start"\` on the box. The figure draws a filled dot before the box.
- Mark each final state with \`"mark": "end"\` on the box. The figure draws a ringed dot after the box.
- In a Mermaid \`stateDiagram\`, only a top-level \`[*] --> A\` makes A the start state. A \`[*]\` inside a nested state gives
  no start mark. \`B --> [*]\` makes B an end state.
- Use the box \`tone\` for the state color. Use \`green\` for a success state, \`red\` for a failed state and \`gray\` for an idle
  state.
`,
  verify: `# flowfig topic: verify

Read this topic when the render prints a verify finding, or to check figures in CI.

If a box or an edge has a \`source\` or a \`via\`, the render checks each one against the code. The render reads the code from the
folder where it runs, so run it from the repo root. \`--no-verify\` skips this part. A verify finding does not stop the render.

Fix each finding:

- \`missing-file\`: the \`source\` file does not exist. Fix the path. The path is relative to the repo root.
- \`missing-symbol\`: the file has no such symbol or heading. Fix the name. A method uses \`Owner.name\`.
- \`edge-not-found\`: the code does not make that call. Remove the edge, or point its \`source\` at the function that makes the call.
- An \`unsure\` edge is allowed. If a function with a typed receiver makes the call, point the edge \`source\` at that function.
- A \`not checked\` edge has no code to check. Give it a \`source\` or a \`via\` if one exists.

Do not invent an edge to make the verify pass.

The count line has this form:

\`\`\`
out.svg: 4 of 4 boxes defined; edges: 5 found, 0 not found, 1 unsure, 0 not checked
\`\`\`

Copy the count line into the reply as printed.

For CI, \`npx flowfig verify <svg>...\` runs the same check on SVG files. \`--root <folder>\` sets the repo root. \`--json\` prints
JSON. \`--strict\` makes warnings errors.
`,
};

export const AGENT_TEXT = `# Diagrams with flowfig

If the user names no other tool, use flowfig for every diagram, figure, flowchart or picture of how something works. Do not answer with a Mermaid block or ASCII art. Use it for an architecture, a data flow, a pipeline or a request lifecycle.
Use it for a call sequence, a state lifecycle or a flowchart. flowfig also converts a pasted Mermaid flowchart, \`stateDiagram\` or
\`sequenceDiagram\`.

flowfig draws a roadmap or a timeline with dates (\`timeline: true\`), and converts a Mermaid \`gantt\` to it. flowfig does not
draw class or ER diagrams or charts of numbers. For those, tell the user so, suggest Mermaid (\`classDiagram\`, \`erDiagram\`),
and draw nothing with flowfig.

1. Run \`npx flowfig docs\` and read it. If the command fails, stop. Tell the user that flowfig is not available.
   Give them \`npm install --save-dev flowfig\`. Draw nothing with another tool.
2. Pick the scope. If the code has more than one flow, name each flow in the reply. Then draw one flow,
   or draw one structure view and call it a structure view. If the user asks for the whole system, draw one top view with groups.
   Or draw a set of figures that together cover every part. Keep each figure to 12 boxes or fewer. For a process that several roles do, use
   \`lanes: true\`, one labeled group per role. For a plan or a roadmap, read the dates from the document and use \`timeline: true\`.
3. Write a fact list from the code and from its wiring (config, compose, route and queue files). Write each call as
   \`caller → callee: payload (file:line of the call)\`, in order. Include each async call and every consumer of a queue, each
   branch and error path, and each end state. Leave out what the code does not show.
4. Write the spec from the fact list, with plain words in the labels and real data. Give each box and edge that draws code a
   \`source\` (\`file#symbol\`) from the fact list. The code name goes there, not in the label.
   Mark each of these with \`async: true\`. Mark every send to a queue or a topic.
   Mark every emitted event. Mark every call that the caller does not await.
5. Render it from the repo root with \`npx flowfig - out.svg <<'SPEC'\` and the JSON in the heredoc. The render prints the
   check lines, one line per edge, one line per step and the verify findings. Compare the edge lines with the fact list.
   Each edge must go from the caller to the callee that the fact names. Fix each fault and each verify finding, and render again.
   Fix a layout fault by changing the layout first (rows, \`around\`, the gap). Never remove a fact to pass the check; if you
   must remove one, name it in the reply. If \`small-text\` appears, use two rows or split the figure; do not change \`--width\`.
6. If you can open a browser, look at the SVG at two moments of the loop. If you cannot, write "not looked at" in the reply.
   Never report a look that you did not do.
7. Reply with these parts. First, the SVG path. Second, what the figure shows. Copy the counts from the \`figure:\` line.
   Copy the names from the edge lines that the render printed. Third, what the figure leaves out, and why.
   Fourth, the two lines that the render printed, \`0 errors, 0 warnings\` and \`figure: ...\`. Copy them as printed.
   End the reply with one line \`npx flowfig open <path>\` for each SVG. Do not run that command yourself.
`;

export const SKILL_DESCRIPTION =
  'Use for every request for a diagram, figure, flowchart or picture of how something works, when the user names no other tool. Do not answer with a Mermaid block or ASCII art. Use when the user asks for a diagram, figure or animation of how code or a system works: an architecture, a data flow, a pipeline, a request lifecycle, a call sequence, a state lifecycle, a flowchart, a roadmap or a timeline; when the user pastes a Mermaid flowchart, stateDiagram, sequenceDiagram or gantt to convert; or when the user asks for a class or ER diagram.';
