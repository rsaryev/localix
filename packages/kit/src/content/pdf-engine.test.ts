import { expect, test } from 'bun:test'
import { pdfPageScale } from './pdf-engine'

test('PDF pages retain physical proportions and bound retina canvas density', () => {
  expect(pdfPageScale(300, 600, 3)).toEqual({ scale: 0.5, density: 2 })
  expect(pdfPageScale(900, 600, 0.8)).toEqual({ scale: 1.5, density: 1 })
  expect(Number.isFinite(pdfPageScale(0, 0, 2).scale)).toBe(true)
})
