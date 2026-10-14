import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPanelSrcDoc, PANEL_CDN_HOSTS, PANEL_CSP } from './pluginPanelSrcDoc'

const TAURI_CONF = resolve(
  import.meta.dir,
  '../../../../../desktop-tauri/src-tauri/tauri.conf.json',
)

/** The sources one directive of a CSP string grants, e.g. `script-src`. */
function directiveSources(csp: string, directive: string): string[] {
  const entry = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `))
  return entry ? entry.split(/\s+/u).slice(1) : []
}

describe('PANEL_CSP', () => {
  test('enforces an opaque, network-less containment contract', () => {
    expect(PANEL_CSP).toContain("default-src 'none'")
    expect(PANEL_CSP).toContain("connect-src 'none'") // panel code can't reach the network
    expect(PANEL_CSP).toContain("frame-src 'none'")
    expect(PANEL_CSP).toContain("base-uri 'none'")
    expect(PANEL_CSP).toContain("form-action 'none'")
  })

  // A srcdoc frame inherits the shell policy and the two intersect: a host missing from the
  // desktop CSP is unreachable from every panel whatever PANEL_CSP grants.
  test('the desktop shell CSP grants every panel CDN host for scripts and styles', () => {
    const shellCsp = JSON.parse(readFileSync(TAURI_CONF, 'utf8')).app.security.csp as string
    for (const directive of ['script-src', 'style-src']) {
      const granted = directiveSources(shellCsp, directive)
      expect(granted.length).toBeGreaterThan(0)
      for (const host of PANEL_CDN_HOSTS) expect(granted).toContain(`https://${host}`)
    }
    // Positive control: the reader must see a host that is absent as absent.
    expect(directiveSources(shellCsp, 'script-src')).not.toContain('https://example.invalid')
  })
})

describe('buildPanelSrcDoc', () => {
  const doc = buildPanelSrcDoc('<p>hi</p>', 'dark', '--background: #000;')

  test('embeds the enforced CSP verbatim', () => {
    expect(doc).toContain(`content="${PANEL_CSP}"`)
  })

  test('drives the theme attribute and color-scheme from `theme`', () => {
    expect(doc).toContain('<html data-theme="dark">')
    expect(doc).toContain('color-scheme: dark;')
    const light = buildPanelSrcDoc('', 'light', '')
    expect(light).toContain('<html data-theme="light">')
    expect(light).toContain('color-scheme: light;')
  })

  test('injects the forwarded host theme CSS into :root', () => {
    expect(doc).toContain('--background: #000;')
  })

  test('carries OS visual preferences through the iframe boundary', () => {
    expect(doc).toContain('@media (prefers-reduced-motion: reduce)')
    expect(doc).toContain('@media (prefers-contrast: more)')
    expect(doc).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(doc).toContain('@media (forced-colors: active)')
  })

  test('installs the acquired host API before any plugin-authored HTML executes', () => {
    expect(doc).toContain("Object.defineProperty(window, 'acquireLocalixApi'")
    expect(doc.indexOf('acquireLocalixApi')).toBeLessThan(doc.indexOf('<p>hi</p>'))
    expect(doc.match(/<\/script>/g)).toHaveLength(1)
  })

  test('injects the plugin html verbatim into the body (containment is the sandbox, not escaping)', () => {
    expect(doc).toContain('<body>\n<p>hi</p>\n</body>')
  })
})
