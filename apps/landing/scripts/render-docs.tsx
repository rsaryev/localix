import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { SiteLayout } from '../src/components/SiteLayout'
import { DocsShell } from '../src/pages/docs/DocsShell'
import type { DocPage } from '../src/generated/docs'
import type { DocHeading } from '../src/pages/docs/docBootstrap'

export function renderDocsShell(page: DocPage, html: string, headings: DocHeading[]) {
  return renderToStaticMarkup(
    <StaticRouter location={`/docs/${page.slug}`}>
      <SiteLayout>
        <DocsShell active={page} headings={headings}>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </DocsShell>
      </SiteLayout>
    </StaticRouter>,
  )
}
