import { useContext, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { ModClient } from './ModClient'
import { ModButton, ModInput, ModSelect, text } from './ModControls'
import { boxLook, DENSITY, ModSiteContext, textLook } from './modStyle'

/**
 * A mod's drawing on a Localix screen. The elements are Claude Code's (`Box`, `Text`, `Button`,
 * `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg`, `Client`); each is drawn with the kit's own
 * control, so a mod looks like the rest of the app; a `Client` runs plugin code, in an isolated
 * frame. Layout and text props read as `modStyle.ts` says, at the density of the site the tree is
 * drawn on (`ModSite`); controls are `ModControls.tsx`.
 */

const FRAME = {
  hairline: 'rounded-md border border-border-faint',
  strong: 'rounded-md border border-border-soft',
  quote: 'border-l-2 border-border-soft pl-2',
} as const

/** A link a mod draws opens only on the web or in mail, never as script; any other is text. */
const safeHref = (value: unknown): string | undefined => {
  const href = text(value)
  return /^(https?:|mailto:)/i.test(href) ? href : undefined
}

export interface ModTreeProps {
  nodes: Array<ModElement | string>
  act: (action: ModAction) => void
}

export function ModTree({ nodes, act }: ModTreeProps): ReactNode {
  // A Client keeps its instance by its key, wherever its siblings change.
  return nodes.map((node, index) => (
    <ModNode
      key={
        typeof node !== 'string' && node.type === 'Client'
          ? `client:${text(node.props.key)}`
          : index
      }
      node={node}
      act={act}
    />
  ))
}

function ModNode({ node, act }: { node: ModElement | string; act: ModTreeProps['act'] }) {
  const site = useContext(ModSiteContext)
  if (typeof node === 'string') return node
  const { props } = node
  const children = <ModTree nodes={node.children} act={act} />
  switch (node.type) {
    case 'Box': {
      const look = boxLook(props, site)
      return (
        <div style={look.style} className={cn(look.framed && FRAME[look.framed])}>
          {children}
        </div>
      )
    }
    case 'Text': {
      const look = textLook(props, site)
      return (
        <span
          className={cn(
            look.tier && DENSITY[site].tiers[look.tier],
            look.weight === 'medium' && 'font-medium',
            look.weight === 'semibold' && 'font-semibold',
            look.tone === 'soft' && 'text-text-soft',
            look.italic && 'italic',
            look.underline && 'underline',
            look.strikethrough && 'line-through',
            look.mono && 'font-mono',
            look.tabular && 'tabular-nums',
            look.chip && 'rounded-xs px-1',
            look.truncate && 'overflow-hidden text-ellipsis',
          )}
          style={look.style}
        >
          {children}
        </span>
      )
    }
    case 'Button':
      return (
        <ModButton props={props} hasChildren={node.children.length > 0} act={act}>
          {children}
        </ModButton>
      )
    case 'Link': {
      const href = safeHref(props.href)
      const label = text(props.label, text(props.href))
      return href ? (
        <ExternalAnchor className="underline" href={href}>
          {label}
        </ExternalAnchor>
      ) : (
        <span>{label}</span>
      )
    }
    case 'Code':
      return (
        <pre
          className={cn(
            'overflow-x-auto rounded-sm bg-field-fill font-mono',
            site === 'band' ? 'px-1.5 py-1 text-2xs' : 'p-2 text-xs',
          )}
        >
          {text(props.source)}
        </pre>
      )
    case 'Markdown':
      return (
        <div className={cn(DENSITY[site].tiers.text, props.dimColor === true && 'text-text-soft')}>
          <MarkdownRenderer>{text(props.text)}</MarkdownRenderer>
        </div>
      )
    case 'Svg':
      return <ModSvg props={props} />
    case 'Client':
      return <ModClient element={node} />
    case 'Input':
      return <ModInput element={text(props.key)} props={props} act={act} />
    case 'Select':
      return <ModSelect props={props} act={act} />
  }
}

/**
 * An SVG as Claude Code draws it on the desktop: an image, which runs no script; interactive, a
 * frame with no permissions at all, so hover styles and SMIL work and still no script runs.
 */
function ModSvg({ props }: { props: Record<string, unknown> }) {
  const source = text(props.source)
  const size = {
    width: typeof props.width === 'number' ? props.width : undefined,
    height: typeof props.height === 'number' ? props.height : undefined,
  }
  if (props.isInteractive === true)
    return (
      <iframe title={text(props.alt)} sandbox="" srcDoc={source} {...size} className="border-0" />
    )
  return (
    <img
      alt={text(props.alt)}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`}
      {...size}
      className="max-w-full"
    />
  )
}
