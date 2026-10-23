import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { DEMO_POSTER, DEMO_SRC } from '../components/home/DemoFilm'

const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8')

test('homepage copy stays in the calm register the README uses', () => {
  // The product register is factual and hedged. Vocabulary that promises rather
  // than describes has no doc to check it against, so it is banned outright —
  // including in the section ledes, which live in the page itself.
  expect(homePage).not.toMatch(
    /\b(?:revolutionary|seamless|seamlessly|blazing|powerful|game-changing|effortless|effortlessly|supercharge|unlock|unleash|cutting-edge|world-class)\b/i,
  )
})

test('homepage copy states no speed or duration the repository does not measure', () => {
  // The repository holds no benchmark for how fast the agent browser is or how long a generated
  // plugin takes, so a copy line that says so has nothing behind it.
  expect(homePage).not.toMatch(
    /\b(?:in seconds|within seconds|instantly|instant|in minutes|faster|fastest|lightning|real[- ]time)\b/i,
  )
})

test('the demo film is published with its poster', () => {
  // A missing file plays nothing and leaves an empty frame on the page.
  const films = readdirSync(new URL('../../public/films/', import.meta.url))

  expect(films).toContain(DEMO_SRC.replace('/films/', ''))
  expect(films).toContain(DEMO_POSTER.replace('/films/', ''))
})
