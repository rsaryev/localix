import type { ReactNode } from 'react';
import { DOCS, SITE } from '@/shared/config';
import { Action } from '@/shared/ui';
import './Nav.css';

/** The bar over every page: the site's links and its one action, on the right, and no name in
 *  the corner. On the landing it stays over the page as it scrolls; elsewhere it scrolls away
 *  and opens with the way home. `tools` is what a page adds before the links (the docs' search). */
export function Nav({ at = 'home', tools }: { at?: 'home' | 'docs' | 'elsewhere'; tools?: ReactNode }) {
  const { links, action } = SITE.bar;
  return (
    <>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <header className={at === 'home' ? 'nav nav-over' : 'nav'}>
        <nav className="nav-links wrap" aria-label="Site">
          {tools}
          {at !== 'home' && (
            <a className="label" href="/">
              Home
            </a>
          )}
          {links.map((link) => (
            <a key={link.href} className="label" href={link.href} aria-current={at === 'docs' && link.href === DOCS ? 'page' : undefined}>
              {link.label}
            </a>
          ))}
          {action && (
            <Action href={action.href} filled small>
              {action.label}
            </Action>
          )}
        </nav>
      </header>
    </>
  );
}
