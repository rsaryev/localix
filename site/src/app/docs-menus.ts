// The reading bar of a docs page: its menus put under what opens them and walked with the arrows,
// the path kept scrolled to the page it ends at, the text's size, and the way back.

for (const menu of document.querySelectorAll<HTMLElement>('.menu[popover]')) {
  const opener = document.querySelector<HTMLElement>(`[popovertarget="${menu.id}"]`);
  if (!opener) continue;
  const filter = menu.querySelector<HTMLInputElement>('input');
  const rows = () => [...menu.querySelectorAll<HTMLElement>('li:not([hidden]) > :is(a, button)')];

  menu.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState !== 'open') return;
    const box = opener.getBoundingClientRect();
    const left = menu.classList.contains('menu-end') ? box.right - menu.offsetWidth : box.left;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${box.bottom + 6}px`;
    if (filter) {
      filter.value = '';
      filter.dispatchEvent(new Event('input'));
      filter.focus();
    } else {
      (menu.querySelector<HTMLElement>('[aria-current], [aria-checked="true"]') ?? rows()[0])?.focus({ preventScroll: true });
    }
  });
  menu.addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLElement);
    (all[(at + step + all.length) % all.length] ?? all[0])?.focus();
  });
  filter?.addEventListener('input', () => {
    const words = filter.value.trim().toLowerCase();
    for (const row of menu.querySelectorAll<HTMLElement>('li')) row.hidden = !row.textContent?.toLowerCase().includes(words);
  });
  filter?.addEventListener('keydown', (event) => event.key === 'Enter' && rows()[0]?.click());
}
// A menu is fixed where it opened: once the page moves under it, it is no longer under its step.
window.addEventListener('scroll', () => document.querySelector<HTMLElement>('.menu:popover-open')?.hidePopover(), { passive: true });

// The path ends at the page: on a phone that end is what shows, the start a swipe away, and an
// edge fades only where more of the path is hidden behind it.
const rail = document.querySelector<HTMLElement>('.crumbs');
if (rail) {
  const edges = () => {
    rail.toggleAttribute('data-more-left', rail.scrollLeft > 1);
    rail.toggleAttribute('data-more-right', rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 1);
  };
  const reveal = () => {
    rail.scrollLeft = rail.scrollWidth;
    edges();
  };
  rail.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(reveal).observe(rail);
  reveal();
}

// The text's size: one of three, kept from page to page.
const SIZES = ['', 'large', 'larger'];
const KEY = 'docs-size';
const sized = (size: string) => {
  if (size) document.documentElement.dataset.size = size;
  else delete document.documentElement.dataset.size;
  for (const row of document.querySelectorAll<HTMLElement>('[data-size]')) row.setAttribute('aria-checked', String(row.dataset.size === size));
};
try {
  const kept = localStorage.getItem(KEY) ?? '';
  if (SIZES.includes(kept)) sized(kept);
} catch {
  // A private window keeps nothing: the size holds for this page.
}
for (const opener of document.querySelectorAll<HTMLElement>('[data-size-open]')) opener.hidden = false;
for (const row of document.querySelectorAll<HTMLElement>('[data-size]')) {
  row.addEventListener('click', () => {
    const size = row.dataset.size ?? '';
    sized(size);
    try {
      localStorage.setItem(KEY, size);
    } catch {
      // As above.
    }
    row.closest<HTMLElement>('[popover]')?.hidePopover();
  });
}

// Back is where the reader came from when that was this site, else the link's own address.
for (const back of document.querySelectorAll<HTMLAnchorElement>('[data-back]')) {
  back.addEventListener('click', (event) => {
    if (!document.referrer.startsWith(location.origin) || history.length < 2) return;
    event.preventDefault();
    history.back();
  });
}
