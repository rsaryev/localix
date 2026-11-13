// The site's content, typed: what content/ says, for every layer to read.
import docs from '@content/docs/nav';
import landing from '@content/landing';
import site from '@content/site';

export type { Block, Cell, Line, Tone } from '@/shared/ui';
export type { Build, Card, Clip, DocsConfig, LandingContent, Media, NavLink, SiteConfig, Tour } from './types';
export { DOC_TITLES, RELEASES } from 'virtual:site-data';

export const SITE = site;
export const LANDING = landing;
export const DOCS_NAV = docs;
/** A file of the site in the repository its sources are in: `kind` is GitHub's `blob` (read it)
 *  or `edit`, and `path` is under the site's root, which may be a folder of that repository. */
export function sourceUrl(kind: 'blob' | 'edit', path: string): string {
  const dir = site.sourceDir ? `${site.sourceDir.replace(/^\/+|\/+$/g, '')}/` : '';
  // A path may climb out of the site's folder (`../docs/x.md`, the repository's docs).
  const parts: string[] = [];
  for (const part of `${dir}${path}`.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return `${site.source ?? site.github}/${kind}/main/${parts.join('/')}`;
}
/** Where the docs live on the site. */
export const DOCS = '/docs';
/** A docs page's address: its name (`features/delegation`), a folder's two hyphens for its slash. */
export const docRoute = (name: string): string => `${DOCS}/${name.split('/').join('--')}`;
/** A docs group's anchor on the docs index, from its title (`Models & context`: `models-context`). */
export const groupId = (title: string): string => title.toLowerCase().replace(/\W+/g, '-');
