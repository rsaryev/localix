import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { IconifyIcon } from '@iconify/types'
import { fileIcon, folderIcon } from './fileIcon'
import { registerVscFileIcon } from '@/shared/contrib/iconContributions'

describe('fileIcon', () => {
  test('maps known extensions to a branded (self-colored) icon', () => {
    // Branded vscode-icons carry their color in the SVG, so `color` is empty
    // and the icon component is what distinguishes them.
    for (const name of ['src/x.ts', 'a.json', 's.css', 'App.tsx']) {
      const spec = fileIcon(name)
      expect(spec.color).toBe('')
      expect(typeof spec.Icon).not.toBe('undefined')
    }
  })

  test('distinct file types get distinct icons', () => {
    expect(fileIcon('a.ts').Icon).not.toBe(fileIcon('a.css').Icon)
    expect(fileIcon('a.js').Icon).not.toBe(fileIcon('a.ts').Icon)
  })

  test('is case-insensitive on the extension (same icon)', () => {
    expect(fileIcon('Comp.TSX').Icon).toBe(fileIcon('comp.tsx').Icon)
    expect(fileIcon('IMG.PNG').Icon).toBe(fileIcon('img.png').Icon)
  })

  test('exact-name match wins over the extension rule', () => {
    // package.json → the npm glyph, distinct from a plain .json.
    expect(fileIcon('package.json').Icon).not.toBe(fileIcon('other.json').Icon)
  })

  test('unknown extension / no extension → the neutral lucide default', () => {
    expect(fileIcon('thing.unknownext').color).toBe('text-text-faint')
    expect(fileIcon('Makefile').color).toBe('text-text-faint')
  })

  test('always returns a usable icon component', () => {
    for (const name of ['a.ts', 'b.unknownext', 'package.json']) {
      expect(typeof fileIcon(name).Icon).not.toBe('undefined')
    }
  })

  test('renders trusted vscode icon data as an accessible native SVG', () => {
    const { Icon } = fileIcon('component.ts')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-3' }))

    expect(markup).toContain('<svg')
    expect(markup).toContain('class="size-3"')
    expect(markup).toContain('viewBox="0 0 32 32"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('fill="#3178c6"')
  })

  test('renders mini-app-contributed icon data through the shared catalog renderer', () => {
    const contribution: IconifyIcon = {
      body: '<path fill="#123456" d="M0 0h16v16H0z"/>',
      width: 16,
      height: 16,
    }
    registerVscFileIcon('Localix.Contributed.Icon', contribution)

    const { Icon, color } = fileIcon('LOCALIX.CONTRIBUTED.ICON')
    const markup = renderToStaticMarkup(createElement(Icon))

    expect(color).toBe('')
    expect(markup).toContain('fill="#123456"')
  })
})

describe('folderIcon', () => {
  test('returns distinct open vs closed icons', () => {
    const open = folderIcon(true)
    const closed = folderIcon(false)
    expect(open.Icon).not.toBe(closed.Icon)
  })
})
