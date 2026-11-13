import type { DocPage } from '@/entities/doc';
import { DOCS } from '@/shared/config';
import { Footer } from '@/widgets/footer';
import { Nav } from '@/widgets/nav';
import { Article } from './Article';
import { DocsIndex } from './DocsIndex';
import { SearchButton, SearchDialog } from './Search';
import { Sidebar } from './Sidebar';
import { Toc } from './Toc';

/** The landing's nav and footer around the docs: the rail of pages (the path over the page is the menu
 *  on a phone), the page, and its sections on the right of a wide screen. No script draws any of it. With a page
 *  it is that page; with none, the index; `missing`, the 404. */
export function DocsLayout({ page, missing }: { page?: DocPage | undefined; missing?: true }) {
  return (
    <>
      <Nav at={missing ? 'elsewhere' : 'docs'} tools={<SearchButton />} />
      <div className="docs wrap">
        <aside className="docs-side">
          <Sidebar active={page?.slug} />
        </aside>
        <main id="main" className="docs-main">
          {missing ? <NotFound /> : page ? <Article page={page} /> : <DocsIndex />}
        </main>
        {page && <Toc headings={page.headings} />}
      </div>
      <Footer />
      <SearchDialog />
    </>
  );
}

/** What any URL the site does not have shows (404.html, which Pages serves with a 404 status
 *  instead of the landing with a 200): where to go instead, the docs' menu beside it. */
function NotFound() {
  return (
    <div className="docs-index">
      <header className="docs-head">
        <p className="docs-label">404</p>
        <h1>Page not found</h1>
        <p className="docs-lede">
          Nothing lives at this address. Go to the <a href="/">home page</a> or the <a href={DOCS}>docs</a>.
        </p>
      </header>
    </div>
  );
}
