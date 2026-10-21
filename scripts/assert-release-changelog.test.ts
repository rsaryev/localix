import { describe, expect, test } from 'bun:test'

import { releaseChangelogProblem } from './assert-release-changelog.mjs'

const changelog = `# Changelog

## Unreleased

## v1.2.0 — 2026-10-21

### Added

- A dialog announces each new version.

## v1.1.0 — 2026-09-01

### Fixed
`

describe('release changelog', () => {
  test('accepts a version whose section lists changes', () => {
    expect(releaseChangelogProblem(changelog, '1.2.0')).toBeNull()
  })

  test('refuses a version with no section, or a section with headings only', () => {
    expect(releaseChangelogProblem(changelog, '1.3.0')).toContain('no "## v1.3.0" section')
    expect(releaseChangelogProblem(changelog, '1.1.0')).toContain('lists no changes')
    expect(releaseChangelogProblem(changelog, '')).toContain('not set')
  })
})
