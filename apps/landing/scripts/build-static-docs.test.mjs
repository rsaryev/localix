import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildStaticDocs,
  renderStaticDocHtml,
  renderStaticHomeHtml,
  renderStaticMarkdown,
} from './build-static-docs.mjs'

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })))
})

const template = `<!doctype html><html><head>
<title>Home</title>
<meta name="description" content="Home description" />
<link rel="canonical" href="https://localix.ai/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://localix.ai/" />
<meta property="og:title" content="Home" />
<meta property="og:description" content="Home description" />
<meta name="twitter:title" content="Home" />
<meta name="twitter:description" content="Home description" />
<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
</head><body><div id="root"></div></body></html>`

describe('static docs HTML', () => {
  test('renders a crawlable home shell before the application starts', () => {
    const html = renderStaticHomeHtml(template, '<main><h1>The open source ADE</h1></main>')

    // The markup is the application's own render, marked so the client hydrates it rather than
    // replacing it with a different layout.
    expect(html).toContain('<div id="root" data-prerendered="home"><main><h1>')
    expect(html).not.toContain('<div id="root"></div>')
  })

  test('renders route-specific crawl and social metadata safely', () => {
    const html = renderStaticDocHtml(template, {
      slug: 'features--workspace',
      title: 'Workspace & tools',
      summary: 'Use <tools> "safely".',
    })

    expect(html).toContain('<title>Workspace &amp; tools · Localix Docs</title>')
    expect(html).toContain('href="https://localix.ai/docs/features--workspace"')
    expect(html).toContain('content="Use &lt;tools&gt; &quot;safely&quot;."')
    expect(html).toContain('"@type":"WebPage"')
    expect(html).not.toContain('"@type":"SoftwareApplication"')
  })

  test('renders a crawlable article body and rewrites public doc links', () => {
    const pages = [
      {
        slug: 'getting-started--start',
        sourcePath: 'docs/getting-started/start.md',
      },
      {
        slug: 'features--workspace',
        sourcePath: 'docs/features/workspace.md',
      },
    ]
    const body = renderStaticMarkdown(
      '# Start\n\n## First steps\n\nRead the [workspace](../features/workspace.md#tools).',
      pages[0],
      pages,
    )
    const html = renderStaticDocHtml(
      template,
      { ...pages[0], title: 'Start', summary: 'Start here.' },
      body,
    )

    expect(html).toContain('<article class="docs-prose"><h1 id="start">Start</h1>')
    expect(html).toContain('<h2 id="first-steps">First steps</h2>')
    expect(html).toContain('href="/docs/features--workspace#tools"')
  })

  test('keeps ordinary Markdown links visible and clickable', () => {
    const page = {
      slug: 'features--workspace',
      sourcePath: 'docs/features/workspace.md',
    }
    const body = renderStaticMarkdown(
      'See the [source](../../apps/ui/src/App.tsx) and [private note](../internals/private.md).',
      page,
      [page],
    )

    expect(body).toContain('<a href="../../apps/ui/src/App.tsx">source</a>')
    expect(body).toContain('<a href="../internals/private.md">private note</a>')
    expect(body).not.toContain('<span>source</span>')
  })

  test('emits one HTML file per known slug', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-static-docs-'))
    tempRoots.push(root)
    await fs.writeFile(path.join(root, 'index.html'), template)

    await buildStaticDocs({
      distDir: root,
      pages: [{ slug: 'getting-started--install', title: 'Install', summary: 'Start here.' }],
      loadContent: async () => '# Install\n\nStart here.',
      renderHome: async () => '<main class="home-rendered"></main>',
    })

    const html = await fs.readFile(path.join(root, 'docs', 'getting-started--install.html'), 'utf8')
    const home = await fs.readFile(path.join(root, 'index.html'), 'utf8')
    expect(html).toContain('<title>Install · Localix Docs</title>')
    expect(home).toContain('data-prerendered="home"><main class="home-rendered">')
  })

  test('removes stale generated HTML shells', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-static-docs-'))
    tempRoots.push(root)
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.writeFile(path.join(root, 'index.html'), template)
    await fs.writeFile(path.join(root, 'docs', 'removed.html'), 'stale')

    await buildStaticDocs({
      distDir: root,
      pages: [{ slug: 'current', title: 'Current', summary: 'Current page.' }],
      loadContent: async () => '# Current\n\nCurrent page.',
      renderHome: async () => '<main></main>',
    })

    expect(await fs.readdir(path.join(root, 'docs'))).toEqual(['current.html'])
  })

  test('rejects a slug that could escape the docs output directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-static-docs-'))
    tempRoots.push(root)
    await fs.writeFile(path.join(root, 'index.html'), template)

    expect(
      buildStaticDocs({
        distDir: root,
        pages: [{ slug: '../escape', title: 'No', summary: 'No.' }],
      }),
    ).rejects.toThrow('Unsafe documentation slug')
  })
})
