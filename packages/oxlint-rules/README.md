# `@localixai/oxlint-rules`

Repository invariants that run **inside** oxlint, as a JS plugin, so a violation is reported at the
offending node while it is being written instead of by a separate source scan afterwards.

This does not replace `scripts/*` or [`@localixai/source-lint`](../source-lint/). A whole-tree
contract — "every bundled plugin manifest agrees with its directory", "no subsystem doc names a file
that no longer exists" — is not something a per-node linter can express, and those stay where they
are. Rules here are the per-node half.

## Rules

| Rule                         | Enforces                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `no-adhoc-focus-ring`        | Focus indicators use the shared recipe instead of hand-written focus ring utilities.                                |
| `no-global-key-listener`     | Global keyboard listeners in the workspace UI and kit use the action registry, apart from explicit contract owners. |
| `no-ground-token-on-control` | Small shared controls use control fills instead of full-strength pane backgrounds.                                  |
| `no-hardcoded-colors`        | Colours that paint surfaces use theme tokens instead of literal values.                                             |
| `no-off-scale-radius`        | Interface classes use the theme's radius scale instead of bare `rounded`.                                           |
| `props-type-naming`          | A component's props type is named after the component.                                                              |

All six rules are enabled as errors in [`.oxlintrc.json`](../../.oxlintrc.json). Their source
modules own their exact scope and exceptions; finding counts belong to current lint output.

## Scope is part of each rule

Every rule here was run over the whole repository before being enabled, and every one of them was
narrowed by what that run reported. The narrowing is not incidental:

- A colour literal is only wrong where it PAINTS. `SpaceColorPicker` offers hex values to the user,
  `ChartCanvas` keeps one as a `readVar` fallback because a `<canvas>` cannot resolve a CSS
  variable, and `RootErrorBoundary` paints `var(--color-background, #070707)` precisely because it
  must render when the stylesheet that defines the token never loaded. A rule matching every string
  literal would have reported all thirty of those and been switched off within a week.
- A props type shared by several components, or declared in another file, is not this file's to
  rename. Neither is the props type of a memoized inner function, which belongs to the exported
  component rather than to the `Impl` wrapper.
- The action registry lives in `apps/ui`, and kit primitives render inside that workspace. The
  landing site has none, and the visual-feedback probe runs inside the page being previewed, so for
  both a global listener is the only listener there is. Plugin surfaces are out of scope only until
  the SDK exposes keyboard registration; today a plugin has nothing to migrate to.

Exemption lists carry their reason inline and are lists of deliberate owners, not backlogs.

## Adding a rule

1. Write `src/rules/<name>.ts` exporting a `Rule`, with a header comment saying what breaks without
   it — not what it checks.
2. Register it in `src/index.ts`. `src/registry.test.ts` fails if you forget: an unregistered rule
   silently never runs, and that looks exactly like clean code.
3. Write `src/rules/<name>.test.ts`. Tests spawn the real `oxlint` over a fixture through
   [`runRule`](src/testing/run-rule.ts) rather than asserting against a hand-built AST, because the
   node shapes these rules key on come from oxlint's alpha JS-plugin layer and nothing else
   guarantees them.
4. Run it over the whole repository before choosing a severity. A rule's first real run is where its
   scope gets decided.

## Notes

oxlint loads `src/index.ts` directly — there is no build step, because `jsPlugins` accepts
TypeScript and both Bun and Node ≥22 strip the types themselves. A compiled `dist/` would only add a
way for the linter to run against a stale copy of its own rules.

The plugin is loaded through **Node's** ESM resolver, which does not guess extensions, so every
relative import in this package is written with its `.ts` suffix.
