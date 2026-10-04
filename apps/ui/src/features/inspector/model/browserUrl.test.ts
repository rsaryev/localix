import { expect, test } from 'bun:test'
import {
  BROWSER_HISTORY_URL,
  addressDestination,
  browserEngine,
  hostsInFrame,
  isLocalBrowserUrl,
  nativePagesSupported,
} from './browserUrl'

test('Linux frames every page until the shell can position a native one', () => {
  // wry frames a child WebView on Linux only inside a gtk::Fixed, and tauri packs it into the
  // window's vbox, so a native page there ignores its pane. Frame it instead.
  expect(nativePagesSupported(true, 'linux')).toBe(false)
  expect(nativePagesSupported(true, 'mac')).toBe(true)
  expect(nativePagesSupported(true, 'windows')).toBe(true)
  expect(nativePagesSupported(false, 'mac')).toBe(false)
  const linuxShell = nativePagesSupported(true, 'linux')
  expect(browserEngine({ url: 'https://google.com' }, linuxShell)).toBe('frame')
  expect(browserEngine({ url: 'https://google.com', nativePage: true }, linuxShell)).toBe('frame')
})

test('only loopback sites use the local feedback renderer', () => {
  expect(isLocalBrowserUrl('http://127.0.0.1:5173')).toBe(true)
  expect(isLocalBrowserUrl('http://localhost:3000')).toBe(true)
  expect(isLocalBrowserUrl('http://[::1]:3000')).toBe(true)
  expect(isLocalBrowserUrl('https://github.com')).toBe(false)
  expect(isLocalBrowserUrl('https://localhost.example.com')).toBe(false)
})

test('one rule picks the engine for every tab', () => {
  const desktop = true
  expect(browserEngine({ url: 'http://localhost:5173' }, desktop)).toBe('frame')
  expect(browserEngine({ url: 'https://google.com' }, desktop)).toBe('native')
  // A local page that refuses framing still needs a real browser.
  expect(browserEngine({ url: 'http://localhost:5173', frameBlocked: true }, desktop)).toBe(
    'native',
  )
  // The history list has no page behind it, in any shell.
  expect(browserEngine({ url: BROWSER_HISTORY_URL }, desktop)).toBe('history')
  expect(browserEngine({ url: BROWSER_HISTORY_URL }, false)).toBe('history')
  // Outside the desktop shell there is no native engine.
  expect(browserEngine({ url: 'https://google.com' }, false)).toBe('frame')
})

test('a page opened in the browser keeps its engine at any address', () => {
  // A link or redirect from a live page to a local server must not swap the page's engine.
  expect(browserEngine({ url: 'http://localhost:3000/cb', nativePage: true }, true)).toBe('native')
})

test('a typed address loads in place only when the tab can serve it', () => {
  const page = { url: 'https://google.com', nativePage: true }
  const devPreview = { url: 'http://localhost:5173' }
  expect(addressDestination(page, 'https://github.com', true)).toBe('here')
  expect(addressDestination(page, 'http://localhost:5173', true)).toBe('elsewhere')
  expect(addressDestination(devPreview, 'http://localhost:3000', true)).toBe('here')
  expect(addressDestination(devPreview, 'https://github.com', true)).toBe('elsewhere')
  // Without a native engine every address is the frame's.
  expect(addressDestination(devPreview, 'https://github.com', false)).toBe('here')
})

test('the frame hosts only local pages that allow it', () => {
  expect(hostsInFrame({ url: 'http://localhost:3000' })).toBe(true)
  expect(hostsInFrame({ url: 'http://localhost:3000', frameBlocked: true })).toBe(false)
  expect(hostsInFrame({ url: 'https://example.com' })).toBe(false)
})
