import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { spaceTypes } from '../../shared/types'
import type { ElementViewProps } from './contract'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a step of a selected flowchart is renamed where it stands, and the ground opens the source', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { flowViews } = await import('./flow')
  const View = flowViews[0]!.View
  const spec = spaceTypes.get('flow')!
  const read = spaceTypes.read(
    'flow',
    spec.fromText!('flowchart LR\n  a[Plan] --> b[Build]') as Record<string, unknown>,
  )
  if (read.status !== 'ok') throw new Error('flow rejected')
  const commits: Record<string, unknown>[] = []
  let sourceOpened = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props: ElementViewProps = {
    id: 'chart',
    props: read.props,
    width: 400,
    height: 200,
    selected: true,
    editing: false,
    missing: false,
    sessionId: 's',
    stamp: 0,
    commit: (next) => commits.push(next),
    resize: () => undefined,
    stopEditing: () => undefined,
  }
  try {
    await act(async () =>
      root.render(
        <div onDoubleClick={() => sourceOpened++}>
          <View {...props} />
        </div>,
      ),
    )
    const step = host.querySelector<HTMLElement>('[title^="Double-click to rename “Plan”"]')!
    await act(async () => {
      step.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(sourceOpened).toBe(0)
    const field = host.querySelector('textarea')!
    expect(field.value).toBe('Plan')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        field,
        'Scope',
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(commits).toHaveLength(1)
    const nodes = commits[0]!.nodes as { id: string; label: string }[]
    expect(nodes.map((node) => node.label)).toEqual(['Scope', 'Build'])

    // The chart's own ground is not a step: its double-click reaches the board's editor.
    await act(async () => {
      host.querySelector('svg')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(sourceOpened).toBe(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('an item of a selected 2×2 matrix is dragged to where it belongs', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { quadrantViews } = await import('./quadrant')
  const View = quadrantViews[0]!.View
  const read = spaceTypes.read(
    'quadrant',
    spaceTypes.get('quadrant')!.fromText!(
      'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  Bet: [0.5, 0.5]',
    ) as Record<string, unknown>,
  )
  if (read.status !== 'ok') throw new Error('quadrant rejected')
  const commits: Record<string, unknown>[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <View
          id="bets"
          props={read.props}
          width={448}
          height={432}
          selected
          editing={false}
          missing={false}
          sessionId="s"
          stamp={0}
          commit={(next) => commits.push(next)}
          resize={() => undefined}
          stopEditing={() => undefined}
        />,
      ),
    )
    const svg = host.querySelector<SVGSVGElement>('svg[role="img"]')!
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 448, height: 432 }) as DOMRect
    const item = svg.querySelector('g')!
    Object.assign(item, { setPointerCapture: () => undefined })
    const pointer = (type: string, x: number, y: number) =>
      act(async () => {
        item.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: x,
            clientY: y,
          }),
        )
      })
    // The plot is 400×352 from (24, 56): the top-left corner is x 0, y 1.
    await pointer('pointerdown', 224, 232)
    await pointer('pointermove', 124, 144)
    await pointer('pointerup', 124, 144)
    expect(commits).toEqual([{ points: [{ label: 'Bet', x: 0.25, y: 0.75 }] }])

    // The keyboard moves it too: Shift+→ a long step right, announced by its name.
    expect(item.getAttribute('role')).toBe('button')
    expect(item.getAttribute('aria-label')).toContain('Bet')
    await act(async () => {
      item.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    })
    expect(commits.at(-1)).toEqual({ points: [{ label: 'Bet', x: 0.6, y: 0.5 }] })
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
