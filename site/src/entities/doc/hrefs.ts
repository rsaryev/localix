/** Where a link written in the repository's markdown points, before the site decides its URL. */
export type Href =
  | { kind: 'url' }
  | { kind: 'anchor'; hash: string }
  | { kind: 'path'; path: string; hash: string }
  | { kind: 'outside' };

/** A link in the markdown file `from` (a repository path such as `docs/ci.md`): an address, an
 *  anchor on the same page, or a repository path resolved as GitHub resolves it (`/x` from the
 *  root, anything else from the file's directory). */
export function classify(from: string, href: string): Href {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'url' };
  const at = href.indexOf('#');
  const target = at < 0 ? href : href.slice(0, at);
  const hash = at < 0 ? '' : decodeURIComponent(href.slice(at + 1));
  if (target === '') return { kind: 'anchor', hash };
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') {
      // `from` may itself climb out of the site's folder (`../docs/x.md`); no further than it.
      if (parts.length === 0 || parts.at(-1) === '..') return { kind: 'outside' };
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(decodeURIComponent(part));
    }
  }
  return { kind: 'path', path: parts.join('/'), hash };
}

/** GitHub's heading ids (github-slugger): lowercased, every punctuation mark but `-` and `_`
 *  dropped, spaces to `-`, a repeat numbered. The anchors the docs use on GitHub work here too. */
export function slugger(): (heading: string) => string {
  const seen = new Map<string, number>();
  return (heading) => {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    let id = base;
    while (seen.has(id)) {
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      id = `${base}-${count}`;
    }
    seen.set(id, 0);
    return id;
  };
}
