import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { slugifyDocHeading } from '../lib/docHeading'
import {
  AUTONOMY_FEATURES,
  BROWSER_FEATURES,
  CONTEXT_FEATURES,
  EXTERNAL_FEATURES,
  CONTROL_FEATURES,
  CONVERSATION_FEATURES,
  CRAFT_FEATURES,
  KANBAN_FEATURES,
  PLUGIN_FEATURES,
  PLUGINS,
  SECTION_GUIDES,
  SPACE_FEATURES,
} from './homeContent'
import { DEMO_POSTER, DEMO_SRC } from '../components/home/DemoFilm'
import { WORKSPACE_LINKS, PLATFORM_OVERVIEW } from './homeOverview'

interface NavigationGroup {
  pages?: string[]
  categories?: NavigationGroup[]
}

const CAPABILITIES = [
  ...CONVERSATION_FEATURES,
  ...CONTEXT_FEATURES,
  ...EXTERNAL_FEATURES,
  ...SPACE_FEATURES,
  ...BROWSER_FEATURES,
  ...PLUGIN_FEATURES,
  ...CRAFT_FEATURES,
  ...AUTONOMY_FEATURES,
  ...CONTROL_FEATURES,
  ...KANBAN_FEATURES,
  ...PLUGINS,
]

test('homepage capabilities describe reachable product behavior', () => {
  const marketingCopy = [...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW]
    .flatMap(({ title, body }) => [title, body])
    .join(' ')

  expect(marketingCopy).not.toMatch(/\b(?:groundwork|not yet wired|not wired)\b/i)
})

test('homepage copy stays in the calm register the README uses', () => {
  // The product register is factual and hedged. Vocabulary that promises rather
  // than describes has no doc to check it against, so it is banned outright —
  // including in the section ledes, which live in the page itself.
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')
  const copy = [
    ...[...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW].flatMap(({ title, body }) => [
      title,
      body,
    ]),
    homePage,
  ].join(' ')

  expect(copy).not.toMatch(
    /\b(?:revolutionary|seamless|seamlessly|blazing|powerful|game-changing|effortless|effortlessly|supercharge|unlock|unleash|cutting-edge|world-class)\b/i,
  )
})

test('homepage copy states no speed or duration the repository does not measure', () => {
  // The repository holds no benchmark for how fast the agent browser is or how long a generated
  // plugin takes, so a copy line that says so has nothing behind it.
  const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')
  const copy = [
    ...[...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW].flatMap(({ title, body }) => [
      title,
      body,
    ]),
    homePage,
  ].join(' ')

  expect(copy).not.toMatch(
    /\b(?:in seconds|within seconds|instantly|instant|in minutes|faster|fastest|lightning|real[- ]time)\b/i,
  )
})

test('the demo film is published with its poster', () => {
  // A missing file plays nothing and leaves an empty frame on the page.
  const films = readdirSync(new URL('../../public/films/', import.meta.url))

  expect(films).toContain(DEMO_SRC.replace('/films/', ''))
  expect(films).toContain(DEMO_POSTER.replace('/films/', ''))
})

test('every homepage capability links to a published documentation page', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/public-nav.json', import.meta.url), 'utf8'),
  ) as { sections: NavigationGroup[] }
  const publicPaths = manifest.sections.flatMap((section) => [
    ...(section.pages ?? []),
    ...(section.categories ?? []).flatMap((category) => category.pages ?? []),
  ])
  const publishedSlugs = new Set(
    publicPaths.map((path) => path.replace(/\.md$/u, '').replaceAll('/', '--')),
  )
  const capabilityLinks = [...CAPABILITIES, ...WORKSPACE_LINKS, ...PLATFORM_OVERVIEW]
  const sectionLinks = Object.values(SECTION_GUIDES)

  for (const link of [...sectionLinks, ...capabilityLinks]) {
    expect(publishedSlugs.has(link.slug)).toBe(true)
  }

  const pathsBySlug = new Map(
    publicPaths.map((path) => [path.replace(/\.md$/u, '').replaceAll('/', '--'), path]),
  )
  for (const link of capabilityLinks) {
    const sourcePath = pathsBySlug.get(link.slug)
    expect(sourcePath).toBeTruthy()
    const source = readFileSync(new URL(`../../../../docs/${sourcePath}`, import.meta.url), 'utf8')
    const headingIds = new Set(
      [...source.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => slugifyDocHeading(match[1])),
    )
    expect(headingIds.has(link.anchor)).toBe(true)
  }
})
