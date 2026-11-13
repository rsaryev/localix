import type { Heading } from '@/entities/doc';

/** A page's sections, on the right of a wide screen; the page's script marks the one being read. One
 *  section is not a table of contents, so it draws nothing. */
export function Toc({ headings }: { headings: Heading[] }) {
  const shown = headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (shown.length < 2) return null;
  return (
    <nav className="docs-toc" aria-label="On this page">
      <p className="docs-label">On this page</p>
      <ul>
        {shown.map((heading) => (
          <li key={heading.id} className={heading.depth === 3 ? 'sub' : undefined}>
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
