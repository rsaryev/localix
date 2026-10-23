import { memo, useMemo } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, TriangleAlert } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import {
  Handle,
  HIDDEN_HANDLE,
  Position,
  useZoomBelow,
  type Node,
  type NodeProps,
} from '@localixai/kit/canvas'
import { CODE_VIEWER_HIGHLIGHT, highlightCode } from '@localixai/kit/code-block'
import { IconButton } from '@localixai/kit/icon-button'
import { TextAction } from '@localixai/kit/text-action'
import type { CodeCard } from '../../shared/lens'
import { KIND_ICON, KIND_TINT } from '../kinds'
import { CodeLinks } from './CodeLinks'
import { CARD, gutterCells, IN_HANDLE, lineHandle, lineY } from './geometry'

/**
 * One declaration on the board: its code as the file says it now, highlighted with the host's own
 * file-viewer palette, and every name the graph resolved made a link (`CodeLinks`). Following a
 * link opens its definition as the next card; the header's outline — file › class › member —
 * climbs back out: the file to its place on the map, an enclosing class to its own card.
 *
 * Far away the code is unreadable anyway, so the card shows its name large instead — semantic
 * zoom: the same box answers "what is this" from afar and "what does it do" up close.
 */
export interface CodeCardData extends Record<string, unknown> {
  card: CodeCard
  index: number
  /** The symbol the next card shows, if any: its link is drawn as the active one. */
  next: string | null
  onFollow: (from: number, id: string) => void
  onOpenFile: (card: CodeCard) => void
  /** Show the card's file on the map, the symbol selected. */
  onReveal: (fileId: string, symbolId: string) => void
}

const FAR_ZOOM = 0.45

function CodeCardNodeImpl({ data }: NodeProps<Node<CodeCardData>>) {
  const { card, index, next, onFollow, onOpenFile, onReveal } = data
  const far = useZoomBelow(FAR_ZOOM)
  const { copied, copy } = useCopied()
  const source = useMemo(() => card.lines.join('\n'), [card.lines])
  const html = useMemo(() => highlightCode(source, card.language), [source, card.language])
  const gutter = gutterCells(card)
  // Any line holding a link can be where the edge to the next card leaves from.
  const linkLines = [...new Set(card.links.map((link) => link.line))]
  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-border-soft bg-card shadow-(--shadow-raised)">
      <Handle
        id={IN_HANDLE}
        type="target"
        position={Position.Left}
        className={HIDDEN_HANDLE}
        style={{ top: CARD.header / 2 }}
      />
      {linkLines.map((line) => (
        <Handle
          key={line}
          id={lineHandle(line)}
          type="source"
          position={Position.Right}
          className={HIDDEN_HANDLE}
          style={{ top: lineY(card, line) }}
        />
      ))}
      <header
        className="flex items-center gap-2 border-b border-border-faint px-3"
        style={{ height: CARD.header }}
      >
        <Outline
          card={card}
          onFile={(file) => onReveal(file, card.node.id)}
          onSymbol={(id) => onFollow(index - 1, id)}
        />
        {card.stale && (
          <span
            className="flex shrink-0 items-center gap-1 text-3xs text-status-warning"
            title="The file changed since it was indexed; links may point at moved lines until the map refreshes."
          >
            <TriangleAlert aria-hidden className="size-3" /> changed
          </span>
        )}
        <IconButton
          aria-label={copied ? 'Copied code' : 'Copy code'}
          tooltip={copied ? 'Copied code' : 'Copy code'}
          size="xs"
          className="nodrag nopan ml-auto"
          onClick={() => void copy(source)}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </IconButton>
        <IconButton
          aria-label="Open in the editor"
          tooltip="Open in the editor"
          size="xs"
          className="nodrag nopan"
          onClick={() => onOpenFile(card)}
        >
          <ExternalLink className="size-3" />
        </IconButton>
      </header>
      <div
        // Canvas navigation otherwise captures a drag as panning and nodes inherit user-select:
        // none. The source owns native text selection; the gutter and link overlays stay inert.
        className="nodrag nopan relative select-text font-mono text-2xs"
        style={{
          paddingTop: CARD.padY,
          paddingBottom: CARD.padY,
          // Token links use character cells. Ligatures turn !== and => into a single glyph and
          // make both the source and link hit area look displaced in fonts that enable them.
          fontFeatureSettings: '"liga" 0, "calt" 0',
          fontVariantLigatures: 'none',
        }}
      >
        <div className="flex">
          <div
            aria-hidden
            className="shrink-0 select-none pl-2 pr-3 text-right text-text-faint/70"
            style={{ width: `${gutter}ch`, lineHeight: `${CARD.line}px` }}
          >
            {card.lines.map((_line, row) => (
              <div key={row}>{card.startLine + row}</div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <pre
              className={cn(
                'm-0 select-text whitespace-pre bg-transparent p-0 font-mono',
                CODE_VIEWER_HIGHLIGHT,
              )}
              style={{ lineHeight: `${CARD.line}px` }}
              // highlightCode escapes the source before it adds its token spans.
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <CodeLinks card={card} next={next} onOpen={(id) => onFollow(index, id)} />
          </div>
        </div>
        {card.truncated && (
          <div
            className="flex items-center px-3 text-3xs text-text-faint"
            style={{ height: CARD.footer }}
          >
            The rest is in the editor.
          </div>
        )}
        {far && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/90 px-6">
            <span className="truncate text-2xl font-semibold text-foreground">
              {card.node.name}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The card's breadcrumb: its file (back to the map), each enclosing symbol (its own card), then
 * the symbol itself with its kind icon. The path to the file stays in the tooltip — on the card,
 * the file name is what orients; the directories are the toolbar's job.
 */
function Outline({
  card,
  onFile,
  onSymbol,
}: {
  card: CodeCard
  onFile: (fileId: string) => void
  onSymbol: (id: string) => void
}) {
  return (
    <nav
      aria-label="Where this is"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs"
    >
      {card.outline.map((crumb, position) => {
        const last = position === card.outline.length - 1
        const Icon = crumb.kind ? KIND_ICON[crumb.kind] : null
        const tint = crumb.kind ? KIND_TINT[crumb.kind] : ''
        return (
          <span
            key={crumb.id}
            className={cn('flex min-w-0 items-center gap-1', last ? 'shrink-0' : 'shrink')}
          >
            {position > 0 && (
              <ChevronRight aria-hidden className="size-3 shrink-0 text-text-faint" />
            )}
            {Icon && <Icon aria-hidden className={cn('size-3.5 shrink-0', tint)} />}
            {last ? (
              <span className="truncate font-medium text-foreground">{crumb.name}</span>
            ) : (
              <TextAction
                className="nodrag truncate rounded-sm text-text-soft hover:text-foreground"
                tooltip={
                  crumb.kind === 'file'
                    ? `${card.node.path}:${card.startLine} — show on the map`
                    : `Open ${crumb.name}`
                }
                onClick={() => (crumb.kind === 'file' ? onFile(crumb.id) : onSymbol(crumb.id))}
              >
                {crumb.name}
              </TextAction>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export const CodeCardNode = memo(CodeCardNodeImpl)
