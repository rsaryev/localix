import { createElement } from 'react'
import { Braces, ExternalLink, FileText, Globe2 } from 'lucide-react'
import type { AgentSource } from '@localixai/agent/agents'

import { canNavigateUi, navigateUi, type UiNavigationHost } from '@/shared/lib/uiNavigation'
import { refKindIcon } from '../refKindPresentation'
import { ExternalAnchor } from '@/shared/ui/external-anchor'

/**
 * ONE provenance row, used in the unified Activity inspector.
 *
 * Extracted rather than copied because the two surfaces must agree on what is clickable: a web
 * source opens in a new tab, an application URI opens IN the workbench (`canNavigateUi` resolves
 * `localix://ui/work-item/file` and `.../chat`), and anything else renders inert rather than
 * pretending to be a link.
 */
export function httpHref(uri: string): string | undefined {
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function sourceDomain(source: AgentSource): string {
  const href = httpHref(source.uri)
  if (!href) return source.provider ?? source.kind
  return new URL(href).hostname.replace(/^www\./, '')
}

/**
 * Kinds the shared ref vocabulary has no glyph for. Everything else defers to `refKindIcon`, which
 * already owns `file`, `session`, `message` and `resource` and falls back to the file glyph.
 */
const SOURCE_ONLY_ICONS: Record<string, typeof Globe2> = {
  document: FileText,
  symbol: Braces,
}

/**
 * The row's glyph.
 *
 * Scheme first, kind second: an http(s) source is a page on the web whatever its kind says, and the
 * research tool publishes five different kinds (`web`, `academic`, `code`, `community`,
 * `encyclopedia`) that are all exactly that. Everything else is an application resource, so
 * rendering one identical link glyph for all of them would throw away a useful distinction.
 *
 * `refKindIcon` rather than a second map: it is the repository's kind→glyph registry, it takes an
 * open string, and it already falls back sensibly. Only the two kinds it has never needed —
 * `document` and `symbol`, which belong to provenance and not to context refs — are added here.
 */
export function sourceIcon(source: AgentSource, href: string | undefined): typeof Globe2 {
  if (href) return Globe2
  return SOURCE_ONLY_ICONS[source.kind] ?? refKindIcon(source.kind)
}

export function SourceRow({
  source,
  navigation,
  onNavigate,
}: {
  source: AgentSource
  navigation: UiNavigationHost
  onNavigate?: () => void
}) {
  const href = httpHref(source.uri)
  const internal = !href && canNavigateUi(source.uri)
  const sourceGlyph = sourceIcon(source, href)
  const domain = sourceDomain(source)
  const badge =
    source.status === 'failed'
      ? { label: 'Failed', className: 'text-status-error' }
      : source.role === 'discovered'
        ? { label: 'Found', className: 'text-status-warning' }
        : source.role === 'cited'
          ? { label: 'Cited', className: 'text-status-info' }
          : null
  const body = (
    <>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-text-faint">
        {createElement(sourceGlyph, { className: 'size-3.5' })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-text-strong">{source.title}</span>
          {badge ? (
            <span className={`shrink-0 text-2xs font-medium ${badge.className}`}>
              {badge.label}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-2xs text-text-faint">
          {domain}
          {source.provider && source.provider !== domain ? ` · ${source.provider}` : ''}
        </span>
        {source.snippet ? (
          <span className="mt-0.5 line-clamp-2 block text-2xs leading-relaxed text-text-soft">
            {source.snippet}
          </span>
        ) : null}
      </span>
      {href ? (
        <ExternalLink className="mt-1 size-3 shrink-0 text-text-faint opacity-60 transition-opacity group-hover/source:opacity-100" />
      ) : null}
    </>
  )

  const baseClassName =
    'group/source flex w-full min-w-0 gap-2.5 rounded-lg px-1.5 py-2.5 text-left'
  const interactiveClassName =
    `${baseClassName} cursor-pointer transition-colors hover:bg-surface-hover active:bg-surface-active ` +
    'outline-none focus-ring'
  return href ? (
    <ExternalAnchor href={href} className={interactiveClassName}>
      {body}
    </ExternalAnchor>
  ) : internal ? (
    <button
      type="button"
      className={interactiveClassName}
      onClick={() => {
        if (navigateUi(source.uri, navigation)) onNavigate?.()
      }}
    >
      {body}
    </button>
  ) : (
    <div className={baseClassName}>{body}</div>
  )
}
