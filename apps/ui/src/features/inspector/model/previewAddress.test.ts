import { expect, test } from 'bun:test'
import { readableAddress, resolvePreviewAddress } from './previewAddress'

test('preview address supports local ports and relative navigation', () => {
  const current = 'http://localhost:5173/dashboard'
  expect(resolvePreviewAddress('localhost:3000/settings', current)).toBe(
    'http://localhost:3000/settings',
  )
  expect(resolvePreviewAddress('/settings', current)).toBe('http://localhost:5173/settings')
  expect(resolvePreviewAddress('https://example.com', current)).toBe('https://example.com/')
  for (const value of [
    '',
    'javascript:alert(1)',
    'file:///tmp/page.html',
    'https://user:pass@example.com',
  ]) {
    expect(resolvePreviewAddress(value, current)).toBeNull()
  }
})

test('browser can open its first page without an existing URL', () => {
  expect(resolvePreviewAddress('https://github.com/', '')).toBe('https://github.com/')
  expect(resolvePreviewAddress('github.com', '')).toBe('https://github.com/')
  expect(resolvePreviewAddress('/relative', '')).toBeNull()
})

test('plain text searches Google while local hosts and web URLs remain addresses', () => {
  expect(resolvePreviewAddress('  how to play bridge  ', '')).toBe(
    'https://www.google.com/search?q=how%20to%20play%20bridge',
  )
  expect(resolvePreviewAddress('hello', '')).toBe('https://www.google.com/search?q=hello')
  expect(resolvePreviewAddress('127.0.0.1:5173', '')).toBe('http://127.0.0.1:5173/')
  expect(resolvePreviewAddress('github.com/browser-use', '')).toBe('https://github.com/browser-use')
  expect(resolvePreviewAddress('data:text/html,hello', '')).toBeNull()
})

test('an idle address reads as host and path, with the query in the words it was typed in', () => {
  expect(readableAddress('https://www.google.com/search?q=caf%C3%A9%20cr%C3%A8me')).toBe(
    'google.com/search?q=café crème',
  )
  expect(readableAddress('https://example.com/')).toBe('example.com')
  expect(readableAddress('http://localhost:5173/app')).toBe('localhost:5173/app')
  // An unencrypted remote page keeps the one part worth noticing.
  expect(readableAddress('http://neverssl.com/')).toBe('http://neverssl.com')
  // Escaped delimiters keep the address's structure; a broken escape is shown as it is.
  expect(readableAddress('https://a.dev/x?next=%2Fhome%26tab')).toBe('a.dev/x?next=%2Fhome%26tab')
  expect(readableAddress('https://a.dev/%E0%A4%A')).toBe('a.dev/%E0%A4%A')
  expect(readableAddress('')).toBe('')
})
