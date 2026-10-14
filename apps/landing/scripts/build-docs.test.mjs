import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildDocs,
  buildSitemap,
  flattenPublicNav,
  truncateSummary,
  validateCodeBlocks,
  validateDocAnchors,
  validateReadablePages,
  validateRelativeDocLinks,
  validateSourceReferences,
} from './build-docs.mjs'

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })))
})

describe('docs generator', () => {
  test('uses an exact ordered public navigation manifest', () => {
    expect(
      flattenPublicNav({
        sections: [
          {
            id: 'getting-started',
            title: 'Getting started',
            pages: ['getting-started/what-is-localix.md'],
          },
          {
            id: 'features',
            title: 'Features',
            categories: [{ title: 'Workbenches', pages: ['features/task-board.md'] }],
          },
        ],
      }),
    ).toEqual([
      {
        path: 'getting-started/what-is-localix.md',
        section: 'getting-started',
        sectionTitle: 'Getting started',
        category: undefined,
        order: 0,
      },
      {
        path: 'features/task-board.md',
        section: 'features',
        sectionTitle: 'Features',
        category: 'Workbenches',
        order: 1,
      },
    ])

    expect(() =>
      flattenPublicNav({
        sections: [
          {
            id: 'docs',
            title: 'Docs',
            pages: ['features/a.md', 'features/a.md'],
          },
        ],
      }),
    ).toThrow('Duplicate documentation public path')
    expect(() =>
      flattenPublicNav({
        sections: [{ id: 'docs', title: 'Docs', pages: ['../private.md'] }],
      }),
    ).toThrow('Unsafe documentation public path')
  })

  test('truncates summaries at a word boundary', () => {
    const summary = truncateSummary(`${'word '.repeat(60)}unfinished-tail`)

    expect(summary.length).toBeLessThanOrEqual(240)
    expect(summary).toEndWith('…')
    expect(summary).not.toContain('unfinished-tail')
    expect(summary.at(-2)).not.toBe(' ')
  })

  test('emits crawlable browser routes for every generated page', () => {
    const sitemap = buildSitemap([
      { slug: 'getting-started--installation' },
      { slug: 'features--workspace' },
    ])

    expect(sitemap).toContain('<loc>https://localix.ai/</loc>')
    expect(sitemap).not.toContain('<loc>https://localix.ai/docs</loc>')
    expect(sitemap).toContain('<loc>https://localix.ai/docs/getting-started--installation</loc>')
    expect(sitemap).toContain('<loc>https://localix.ai/docs/features--workspace</loc>')
    expect(sitemap).not.toContain('#')
  })

  test('requires a language and keeps public code examples compact', () => {
    expect(() =>
      validateCodeBlocks([
        {
          sourcePath: 'docs/good.md',
          content: '# Good\n\n```ts\nconst answer = 42\n```\n',
        },
      ]),
    ).not.toThrow()

    expect(() =>
      validateCodeBlocks([
        {
          sourcePath: 'docs/unformatted.md',
          content: '# Missing language\n\n```\ncommand\n```\n',
        },
      ]),
    ).toThrow('fenced code block has no language')

    expect(() =>
      validateCodeBlocks(
        [
          {
            sourcePath: 'docs/too-long.md',
            content: `# Too long\n\n\`\`\`text\n${'line\n'.repeat(4)}\`\`\`\n`,
          },
        ],
        3,
      ),
    ).toThrow('code block has 4 lines (maximum 3)')
  })

  test('keeps public pages and prose blocks scannable', () => {
    expect(() =>
      validateReadablePages([
        {
          sourcePath: 'docs/good.md',
          content: '# Good\n\nA short introduction.\n\n- A focused list item.\n',
        },
      ]),
    ).not.toThrow()

    expect(() =>
      validateReadablePages(
        [{ sourcePath: 'docs/long-page.md', content: '# Long\n\nBody\n\nBody\n' }],
        { maxLines: 4 },
      ),
    ).toThrow('page has 6 lines (maximum 4)')

    expect(() =>
      validateReadablePages(
        [
          {
            sourcePath: 'docs/dense.md',
            content: '# Dense\n\nThis prose block is intentionally too long.\n',
          },
        ],
        { maxParagraphWords: 5 },
      ),
    ).toThrow('prose block has 7 words (maximum 5)')
  })

  test('rejects broken relative links but ignores examples inside code', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-doc-links-'))
    tempRoots.push(root)
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.writeFile(path.join(root, 'docs', 'exists.md'), '# Existing\n')

    expect(
      validateRelativeDocLinks(
        [
          {
            sourcePath: 'docs/page.md',
            content:
              '[valid](exists.md) and `[example](missing-in-code.md)`\n\n```md\n[fenced](missing.md)\n```',
          },
          { sourcePath: 'docs/exists.md', content: '# Existing\n' },
        ],
        root,
      ),
    ).resolves.toEqual([])

    expect(
      validateRelativeDocLinks(
        [{ sourcePath: 'docs/page.md', content: '[broken](missing.md)' }],
        root,
      ),
    ).rejects.toThrow('docs/page.md: missing.md')
  })

  test('requires ordinary absolute URLs for non-public repository files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-doc-source-links-'))
    tempRoots.push(root)
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.mkdir(path.join(root, 'apps'), { recursive: true })
    await fs.writeFile(path.join(root, 'apps', 'source.ts'), 'export {}\n')

    const error = await validateRelativeDocLinks(
      [{ sourcePath: 'docs/page.md', content: '[source](../apps/source.ts)' }],
      root,
    ).catch((reason) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('must be an ordinary absolute URL')

    expect(
      await validateRelativeDocLinks(
        [
          {
            sourcePath: 'docs/page.md',
            content: '[source](https://github.com/rsaryev/localix/blob/main/apps/source.ts)',
          },
        ],
        root,
      ),
    ).toEqual([])
  })

  test('validates self and cross-page heading anchors', () => {
    const pages = [
      {
        sourcePath: 'docs/start.md',
        content: '# Start\n\n## Local setup\n\n[Details](features/details.md#limits)\n',
      },
      {
        sourcePath: 'docs/features/details.md',
        content: '# Details\n\n## Limits\n\n[Setup](../start.md#local-setup)\n',
      },
    ]

    expect(() => validateDocAnchors(pages)).not.toThrow()
    expect(() =>
      validateDocAnchors([
        pages[0],
        { ...pages[1], content: '# Details\n\n[Missing](#not-here)\n' },
      ]),
    ).toThrow('docs/features/details.md: #not-here')
  })

  test('validates rendered duplicate and setext ids while excluding tilde-fenced headings', () => {
    const page = {
      sourcePath: 'docs/headings.md',
      content: [
        '## Repeat',
        '',
        '## Repeat',
        '',
        'Setext title',
        '============',
        '',
        '~~~markdown',
        '## Fake heading',
        '~~~',
        '',
        '[Second](#repeat-1) and [Setext](#setext-title)',
      ].join('\n'),
    }
    expect(() => validateDocAnchors([page])).not.toThrow()
    expect(() =>
      validateDocAnchors([{ ...page, content: `${page.content}\n[Missing](#fake-heading)` }]),
    ).toThrow('docs/headings.md: #fake-heading')
  })

  test('rejects stale repository file references in public prose', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-doc-sources-'))
    tempRoots.push(root)
    await fs.mkdir(path.join(root, 'apps', 'api'), { recursive: true })
    await fs.writeFile(path.join(root, 'apps', 'api', 'server.ts'), 'export {}\n')

    expect(
      validateSourceReferences(
        [
          {
            sourcePath: 'docs/page.md',
            content: 'See `apps/api/server.ts`.\n\n```text\napps/api/example-only.ts\n```\n',
          },
        ],
        root,
      ),
    ).resolves.toBeUndefined()

    expect(
      validateSourceReferences(
        [{ sourcePath: 'docs/page.md', content: 'See `apps/api/removed.ts`.' }],
        root,
      ),
    ).rejects.toThrow('apps/api/removed.ts')
  })

  test('reports an uncaptured screenshot instead of failing the build', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-doc-shots-'))
    tempRoots.push(root)
    await fs.mkdir(path.join(root, 'docs', 'features'), { recursive: true })

    // A screenshot slot is declared before the capture exists on purpose, so a page
    // can be written ahead of being photographed. It comes back as pending…
    expect(
      validateRelativeDocLinks(
        [
          {
            sourcePath: 'docs/features/thing.md',
            content: '![a thing](../assets/screenshots/thing/overview--2026-08-07.png)',
          },
        ],
        root,
      ),
    ).resolves.toEqual([
      path.join('docs', 'assets', 'screenshots', 'thing', 'overview--2026-08-07.png'),
    ])

    // …while a missing image ANYWHERE ELSE is still a broken build, which is the
    // protection this validator exists for.
    expect(
      validateRelativeDocLinks(
        [{ sourcePath: 'docs/features/thing.md', content: '![x](../assets/logo.svg)' }],
        root,
      ),
    ).rejects.toThrow('../assets/logo.svg')
  })

  test('keeps metadata small and loads page bodies only through lazy modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-docs-'))
    tempRoots.push(root)
    const docs = path.join(root, 'docs')
    const generated = path.join(root, 'generated')
    const manifest = path.join(generated, 'docs.ts')
    const pages = path.join(generated, 'docs-pages')
    await fs.mkdir(path.join(docs, 'getting-started'), { recursive: true })
    await fs.mkdir(path.join(docs, 'features'), { recursive: true })
    await fs.mkdir(path.join(docs, 'internals', 'subsystems'), { recursive: true })
    await fs.mkdir(pages, { recursive: true })
    await fs.writeFile(path.join(pages, 'stale.ts'), 'export default "stale"\n')
    await fs.writeFile(
      path.join(docs, 'getting-started', 'start.md'),
      '---\norder: 1\n---\n# Start here\n\nFirst summary.\n\n## Setup\nDeep body.\n',
    )
    await fs.writeFile(
      path.join(docs, 'features', 'search.md'),
      '# Search\n\nSearch summary.\n\nneedle-that-exists-only-in-the-body\n',
    )
    await fs.writeFile(path.join(docs, 'internals', 'subsystems', 'private.md'), '# Private\n')
    await fs.writeFile(path.join(docs, 'internals', 'brand.md'), '# Brand\n')
    await fs.writeFile(path.join(docs, 'internals', 'product-evidence.md'), '# Evidence\n')
    const result = await buildDocs({
      sourceRoot: root,
      sourceDocs: docs,
      manifestFile: manifest,
      pageContentDir: pages,
      publicNav: [
        {
          path: 'getting-started/start.md',
          section: 'getting-started',
          sectionTitle: 'Getting started',
          order: 0,
        },
        {
          path: 'features/search.md',
          section: 'features',
          sectionTitle: 'Features',
          category: 'Workspace',
          order: 1,
        },
      ],
    })

    expect(result.pages).toHaveLength(2)
    expect(await fs.readdir(pages)).not.toContain('stale.ts')
    const manifestSource = await fs.readFile(manifest, 'utf8')
    expect(manifestSource).toContain('loadDocContent')
    expect(manifestSource).not.toContain('needle-that-exists-only-in-the-body')

    const generatedModule = await import(`${pathToFileURL(manifest).href}?test=${Date.now()}`)
    expect(generatedModule.docPages.map((page) => page.slug)).toEqual([
      'getting-started--start',
      'features--search',
    ])
    expect(await generatedModule.loadDocContent('features--search')).toContain(
      'needle-that-exists-only-in-the-body',
    )
    const allContent = await generatedModule.loadAllDocContent()
    expect(allContent.get('getting-started--start')).toContain('## Setup')
    const missingError = await generatedModule.loadDocContent('missing').catch((error) => error)
    expect(missingError).toBeInstanceOf(Error)
    expect(missingError.message).toBe('Unknown documentation page: missing')
  })

  test('supports concurrent generation into one output tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-docs-concurrent-'))
    tempRoots.push(root)
    const docs = path.join(root, 'docs')
    const generated = path.join(root, 'generated')
    const manifest = path.join(generated, 'docs.ts')
    const pages = path.join(generated, 'docs-pages')
    await fs.mkdir(path.join(docs, 'features'), { recursive: true })
    for (let index = 0; index < 20; index += 1) {
      await fs.writeFile(
        path.join(docs, 'features', `page-${index}.md`),
        `# Page ${index}\n\nBody ${index}.\n`,
      )
    }

    await Promise.all(
      Array.from({ length: 4 }, () =>
        buildDocs({
          sourceRoot: root,
          sourceDocs: docs,
          manifestFile: manifest,
          pageContentDir: pages,
          publicNav: Array.from({ length: 20 }, (_, index) => ({
            path: `features/page-${index}.md`,
            section: 'features',
            sectionTitle: 'Features',
            category: 'More',
            order: index,
          })),
        }),
      ),
    )

    expect((await fs.readdir(pages)).filter((file) => file.endsWith('.ts'))).toHaveLength(20)
    expect((await fs.readdir(pages)).some((file) => file.endsWith('.tmp'))).toBe(false)
    const source = await fs.readFile(manifest, 'utf8')
    expect(source).toContain('features--page-19')
  })
})
