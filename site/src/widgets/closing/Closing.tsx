import { Download } from '@/features/download';
import { LANDING, SITE } from '@/shared/config';
import { rich } from '@/shared/lib/rich';
import { Action, SectionHead } from '@/shared/ui';
import './Closing.css';

/** The page's end: how to start, in numbered steps, then where to go. The first link is the
 *  filled action; where the site has builds to download, the download is, before the links. The
 *  bar's action lands here (`#start`). */
export function Closing() {
  const { title, aside, steps, links } = LANDING.closing;
  const builds = SITE.downloads;
  return (
    <section id="start" className="closing wrap" aria-labelledby="closing-title">
      <SectionHead id="closing-title" title={title} aside={aside && <p className="label">{aside}</p>} />
      <ol className="closing-steps">
        {steps.map((step, at) => (
          <li key={step.title} className="reveal">
            <span className="label" aria-hidden="true">
              {String(at + 1).padStart(2, '0')}
            </span>
            <h3>{step.title}</h3>
            <p>{rich(step.text)}</p>
          </li>
        ))}
      </ol>
      <p className="closing-links">
        {builds && <Download builds={builds} bare />}
        {links.map((link, at) => (
          <Action key={link.href} href={link.href} filled={!builds && at === 0}>
            {link.label}
          </Action>
        ))}
      </p>
    </section>
  );
}
