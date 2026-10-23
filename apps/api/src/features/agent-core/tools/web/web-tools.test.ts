import { describe, it, expect } from 'bun:test'
import {
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  checkUrlSafety,
  readBodyCapped,
} from './net-safety'
import { htmlToText, decodeEntities, extractTitle, stripToText } from './html-text'
import { fetchReadablePage } from './research-fetch'
import { extractReadable } from './readable-extract'

// A minimal Response-like stub so tests never touch the network.
function fakeResponse(opts: {
  status?: number
  headers?: Record<string, string>
  body: string
}): Response {
  const headers = new Headers(opts.headers ?? {})
  return new Response(opts.body, { status: opts.status ?? 200, headers })
}

describe('net-safety — private address classification', () => {
  it('flags IPv4 loopback / private / link-local / CGNAT ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.16.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true)
    }
  })
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateIPv4(ip)).toBe(false)
    }
  })
  it('flags IPv6 loopback / ULA / link-local / v4-mapped-private', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIPv6(ip)).toBe(true)
    }
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('checkUrlSafety (SSRF guard)', () => {
  it('blocks localhost + .local/.internal hostnames without any DNS', async () => {
    expect(await checkUrlSafety(new URL('http://localhost/'))).toMatch(/local machine/)
    expect(await checkUrlSafety(new URL('http://foo.internal/'))).toMatch(/local machine/)
    expect(await checkUrlSafety(new URL('http://db.local/'))).toMatch(/local machine/)
  })
  it('blocks literal private IPs (no resolver needed)', async () => {
    expect(await checkUrlSafety(new URL('http://127.0.0.1:8080/'))).toMatch(/private\/internal/)
    expect(await checkUrlSafety(new URL('http://[::1]/'))).toMatch(/private\/internal/)
  })
  it('allows a public IP literal', async () => {
    expect(await checkUrlSafety(new URL('http://93.184.216.34/'))).toBeNull()
  })
  it('blocks a hostname that RESOLVES to a private IP (rebinding defence)', async () => {
    const resolve = async () => ['10.0.0.5']
    expect(await checkUrlSafety(new URL('http://evil.example.com/'), resolve)).toMatch(
      /resolves to private/,
    )
  })
  it('allows a hostname that resolves to a public IP', async () => {
    const resolve = async () => ['93.184.216.34']
    expect(await checkUrlSafety(new URL('http://example.com/'), resolve)).toBeNull()
  })
  it('refuses a hostname whose resolution fails (fail closed)', async () => {
    const resolve = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND')
    }
    expect(await checkUrlSafety(new URL('http://attacker.test/'), resolve)).toMatch(
      /could not be resolved/,
    )
    expect(await checkUrlSafety(new URL('http://empty.test/'), async () => [])).toMatch(
      /could not be resolved/,
    )
  })
})

describe('readBodyCapped', () => {
  it('caps the body at maxBytes and reports truncation', async () => {
    const res = fakeResponse({ body: 'x'.repeat(1000) })
    const out = await readBodyCapped(res, 100)
    expect(out.bytes).toBe(100)
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBe(100)
  })
  it('returns the whole body when under the cap', async () => {
    const res = fakeResponse({ body: 'hello' })
    const out = await readBodyCapped(res, 1000)
    expect(out.text).toBe('hello')
    expect(out.truncated).toBe(false)
  })
})

describe('html-text', () => {
  it('strips tags + decodes named + numeric entities', () => {
    expect(htmlToText('<p>Hello&nbsp;&amp; welcome</p>')).toBe('Hello & welcome')
    expect(decodeEntities('caf&#233; &#x2019;s &lt;tag&gt;')).toBe('café ’s <tag>')
  })
  it('drops scripts/styles and turns block closers into newlines', () => {
    const html = '<style>.x{}</style><h1>Title</h1><p>Line1</p><p>Line2</p><script>bad()</script>'
    const text = htmlToText(html)
    expect(text).toContain('Title')
    expect(text).toContain('Line1')
    expect(text).toContain('Line2')
    expect(text).not.toContain('bad()')
    expect(text).not.toContain('.x{}')
  })
  it('extracts + collapses the document title', () => {
    expect(extractTitle('<html><head><title>  Hi\n  there </title></head>')).toBe('Hi there')
    expect(extractTitle('<html>no title</html>')).toBeUndefined()
  })
  it('stripToText collapses whitespace for snippets', () => {
    expect(stripToText('<b>a</b>   b\nc')).toBe('a b c')
  })
})

