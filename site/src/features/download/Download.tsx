import { type ReactNode, useEffect, useState } from 'react';
import type { Build } from '@/shared/config';
import { Action } from '@/shared/ui';
import { system } from './system';
import './Download.css';

/**
 * The download as a page's first action: the build for the reader's system, found once the page
 * runs. Until then, and on a system no build is for, the first build stands. `children` are the
 * other actions of its row. Under the row, one quiet line: what that build needs, the other
 * builds as links, then `after`. `bare` is the button alone, for a row of actions.
 */
export function Download({ builds, bare = false, after, children }: { builds: Build[]; bare?: boolean; after?: ReactNode; children?: ReactNode }) {
  const [os, setOs] = useState<Build['os']>();
  useEffect(() => setOs(system()), []);
  const main = builds.find((build) => build.os === os) ?? builds[0];
  if (!main) return null;
  const button = (
    <Action href={main.href} filled>
      {main.label}
    </Action>
  );
  if (bare) return button;
  const others = builds.filter((build) => build !== main);
  return (
    <div className="download">
      <p className="download-actions">
        {button}
        {children}
      </p>
      <p className="download-more">
        {main.note}
        {others.map((build) => (
          <span key={build.os}>
            {' · '}
            <a href={build.href}>{build.also}</a>
          </span>
        ))}
        {after && <span> · {after}</span>}
      </p>
    </div>
  );
}
