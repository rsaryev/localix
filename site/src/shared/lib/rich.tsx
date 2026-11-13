import type { ReactNode } from 'react';

/** A line of content as nodes: what stands between backticks as code, and a [link](/to) as a
 *  link. Nothing else is read, so content stays plain text. */
export function rich(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\[[^\]]+\]\([^)\s]+\))/).map((part, at) => {
    if (part.startsWith('`')) return <code key={at}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    return link ? (
      <a key={at} href={link[2]}>
        {link[1]}
      </a>
    ) : (
      part
    );
  });
}
