# Verify in CI

This page holds how flowfig finds a drifted diagram and fails CI.

## The problem

A diagram in a repo drifts from the code. Someone renames a function, and the diagram still shows the old name. No
check fails, so no one sees the drift.

flowfig links each part of a diagram to the code that it draws. `flowfig verify` fails when a linked file or symbol is
gone, and warns when the code does not make an edge. Run `verify` in CI, and a stale diagram fails the pull request.

## Fail CI when the diagram drifts

A box, an edge or a message can name the code that it draws:

```json
{ "id": "verify", "label": "verifyPassword", "source": "src/auth/login.ts#verifyPassword" }
```

Rename `verifyPassword` to `checkPassword`. Then `verify` fails with exit code 1:

```console
$ npx flowfig verify login.svg
error    missing-symbol     login.svg: box "verify" -> src/auth/login.ts#verifyPassword: symbol not defined
1 error, 0 warnings
login.svg: 0 of 1 boxes defined
```

`verify` checks that each linked file exists and that it defines the symbol. It also checks each edge against the code
(see [Verify in CI](#verify-in-ci)). A link to a Markdown file can name a heading, so a process diagram can follow its SOP
document.

The GitHub Action runs `verify` on every figure in a pull request. For each SVG that the PR changes, it comments the old
image, the new image and the spec changes. It also names each figure whose linked code the PR changes.

```yaml
# .github/workflows/figures.yml
name: figures
on: pull_request
jobs:
  figures:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the Action reads the old figure from the base commit
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: iamalvisng/flowfig@v0.12.0
        with:
          figures: 'docs/**/*.svg' # default **/*.svg
          # coverage: true # also fail the job if a figure is stale
```

Set `coverage: true` to run `flowfig coverage --strict` after the comment. The job then fails if a figure is stale or fails verify.

## Verify in CI

A box, an edge or a hop can name the code it draws: `"source": "src/auth/login.ts#verifyPassword"`. `npx flowfig verify docs/login.svg`
fails when the file or the symbol is gone. The action runs `verify` on every figure in a pull request. It comments the old and
the new image for each SVG the PR changes, with the spec changes as a list, and it names each figure whose linked code the PR
changes.

`verify` prints one count line for each figure, and gives each edge one result:

```console
docs/login.svg: 7 of 7 boxes defined; edges: 9 found, 0 not found, 1 unsure, 1 not checked
```

- found: the caller code calls or references the callee through an import, the same file or a typed receiver.
- not found: the caller code does not. `verify` warns, and `--strict` makes it an error.
- unsure: `verify` cannot decide, for example when a receiver has no declared type. `verify` lists it with the reason. It never fails CI.
- not checked: the edge has no `source`, or the language is not supported.

`verify` also checks `detail`. If the file is missing or has no figure spec, `verify` warns with `missing-detail`. `--strict` makes it an error.

A method source is `path#Owner.name`. An edge `source` names the function that makes the call.

`via` on an edge names the route, queue, topic, table, file or key that both sides use. For a `via` edge, found means that the caller code and the callee file both use that token. It does not prove that a handler serves it.

Edge checks support TypeScript/JavaScript, Python, Go, Java, C# and Rust. Other files keep the name check for boxes.

A process figure for a team links its boxes to the SOP document, not to code: `"source": "docs/sop/refunds.md#step-3-approve-or-reject"`. The symbol is the heading as a GitHub anchor. If the heading is gone, `verify` fails.

```yaml
# .github/workflows/figures.yml
name: figures
on: pull_request
jobs:
  figures:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the Action reads the old figure from the base commit
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: iamalvisng/flowfig@v0.12.0
        with:
          figures: 'docs/**/*.svg' # default **/*.svg
```
