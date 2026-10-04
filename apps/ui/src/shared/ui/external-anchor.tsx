import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from 'react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'

export type ExternalAnchorProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'href' | 'target' | 'rel' | 'download'
> & {
  /** A validated http(s), mailto or tel destination owned by the caller. */
  href: string
  /** Show new-tab semantics to browser users; the desktop host still owns activation. */
  newTab?: boolean
}

/**
 * A real external anchor whose activation is routed through the platform host.
 * Keeping `href` preserves link semantics, copy-link and the browser status bar;
 * intercepting activation avoids dead `_blank` links in desktop webviews.
 */
export const ExternalAnchor = forwardRef<HTMLAnchorElement, ExternalAnchorProps>(
  ({ href, newTab = true, onClick, onAuxClick, ...props }, ref) => {
    const open = () => platformCapabilities().external.open(href)
    /**
     * STOPS PROPAGATION as well as the default.
     *
     * `tauri-plugin-shell` injects a click listener on `document.body` that fires
     * for any `<a target="_blank">` with an http/https/mailto/tel href and calls
     * `plugin:shell|open` — and, unlike the opener plugin's equivalent, it does
     * NOT check `defaultPrevented`. That command is deliberately absent from this
     * app's capabilities (the shell plugin is registered only so Rust can run the
     * Bun sidecar), so every external link raised a denied invoke and an
     * unhandled rejection — "shell.open not allowed" — on top of the open we had
     * already performed. React listens at the root container, which is INSIDE
     * body, so not letting the event travel further is what keeps that shim out
     * of a click this component has fully handled.
     */
    const handled = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      event.stopPropagation()
      open()
    }
    const activate = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      handled(event)
    }
    const activateAux = (event: MouseEvent<HTMLAnchorElement>) => {
      onAuxClick?.(event)
      if (event.defaultPrevented || event.button !== 1) return
      handled(event)
    }

    return (
      <a
        ref={ref}
        data-slot="external-anchor"
        href={href}
        target={newTab ? '_blank' : undefined}
        rel={newTab ? 'noopener noreferrer' : undefined}
        onClick={activate}
        onAuxClick={activateAux}
        {...props}
      />
    )
  },
)
ExternalAnchor.displayName = 'ExternalAnchor'
