import { expect, test } from 'bun:test'
import { detectDownload } from './downloadPlatform'

test('detects Windows and Linux from the platform alone', () => {
  expect(detectDownload({ platform: 'Win32' })).toEqual({ id: 'windows', certain: true })
  expect(detectDownload({ userAgent: 'X11; Linux x86_64' })).toEqual({ id: 'linux', certain: true })
})

test('never reads the Mac chip off MacIntel, which every Mac browser reports', () => {
  // Safari on Apple silicon says MacIntel and "Intel Mac OS X" too, so this alone is a guess.
  const safari = {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
  }
  expect(detectDownload(safari)).toEqual({ id: 'mac-arm64', certain: false })
  // Safari masks the renderer to "Apple GPU" on both chips: still undecided.
  expect(detectDownload({ ...safari, renderer: 'Apple GPU' })).toEqual({
    id: 'mac-arm64',
    certain: false,
  })
})

test('takes the chip from Client Hints first, then from the WebGL renderer', () => {
  const mac = { platform: 'macOS' }
  expect(detectDownload({ ...mac, architecture: 'x86' })).toEqual({ id: 'mac-x64', certain: true })
  expect(detectDownload({ ...mac, architecture: 'arm', renderer: 'Intel Iris' })).toEqual({
    id: 'mac-arm64',
    certain: true,
  })
  expect(
    detectDownload({ ...mac, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)' }),
  ).toEqual({ id: 'mac-arm64', certain: true })
  expect(detectDownload({ ...mac, renderer: 'Intel(R) Iris(TM) Plus Graphics 655' })).toEqual({
    id: 'mac-x64',
    certain: true,
  })
  expect(detectDownload({ ...mac, renderer: 'AMD Radeon Pro 5500M OpenGL Engine' })).toEqual({
    id: 'mac-x64',
    certain: true,
  })
})

test('an unknown platform falls back to an uncertain Mac guess', () => {
  expect(detectDownload({ userAgent: 'Android' })).toEqual({ id: 'mac-arm64', certain: false })
})
