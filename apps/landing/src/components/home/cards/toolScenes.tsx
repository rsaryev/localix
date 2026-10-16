import type { CSSProperties, ReactNode } from 'react'
import { Check, ChevronDown, FileCode2, GitBranch, SquareKanban, Waypoints } from 'lucide-react'
import { Window } from './chrome'
import { Code } from './highlight'

const order = (i: number) => ({ '--i': i }) as CSSProperties

function DiffLine({
  old,
  next,
  sign = ' ',
  className,
  children,
}: {
  old?: number
  next?: number
  sign?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span className={`sc-diff-line ${className ?? ''}`}>
      <i className="k-gutter">{old}</i>
      <i className="k-gutter">{next}</i>
      <i className="sc-sign">{sign}</i>
      <span className="sc-diff-code">{children}</span>
    </span>
  )
}

/** The changed line is marked removed, its replacement is written, and the change is committed. */
export function GitScene() {
  return (
    <Window tabs={[{ icon: GitBranch, label: 'Working tree changes', active: true }]}>
      <div className="sc-git">
        <div className="sc-diff-head">
          <ChevronDown className="size-3" />
          <b className="k-mono">release.ts</b>
          <span>src</span>
          <span className="sc-plus">+1</span>
          <span className="sc-minus">−1</span>
        </div>
        <div className="sc-diff k-mono">
          <DiffLine old={10} next={10}>
            <Code lang="ts">{'export const release: Release = {'}</Code>
          </DiffLine>
          <DiffLine old={11} next={11}>
            <Code lang="ts">{"  id: 'v1.4',"}</Code>
          </DiffLine>
          <DiffLine old={12} sign="−" className="sc-del">
            <Code lang="ts">{'  state: '}</Code>
            <mark className="sc-word-del">'in-review'</mark>
            <span className="t-x">,</span>
          </DiffLine>
          <DiffLine next={12} sign="+" className="sc-ins">
            <Code lang="ts">{'  state: '}</Code>
            <mark className="sc-word-ins">'ready'</mark>
            <span className="t-x">,</span>
          </DiffLine>
          <DiffLine old={13} next={13}>
            <Code lang="ts">{'}'}</Code>
          </DiffLine>
        </div>
        <div className="sc-commit-row">
          <span className="sc-commit-input k-swap">
            <span className="k-placeholder">Commit message</span>
            <span className="sc-commit-typed">fix: mark the release ready</span>
          </span>
          <span className="k-btn sc-commit">
            <span className="k-swap">
              <span>
                <Check className="size-2.5" /> Commit
              </span>
              <span>
                <Check className="size-2.5" /> Committed
              </span>
            </span>
          </span>
        </div>
      </div>
    </Window>
  )
}

/** The import edges draw out of `app.ts` one after another; each file lights on arrival. */
export function GraphScene() {
  return (
    <Window tabs={[{ icon: Waypoints, label: 'Code Graph', active: true }]}>
      <div className="sc-graph-canvas">
        <div className="sc-graph">
          <svg viewBox="0 0 280 160" fill="none" aria-hidden="true">
            <path className="sc-edge-base" d="M70 80H130V35H195M130 80V125H195" />
            <path className="sc-edge sc-edge-a" d="M70 80H130V35H195" pathLength={1} />
            <path className="sc-edge sc-edge-b" d="M70 80H130V125H195" pathLength={1} />
          </svg>
          {[
            ['root', 'app.ts'],
            ['top', 'routes.ts'],
            ['bottom', 'store.ts'],
          ].map(([place, name]) => (
            <span key={name} className={`sc-node sc-node-${place} k-mono`}>
              <FileCode2 className="size-3" />
              {name}
            </span>
          ))}
          <span className="sc-graph-kind">imports</span>
        </div>
        <span className="k-chip sc-graph-share">Shared with agent</span>
      </div>
    </Window>
  )
}

function Count({ from, to }: { from: number; to: number }) {
  return (
    <span className="k-swap sc-count">
      <span>{from}</span>
      <span>{to}</span>
    </span>
  )
}

function Task({
  id,
  title,
  tag,
  owner,
  className,
  style,
}: {
  id: string
  title: string
  tag: string
  owner: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`sc-task ${className ?? ''}`} style={style}>
      <span className="sc-task-meta">
        <i className="k-dot" />
        <span className="k-mono">{id}</span>
        <span className="sc-owner">@{owner}</span>
      </span>
      <span className="sc-task-title">{title}</span>
      <span className="sc-label" data-tag={tag}>
        {tag}
      </span>
    </div>
  )
}

/** A card is picked up from Ready, set down in progress, then in Done; counts and progress follow. */
export function KanbanScene() {
  return (
    <Window tabs={[{ icon: SquareKanban, label: 'Board', active: true }]}>
      <div className="sc-board">
        <div className="sc-board-progress">
          <i>
            <i />
          </i>
          <span>
            <Count from={1} to={2} />
            /3 done
          </span>
        </div>
        <div className="sc-columns">
          <span data-column="ready">
            Ready <Count from={2} to={1} />
          </span>
          <span data-column="doing">
            In progress <Count from={1} to={0} />
          </span>
          <span data-column="done">
            Done <Count from={1} to={2} />
          </span>
        </div>
        <Task id="LX-4" title="Write notes" tag="docs" owner="lead" className="sc-at-ready" />
        <Task id="LX-1" title="Review layout" tag="interface" owner="fe" className="sc-at-done" />
        <Task
          id="LX-2"
          title="Check preview"
          tag="tests"
          owner="qa"
          className="sc-moving"
          style={order(0)}
        />
      </div>
    </Window>
  )
}
