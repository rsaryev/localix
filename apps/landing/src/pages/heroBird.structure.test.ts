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
  expect(read('../styles.css')).toMatch(
    /\.hero-bird\[data-paused='true'\] \* \{\s*animation-play-state: paused !important;/u,
  )
})
