import { expect, test } from 'bun:test'
import { parseReleases } from './build-releases.mjs'

const CHANGELOG = `# Changelog

Localix is in beta.

## Unreleased

- **Not out yet**: never listed.

## v0.1.0-beta.23 — 2026-11-01

The agent island is back for questions and approvals, and the agent works real web pages far more
reliably. Dialogs now follow your window transparency.

### Added

- **Agent island**: on a Mac, an agent's question can open at the notch
  while you work in another app.
- **Browser handles real pages**: dropdowns.

### Fixed

- **Dialogs follow window transparency**: dialogs.

## v0.1.0-beta.22 — 2026-10-30

A fix for the Store.

### Changed

- **Open in the Store**: shows Open again.

## v0.1.0-beta.10 — draft prepared 2026-10-17

- **Draft**: never listed.
`

test('lists each dated release with its first sentence and its entries per group', () => {
  expect(parseReleases(CHANGELOG)).toEqual([
    {
      version: '0.1.0-beta.23',
      date: '2026-11-01',
      summary:
        'The agent island is back for questions and approvals, and the agent works real web pages far more reliably.',
      added: 2,
      changed: 0,
      fixed: 1,
      removed: 0,
    },
    {
      version: '0.1.0-beta.22',
      date: '2026-10-30',
      summary: 'A fix for the Store.',
      added: 0,
      changed: 1,
      fixed: 0,
      removed: 0,
    },
  ])
})

test('a summary reads as plain text: links, bold and code lose their markup', () => {
  const [release] = parseReleases(`## v1.0.0 — 2026-01-02

Apps now come from the [Localix marketplace](https://example.com/m), **signed**, with \`/mini-app\`.
`)
  expect(release.summary).toBe(
    'Apps now come from the Localix marketplace, signed, with /mini-app.',
  )
})
