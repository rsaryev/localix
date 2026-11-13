import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { siteData } from './scripts/site-data.mjs';
import docs from './content/docs/nav.ts';

const dir = (path: string) => decodeURIComponent(new URL(path, import.meta.url).pathname);
const ENTRY = '/src/app/entry-server.tsx';
/** The docs' markdown, from the site's root: content/docs, or the folder nav.ts names. */
const DOCS_DIR = docs.dir ?? 'content/docs';
/** Where the pictures of docs outside the site's folder are served (`/docs/`), as
 *  content.ts names them; none for docs under it, which Vite serves at their own path. */
const OUTSIDE = DOCS_DIR.startsWith('../') ? `/${DOCS_DIR.replace(/^(\.\.\/)+/, '').replace(/\/+$/, '')}/` : undefined;

/** The site in dev: the landing's head filled from content/site.ts, and /docs and /docs/<slug>
 *  and /kit rendered on each request, as scripts/prerender.mjs writes them at build time; any other
 *  address is the 404 page; the page is reloaded when a doc's markdown changes. */
function pages(): Plugin {
  return {
    name: 'sitekit-pages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // originalUrl: Connect sets it, and the site's types know it without Node's.
        const url: string = req.originalUrl ?? '';
        const route = url.split(/[?#]/)[0]?.replace(/(.)\/$/, '$1') ?? '';
        // The landing, and every file (a module, an asset, a picture), are Vite's own to serve.
        // (but the search's index, which the build writes and the dev server makes on request).
        const made = route.endsWith('/search.json');
        // A picture of docs outside the site's folder is served where the build copies it
        // (`../docs/assets/x.png` at /docs/assets/x.png): Vite serves it from where it is.
        if (OUTSIDE && route.startsWith(OUTSIDE) && /\.\w+$/.test(route)) {
          // url is Node's own field, which the site's types do not know without Node's.
          (req as { url?: string }).url = `/@fs${dir(DOCS_DIR)}/${route.slice(OUTSIDE.length)}`;
          return next();
        }
        if (route === '/' || (/\.\w+$/.test(route) && !made) || route.startsWith('/@')) return next();
        void (async () => {
          const entry = await server.ssrLoadModule(ENTRY);
          if (made) {
            if (route !== entry.SEARCH_INDEX) return next();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(entry.searchIndex());
            return;
          }
          if (route === entry.KIT) {
            const kit = (await server.ssrLoadModule('/kit.html?raw')).default as string;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(await server.transformIndexHtml(route, entry.renderKit(kit)));
            return;
          }
          const template = (await server.ssrLoadModule('/docs.html?raw')).default as string;
          const html: string | undefined = entry.renderDocsPage(route, template);
          res.statusCode = html === undefined ? 404 : 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(await server.transformIndexHtml(route, html ?? entry.renderNotFound(template)));
        })().catch(next);
      });
      // The docs may be outside the site's folder, where Vite does not look on its own.
      server.watcher.add(dir(DOCS_DIR));
      server.watcher.on('change', (file) => {
        if (file.endsWith('.md')) server.ws.send({ type: 'full-reload' });
      });
    },
    async transformIndexHtml(html, ctx) {
      if (!ctx.server || !html.includes('<!--app:head-->')) return html;
      const entry = await ctx.server.ssrLoadModule(ENTRY);
      return html.replace('<!--app:head-->', () => entry.landingHead() as string);
    },
  };
}

const DATA = 'virtual:site-data';

/** What the landing shows of the repository's files, read as the site is built
 *  (scripts/site-data.mjs): each docs page's title and the changelog's latest releases. The
 *  landing runs in the browser, where neither the markdown nor its engine is loaded. */
function data(): Plugin {
  return {
    name: 'sitekit-data',
    resolveId: (id) => (id === DATA ? `\0${DATA}` : undefined),
    load(id) {
      if (id !== `\0${DATA}`) return undefined;
      const { files, titles, releases } = siteData(dir('.'), DOCS_DIR);
      for (const file of files) this.addWatchFile(file);
      return `export const DOC_TITLES = ${JSON.stringify(titles)};\nexport const RELEASES = ${JSON.stringify(releases)};\n`;
    },
  };
}

// The site is served from the domain root; public/ keeps every static URL as it is.
// Three pages are built: the landing, docs.html (the shell every docs page is prerendered into)
// and kit.html, the UI kit's.
export default defineConfig({
  plugins: [react(), data(), pages()],
  base: '/',
  resolve: {
    alias: { '@content': dir('./content'), '@docs': dir(`./${DOCS_DIR}`), '@': dir('./src') },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Every browser the es2022 target reaches preloads modules itself: no polyfill, and so no
    // chunk the two pages would share for it alone.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { main: 'index.html', docs: 'docs.html', kit: 'kit.html' },
    },
  },
});
