import type { ReactNode } from 'react';
import './SectionHead.css';

/** A section's heading, with a short aside at its right: a count, a line, a link. `id` is the
 *  heading's, for the section's `aria-labelledby`. */
export function SectionHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <header className="section-head">
      <h2 id={id}>{title}</h2>
      {aside}
    </header>
  );
}
