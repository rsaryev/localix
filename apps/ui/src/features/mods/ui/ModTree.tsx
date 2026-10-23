import { useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { ModClient } from './ModClient'

/**
 * A mod's drawing on a Localix screen. The elements are Claude Code's (`Box`, `Text`, `Button`,
 * `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg`, `Client`); each is drawn with the kit's own
 * control, so a mod looks like the rest of the app; a `Client` runs plugin code, in an isolated
 * frame. Spacing in terminal cells (or a step name) becomes a step of the app's spacing; colours a
 * terminal names are left to the theme.
 */

const STEP_PX: Record<string, number> = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 }
const space = (value: unknown): string | undefined =>
  typeof value === 'number'
    ? `${value * 4}px`
    : typeof value === 'string'
      ? `${STEP_PX[value] ?? 0}px`
      : undefined

/** A prop as text: what a mod passes as a string or number, never an object's `[object Object]`. */
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback

/** A link a mod draws opens only on the web or in mail, never as script; any other is text. */
const safeHref = (value: unknown): string | undefined => {
  const href = text(value)
  return /^(https?:|mailto:)/i.test(href) ? href : undefined
}

function boxStyle(props: Record<string, unknown>): CSSProperties {
  return {
    display: 'flex',
    flexDirection: props.flexDirection === 'column' ? 'column' : 'row',
    flexWrap: props.flexWrap === 'wrap' ? 'wrap' : undefined,
    alignItems: typeof props.alignItems === 'string' ? props.alignItems : undefined,
    justifyContent: typeof props.justifyContent === 'string' ? props.justifyContent : undefined,
    gap: space(props.gap),
    rowGap: space(props.rowGap),
    columnGap: space(props.columnGap),
    padding: space(props.padding),
    paddingInline: space(props.paddingX),
    paddingBlock: space(props.paddingY),
    margin: space(props.margin),
    flexGrow: typeof props.flexGrow === 'number' ? props.flexGrow : undefined,
  }
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
  if (typeof node === 'string') return node
  const { props } = node
  const children = <ModTree nodes={node.children} act={act} />
  switch (node.type) {
    case 'Box':
      return (
        <div
          style={boxStyle(props)}
          className={cn(props.borderStyle !== undefined && 'rounded-md border border-border')}
        >
          {children}
        </div>
      )
    case 'Text':
      return (
        <span
          className={cn(
            (props.bold === true || props.weight === 'semibold' || props.weight === 'bold') &&
              'font-semibold',
            props.weight === 'medium' && 'font-medium',
            props.italic === true && 'italic',
            props.underline === true && 'underline',
            props.dimColor === true && 'text-text-soft',
            props.mono === true && 'font-mono',
            props.tabular === true && 'tabular-nums',
          )}
        >
          {children}
        </span>
      )
    case 'Button':
      return (
        <Button
          size="sm"
          variant={props.plain === true ? 'ghost' : 'secondary'}
          onClick={() => act({ kind: 'press', element: text(props.key) })}
        >
          {text(props.label)}
        </Button>
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
        <pre className="overflow-x-auto rounded-md bg-field-fill p-2 font-mono text-xs">
          {text(props.source)}
        </pre>
      )
    case 'Markdown':
      return <MarkdownRenderer>{text(props.text)}</MarkdownRenderer>
    case 'Svg':
      return <ModSvg props={props} />
    case 'Client':
      return <ModClient element={node} />
    case 'Input':
      return <ModInput element={text(props.key)} props={props} act={act} />
    case 'Select':
      return (
        <Select
          value={text(props.value)}
          onValueChange={(value) => act({ kind: 'select', element: text(props.key), value })}
          options={optionsOf(props.options)}
        />
      )
  }
}

function optionsOf(value: unknown): { value: string; label: string }[] {
  if (!Array.isArray(value)) return []
  return value.map((option) =>
    typeof option === 'string'
      ? { value: option, label: option }
      : {
          value: text((option as { value?: unknown }).value),
          label: text(
            (option as { label?: unknown }).label,
            text((option as { value?: unknown }).value),
          ),
        },
  )
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

/** Typing stays on screen; Enter submits it, and leaving the field sends what was typed. */
function ModInput(input: {
  element: string
  props: Record<string, unknown>
  act: ModTreeProps['act']
}) {
  const [value, setValue] = useState(text(input.props.value))
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        input.act({ kind: 'submit', element: input.element, value })
      }}
    >
      <Input
        aria-label={text(input.props.label, input.element)}
        placeholder={
          typeof input.props.placeholder === 'string' ? input.props.placeholder : undefined
        }
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => input.act({ kind: 'input', element: input.element, value })}
      />
      {typeof input.props.submitLabel === 'string' && (
        <Button size="sm" type="submit">
          {input.props.submitLabel}
        </Button>
      )}
    </form>
  )
}
