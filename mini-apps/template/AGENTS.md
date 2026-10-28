# Working on the reference mini app

This is Daily Log, the mini app every user mini app is created from: the mini-app-authoring plugin's
`mini-app create` copies it into a new folder under a new identity, and the agent replaces its
domain. Read the repository root guidelines first. This directory is a Bun workspace package, not a
separate Git repository; use the parent's dependency installation and lockfile.

What a copy is made of is declared in `scaffold.json`, and every part of it is load-bearing:

- **Entry** — same path and export in every copy, body replaced: `mini-app.json`, `guide.md`,
  `icon.svg`, `backend/index.ts` (`register`), `ui/register.tsx` (`registerUi`).
- **Domain** — Daily Log itself, replaced by each copy. Its identifiers on `domainTokens` are the
  residue the plugin's check reports; one a copy may rightly keep (`{snake}_summary`) is not listed.
- **Patterns** — each domain file is the pattern for its part (a collection, a tool, a settings
  route, the screen, a chart, a list, a form, the tests), named at an anchor the file contains. Keep
  each the best example of its kind: copies imitate them.
- **Authoring only** — the preview, the build configuration and the DOM tests, which the kit does
  not ship (a copy cannot run DOM tests).

There is no frame of copied helpers: the plumbing is the SDK's app layer
(`packages/mini-app-sdk/src/backend/app.ts`, `collection.ts`, `judgment.ts`, `testing.ts` and
`src/ui/app.tsx`). A fix to it reaches every copy at once.

House rules the copies inherit from here:

- `shared/model.ts` is the contract: schemas and the pure logic both sides use. The screen and the
  tools compute what they show with the same function.
- What the person and the agent create lives in a collection. The screen reads it with
  `useCollection` and changes it through it; it never keeps a second copy of the list.
- Every control comes from the host kit, `@localixai/kit/<id>`, coloured with host tokens; the
  plugin's style step and `scripts/ui-token-drift-guard.test.ts` apply the same rules. Never import
  `@/…`: the UI is built into its own artifact.
- The screen publishes what it shows as message context and clears it when inactive
  (`useAgentContext`).
- No word "template" in prose of a shipped file: the scaffold renames it to the copy's name.
- Keep application code independent of `preview/`, which only this repository has.

Choose checks for the changed contract. Run a focused test under this mini app; use its `type-check`
or `type-check:tests` script when static evidence is needed. Changes to what copies are made of also
need `bun test scripts/mini-app-kit.integration.test.ts` from the repository root: it stages a kit,
creates a copy from it and checks, builds and installs that copy.

For visible changes, inspect `mini-app:template` in the running app at narrow and wide widths and
maintain the `system/overview` capture scenario under the repository screenshot workflow.
