import { describe, expect, test } from 'bun:test'

import { buildReleaseNotes, changelogSection } from './build-release-notes.mjs'

const changelog = `# Changelog

## Unreleased

Changes land on \`main\`.

## v1.2.0-beta.1 — 2026-10-11

Intro line.

### Added

- Something new.

## v1.1.0 — 2026-09-01

- Older.
`

const base = {
  tag: 'v1.2.0-beta.1',
  commit: 'a'.repeat(40),
  repository: 'rsaryev/localix',
  channel: 'beta',
  changelog,
  assets: ['Localix-macos-arm64.dmg', 'Localix-linux-x64.AppImage', 'latest.json'],
}

describe('release notes', () => {
  test('takes exactly the tagged version section from the changelog', () => {
    expect(changelogSection(changelog, '1.2.0-beta.1')).toBe(
      'Intro line.\n\n### Added\n\n- Something new.',
    )
    expect(changelogSection(changelog, '9.9.9')).toBe('')
  })

  test('marks only macOS on Apple silicon as tested and lists published installers only', () => {
    const notes = buildReleaseNotes(base)
    expect(notes).toStartWith('Localix v1.2.0-beta.1 (beta)')
    expect(notes).toContain('tested only on macOS (Apple silicon)')
    expect(notes).toContain('| macOS, Apple silicon | `Localix-macos-arm64.dmg` | Tested |')
    expect(notes).toContain('| Linux, x86-64 | `Localix-linux-x64.AppImage` | Experimental |')
    expect(notes).not.toContain('Localix-macos-x64.dmg')
    expect(notes).toContain('## Highlights')
    expect(notes).toContain(`Source commit: ${'a'.repeat(40)}`)
  })

  test('drops the beta warning from a stable release and keeps generated changes', () => {
    const notes = buildReleaseNotes({
      ...base,
      tag: 'v1.1.0',
      channel: '',
      generated: "## What's Changed\n* Fix a thing in #7",
    })
    expect(notes).not.toContain('Beta.')
    expect(notes).toContain("## What's changed\n\n* Fix a thing in #7")
  })

  test('refuses a tag that is not a semantic version', () => {
    expect(() => buildReleaseNotes({ ...base, tag: 'latest' })).toThrow('semantic version')
  })
})
