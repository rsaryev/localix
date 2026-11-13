// The docs' search, loaded the first time it is opened: the index is every section of every page
// as text, fetched once; a query's words must all be in a section, and one found in a heading or
// a title counts for more than one in the text.

type Row = { u: string; p: string; g: string; h: string; x: string };
const MOST = 12;

/** The rows that have every word, best first; with no words, the pages themselves. */
function find(rows: Row[], words: string[]): Row[] {
  if (words.length === 0) return rows.filter((row) => row.h === '');
  const scored: { row: Row; score: number }[] = [];
  for (const row of rows) {
    const [title, head, text] = [row.p.toLowerCase(), row.h.toLowerCase(), row.x.toLowerCase()];
    let score = 0;
    for (const word of words) {
      const here = (head || title).includes(word) ? 6 : title.includes(word) ? 2 : text.includes(word) ? 1 : 0;
      if (here === 0) {
        score = 0;
        break;
      }
      score += here;
    }
    // A page's opening stands for the page: it goes before that page's sections.
    if (score > 0) scored.push({ row, score: score + (row.h === '' ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MOST).map(({ row }) => row);
}

/** `text` into `node`, each word of the query marked. */
function marked(node: HTMLElement, text: string, words: string[]) {
  const pattern = words.length > 0 ? new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  for (const [index, part] of (pattern ? text.split(pattern) : [text]).entries()) {
    if (index % 2 === 1) node.append(Object.assign(document.createElement('mark'), { textContent: part }));
    else node.append(part);
  }
}

/** The text around the first word found, so the result shows why it is one. */
function around(text: string, words: string[]): string {
  const at = Math.min(...words.map((word) => text.toLowerCase().indexOf(word)).filter((index) => index >= 0), text.length);
  const from = at === text.length || at < 60 ? 0 : text.indexOf(' ', at - 50) + 1;
  return `${from > 0 ? '…' : ''}${text.slice(from, from + 160)}`;
}

/** Makes `dialog` a search: what is typed is found as it is typed, the arrows move through the
 *  results, Enter opens the one marked. */
export async function attach(dialog: HTMLDialogElement) {
  const input = dialog.querySelector<HTMLInputElement>('input');
  const list = dialog.querySelector<HTMLElement>('.search-results');
  const status = dialog.querySelector<HTMLElement>('.search-status');
  if (!input || !list || !status) return;
  let rows: Row[] = [];
  let at = 0;

  const mark = (next: number) => {
    const items = [...list.children];
    at = items.length === 0 ? 0 : (next + items.length) % items.length;
    items.forEach((item, index) => item.setAttribute('aria-selected', String(index === at)));
    const current = items[at];
    if (current) input.setAttribute('aria-activedescendant', current.id);
    else input.removeAttribute('aria-activedescendant');
    current?.querySelector('a')?.scrollIntoView({ block: 'nearest' });
  };
  const draw = () => {
    const query = input.value.trim();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = find(rows, words);
    list.replaceChildren(
      ...found.map((row, index) => {
        const link = Object.assign(document.createElement('a'), { href: row.u });
        const piece = (name: string) => link.appendChild(Object.assign(document.createElement('span'), { className: name }));
        piece('search-where').textContent = row.h ? `${row.g} / ${row.p}` : row.g;
        marked(piece('search-title'), row.h || row.p, words);
        if (row.x) marked(piece('search-text'), around(row.x, words), words);
        const item = Object.assign(document.createElement('li'), { id: `search-result-${index}` });
        item.setAttribute('role', 'option');
        item.append(link);
        return item;
      }),
    );
    status.textContent = found.length > 0 ? '↑↓ to move · ↵ to open · esc to close' : `Nothing found for “${query}”.`;
    mark(0);
  };

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      mark(at + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      // The form's own submit would close the dialog and go nowhere.
      event.preventDefault();
      list.children[at]?.querySelector('a')?.click();
    }
  });
  list.addEventListener('pointermove', (event) => {
    const item = (event.target as Element).closest('li');
    if (item && item.getAttribute('aria-selected') !== 'true') mark([...list.children].indexOf(item));
  });
  // A result on this page only moves the page, so the dialog must get out of its way; one on
  // another page leaves with the dialog as it is, which the browser's cross-fade needs unchanged.
  list.addEventListener('click', (event) => {
    const link = (event.target as Element).closest('a');
    if (link && link.pathname === location.pathname) dialog.close();
  });
  dialog.addEventListener('click', (event) => event.target === dialog && dialog.close());
  dialog.addEventListener('close', () => {
    input.value = '';
    draw();
  });

  status.textContent = 'Loading…';
  try {
    const response = await fetch(dialog.dataset.index ?? '');
    if (!response.ok) throw new Error(String(response.status));
    rows = (await response.json()) as Row[];
    draw();
  } catch {
    status.textContent = 'The search could not be loaded. The pages are listed in the menu.';
  }
}
