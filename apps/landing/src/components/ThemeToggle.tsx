import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The key the inline script in `index.html` reads before the first paint. */
const THEME_KEY = 'localix-theme'

function toggleTheme() {
  const root = document.documentElement
  const next = root.dataset.theme === 'light' ? 'dark' : 'light'
  root.dataset.theme = next
  root.style.colorScheme = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // Storage can be blocked; the choice then lasts until the page closes.
  }
}

/**
 * Both icons always render and CSS shows the one for the current theme. The theme is only known
 * in the browser, so choosing an icon in React would make the prerendered markup differ from the
 * hydrated one — the flash this page was reworked to remove.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      className={cn(
        'focus-ring inline-flex size-9 items-center justify-center rounded-md border border-border-subtle bg-card text-text-soft transition-colors hover:text-foreground',
        className,
      )}
    >
      <Sun aria-hidden className="hidden size-4 dark:block" />
      <Moon aria-hidden className="size-4 dark:hidden" />
    </button>
  )
}