// A realistic article page wrapped in the usual site chrome (nav / header /
// cookie banner / sidebar / footer) that today's regex strip would leave in.
const ARTICLE_PAGE = `<!doctype html>
<html><head><title>Understanding Widgets — Docs</title></head>
<body>
  <header id="site-header"><a href="/">Home</a> <a href="/pricing">Pricing</a></header>
  <nav class="main-nav"><ul><li><a href="/a">Alpha</a></li><li><a href="/b">Beta</a></li><li><a href="/c">Gamma</a></li></ul></nav>
  <div class="cookie-banner">We use cookies to improve your experience. Accept all cookies to continue browsing this site.</div>
  <article>
    <h1>Understanding Widgets</h1>
    <p>Widgets are the primary building block of the platform. They encapsulate a small unit of behaviour and render their own UI, which keeps the surrounding application simple and predictable for everyone involved.</p>
    <h2>Getting started with widgets</h2>
    <p>To create a widget you declare its inputs and outputs, then implement a render function. The full contract is described in <a href="https://example.com/spec">the spec</a> and is stable across releases so you can rely on it.</p>
    <ul><li>Declare the inputs your widget needs</li><li>Implement the render function body</li><li>Register the widget with the host runtime</li></ul>
    <p>Once registered, a widget participates in the normal lifecycle and receives updates whenever its inputs change, allowing rich interactive behaviour without extra plumbing on your part at all.</p>
  </article>
  <aside class="sidebar"><h3>Related</h3><a href="/x">See also X</a><a href="/y">See also Y</a></aside>
  <footer id="site-footer">Copyright 2026 WidgetCo. All rights reserved. Privacy policy and terms of service apply.</footer>
</body></html>`

describe('readable-extract — main-content isolation', () => {
  it('isolates the article as Markdown, dropping nav/footer/cookie chrome', async () => {
    const out = await extractReadable(ARTICLE_PAGE, 'https://example.com/docs/widgets', 'markdown')
    // Article body + structure survives (Readability strips the H1 that duplicates
    // the page title; the H2 heading, link targets and list all remain).
    expect(out.text).toContain('Widgets are the primary building block')
    expect(out.text).toContain('## Getting started with widgets') // atx heading preserved
    expect(out.text).toContain('[the spec](https://example.com/spec)') // link target survives
    expect(out.text).toContain('Declare the inputs your widget needs') // list item survives
    expect(out.title).toBe('Understanding Widgets — Docs')
    // Chrome is dropped.
    expect(out.text).not.toContain('Accept all cookies')
    expect(out.text).not.toContain('Copyright 2026')
    expect(out.text).not.toContain('Pricing')
  })

  it('returns the same readable body as plain text in text mode (no markdown syntax)', async () => {
    const out = await extractReadable(ARTICLE_PAGE, 'https://example.com/docs/widgets', 'text')
    expect(out.text).toContain('Widgets are the primary building block')
    expect(out.text).toContain('Getting started with widgets') // heading text, plain
    expect(out.text).toContain('the spec')
    expect(out.text).not.toContain('##') // plain text, not markdown
    expect(out.text).not.toContain('[the spec]')
    expect(out.text).not.toContain('Accept all cookies')
  })

  it('falls back to htmlToText when Readability cannot parse (tiny/minimal page)', async () => {
    const out = await extractReadable(
      '<html><body><p>Just a short note.</p></body></html>',
      'https://example.com/',
      'markdown',
    )
    expect(out.text).toBe('Just a short note.')
  })

  it('falls back cleanly on a JSON body (not HTML)', async () => {
    const json = '{"ok":true,"items":[1,2,3]}'
    const out = await extractReadable(json, 'https://api.example.com/', 'markdown')
    // No article to isolate — the raw text passes through the regex fallback.
    expect(out.text).toContain('"ok":true')
  })
})

