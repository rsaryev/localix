import { GROUPS } from '@/entities/doc';
import { DOCS_NAV, groupId } from '@/shared/config';
import { ReadingBar } from './ReadingBar';

const INDEX = DOCS_NAV.index;

/** /docs: what the docs cover, each group with its pages as cards. */
export function DocsIndex() {
  return (
    <div className="docs-index">
      <ReadingBar />
      <header className="docs-head">
        <p className="docs-label">Documentation</p>
        <h1>{INDEX.title}</h1>
        <p className="docs-lede">{INDEX.description}</p>
      </header>
      {GROUPS.map((group) => {
        const id = groupId(group.title);
        return (
          <section key={group.title} className="docs-group" aria-labelledby={id}>
            <div>
              <h2 id={id}>{group.title}</h2>
              <p>{group.blurb}</p>
            </div>
            <ul className="docs-cards">
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <a href={page.route}>
                    <span className="docs-card-title">{page.title}</span>
                    <span className="docs-card-text">{page.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
