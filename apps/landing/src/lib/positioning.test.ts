import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replaceAll(/\s+/gu, ' ')

/**
 * The words the product describes itself with. They are repeated by the landing page, the app
 * shell, the package manifests, the README and the docs, and each copy used to drift on its own
 * (one said "planning, executing, and reviewing software work", another "shared context across
 * files"). Change them here and in every carrier below, or this test names the one left behind.
 */
const TITLE = 'Localix — One workspace for you and a team of agents'
const HEADLINE = 'One workspace for you and a team of agents'
const DESCRIPTION =
  'Localix is an open source Agentic Development Environment: one workspace where you and a team of agents share the editor, terminals, preview, and databases.'
/** The same sentence without the product name, for fields that already sit under it. */
const REPO_SHORT =
  'Open source Agentic Development Environment: one workspace where you and a team of agents share the editor, terminals, preview, and databases.'

describe('product positioning', () => {
  test('the short form is the description without the product name', () => {
    expect(DESCRIPTION.toLowerCase()).toContain(REPO_SHORT.toLowerCase())
  })

  test('the description fits a search snippet and the repository field', () => {
    expect(DESCRIPTION.length).toBeLessThanOrEqual(160)
    expect(REPO_SHORT.length).toBeLessThanOrEqual(160)
  })

  test.each([
    ['apps/landing/index.html', [TITLE, DESCRIPTION]],
    ['apps/landing/public/og.svg', [TITLE, DESCRIPTION]],
    ['apps/landing/src/pages/docs/useDocMetadata.ts', [TITLE]],
    ['apps/landing/src/lib/structuredData.ts', [DESCRIPTION]],
    ['apps/ui/index.html', [DESCRIPTION]],
    [
      'README.md',
      [
        HEADLINE,
        'An open source workspace where you and your agents share the editor, terminals, preview, and databases.',
      ],
    ],
  ])('%s states the positioning', (file, expected) => {
    const text = read(file)
    for (const sentence of expected) expect(text).toContain(sentence)
  })

  test.each([
    'package.json',
    'apps/desktop-tauri/src-tauri/Cargo.toml',
    'apps/ui/public/manifest.webmanifest',
  ])('%s carries the short form', (file) => {
    expect(read(file)).toContain(REPO_SHORT)
  })

  test('the hero states the headline', () => {
    expect(read('apps/landing/src/pages/HomePage.tsx')).toContain(HEADLINE)
  })

  // The old claim told readers what the product IS in category words only. Nothing may bring it
  // back as the headline or the page title.
  test('no carrier still leads with the retired headline', () => {
    for (const file of [
      'apps/landing/index.html',
      'apps/landing/public/og.svg',
      'apps/landing/src/pages/docs/useDocMetadata.ts',
      'apps/desktop-tauri/src-tauri/Cargo.toml',
    ]) {
      expect(read(file)).not.toContain('Localix — The open source ADE')
    }
  })
})
