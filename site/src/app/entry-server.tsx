import { StrictMode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { PAGES } from '@/entities/doc';
import { DocsLayout } from '@/pages/docs';
import { KitPage } from '@/pages/kit';
import { LandingPage } from '@/pages/landing';
import { DOCS, DOCS_NAV, SITE } from '@/shared/config';
import { head } from './head';

const HEAD = '<!--docs:head-->';
const BODY = '<!--docs:body-->';

/** The landing as HTML, for the build to put into dist/index.html. */
export function render(): string {
  return renderToString(
    <StrictMode>
      <LandingPage />
    </StrictMode>,
  );
}

/** Every docs route the build writes: the index, then each page. */
export const DOCS_ROUTES = [DOCS, ...PAGES.map((page) => page.route)];

/** 404.html: the docs' template around the 404, kept out of search results. */
export function renderNotFound(template: string): string {
  const meta = [`<title>Page not found · ${SITE.name}</title>`, '<meta name="robots" content="noindex">'].join('\n  ');
  const body = renderToStaticMarkup(<DocsLayout missing />);
  return template.replace(HEAD, () => meta).replace(BODY, () => body);
}

/** Where the UI kit is. It is for the people who build the site: kept out of search results and
 *  the sitemap. */
export const KIT = '/kit';

/** /kit as a whole document: `template` is kit.html. */
export function renderKit(template: string): string {
  const meta = [`<title>UI kit · ${SITE.name}</title>`, '<meta name="robots" content="noindex">'].join('\n  ');
  const body = renderToStaticMarkup(<KitPage />);
  return template.replace(HEAD, () => meta).replace(BODY, () => body);
}

/** A docs route as a whole document: `template` (docs.html, as built or as written) with the
 *  page's head and body in its two marks. Undefined for a route that is no page. */
export function renderDocsPage(route: string, template: string): string | undefined {
  const page = PAGES.find((candidate) => candidate.route === route);
  if (!page && route !== DOCS) return undefined;
  for (const mark of [HEAD, BODY]) {
    if (!template.includes(mark)) throw new Error(`${mark} is missing from docs.html`);
  }
  const index = DOCS_NAV.index;
  const meta = page
    ? { title: `${page.title} · ${SITE.name} docs`, headline: page.title, description: page.description, route }
    : { title: index.title, headline: index.title, description: index.description, route };
  const body = renderToStaticMarkup(<DocsLayout page={page} />);
  // Replaced by functions: a `$&` in a page is text, not a pattern.
  return template.replace(HEAD, () => head({ ...meta, kind: 'article' })).replace(BODY, () => body);
}

export { landingHead } from './head';
export { llmsDocs, llmsFull, searchIndex, sitemap } from './files';
export { SEARCH_INDEX } from '@/pages/docs';
export { IMAGES, REPO_FILES } from '@/entities/doc';
