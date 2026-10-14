import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { treeNavKeyDown } from '@localixai/kit/tree-navigation'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

/** Build a tree container of focusable rows; dirs carry aria-expanded. */
function buildTree(rows: Array<{ path: string; expanded?: boolean }>) {
  const container = document.createElement('div')
  for (const r of rows) {
    const btn = document.createElement('button')
    btn.dataset.treePath = r.path
    if (r.expanded !== undefined) btn.setAttribute('aria-expanded', String(r.expanded))
    container.appendChild(btn)
  }
  document.body.appendChild(container)
  return container
}

function fireKey(
  container: HTMLElement,
  target: Element,
  key: string,
  opts: { toggled: string[] },
) {
  let prevented = false
  treeNavKeyDown(
    {
      key,
      currentTarget: container,
      target,
      preventDefault: () => {
        prevented = true
      },
    } as unknown as React.KeyboardEvent<HTMLElement>,
    {
      toggleDir: (path) => opts.toggled.push(path),
      parentOf: (path) => {
        const i = path.lastIndexOf('/')
        return i > 0 ? path.slice(0, i) : null
      },
    },
  )
  return prevented
}

const rowsOf = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-tree-path]'))

describe('treeNavKeyDown', () => {
  test('ArrowDown / ArrowUp move focus across rows; Home/End jump', () => {
    const c = buildTree([{ path: 'a' }, { path: 'b' }, { path: 'c' }])
    const [a, b, cc] = rowsOf(c)
    const toggled: string[] = []
    expect(fireKey(c, a, 'ArrowDown', { toggled })).toBe(true)
    expect(document.activeElement).toBe(b)
    fireKey(c, b, 'ArrowUp', { toggled })
    expect(document.activeElement).toBe(a)
    fireKey(c, a, 'End', { toggled })
    expect(document.activeElement).toBe(cc)
    fireKey(c, cc, 'Home', { toggled })
    expect(document.activeElement).toBe(a)
    expect(toggled).toEqual([])
    c.remove()
  })

  test('ArrowRight expands a collapsed dir, steps into an open one; files ignore it', () => {
    const c = buildTree([{ path: 'dir', expanded: false }, { path: 'dir/file' }])
    const [dir, file] = rowsOf(c)
    const toggled: string[] = []
    fireKey(c, dir, 'ArrowRight', { toggled })
    expect(toggled).toEqual(['dir'])
    dir.setAttribute('aria-expanded', 'true')
    fireKey(c, dir, 'ArrowRight', { toggled })
    expect(document.activeElement).toBe(file)
    fireKey(c, file, 'ArrowRight', { toggled })
    expect(toggled).toEqual(['dir']) // leaf: no toggle, no move
    c.remove()
  })

  test('ArrowLeft collapses an open dir, else walks up to the nearest RENDERED ancestor row', () => {
    // "a/b" is a compressed segment — "a" alone is not rendered.
    const c = buildTree([{ path: 'a/b', expanded: true }, { path: 'a/b/deep/leaf' }])
    const [dir, leaf] = rowsOf(c)
    const toggled: string[] = []
    // leaf's immediate string parent "a/b/deep" is not a row → lands on "a/b".
    fireKey(c, leaf, 'ArrowLeft', { toggled })
    expect(document.activeElement).toBe(dir)
    fireKey(c, dir, 'ArrowLeft', { toggled })
    expect(toggled).toEqual(['a/b'])
    c.remove()
  })

  test('ignores keys when focus is not on a row (e.g. inline rename input)', () => {
    const c = buildTree([{ path: 'a' }])
    const input = document.createElement('input')
    c.appendChild(input)
    const toggled: string[] = []
    expect(fireKey(c, input, 'ArrowDown', { toggled })).toBe(false)
    c.remove()
  })
})
