# Explain a flow in a web page

This page holds how to put an explained flow in a web page.

## Explain a flow in a web page

`flowfig/element` is a web component. It shows one flow to a reader who does not know the code. Load the script and add the tag:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/flowfig/dist/element.js"></script>
<flowfig-explain src="explain-bakery.svg" form="guide"></flowfig-explain>
<flowfig-explain src="after.json" before="before.json" form="change">
  <p slot="verdict">A failed ledger write now runs again by itself.</p>
</flowfig-explain>
```

![The guide form as a small world: the courier truck carries the cake box from the bakery to the customer's house](explain-bakery.png)

The element has three forms:

- `diagram` shows the figure that `toSvg` draws, with the step tabs of the player.
- `guide` shows one moment at a time. The actors are the cast. The cast comes from the lanes. Else it comes from the labeled top-level groups.
  Else it comes from the boxes that the steps visit. A store box adds the actor "Records" at the end. When the cast comes from the boxes, the cast holds at most 6 actors, and "Records" takes one of the 6 places. In a figure
  without lanes, a decision box is not an actor.
- `change` shows the older and the newer spec side by side, with the differences marked. Below the diagrams, an outcome row
  compares Before and After: red for an end box with the tone `red` or `gray`, green for the tone `green`. A step that only one
  side has plays on that side only.

For a good guide, give each role a lane or a labeled group. Give each beat a `say`. Use `note` for the reason and `look` for the picture.

The guide form shows a figure as a small isometric world when an edge `carries` a thing, or when an actor has the look
`person`, `shop` or `truck`. Each actor stands in a building along a road. A thing moves by road or by hand. Data flies as an arc
through the air. A check is a gate at the door of its owner. Each story ends on an outcome frame, with the `outcome` sentence and
one tag for each actor. On a phone, the road runs down the screen as a stacked street. Other figures show the diagram in the guide.
The world loads from `element-world.js` next to `element.js`, with a shared chunk (`element-looks.js`). A CDN script tag loads
them from the same folder. The world art stays light in a dark theme.

| Attribute | Values                                                             | Default                                       |
| --------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `src`     | The URL of a spec JSON file, or of an SVG that flowfig wrote.      | required, unless the `spec` property is set   |
| `form`    | `diagram`, `guide` or `change`.                                    | `guide` if the spec has steps, else `diagram` |
| `step`    | A step label to start on.                                          | the first step                                |
| `before`  | The URL of the older spec.                                         | required for `change`                         |
| `theme`   | `auto`, `light` or `dark`.                                         | `auto`                                        |
| `code`    | Present: each moment shows its `source` and `via` values.          | absent                                        |
| `forms`   | The forms that the reader can switch between, separated by spaces. | all forms that the input allows               |

The `theme` key of the spec colors the SVG in the diagram and change forms. It applies only when the `theme` attribute is `auto`. The element keeps a color only if it is plain color syntax. Else it uses the default color.

- Properties: `spec` and `beforeSpec` (objects, instead of the URLs), and `moment` (the index; read and write).
- Methods: `next()`, `back()`, `play()`, `pause()` and `show(stepLabel)`.
- Events: `flowfig-moment` (`detail: { step, moment, total }`) and `flowfig-form` (`detail: { form }`).
- Slots: `verdict` (the change form; it shows above the diagrams), `title` and `caption`. Without a `verdict`, the change form shows a plain list of what changed. The raw diff is behind "Show all changes".
- Keys: the element takes focus. The arrow keys move between moments (or between steps in the diagram form). Space plays and pauses. The keys 1 to 9 pick a step.

The element has a shadow root. The CSS of the host page does not reach inside it. To change the look, set the `--flowfig-*` tokens
on the element: `--flowfig-bg`, `--flowfig-surface`, `--flowfig-border`, `--flowfig-ink`, `--flowfig-muted`, `--flowfig-accent`,
`--flowfig-on-accent`, `--flowfig-good`, `--flowfig-bad`, `--flowfig-play`, `--flowfig-font`. Only these tokens change the look.

```css
flowfig-explain {
  --flowfig-accent: #7c3aed;
  --flowfig-font: Georgia, serif;
}
```

The element is `element.js` and the files `element-world.js` and `element-looks.js` next to it. The core loads under 45 kB gzip, and the world loads on demand. There is no React. In a bundler, write `import 'flowfig/element'`.
