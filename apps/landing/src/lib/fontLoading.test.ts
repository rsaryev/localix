import { readLandingStyles } from '../testing/read-styles'
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const landingFonts = read('../fonts.css')
const sharedFonts = read('../../../ui/src/app/fonts.css')
const styles = readLandingStyles()

function faces(css: string) {
  return [...css.matchAll(/@font-face\s*\{([^}]+)\}/gu)].map(([, body]) => ({
    family: body!.match(/font-family:\s*'([^']+)'/u)?.[1],
    display: body!.match(/font-display:\s*(\w+)/u)?.[1],
    weight: body!.match(/font-weight:\s*([^;]+)/u)?.[1],
    asset: body!.match(/([\w-]+\.woff2)/u)?.[1],
  }))
}

test('landing font policy cannot fall through to a late-swapping kit face', () => {
  const local = faces(landingFonts)
  const kit = faces(sharedFonts)
  expect(local).toHaveLength(2)
  for (const face of local) {
    expect(face.display).toBe('optional')
    expect(kit.some((shared) => shared.family === face.family)).toBe(false)
    const shared = kit.find((candidate) => candidate.asset === face.asset)
    expect(shared).toBeDefined()
    expect(face.weight).toBe(shared!.weight)
  }
  expect(styles).toContain("--font-heading: 'Localix Landing Heading', Arial, sans-serif;")
  expect(styles).toContain("--font-sans: 'Localix Landing Sans', Arial, sans-serif;")
  expect(styles.indexOf("@import './fonts.css'")).toBeGreaterThan(
    styles.indexOf("@import '../../ui/src/app/index.css'"),
  )
})

test('early discovery and painted faces refer to the same font assets', () => {
  const html = read('../../index.html')
  for (const face of faces(landingFonts)) {
    expect(html).toContain(face.asset!)
  }
})
