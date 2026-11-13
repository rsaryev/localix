import { DOCS } from '@/shared/config';
import { Search as SearchIcon } from '@/shared/ui';

/** Where the build writes what the search reads: every section of every page, as text. */
export const SEARCH_INDEX = `${DOCS}/search.json`;

/** What opens the search, in the bar. Hidden until the page's script is there to answer it. */
export function SearchButton() {
  return (
    <button type="button" className="search-open" data-search-open hidden aria-keyshortcuts="Meta+K Control+K">
      <SearchIcon />
      <span className="search-open-label">Search</span>
      <kbd data-search-key>Ctrl K</kbd>
    </button>
  );
}

/** The search itself: a field over its results, a dialog of the browser's own, so focus is kept
 *  inside it and Esc closes it. The page's script fills the results. */
export function SearchDialog() {
  return (
    <dialog className="search" data-index={SEARCH_INDEX} aria-label="Search the docs">
      <form method="dialog" className="search-field">
        <SearchIcon />
        <input
          type="search"
          name="q"
          placeholder="Search the docs"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-label="Search the docs"
        />
        <button type="submit" className="search-close" formNoValidate>
          Esc
        </button>
      </form>
      <ul id="search-results" className="search-results" role="listbox" aria-label="Results" />
      <p className="search-status" role="status" />
    </dialog>
  );
}
