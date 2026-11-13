import { GROUPS, PAGES } from '@/entities/doc';
import { DOCS, DOCS_NAV, SITE as CONFIG } from '@/shared/config';

const SITE = CONFIG.url;
const INDEX = DOCS_NAV.index;

/** sitemap.xml: the landing, the docs' index and every page. */
export function sitemap(): string {
  const urls = ['/', DOCS, ...PAGES.map((page) => page.route)]
    .map((route) => `  <url>\n    <loc>${SITE}${route === '/' ? '/' : route}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The docs' part of llms.txt: each page with what it covers, by group, and the whole in one file. */
export function llmsDocs(): string {
  const groups = GROUPS.map(
    (group) =>
      `### ${group.title}\n\n${group.pages.map((page) => `- [${page.title}](${SITE}${page.route}): ${page.description}`).join('\n')}`,
  );
  return `## Docs\n\n${groups.join('\n\n')}\n\nEvery page in one markdown file: ${SITE}/llms-full.txt\n`;
}

/** llms-full.txt: every page's markdown, in the order of the docs, its links made absolute. */
export function llmsFull(): string {
  const pages = PAGES.map((page) => `---\n\nSource: ${SITE}${page.route}\n\n${page.markdown.trim()}\n`);
  return `# ${INDEX.title}\n\n> ${INDEX.description}\n\n${pages.join('\n')}`;
}

/** A piece of a page's HTML as the text a reader sees: no tags, no copy buttons, no heading marks. */
function plain(html: string): string {
  return html
    .replace(/<(button|svg|a class="hash")[\s\S]*?<\/(button|svg|a)>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the docs' search reads: each page cut at its headings, a row a section (`u` where it is,
 *  `p` its page, `g` the page's group, `h` its heading, none for a page's opening, `x` its text). */
export function searchIndex(): string {
  const rows = PAGES.flatMap((page) =>
    page.html.split(/(?=<h[23] id=")/).map((part) => {
      const head = /^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/.exec(part);
      const body = head ? part.slice(head[0].length) : part;
      return { u: head ? `${page.route}#${head[1]}` : page.route, p: page.title, g: page.group, h: head ? plain(head[2] ?? '') : '', x: plain(body) };
    }),
  );
  return JSON.stringify(rows);
}
