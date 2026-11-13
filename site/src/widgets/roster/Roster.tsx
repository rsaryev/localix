import { DOCS, DOCS_NAV, DOC_TITLES, LANDING, docRoute, groupId } from '@/shared/config';
import { SectionHead } from '@/shared/ui';
import './Roster.css';

const count = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`;

/** The docs as an index: a column for each group of content/docs/nav.ts, a row for each of its
 *  pages, numbered. Drawn when the landing's content has `docs`. */
export function Roster() {
  const docs = LANDING.docs;
  if (!docs) return null;
  // A column cut short says how many it leaves out; one page left is shown, not counted.
  const shown = (pages: string[]) => (docs.limit !== undefined && pages.length > docs.limit + 1 ? docs.limit : pages.length);
  const total = DOCS_NAV.groups.reduce((sum, group) => sum + group.pages.length, 0);
  return (
    <section className="roster wrap" aria-labelledby="roster-title">
      <SectionHead
        id="roster-title"
        title={docs.title}
        aside={
          <a className="label" href={DOCS}>
            {count(total)} →
          </a>
        }
      />
      <div className="roster-columns">
        {DOCS_NAV.groups.map((group) => (
          <div key={group.title} className="reveal">
            <h3 className="label">{group.title}</h3>
            <ul>
              {group.pages.slice(0, shown(group.pages)).map((page, at) => (
                <li key={page}>
                  <a className="roster-row" href={docRoute(page)}>
                    <span className="roster-name">{DOC_TITLES[page] ?? page}</span>
                    <span className="roster-no" aria-hidden="true">
                      {String(at + 1).padStart(2, '0')}
                    </span>
                  </a>
                </li>
              ))}
              {shown(group.pages) < group.pages.length && (
                <li>
                  <a className="roster-row roster-more" href={`${DOCS}#${groupId(group.title)}`}>
                    <span className="roster-name">{group.pages.length - shown(group.pages)} more</span>
                    <span className="roster-no" aria-hidden="true">
                      →
                    </span>
                  </a>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
