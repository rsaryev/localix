import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(srcDir, rel), 'utf8')

describe('landing page shell', () => {
  test('every page-level column is PAGE_SHELL, so footer edges line up with content', () => {
    // Docs used to carry its own `max-w-[88rem] px-5` column, which left the
    // shared footer a few pixels wider than the page above it on /docs.
    expect(read('lib/shell.ts')).toContain("'mx-auto w-full max-w-[90rem] px-6 lg:px-10'")

    // The home column lives on `<Section>`; SiteLayout and DocsPage carry theirs
    // directly. All three must resolve to the same one constant.
    for (const file of [
      'components/SiteLayout.tsx',
      'components/home/Reveal.tsx',
      'pages/DocsPage.tsx',
    ]) {
      expect(read(file)).toContain('PAGE_SHELL')
      // No hand-rolled second shell.
      expect(read(file)).not.toContain('max-w-[88rem]')
      expect(read(file)).not.toMatch(/mx-auto[^"'`]*max-w-\[90rem\]/)
    }
  })

  test('the section rail stays inside the page gutter', () => {
    // `right-2` (0.5rem) + the `size-6` (1.5rem) dot target ends at 2rem, inside
    // the shell's 2.5rem `lg:px-10` gutter — it must not sit over the content.
    const nav = read('components/SectionNav.tsx')
    expect(nav).toContain('fixed right-2 top-1/2')
    expect(nav).toContain('size-6')
  })

  test('the docs rails share one sticky offset', () => {
    // The two rails are separate components; they still have to pin on one line.
    const rails = ['pages/docs/DocsSidebar.tsx', 'pages/docs/DocsTableOfContents.tsx'].flatMap(
      (file) => read(file).match(/sticky top-\d+/g) ?? [],
    )
    expect(rails).toEqual(['sticky top-8', 'sticky top-8'])
  })

  test('`.lede` owns its own measure — no dead max-w utility on the same element', () => {
    // `.lede` is unlayered CSS (`max-width: 54ch`), so it beats Tailwind's
    // layered `max-w-*` utilities. Putting one on a `.lede` element declares a
    // measure that never applies and misleads the next reader.
    for (const file of ['pages/HomePage.tsx', 'pages/DocsPage.tsx', 'components/home/cards.tsx']) {
      for (const [cls] of read(file).matchAll(/className="([^"]*\blede\b[^"]*)"/g)) {
        expect(cls).not.toMatch(/\bmax-w-/)
      }
    }
  })

  test('outline call-to-actions come from Button, not hand-rolled borders', () => {
    // `variant="outline"` is one string in Button.tsx; DownloadChooser and the
    // docs 404 each used to carry their own copy of it.
    expect(read('components/DownloadChooser.tsx')).not.toMatch(/border border-control-border/)

    const docs = read('pages/DocsPage.tsx')
    expect(docs).toContain('ButtonLink')
    // Docs still draws that border, but only on form controls — which Button
    // does not cover. Any other use is a hand-rolled outline button.
    for (const [, next] of docs.matchAll(/border border-control-border (\S+)/g)) {
      expect(next).toBe('bg-surface-raised')
    }
  })

  test('shared components import relatively so bun test can load them', () => {
    // `bun test` runs from the repository root and reads the root tsconfig, so
    // it cannot resolve the `@/` alias Vite provides. Anything a DOM test
    // module-loads must therefore use a relative specifier.
    for (const file of [
      'lib/shell.ts',
      'components/Button.tsx',
      'components/DownloadChooser.tsx',
      'components/SiteLayout.tsx',
    ]) {
      expect(read(file)).not.toMatch(/^import .* from '@\//m)
    }
  })

  test('the homepage is rendered from the tree React hydrates, never from a lookalike', () => {
    // The first paint used to be a hand-written copy of the hero (its own CSS, its own
    // fonts and sizes) that React replaced a moment later, so the page painted one layout
    // and jumped to another. The build now renders the real route table, and the client
    // hydrates it. A second copy of the hero anywhere in the build brings the jump back.
    const appRoot = join(srcDir, '..')
    const build = readFileSync(join(appRoot, 'scripts/build-static-docs.mjs'), 'utf8')
    const renderer = readFileSync(join(appRoot, 'scripts/render-home.tsx'), 'utf8')
    expect(renderer).toContain('<AppRoutes />')
    expect(build).not.toContain('The open source ADE')
    expect(read('styles.css')).not.toContain('.home-static')

    // The client adopts the markup only when it was rendered here, and only on `/`.
    const main = read('main.tsx')
    expect(main).toContain('hydrateRoot')
    expect(main).toContain("hasAttribute('data-prerendered')")
    // Static docs use the same shell, so adding the rails never changes the article column.
    expect(build).toContain('renderDocsShell(active, bodyHtml, headings)')
    expect(readFileSync(join(appRoot, 'scripts/render-docs.tsx'), 'utf8')).toContain('<DocsShell')
  })

  test('the product sentence is the same wherever the page states it', () => {
    // The one-sentence description is repeated in the hero, the page metadata, the structured
    // data and the social card. Each carrier once said something different.
    const appRoot = join(srcDir, '..')
    const sentence = 'editor, terminals, preview, and databases'
    const carriers = [
      readFileSync(join(appRoot, 'index.html'), 'utf8'),
      readFileSync(join(appRoot, 'public/og.svg'), 'utf8'),
      read('pages/docs/useDocMetadata.ts'),
    ]
    for (const carrier of carriers) expect(carrier).toContain(sentence)
    // The concise hero preserves the same working surfaces as the metadata.
    expect(read('pages/HomePage.tsx').replaceAll(/\s+/g, ' ')).toContain(
      'share the editor, terminals, preview, and databases',
    )
    // llms.txt is hand-maintained and wraps its copy inside a blockquote, so unwrap first.
    const llms = readFileSync(join(appRoot, 'public/llms.txt'), 'utf8')
      .replaceAll(/^>\s?/gmu, '')
      .replaceAll(/\s+/gu, ' ')
    expect(llms).toContain('share the editor, terminals, preview, and databases')
    // No claim of a download until a release exists: the action that works today is a build.
    expect(read('components/DownloadChooser.tsx')).toContain('/docs/getting-started--installation')
  })
})
