import { DOCS_NAV, SITE, docRoute, sourceUrl } from '@/shared/config';
import { classify } from './hrefs';
import { read, render, type Heading } from './markdown';

/** Where the docs' markdown lives, from the site's root (vite.config.ts points `@docs` at it). */
const ROOT = `${(DOCS_NAV.dir ?? 'content/docs').replace(/\/+$/, '')}/`;
const UNLISTED = DOCS_NAV.unlisted;
/** A file under the docs' folder that is named, or is in a folder named, under `unlisted`. */
const unlisted = (name: string) => name in UNLISTED || Object.keys(UNLISTED).some((key) => key.endsWith('/') && name.startsWith(key));

/** The docs' markdown, read when the site is built (and on each request in dev). */
const FILES = import.meta.glob<string>('@docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
// A key is the file from this folder, three under the site's root: `../../../content/docs/x.md`.
const SOURCES = new Map(Object.entries(FILES).map(([key, text]) => [key.replace(/^(\.\.\/){3}/, ''), text]));

export type DocPage = {
  slug: string;
  route: string;
  source: string;
  group: string;
  title: string;
  titleId: string;
  /** The first paragraph, cut to what a search result or a link preview shows. */
  description: string;
  headings: Heading[];
  html: string;
  /** The markdown with every link made absolute, for llms-full.txt. */
  markdown: string;
};

type Draft = Omit<DocPage, 'html' | 'markdown'> & { body: string; text: string };

function cut(text: string, most = 200): string {
  if (text.length <= most) return text;
  const head = text.slice(0, most - 1);
  return `${head.slice(0, head.lastIndexOf(' ')).replace(/[,:;.]$/, '')}…`;
}

const problems: string[] = [];
/** A page's name is its address: lower-case words joined by hyphens. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const listed = DOCS_NAV.groups.flatMap((group) => group.pages);
for (const slug of new Set(listed)) {
  if (!slug.split('/').every((part) => NAME.test(part))) {
    problems.push(`${ROOT}${slug}.md: a page's name is lower-case words joined by hyphens`);
  }
  if (listed.indexOf(slug) !== listed.lastIndexOf(slug)) problems.push(`${ROOT}${slug}.md: listed twice in nav.ts`);
}
const drafts: Draft[] = DOCS_NAV.groups.flatMap((group) =>
  group.pages.flatMap((slug) => {
    const source = `${ROOT}${slug}.md`;
    const text = SOURCES.get(source);
    if (text === undefined) {
      problems.push(`${source}: in nav.ts, but there is no such file`);
      return [];
    }
    try {
      const { summary, ...parsed } = read(text);
      return [{ ...parsed, slug, source, text, route: docRoute(slug), group: group.title, description: cut(summary) }];
    } catch (error) {
      problems.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }),
);
for (const source of SOURCES.keys()) {
  if (!drafts.some((page) => page.source === source) && !unlisted(source.slice(ROOT.length))) {
    problems.push(`${source}: neither a page in nav.ts nor unlisted there`);
  }
}

/** Repository files the docs link to on GitHub, and pictures copied into the build: prerender.mjs
 *  checks the first exist and copies the second, a file by where it is served, to that path
 *  under dist/. Both are paths from the site's root. */
export const REPO_FILES = new Set<string>();
export const IMAGES = new Map<string, string>();

/** Where a link of `page` goes on the site: a page here (its anchor checked), a picture copied
 *  beside the pages, or the file on GitHub. A link that goes nowhere is a problem. */
function site(page: Draft, href: string, image: boolean): string {
  const to = classify(page.source, href);
  const wrong = (why: string) => {
    problems.push(`${page.source}: ${href} (${why})`);
    return href;
  };
  if (to.kind === 'url') return href;
  if (to.kind === 'outside') return wrong('outside the repository');
  const target = to.kind === 'anchor' ? page : drafts.find((draft) => draft.source === to.path);
  if (target) {
    const known = to.hash === '' || to.hash === target.titleId || target.headings.some((h) => h.id === to.hash);
    if (!known) return wrong(`${target.source} has no heading #${to.hash}`);
    const hash = to.hash ? `#${to.hash}` : '';
    return target === page && to.kind === 'anchor' ? hash : `${target.route}${hash}`;
  }
  if (to.kind === 'anchor') return wrong('no such page');
  if (image) {
    // A picture of the repository's own docs (`../docs/assets/x.png`) is served at `/docs/assets/x.png`.
    const served = to.path.replace(/^(\.\.\/)+/, '');
    IMAGES.set(served, to.path);
    return `/${served}`;
  }
  if (to.path.startsWith(ROOT) && to.path.endsWith('.md') && !unlisted(to.path.slice(ROOT.length))) {
    return wrong('no such doc');
  }
  REPO_FILES.add(to.path);
  return `${sourceUrl('blob', to.path)}${to.hash ? `#${to.hash}` : ''}`;
}

/** Markdown links outside fenced code, as llms-full.txt keeps them. */
function absolute(page: Draft, links: Map<string, string>): string {
  return page.text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part) =>
      part.startsWith('```')
        ? part
        : part.replace(/(\]\()([^)\s]+)(\))/g, (all, open: string, href: string, close: string) => {
            const to = links.get(href);
            if (to === undefined) return all;
            const url = to.startsWith('#') ? `${SITE.url}${page.route}${to}` : to.startsWith('/') ? `${SITE.url}${to}` : to;
            return `${open}${url}${close}`;
          }),
    )
    .join('');
}

/** Every page, in the order of nav.ts. */
export const PAGES: DocPage[] = drafts.map((draft) => {
  const links = new Map<string, string>();
  const html = render(draft.body, (href, image) => {
    const to = site(draft, href, image);
    links.set(href, to);
    return to;
  });
  const { body: _body, text: _text, ...page } = draft;
  return { ...page, html, markdown: absolute(draft, links) };
});

if (problems.length > 0) {
  throw new Error(`The docs' markdown has problems:\n  ${problems.join('\n  ')}`);
}

/** The groups of nav.ts with their pages. */
export const GROUPS = DOCS_NAV.groups.map((group) => ({
  title: group.title,
  blurb: group.blurb,
  pages: PAGES.filter((page) => page.group === group.title),
}));
