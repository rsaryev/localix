# Package principles

Robert C. Martin's package coupling principles govern how packages may depend on each other: no
cycles, depend toward stability, and make stable packages abstract. Localix applies them to its
workspace packages and, by extension, to feature modules.

## Source

Robert C. Martin, "Principles of OOD", butunclebob.com,
<http://butunclebob.com/ArticleS.UncleBob.PrinciplesOfOod>. Unreachable on 2026-10-21 (connection
refused), and the Internet Archive copy could not be fetched.

Used instead, with that caveat:

- Wikipedia, "Acyclic dependencies principle",
  <https://en.wikipedia.org/wiki/Acyclic_dependencies_principle>, which cites Martin's Object Mentor
  paper "Granularity".
- Wikipedia, "Software package metrics", <https://en.wikipedia.org/wiki/Software_package_metrics>,
  which cites Martin, _Agile Software Development, Principles, Patterns, and Practices_ (2002).
- Wikipedia, "Package principles", <https://en.wikipedia.org/wiki/Package_principles>, for the list.

## What the source says

Acyclic Dependencies Principle: Martin requires that "the dependency graph of packages or components
should have no cycles". A cycle can be broken by inverting one dependency through an abstraction or
by extracting the shared part into a new package both sides depend on.

Stable Dependencies Principle: depend in the direction of stability. Stability is measured as
instability I = Ce / (Ca + Ce), where Ca counts incoming and Ce outgoing dependencies; I near 0 is
stable, near 1 unstable. A package should depend only on packages with lower I.

Stable Abstractions Principle: a package should be as abstract as it is stable. Abstractness A is
the share of abstract types. Packages near the line A + I = 1 (the main sequence) are balanced; the
distance D = |A + I − 1| measures deviation.

## Rules we take

- Keep the workspace package graph acyclic; break a new cycle by a port or a new lower package.
- Keep the feature graph inside `apps/api/src/features` and `apps/ui/src/features` acyclic for value
  imports.
- Depend toward stability: `packages/agent` and `packages/mini-app-sdk` depend on nothing above
  them; apps depend on packages, never the reverse.
- Keep the most depended-on packages (`packages/agent`, `packages/mini-app-sdk`) mostly interfaces
  and types.
- Declare every workspace import in the importing package's manifest.

## How Localix applies it today

The workspace package graph is acyclic (read from `packages/*/package.json` and
`apps/*/package.json` on 2026-10-21). `@localixai/agent` has no workspace dependencies and sits at
the bottom; the engine packages depend only on it; `@localixai/api` and `@localixai/ui` sit at the
top.

`scripts/check-architecture.mjs` enforces parts of this: an undeclared workspace import is reported
as "used without being declared"; `ENGINE_LAYERS` pins each engine package's allowed dependencies;
`kitBoundaryProblem` keeps `packages/kit` from importing apps or mini apps; a relative import from a
package into `apps/` or `mini-apps/` is reported; and the agent package may import no `@localixai/*`
module.

## Known gaps

- A1 forbids a cycle between workspace packages and A6 a value-import cycle between API features,
  both at a baseline of zero. Type-only imports between features are not counted and may form
  cycles; they carry no runtime coupling.
- Instability and abstractness are not measured.
