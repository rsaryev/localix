import { SITE } from '@/shared/config';
import './Footer.css';

/** Under every page, one strip: the site's one line, then where else to go. */
export function Footer() {
  return (
    <footer className="foot wrap">
      <p>{SITE.footer.note}</p>
      <nav aria-label="Footer">
        {SITE.footer.links.map((link) => (
          <a key={link.href} className="label" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
