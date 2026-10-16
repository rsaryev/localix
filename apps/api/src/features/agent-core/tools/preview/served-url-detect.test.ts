import { describe, expect, test } from 'bun:test'
import { detectServedUrl, createServedUrlScanner, classifyHost } from './served-url-detect'

describe('detectServedUrl (content-based, stack-agnostic)', () => {
  test('finds a Vite "Local:" URL (origin form, trailing slash dropped)', () => {
    expect(detectServedUrl('  VITE v5  ready\n  ➜  Local:   http://localhost:5173/')).toBe(
      'http://localhost:5173',
    )
  })

  test('finds a bare localhost URL with a port', () => {
    expect(detectServedUrl('Serving HTTP on http://127.0.0.1:8000 ...')).toBe(
      'http://127.0.0.1:8000',
    )
  })

  test('normalizes 0.0.0.0 to localhost (a bind-all address is not browsable)', () => {
    expect(detectServedUrl('Listening on http://0.0.0.0:3000')).toBe('http://localhost:3000')
  })

  test('keeps a path the framework prints', () => {
    expect(detectServedUrl('ready - started server on http://localhost:3000/app')).toBe(
      'http://localhost:3000/app',
    )
  })

  test('drops query + fragment (a token-bearing line cannot leak into the panel)', () => {
    expect(detectServedUrl('callback at http://localhost:3000/auth?token=secret#x')).toBe(
      'http://localhost:3000/auth',
    )
  })

  test('trims trailing sentence punctuation', () => {
    expect(detectServedUrl('Now running at http://localhost:4321.')).toBe('http://localhost:4321')
  })

  test('prefers loopback over a LAN (private-IP) host when both are printed', () => {
    // Vite prints Network (LAN) first sometimes; loopback is the better local open.
    expect(
      detectServedUrl('Network: http://192.168.1.20:5173/  Local: http://localhost:5173/'),
    ).toBe('http://localhost:5173')
  })

  test('sees through ANSI color codes interleaved in the URL (Vite-style banner)', () => {
    const banner =
      '  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m\x1b[39m/\x1b[39m\n'
    expect(detectServedUrl(banner)).toBe('http://localhost:5173')
  })

  test('requires an explicit port — a bare http://localhost is NOT a server URL', () => {
    expect(detectServedUrl('open http://localhost in your browser')).toBeUndefined()
  })

  test('ignores a non-local (custom/public) host — not previewable from the banner alone', () => {
    expect(detectServedUrl('see https://example.com:443/docs for help')).toBeUndefined()
  })

  test('returns undefined when no URL is present', () => {
    expect(detectServedUrl('compiling...\nbuild succeeded')).toBeUndefined()
  })

  // REGRESSION: the loopback test was the single address `127.0.0.1`, so a dev server
  // on any other 127.x address (a standard way to run several apps on one port) fell
  // through to `public-ip` and was DROPPED by scoreCandidates — silently never
  // auto-detected. Loopback is the whole 127.0.0.0/8.
  describe('local ranges that were classified public-ip and silently dropped', () => {
    test('a 127.0.0.0/8 address other than 127.0.0.1 is loopback', () => {
      expect(detectServedUrl('Serving on http://127.0.0.2:8000')).toBe('http://127.0.0.2:8000')
      expect(detectServedUrl('Serving on http://127.1.2.3:8000')).toBe('http://127.1.2.3:8000')
      expect(classifyHost('127.0.0.2')).toBe('loopback')
    })

    test('a 127.x loopback outranks a LAN address in the same banner', () => {
      expect(
        detectServedUrl('Network: http://192.168.1.20:5173/\nLocal: http://127.0.0.5:5173/'),
      ).toBe('http://127.0.0.5:5173')
    })

    test('CGNAT 100.64/10 is a private (LAN-ish) address, not a public one', () => {
      expect(classifyHost('100.64.0.1')).toBe('private-ip')
      expect(classifyHost('100.127.255.254')).toBe('private-ip')
      expect(detectServedUrl('Listening on http://100.100.1.5:3000')).toBe(
        'http://100.100.1.5:3000',
      )
    })

    test('100.x OUTSIDE the CGNAT block stays public (the fix widened, it did not blur)', () => {
      expect(classifyHost('100.63.0.1')).toBe('public-ip')
      expect(classifyHost('100.128.0.1')).toBe('public-ip')
      expect(detectServedUrl('see http://100.63.0.1:3000 for the staging box')).toBeUndefined()
    })

    test('a genuinely public IP is still ignored (no local listener cross-check)', () => {
      expect(classifyHost('93.184.216.34')).toBe('public-ip')
      expect(detectServedUrl('deployed to http://93.184.216.34:8080')).toBeUndefined()
    })
  })
})

describe('createServedUrlScanner (streaming, newline-finalized)', () => {
  test('does NOT latch a partial URL split across chunks until the line completes', () => {
    const s = createServedUrlScanner()
    // A chunk that splits the port — must not latch `:5` as port 5.
    expect(s.push('Local: http://localhost:5')).toBeUndefined()
    expect(s.current()).toBeUndefined()
    // The rest arrives with the newline → now finalized + detected whole.
    expect(s.push('173/\n')).toBe('http://localhost:5173')
    expect(s.current()).toBe('http://localhost:5173')
  })

  test('only emits when the best URL first appears or improves', () => {
    const s = createServedUrlScanner()
    expect(s.push('Network: http://192.168.0.5:3000/\n')).toBe('http://192.168.0.5:3000')
    // A loopback line later → higher score → emits the improvement.
    expect(s.push('Local: http://localhost:3000/\n')).toBe('http://localhost:3000')
    // Same/worse again → no re-emit.
    expect(s.push('Network: http://192.168.0.5:3000/\n')).toBeUndefined()
    expect(s.current()).toBe('http://localhost:3000')
  })

  test('buffers an unterminated line (no newline) without latching', () => {
    const s = createServedUrlScanner()
    expect(s.push('  ➜  Local: http://localhost:8080/')).toBeUndefined()
    expect(s.push('\n')).toBe('http://localhost:8080')
  })
})
