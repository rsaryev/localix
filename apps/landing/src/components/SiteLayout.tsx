import { useEffect, useRef, type ReactNode } from 'react'
import { Outlet, Link, useLocation } from 'react-router'
import { HOME_SHELL, PAGE_SHELL } from '../lib/shell'
import { Button } from './Button'
import { SiteHeader } from './SiteHeader'
import { REPOSITORY_URL } from '../lib/site'

const FOOTER_LINKS = [
  { label: 'GitHub', href: REPOSITORY_URL },
  { label: 'Changelog', href: `${REPOSITORY_URL}/blob/main/CHANGELOG.md` },
  { label: 'Security', href: `${REPOSITORY_URL}/blob/main/SECURITY.md` },
]

export function SiteLayout({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const isDocsRoute = location.pathname.startsWith('/docs')
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(location.pathname)

  useEffect(() => {
    if (location.hash) {
      const frame = requestAnimationFrame(() => {
        const target = document.getElementById(location.hash.slice(1))
        if (!target) return
        target.tabIndex = -1
        target.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'start' })
      })
      previousPath.current = location.pathname
      return () => cancelAnimationFrame(frame)
    }
    if (previousPath.current === location.pathname) return
    previousPath.current = location.pathname
    window.scrollTo({ top: 0 })
    mainRef.current?.focus()
  }, [location.hash, location.pathname])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
      <a
        href="#main-content"
        className="focus-ring fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-soft)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
        {children ?? <Outlet />}
      </main>

      <footer
        className={`site-footer${isDocsRoute ? ' docs-site-footer border-t border-border-subtle' : ''}`}
      >
        <div
          className={`${isDocsRoute ? PAGE_SHELL : HOME_SHELL} flex flex-wrap items-center justify-between gap-4 pt-7 pb-10 text-[0.8125rem] text-text-faint`}
        >
          <p className="m-0">
            <span className="text-text-soft">Localix</span> is MIT-licensed and open source.
          </p>
          <nav aria-label="Footer" className="site-footer-nav flex items-center gap-5">
            <Link to="/docs" className="hover:text-foreground">
              Docs
            </Link>
            {FOOTER_LINKS.map(({ label, href }) => (
              <a key={label} href={href} className="hover:text-foreground">
                {label}
              </a>
            ))}
            {isDocsRoute && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                  mainRef.current?.focus({ preventScroll: true })
                  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
                }}
              >
                Back to top
              </Button>
            )}
          </nav>
        </div>
      </footer>
    </div>
  )
}
