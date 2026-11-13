import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replaceAll(/\s+/gu, ' ')

/**
 * The words the product describes itself with. They are repeated by the website, the app shell,
 * the package manifests, the README and the docs, and each copy used to drift on its own (one
 * said "planning, executing, and reviewing software work", another "shared context across
 * files"). Change them here and in every carrier below, or this test names the one left behind.
 */
const TITLE = 'Localix — One workspace for you and your agents'
const HEADLINE = 'The Agentic Development Environment'
const DESCRIPTION =
  'Localix is an open source Agentic Development Environment: an AI agent, its subagents, your editor, terminals and browser. Use any model, or run one locally.'
/** The same sentence without the product name, for fields that already sit under it. */
const REPO_SHORT =
  'Open source Agentic Development Environment: an AI agent, its subagents, your editor, terminals and browser. Use any model, or run one locally.'
const LEDE =
  'An AI agent and its subagents work with you in one desktop app: your editor, terminals and browser. Any model, or run one on your own computer.'

describe('product positioning', () => {
  test('the short form is the description without the product name', () => {
    expect(DESCRIPTION.toLowerCase()).toContain(REPO_SHORT.toLowerCase())
  })

  test('the description fits a search snippet and the repository field', () => {
    expect(DESCRIPTION.length).toBeLessThanOrEqual(160)
    expect(REPO_SHORT.length).toBeLessThanOrEqual(160)
  })

  test.each([
    // The website's title and description: its <title>, link previews and structured data.
    ['site/content/site.ts', [TITLE, DESCRIPTION]],
    ['site/content/landing.ts', [HEADLINE, LEDE]],
    ['site/public/og-card.html', [HEADLINE]],
    ['apps/ui/index.html', [DESCRIPTION]],
    ['README.md', [HEADLINE, LEDE]],
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

  test('llms.txt states the description inside its blockquote', () => {
    const llms = readFileSync(join(repoRoot, 'site/public/llms.txt'), 'utf8')
      .replaceAll(/^>\s?/gmu, '')
      .replaceAll(/\s+/gu, ' ')
    expect(llms).toContain(DESCRIPTION)
  })
})

// The website links each installer by `releases/latest/download/<name>`, a name with no version
// in it, which the release workflow uploads as a copy of the versioned installer. A name the
// workflow does not upload would be a download button that answers 404.
describe('website downloads', () => {
  test('every installer the website links is one the release uploads under that name', () => {
    const site = read('site/content/site.ts')
    const release = read('.github/workflows/release.yml')
    const names = [...site.matchAll(/releases\/latest\/download\/([\w.-]+)/gu)].map(
      ([, name]) => name,
    )
    expect(names.length).toBeGreaterThan(0)
    for (const name of names)
      expect(release).toContain(`stable_copy 'dist-assets/*.${name.split('.').at(-1)}' ${name}`)
  })
})
