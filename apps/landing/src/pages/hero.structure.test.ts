import { readLandingStyles } from '../../scripts/read-styles'
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8')

// The hero is one screen, as on llx.sh: the copy beside the demo on wide screens, stacked on
// narrow ones, with one word of the headline on a white chip.
test('the hero sets the copy beside the demo and one word on a chip', () => {
  const home = read('./HomePage.tsx')
  expect(home).toContain("const CHIP_WORD = 'Agentic'")
  expect(home).toContain('className="hero-chip"')
  expect(home).toContain('<div id="demo" className="hero-demo">')

  const css = readLandingStyles()
  expect(css).toMatch(
    /@media \(min-width: 60rem\) \{\s*\.hero \{\s*grid-template-columns: minmax\(0, 4fr\) minmax\(0, 7fr\);/u,
  )
  expect(css).toMatch(/\.hero-chip \{[^}]*background: var\(--foreground\);[^}]*rotate\(-1\.5deg\)/u)
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
