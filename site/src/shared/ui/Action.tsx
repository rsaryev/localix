import type { ReactNode } from 'react';
import './Action.css';

/** A link as an action, a pill: filled for the one to take first, a hairline outline otherwise;
 *  `small` in the bar. */
export function Action({ href, filled = false, small = false, children }: { href: string; filled?: boolean; small?: boolean; children: ReactNode }) {
  return (
    <a className={['action', filled && 'filled', small && 'small'].filter(Boolean).join(' ')} href={href}>
      {children}
    </a>
  );
}
