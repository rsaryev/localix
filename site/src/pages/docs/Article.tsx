import { PAGES, type DocPage } from '@/entities/doc';
import { DOCS, sourceUrl } from '@/shared/config';
import { ReadingBar } from './ReadingBar';

/** One page: the bar it is read under, its title, the markdown as HTML, then the pages before
 *  and after it around where to change it. */
export function Article({ page }: { page: DocPage }) {
  const at = PAGES.indexOf(page);
  const previous = at === 0 ? { route: DOCS, title: 'Overview' } : PAGES[at - 1];
  const next = PAGES[at + 1];
  return (
    <article className="docs-article">
      <ReadingBar page={page} />
      <h1 className="docs-title" id={page.titleId}>
        {page.title}
      </h1>
      <div dangerouslySetInnerHTML={{ __html: page.html }} />
      <footer className="docs-foot">
        {previous ? (
          <a className="docs-turn" href={previous.route} rel="prev" aria-label={`Previous page: ${previous.title}`}>
            <span aria-hidden="true">←</span>
            <span className="docs-turn-title">{previous.title}</span>
          </a>
        ) : (
          <span />
        )}
        <a className="docs-edit" href={sourceUrl('edit', page.source)}>
          Edit on GitHub
        </a>
        {next ? (
          <a className="docs-turn docs-turn-next" href={next.route} rel="next" aria-label={`Next page: ${next.title}`}>
            <span className="docs-turn-title">{next.title}</span>
            <span aria-hidden="true">→</span>
          </a>
        ) : (
          <span />
        )}
      </footer>
    </article>
  );
}
