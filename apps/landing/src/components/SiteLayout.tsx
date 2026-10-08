import { useEffect, useRef, type ReactNode } from 'react'
import { Outlet, Link, useLocation } from 'react-router'
import { PAGE_SHELL } from '../lib/shell'
import { Button } from './Button'
import { SiteHeader } from './SiteHeader'

export function SiteLayout({ children }: { children?: ReactNode }) {
  const location = useLocation()
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
    <div className="min-h-screen bg-background text-foreground antialiased">
      <a
        href="#main-content"
        className="focus-ring fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-soft)] transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" ref={mainRef} tabIndex={-1} className="outline-none">
        {children ?? <Outlet />}
      </main>

      <footer className="site-footer border-t border-border-subtle">
        <div
          className={`${PAGE_SHELL} flex flex-col items-center justify-between gap-4 py-10 text-sm text-text-faint sm:flex-row`}
        >
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="size-5 opacity-80" />
            <span>Localix</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/docs" className="hover:text-foreground">
              Docs
            </Link>
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
          </div>
        </div>
      </footer>
    </div>
  )
}
