// Puts the rendered landing into dist/index.html, so the text is in the HTML before any script
// runs (for crawlers, link previews and visitors without JavaScript); the client then hydrates it.
// Then writes each docs page as a whole HTML file (/docs/ci is dist/docs/ci.html, which
// Cloudflare Pages serves at that URL with no redirect), and the files that list them.
// Runs after `vite build` and `vite build --ssr`, then removes the server bundle.
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const server = fileURLToPath(new URL('../dist-ssr/', import.meta.url));
const repo = fileURLToPath(new URL('../', import.meta.url));

// Importing the bundle reads the docs' markdown, and fails on a link to a page or a heading that
// does not exist.
const ssr = await import(new URL('entry-server.js', `file://${server}`).href);
const page = `${dist}index.html`;
const html = await readFile(page, 'utf8');
const mount = '<div id="root"></div>';
const head = '<!--app:head-->';
for (const mark of [mount, head]) {
  if (!html.includes(mark)) throw new Error(`${mark} is missing from dist/index.html`);
}
// The landing's few kilobytes of style go into the page itself: one round trip less before its
// first paint. The docs keep their stylesheets as files, cached from one page to the next.
const sheet = /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g;
const styles = new Map();
for (const [, href] of html.matchAll(sheet)) styles.set(href, await readFile(`${dist}${href.slice(1)}`, 'utf8'));
if (styles.size === 0) throw new Error('dist/index.html links no stylesheet to inline');
await writeFile(
  page,
  html
    .replace(head, () => ssr.landingHead())
    .replace(sheet, (_, href) => `<style>${styles.get(href).trim()}</style>`)
    .replace(mount, () => `<div id="root">${ssr.render()}</div>`),
);

const missing = [...ssr.REPO_FILES].filter((path) => !existsSync(repo + path));
if (missing.length > 0) {
  throw new Error(`The docs link to files the repository does not have:\n  ${missing.join('\n  ')}`);
}
const template = await readFile(`${dist}docs.html`, 'utf8');
for (const route of ssr.DOCS_ROUTES) {
  const file = `${dist}${route.slice(1)}.html`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, ssr.renderDocsPage(route, template));
}
await writeFile(`${dist}${ssr.SEARCH_INDEX.slice(1)}`, ssr.searchIndex());
for (const [served, file] of ssr.IMAGES) {
  await mkdir(dirname(dist + served), { recursive: true });
  await cp(repo + file, dist + served);
}
await writeFile(`${dist}kit.html`, ssr.renderKit(await readFile(`${dist}kit.html`, 'utf8')));
await writeFile(`${dist}sitemap.xml`, ssr.sitemap());
// Any URL the site does not have: Pages serves 404.html with a 404 status, where it would
// otherwise answer every unknown path with the landing and a 200.
await writeFile(`${dist}404.html`, ssr.renderNotFound(template));
// The build's assets are named by their content's hash, so a browser keeps them for good; the
// fonts and the favicon keep their names, so they are kept a week. Everything else Pages
// revalidates on each visit, its default. A site's own rules (public/_headers) stay first.
const headers = [
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/fonts/*',
  '  Cache-Control: public, max-age=604800',
  '/favicon.png',
  '  Cache-Control: public, max-age=604800',
];
const own = existsSync(`${dist}_headers`) ? `${(await readFile(`${dist}_headers`, 'utf8')).trimEnd()}\n` : '';
await writeFile(`${dist}_headers`, `${own}${headers.join('\n')}\n`);
await writeFile(`${dist}llms-full.txt`, ssr.llmsFull());
// public/llms.txt is the site's own words; the docs' list follows them.
if (!existsSync(`${dist}llms.txt`)) throw new Error('public/llms.txt is missing');
const llms = await readFile(`${dist}llms.txt`, 'utf8');
await writeFile(`${dist}llms.txt`, `${llms.trimEnd()}\n\n${ssr.llmsDocs()}`);

await rm(server, { recursive: true, force: true });
console.log(`prerendered dist/index.html and ${ssr.DOCS_ROUTES.length} docs pages`);
