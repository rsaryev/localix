# Layering

Separate presentation, domain logic and data access so each can be understood and changed with less
of the others in mind. In a system the size of Localix, split by domain module first and layer
inside each module.

## Source

Martin Fowler, "PresentationDomainDataLayering", bliki, 26 August 2015.
<https://martinfowler.com/bliki/PresentationDomainDataLayering.html>

## What the source says

Fowler describes three layers: presentation handles requests and renders output, domain logic holds
validation and calculation, and data access talks to databases or remote services. The value is
mostly cognitive: a developer works on one concern at a time, and a layer can be substituted or
tested on its own.

Dependencies run downward, from presentation to domain to data. A common variation puts a mapper
between domain and data so the domain does not depend on the data source; Fowler notes that this is
often called Hexagonal Architecture.

Layering works at small granularity. Once a layer grows, Fowler recommends making domain-oriented
modules the top level and layering within each. He accepts framework-suggested top levels such as
view, model and data for small systems, not large ones. He adds: "Developers don't have to be
full-stack but teams should be."

## Rules we take

- Make the domain module the top-level folder: `apps/api/src/features/<domain>` and
  `apps/ui/src/features/<domain>`.
- Inside an API feature, keep routes (presentation), service (domain) and repository (data) in
  separate files; a route calls the service, never the repository.
- Keep presentation free of storage: no `kysely` import in a `routes*.ts` file.
- In the UI, keep server access in `shared/api` and the feature `model` segment; `ui` components do
  not fetch.
- Do not add a top-level `controllers/`, `services/` or `repositories/` folder.

## How Localix applies it today

`apps/api/src/features` holds 56 domain modules (`chat`, `agents`, `triggers`, `work` and others).
Inside `apps/api/src/features/chat`, `routes.ts` and `routes-*.ts` are the presentation layer,
`service.ts` and `service/` hold domain behaviour, and `repository.ts` and `repository-*.ts` hold
data access. Contracts shared with clients live in `apps/api/src/features/chat/contracts/`.

The UI follows the same idea through Feature-Sliced Design: `apps/ui/src/features/chat/model` holds
state and API calls, `apps/ui/src/features/chat/ui` holds components. See
[Feature-Sliced Design](feature-sliced-design.md).

`scripts/check-architecture.mjs` keeps UI access to the API in one place: a raw `fetch` to
`API_BASE_URL` outside `apps/ui/src/shared/api/internal.ts` is reported with "use apiFetch", and
`scripts/api-contract-guard.test.ts` refuses hand-built `/rpc/` URLs.

## Known gaps

- Not enforced inside API features: no check stops a route file from importing a repository or
  `kysely`. 46 non-test files under `apps/api/src/features` import `hono` and 91 import `kysely`
  (measured 2026-10-21); the split into routes, service and repository files is a convention.
- Not every API feature uses the routes, service, repository file naming.
- Related: [bounded context](bounded-context.md), [architecture overview](../../architecture.md).
