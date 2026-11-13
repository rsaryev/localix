// What the landing shows of the repository's files, read as the site is built (vite.config.ts
// serves it to the pages as `virtual:site-data`).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A changelog as releases, newest first: a `## 1.2.0` heading (a date after it, `- 2026-01-31`
 *  or in brackets, is read when there), its first paragraph, and how many entries it lists. */
export function releases(text) {
  return text
    .split(/^## /m)
    .slice(1)
    .flatMap((part) => {
      const [head = '', ...lines] = part.split('\n');
      const version = /^\[?v?(\d+\.\d+[\w.-]*)\]?/.exec(head)?.[1];
      if (!version) return [];
      const body = lines.join('\n');
      const summary =
        body
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .find((block) => block && !/^([-*#]|\*\*)/.test(block)) ?? '';
      return [
        {
          version,
          date: /\d{4}-\d{2}-\d{2}/.exec(head)?.[0] ?? '',
          summary: summary.replace(/[`*]/g, '').replace(/\s+/g, ' '),
          changes: (body.match(/^[-*] /gm) ?? []).length,
        },
      ];
    });
}

/** Under `root`: each docs page's title (its first heading) by its name, the file's path under
 *  `dir` (the docs' folder from the root) without `.md`; the changelog's five latest releases;
 *  and the files read, for the dev server to watch. */
export function siteData(root, dir = 'content/docs') {
  const docs = join(root, dir);
  const changelog = join(root, 'CHANGELOG.md');
  const names = readdirSync(docs, { recursive: true }).filter((name) => name.endsWith('.md'));
  const titles = {};
  for (const name of names) {
    titles[name.slice(0, -3)] = /^#\s+(.+)$/m.exec(readFileSync(join(docs, name), 'utf8'))?.[1]?.replace(/`/g, '').trim() ?? name;
  }
  return {
    files: [...names.map((name) => join(docs, name)), changelog],
    titles,
    releases: existsSync(changelog) ? releases(readFileSync(changelog, 'utf8')).slice(0, 5) : [],
  };
}
