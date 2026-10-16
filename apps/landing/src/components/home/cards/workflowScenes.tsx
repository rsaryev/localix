import type { CSSProperties, ReactNode } from 'react'
import {
  AppWindow,
  ArrowUp,
  Check,
  Crosshair,
  FileCode2,
  GitCompareArrows,
  MessageSquare,
  MousePointer2,
  Puzzle,
  SquareKanban,
  SquareTerminal,
  X,
} from 'lucide-react'
import { AgentHeader, Window } from './chrome'
import { Code } from './highlight'
import { useFlight } from './useFlight'

const order = (i: number) => ({ '--i': i }) as CSSProperties

/** A chip that arcs from the scene's `[data-fly-from]` anchor into this slot. */
function FlyingChip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`k-slot ${className}`} data-fly-to>
      <span className="sc-fly-x">
        <span className="sc-fly-y">
          <span className="k-chip sc-fly-chip">{children}</span>
        </span>
      </span>
    </span>
  )
}

const checklist = [
  { title: 'Review the changes', owner: '@frontend' },
  { title: 'Check the release states', owner: '@qa' },
  { title: 'Write the release notes', owner: '@lead' },
]

/** The request builds in chat; the plugin opens in its own tab, renders, and its first check
 * moves the release progress. */
export function PluginScene() {
  return (
    <Window
      className="sc-plugin"
      tabs={[
        { icon: Puzzle, label: 'Release checklist', active: true, className: 'sc-plugin-tab' },
        { icon: MessageSquare, label: 'Release plan', className: 'sc-plugin-session-tab' },
      ]}
    >
      <div className="sc-workbench sc-plugin-split">
        <div className="sc-plugin-view">
          <span className="sc-plugin-kicker">Release</span>
          <div className="sc-plugin-progress">
            <b>Workspace update v1.4</b>
            <span className="k-swap">
              <span>0 of 3</span>
              <span>1 of 3</span>
            </span>
            <i>
              <i />
            </i>
          </div>
          {checklist.map((item, i) => (
            <div key={item.title} className="sc-plugin-row" style={order(i)}>
              <span className="sc-skeleton" />
              <span className="sc-real">
                <span className={i === 0 ? 'k-check sc-tick' : 'k-check'}>
                  <Check className="size-2.5" />
                </span>
                <span className="sc-row-title">{item.title}</span>
                <span className="sc-row-owner">{item.owner}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="sc-session sc-plugin-chat">
          <span className="sc-session-label">
            <MessageSquare className="size-3" /> Release plan
          </span>
          <div className="k-bubble sc-plugin-ask">Build a release checklist plugin</div>
          <div className="sc-plugin-reply">
            <AgentHeader id="lead" name="Team Lead" />
            <div className="sc-build">
              <span className="k-swap">
                <span>Building plugin</span>
                <span className="sc-build-done">
                  <Check className="size-3" /> Built · tests passed
                </span>
              </span>
              <i />
            </div>
          </div>
        </div>
      </div>
    </Window>
  )
}

/** Inspect on, the pointer picks the button, and its reference arcs into the session on the right. */
export function BrowserScene() {
  const scene = useFlight<HTMLDivElement>()
  return (
    <Window tabs={[{ icon: AppWindow, label: 'localhost:5173', active: true }]}>
      <div ref={scene} className="sc-workbench sc-browser">
        <div className="sc-page">
          <span className="sc-inspect">
            <Crosshair className="size-2.5" /> Inspect
          </span>
          <span className="sc-page-title">Release notes</span>
          <span className="sc-page-copy">Ready for your next release.</span>
          <div className="sc-page-row">
            <span className="sc-publish">
              Publish
              <span className="sc-outline" />
              <span className="k-cursor sc-browser-cursor">
                <MousePointer2 className="size-4 fill-current" />
              </span>
            </span>
            <span className="sc-tag-anchor" data-fly-from>
              <span className="sc-tag k-mono">button.publish</span>
            </span>
          </div>
        </div>
        <div className="sc-session">
          <span className="sc-session-label">
            <MessageSquare className="size-3" /> Session
          </span>
          <div className="k-composer">
            <FlyingChip className="sc-browser-slot">
              <MousePointer2 className="size-2.5" /> button.publish
            </FlyingChip>
            <span className="k-swap sc-browser-input">
              <span className="k-placeholder">Describe the outcome you want…</span>
              <span className="sc-typed">Fix the hover state</span>
            </span>
            <span className="k-send">
              <ArrowUp className="size-3" />
            </span>
          </div>
        </div>
      </div>
    </Window>
  )
}

const source = [
  'export const release: Release = {',
  "  id: 'v1.4',",
  "  state: 'ready',",
  '  checks: checks.every(Boolean),',
  '}',
]

/** A selected line flies into the session on the right; the diff and a card join it, one is removed. */
export function ContextScene() {
  const scene = useFlight<HTMLDivElement>()
  return (
    <Window
      tabs={[
        { icon: FileCode2, label: 'release.ts', active: true },
        { icon: SquareTerminal, label: 'Terminal' },
      ]}
    >
      <div ref={scene} className="sc-workbench sc-context">
        <div className="sc-code k-mono">
          {source.map((line, i) => (
            <span key={line} className={i === 2 ? 'sc-selected' : undefined}>
              <i className="k-gutter">{10 + i}</i>
              {i === 2 && <b className="sc-selection" />}
              <span data-fly-from={i === 2 || undefined}>
                <Code lang="ts">{line}</Code>
              </span>
            </span>
          ))}
        </div>
        <div className="sc-session">
          <span className="sc-session-label">
            <MessageSquare className="size-3" /> Session
          </span>
          <div className="k-composer">
            <FlyingChip className="sc-ctx-slot">
              <FileCode2 className="size-2.5" /> release.ts:12
            </FlyingChip>
            <span className="k-chip sc-ctx-chip" style={order(0)}>
              <GitCompareArrows className="size-2.5" /> 2 files
            </span>
            <span className="k-chip sc-ctx-chip sc-ctx-drop" style={order(1)}>
              <SquareKanban className="size-2.5" /> LX-2
              <X className="sc-ctx-x size-2.5" />
            </span>
            <span className="k-send">
              <ArrowUp className="size-3" />
            </span>
          </div>
        </div>
      </div>
    </Window>
  )
}
