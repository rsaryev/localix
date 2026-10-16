import { readLandingStyles } from '../../scripts/read-styles'
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8')

// The bird used to settle after three passes, holding the wind invisible and the bird at rest.
// Nothing replayed it, so a few seconds after load the hero looked broken until the page was
// reloaded. It must loop while visible, and stop moving only while nobody can see it.
test('the hero bird loops while visible and pauses only while hidden', () => {
  const bird = read('../components/home/HeroBird.tsx')
  expect(bird).toContain('cycles={reduced ? 1 : Infinity}')
  expect(bird).toContain('IntersectionObserver')
  expect(bird).toContain("document.addEventListener('visibilitychange'")
  expect(bird).toContain('hero-bird w-full')

  // The pause is a play state, not a restart: the bird resumes mid-flight.
  expect(readLandingStyles()).toMatch(
    /\.hero-bird\[data-paused='true'\] \* \{\s*animation-play-state: paused !important;/u,
  )
})

test('mobile wind phases cover one shared period instead of clustering seeded delays', () => {
  const css = readLandingStyles()
  expect(css).toContain('--hero-wind-period: 6s')
  expect(css).toContain('animation-duration: var(--hero-wind-period) !important')
  expect(css).toContain(
    'animation-delay: calc(var(--hero-wind-period) * var(--hero-wind-phase)) !important',
  )
  for (let index = 0; index < 8; index++) {
    expect(css).toContain(
      `.hero-bird-wind > div:nth-child(${index + 1}) {\n    --hero-wind-phase: ${-index / 8};`,
    )
  }
})

test('the deferred hero reserves its final geometry before the bird mounts', () => {
  expect(read('./HomePage.tsx')).toContain('hero-bird-slot')
  expect(readLandingStyles()).toMatch(
    /\.hero-bird-slot \{\s*grid-area: bird;\s*height: var\(--bird-slot-height\);\s*overflow: visible;/u,
  )
  expect(readLandingStyles()).toContain('--hero-bird-height: 24rem')
  expect(readLandingStyles()).toContain('--hero-bird-height: 30rem')
  expect(read('../components/home/HeroBird.tsx')).toContain('stageClassName="h-full w-full"')
  expect(read('../components/home/HeroBird.tsx')).toContain(
    "const desktopQuery = '(min-width: 64rem)'",
  )
  expect(read('../components/home/HeroBird.tsx')).not.toContain('if (!desktop) return null')
})

test('mobile bird shares the description row without narrowing the heading or action', () => {
  const css = readLandingStyles()
  expect(css).toContain(
    "grid-template-areas: 'badge badge' 'heading heading' 'description bird' 'action action'",
  )
  expect(css).toContain('--bird-slot-width: 7rem')
  expect(css).toContain('--bird-slot-height: 10rem')
  expect(css).toContain('--bird-size: 5rem')
  expect(css).toContain('@media (max-width: 350px)')
  expect(css).toContain('--bird-slot-width: 6rem')
  expect(css).toContain('--bird-size: 4rem')
})

test('wind extends behind hero copy without intercepting actions or clipping at the bird', () => {
  const css = readLandingStyles()
  const bird = read('../components/home/HeroBird.tsx')
  expect(css).toContain('isolation: isolate')
  expect(css).toContain('z-index: var(--z-raised)')
  expect(css).toMatch(/\.hero-bird-slot \{[^}]*pointer-events: none;/u)
  expect(bird).not.toContain('[mask-image:linear-gradient')
  expect(css).not.toContain('hero-wind-sweep')
  expect(bird).toContain('spread={260}')
  expect(bird).toContain("observer.observe(element.closest('.hero-layout') ?? element)")
})

test('landing boosts mobile wind contrast without changing desktop timing or reduced motion', () => {
  const bird = read('../components/home/HeroBird.tsx')
  const css = readLandingStyles()
  expect(bird).toContain('windIntensity={desktop ? 1.2 : 1.4}')
  expect(bird).toContain('lineCount={reduced ? 0 : desktop ? 12 : 8}')
  expect(css).toContain('--bird-wind-duration-scale: 2.5')
  expect(css).toContain('--bird-drift-duration: 10s')
  expect(css).toMatch(/\.hero-bird \* \{\s*animation: none !important;/u)
})

test('critical CSS and kit fonts are discovered in the document head, not after React mounts', () => {
  const html = read('../../index.html')
  expect(html).toContain('<link rel="stylesheet" href="/src/styles.css" />')
  expect(html).toContain('inter-latin-wght-normal.woff2')
  expect(html).toContain('dm-sans-latin-wght-normal.woff2')
  expect(html.match(/as="font"/gu)).toHaveLength(2)
  expect(read('../main.tsx')).not.toContain("import './styles.css'")
  expect(read('../components/ProductShot.tsx')).toContain('width={1600}')
  expect(read('../components/ProductShot.tsx')).toContain('height={1000}')
})