describe('research readable-page loader — validation + guards', () => {
  it('rejects a non-URL input', async () => {
    const r = await fetchReadablePage({ url: 'not a url' })
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/Invalid URL/)
  })
  it('rejects a non-http(s) protocol', async () => {
    const r = await fetchReadablePage({ url: 'file:///etc/passwd' })
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/Unsupported protocol/)
  })
  it('blocks a private-IP target before fetching (SSRF)', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return fakeResponse({ body: 'secret' })
    }) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://169.254.169.254/latest/meta-data' },
      { fetchImpl },
    )
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/Blocked/)
    expect(called).toBe(false)
  })
  it('does not fetch a host whose safety check could not resolve it', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return fakeResponse({ headers: { 'content-type': 'text/plain' }, body: 'INTERNAL_MARKER' })
    }) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://attacker.test/' },
      {
        fetchImpl,
        resolveHost: async () => {
          throw new Error('ENOTFOUND')
        },
      },
    )
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/Blocked/)
    expect(r.content).not.toContain('INTERNAL_MARKER')
    expect(called).toBe(false)
  })
  it('allows a private target when config.allowPrivate is set', async () => {
    const fetchImpl = (async () =>
      fakeResponse({
        headers: { 'content-type': 'text/plain' },
        body: 'ok',
      })) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://127.0.0.1:3000/' },
      { fetchImpl, config: { allowPrivate: true } },
    )
    expect(r.isError).toBeUndefined()
    expect(r.content).toContain('ok')
  })
  it('does not present PDF bytes as readable research evidence', async () => {
    for (const contentType of ['application/pdf', 'text/plain']) {
      const fetchImpl = (async () =>
        fakeResponse({
          headers: { 'content-type': contentType },
          body: '%PDF-1.4\n1 0 obj\n<</Title (Unrelated system card)>>',
        })) as unknown as typeof fetch
      const r = await fetchReadablePage(
        { url: 'https://example.com/system-card.pdf' },
        { fetchImpl, resolveHost: async () => ['93.184.216.34'] },
      )
      expect(r.isError).toBe(true)
      expect(r.content).toMatch(/PDF.*cannot be read as a web page/)
      expect(r.content).not.toContain('1 0 obj')
    }
  })
  it('converts HTML to readable text with title + preserves final URL', async () => {
    const fetchImpl = (async () =>
      fakeResponse({
        headers: { 'content-type': 'text/html' },
        body: '<html><head><title>Doc</title></head><body><h1>Heading</h1><p>Body text.</p></body></html>',
      })) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://example.com/', resolveHost: undefined } as never,
      {
        fetchImpl,
        resolveHost: async () => ['93.184.216.34'],
      },
    )
    expect(r.content).toContain('Title: Doc')
    expect(r.content).toContain('Heading')
    expect(r.content).toContain('Body text.')
    expect(r.details?.title).toBe('Doc')
    expect(r.details?.finalUrl).toBe('http://example.com/')
  })
  it('defaults to Markdown extraction, dropping chrome and keeping the article + title', async () => {
    const fetchImpl = (async () =>
      fakeResponse({
        headers: { 'content-type': 'text/html' },
        body: ARTICLE_PAGE,
      })) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://example.com/docs' },
      { fetchImpl, resolveHost: async () => ['93.184.216.34'] },
    )
    expect(r.content).toContain('Title: Understanding Widgets — Docs')
    expect(r.content).toContain('## Getting started with widgets')
    expect(r.content).toContain('[the spec](https://example.com/spec)')
    expect(r.content).not.toContain('Accept all cookies')
    expect(r.content).not.toContain('Copyright 2026')
  })

  it('format:"html" returns the untouched raw HTML (no extraction)', async () => {
    const fetchImpl = (async () =>
      fakeResponse({
        headers: { 'content-type': 'text/html' },
        body: ARTICLE_PAGE,
      })) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://example.com/docs', format: 'html' },
      { fetchImpl, resolveHost: async () => ['93.184.216.34'] },
    )
    expect(r.content).toContain('<article>')
    expect(r.content).toContain('cookie-banner')
  })

  it('follows redirects and re-checks safety on each hop', async () => {
    const hops: string[] = []
    const fetchImpl = (async (url: URL) => {
      hops.push(url.toString())
      if (url.toString() === 'http://example.com/') {
        return fakeResponse({
          status: 302,
          headers: { location: 'http://example.org/final' },
          body: '',
        })
      }
      return fakeResponse({
        headers: { 'content-type': 'text/plain' },
        body: 'landed',
      })
    }) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://example.com/' },
      { fetchImpl, resolveHost: async () => ['93.184.216.34'] },
    )
    expect(hops).toEqual(['http://example.com/', 'http://example.org/final'])
    expect(r.content).toContain('landed')
    expect(r.details?.finalUrl).toBe('http://example.org/final')
  })
  it('truncates output past maxChars', async () => {
    const fetchImpl = (async () =>
      fakeResponse({
        headers: { 'content-type': 'text/plain' },
        body: 'y'.repeat(500),
      })) as unknown as typeof fetch
    const r = await fetchReadablePage(
      { url: 'http://example.com/' },
      {
        fetchImpl,
        resolveHost: async () => ['8.8.8.8'],
        config: { maxChars: 100 },
      },
    )
    expect(r.content).toMatch(/truncated \d+ more chars/)
    expect(r.details?.truncated).toBe(true)
  })
})
