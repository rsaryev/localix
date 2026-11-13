import { GROUPS } from '@/entities/doc';
import { ChevronRight } from '@/shared/ui';

/** Every page, a branch a group: the rail beside the text. The branch of the page shown is open
 *  (all of them on the index); the others open on a press, with no script. */
export function Sidebar({ active }: { active?: string | undefined }) {
  return (
    <nav className="docs-nav" aria-label="Docs">
      {GROUPS.map((group) => (
        <details key={group.title} open={active === undefined || group.pages.some((page) => page.slug === active)}>
          <summary>
            <ChevronRight />
            {group.title}
          </summary>
          <ul>
            {group.pages.map((page) => (
              <li key={page.slug}>
                <a href={page.route} aria-current={page.slug === active ? 'page' : undefined}>
                  {page.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}
