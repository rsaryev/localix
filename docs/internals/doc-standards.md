# Documentation standards

Localix documentation turns current implementation into short, auditable guidance for readers and
contributors. Use this contract to structure a page, place qualifications beside claims, and pass
the repository documentation gates.

## Terminology

| Term             | Meaning                                                                 | Boundary                                                        |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Primary sentence | A short statement naming one mechanism and its user-visible result.     | Target 12–22 words; this is an editorial target, not a gate.    |
| Qualification    | An activation, dependency, client, trust, or non-goal boundary.         | Keep it adjacent to the claim, outside the primary scan path.   |
| Evidence         | Current implementation, tests, configuration, or generated contracts.   | A plan, issue, or old benchmark is not implementation evidence. |
| Screenshot slot  | A semantic, dated path reserved for a product capture.                  | A missing slot is reported; an ordinary broken image is fatal.  |
| Source of truth  | The smallest set of repository files that owns the documented behavior. | Links support the page; they do not replace operational copy.   |
| Owning page      | The guide that defines a shared concept once for sibling pages to link. | Sibling pages retain only the local consequence.                |

## What you can do

Use this section order for a new or substantially rewritten technical page:

| Order | Block             | Purpose                                                                    |
| ----- | ----------------- | -------------------------------------------------------------------------- |
| 1     | Title and opening | Tell a stranger what the subject is and what the page helps them do.       |
| 2     | `Terminology`     | Define overloaded product or implementation terms in a three-column table. |
| 3     | `What you can do` | Present user or contributor operations with an adjacent boundary.          |
| 4     | `How it works`    | Name the modules, state transitions, storage, or protocol behind them.     |
| 5     | `Configuration`   | Tabulate commands, settings, flags, environment values, or choices.        |
| 6     | `Limits`          | State missing wiring, dependencies, non-goals, and failure boundaries.     |
| 7     | `Related guides`  | Link sibling concepts instead of restating their explanations.             |
| 8     | `Source of truth` | Link current owning source and tests; use GitHub URLs on published pages.  |

Use the outline where it helps the reader; a recipe can use numbered steps, and a reference can lead
with its command or option table. Omit empty sections. `Related guides` and `Source of truth` use
compact lists of descriptive links, in that order, with source evidence last.

The opening is two concrete sentences. The first defines the subject; the second tells the reader
when the page is useful.

## How it works

### Claims and qualifications

Write the primary sentence so it remains true when read alone. Put the required boundary in a
`Boundary` table column or a separate sentence immediately after it.

| Weak packaging                                                       | Required packaging                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A long sentence that introduces a mechanism and retracts half of it. | One short mechanism sentence, then a labelled boundary.                            |
| “Integrated agents improve the workflow.”                            | “Sessions share the workspace, terminal, and source control already in use.”       |
| “Supports every provider.”                                           | Name the implemented connection types and link the provider guide for limitations. |
| A distant footnote containing an activation requirement.             | Put `Requires`, `Scope`, `Availability`, or `Boundary` beside the claim.           |

Every factual noun needs current evidence. Open the implementation during the same change, verify
exact names and defaults, and remove anything that cannot be traced.

### Density and ownership

- Give each capability one 12–22-word primary sentence and one adjacent qualification.
- Prefer a named protocol, module, state, file format, or command over category language.
- Convert repeated options, states, commands, and mappings into tables.
- Keep examples smaller than the contract they teach; link source for full implementations.
- Choose one owning page for shared behavior and link it from sibling pages.
- Use calm technical English. Avoid superlatives, competitor comparisons, and design attribution.

Public claims require current implementation evidence: a source file, a test, or a generated
contract. A plan, an issue, or an old benchmark is not evidence.

### Links and source references

Use relative links between public pages and for screenshot assets. In published pages, link source
files and other unpublished repository documents with their ordinary GitHub URL: the landing site
cannot route them as documentation pages. Unpublished internals can use repository-relative links.
Backticked exact source paths beginning with `apps/`, `packages/`, `scripts/`, `config/`, or `docs/`
must exist; use a Markdown link when the file helps the reader.

Do not turn directories, globs, or example placeholders into apparent exact file references.
External links are allowed, but the local documentation generator does not fetch them.

### Product captures

Store captures under the one canonical screenshot tree:

```text
docs/assets/screenshots/<feature>/<surface>--YYYY-MM-DD.png
```

Use a semantic lowercase-hyphenated feature and surface. Compose captures at 1600×1000 CSS pixels;
the current capture workflow produces native 3× PNGs (4800×3000 physical pixels). Use English
deterministic data without names, private paths, secrets, provider keys, unrelated windows, or
desktop chrome. Follow the [capture workflow](../../scripts/screenshots/README.md).

A pending slot may name a dated PNG before the image exists. Place at most one useful capture in a
section, immediately after the claim it demonstrates; a screenshot proves visible state only.

## Configuration

### Enforced page gates

| Check                            | Enforced boundary                                              |
| -------------------------------- | -------------------------------------------------------------- |
| Page length                      | At most 400 lines.                                             |
| Prose block or list item         | At most 120 words.                                             |
| Fenced code block                | At most 48 lines and a language identifier is required.        |
| Relative Markdown link           | Must resolve inside the repository.                            |
| Exact backticked repository file | Must exist for the source roots checked by the docs generator. |
| Pending screenshot slot          | May be absent only below `docs/assets/screenshots/`.           |
| Public contributor-specific path | Rejected by the public-repository hygiene check.               |

### Commands

| Command                               | Use                                                     | Boundary                                              |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `bunx oxfmt --write <owned-files>`    | Format only the files changed in the current scope.     | Do not use the repository-wide writer in shared work. |
| `bun run --cwd apps/landing docs:gen` | Validate and generate the public documentation surface. | It checks pages listed in the public navigation.      |
| `bun run check:docs`                  | Validate source references in subsystem internals.      | It is a ratchet with explicit historical debt.        |
| `bun run check:public`                | Validate public paths, links, and repository hygiene.   | It also checks contracts outside Markdown.            |

## Limits

- The documentation generator validates only pages listed in `docs/public-nav.json`; unpublished
  internals still require manual review and the repository-wide public check.
- Relative links are resolved locally, but external URLs are not checked for availability.
- A pending screenshot path passes generation without an image. It is a declared content gap, not
  evidence that the surface exists or looks current.
- Formatting and link gates cannot prove a product claim. Review the implementation and tests.
- README, policy, license, and security files can use a purpose-built outline when the technical
  page skeleton would obscure their job.

## Related guides

- [Contributing](contributing.md)
- [Documentation map](../README.md)
- [Architecture](architecture.md)

## Source of truth

- [Documentation generator](../../apps/landing/scripts/build-docs.mjs)
- [Public documentation navigation](../public-nav.json)
- [Public repository hygiene check](../../scripts/check-public-repo.mjs)
- [Subsystem source-reference check](../../scripts/check-doc-refs.mjs)
- [Screenshot contract](../assets/screenshots/README.md)
