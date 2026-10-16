import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { slugifyDocHeading } from '../lib/docHeading'
import { HOMEPAGE_HIGHLIGHTS } from './homeHighlights'

test('feature cards lead to published guides and real section anchors', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/public-nav.json', import.meta.url), 'utf8'),
  ) as { sections: { pages?: string[]; categories?: { pages: string[] }[] }[] }
  const published = new Set(
    manifest.sections.flatMap((section) => [
      ...(section.pages ?? []),
      ...(section.categories ?? []).flatMap((category) => category.pages),
    ]),
  )
  expect(new Set(HOMEPAGE_HIGHLIGHTS.map(({ id }) => id)).size).toBe(HOMEPAGE_HIGHLIGHTS.length)
  for (const feature of HOMEPAGE_HIGHLIGHTS) {
    const path = feature.slug.replaceAll('--', '/') + '.md'
    expect(published.has(path)).toBe(true)
    const source = readFileSync(new URL(`../../../../docs/${path}`, import.meta.url), 'utf8')
    const anchors = [...source.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) =>
      slugifyDocHeading(match[1]),
    )
    expect(anchors).toContain(feature.anchor)
  }
})

test('the curated development features exclude games and unsupported promises', () => {
  const copy = HOMEPAGE_HIGHLIGHTS.flatMap(({ title, body, slug }) => [title, body, slug]).join(' ')
  expect(copy).not.toMatch(/game-2048|features--games|instant|in seconds|automatically starts/i)
})

test('every feature card has its own scene', () => {
  const scenes = readFileSync(
    new URL('../components/home/FeatureIllustration.tsx', import.meta.url),
    'utf8',
  )
  for (const { id } of HOMEPAGE_HIGHLIGHTS) expect(scenes).toMatch(new RegExp(`\\b${id}: `))
})
