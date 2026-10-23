/**
 * Subresource-failure capture: a capture-phase error listener collects failed
 * resource loads (deduped, kind-labelled, origin-stripped), and a read-time scan of
 * <link rel=stylesheet> with a null `.sheet` catches a stylesheet that failed before
 * the listener existed — the silently-unstyled-page signal.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { installResourceErrorCapture } from './resource-errors'

describe('installResourceErrorCapture', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  test('captures a failed stylesheet link via the capture-phase error event', () => {
    const cap = installResourceErrorCapture()
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'assets/style.css'
    document.head.appendChild(link)
    // Synthesize the resource error the browser would fire (does not bubble → capture).
    link.dispatchEvent(new Event('error'))
    expect(cap.read()).toContain('stylesheet assets/style.css')
    cap.uninstall()
  })

  test('labels scripts and images and dedupes', () => {
    const cap = installResourceErrorCapture()
    const script = document.createElement('script')
    script.setAttribute('src', 'app.js')
    document.body.appendChild(script)
    const img = document.createElement('img')
    img.setAttribute('src', 'pics/logo.png')
    document.body.appendChild(img)
    script.dispatchEvent(new Event('error'))
    script.dispatchEvent(new Event('error')) // duplicate → collapsed
    img.dispatchEvent(new Event('error'))
    const out = cap.read()
    expect(out).toContain('script app.js')
    expect(out).toContain('image pics/logo.png')
    expect(out.filter((l) => l === 'script app.js')).toHaveLength(1)
    cap.uninstall()
  })

  test("ignores a window-level JS error (that is console-capture's job)", () => {
    const cap = installResourceErrorCapture()
    window.dispatchEvent(new Event('error')) // target is window, not an element
    expect(cap.read()).toHaveLength(0)
    cap.uninstall()
  })

  test('a clean page yields nothing', () => {
    const cap = installResourceErrorCapture()
    expect(cap.read()).toEqual([])
    cap.uninstall()
  })
})
