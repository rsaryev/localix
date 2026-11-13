import { SITE } from '@/shared/config';
import { escapeHtml } from '@/shared/lib/html';

export type Meta = {
  title: string;
  /** What the structured data calls the page. */
  headline: string;
  description: string;
  route: string;
  /** The landing is a website; a docs page, an article. */
  kind: 'website' | 'article';
};

const IMAGE = `${SITE.url}${SITE.image.path}`;
const IMAGE_TYPE = /\.jpe?g$/i.test(SITE.image.path) ? 'image/jpeg' : 'image/png';

/** A page's own head: its title, description, canonical URL, link previews and what it is. */
export function head({ title, headline, description, route, kind }: Meta): string {
  const url = `${SITE.url}${route}`;
  const [t, d, alt] = [escapeHtml(title), escapeHtml(description), escapeHtml(SITE.image.alt)];
  const data =
    kind === 'website'
      ? { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, description, url, ...SITE.jsonLd }
      : {
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline,
          description,
          url,
          isPartOf: { '@type': 'WebSite', name: SITE.name, url: `${SITE.url}/` },
        };
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="${kind}">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE.name)}">`,
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:image" content="${IMAGE}">`,
    `<meta property="og:image:type" content="${IMAGE_TYPE}">`,
    `<meta property="og:image:width" content="${SITE.image.width ?? 1200}">`,
    `<meta property="og:image:height" content="${SITE.image.height ?? 630}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${IMAGE}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
    `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
  ].join('\n  ');
}

/** The landing's head. */
export const landingHead = () =>
  head({ title: SITE.title, headline: SITE.title, description: SITE.description, route: '/', kind: 'website' });
