# Development

This page holds how to work on flowfig.

## Development

```bash
npm install
npm run dev            # the gallery: each file in figures/ is one figure
npm test               # build, then run the unit tests
npm run typecheck
npm run format:check
```

A change to the layout, the routing or the SVG output needs a unit test in `src/*.test.ts`.
