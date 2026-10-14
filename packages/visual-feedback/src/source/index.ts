/**
 * Source resolution — map a picked DOM element back to source so the agent knows
 * where to edit. Layered + safe-by-default. Ordering (short-circuit on first hit):
 *
 *   1. data-attr      — `data-source-loc="file:line[:col]"` / `data-od-id` if present
 *   2. react-fiber    — read `_debugSource` from the fiber (READ ONLY, no stack-probe)
 *   3. served-file    — the file WE are serving (strongest signal for static previews)
 *                       + the robust selector + nearby text for in-file location
 *
 * The risky stack-trace probe (invoking component functions) is intentionally
 * NOT implemented here — it has side effects and is rarely needed for our case.
 * Results are cached per element via a WeakMap.
 */

import type { VfSource } from '../protocol/index'

export interface SourceResolver {
  name: string
  resolve(el: Element): VfSource | null
}

/**
 * Source from a build-time stamped attribute, covering the common conventions:
 *   - `data-source-loc="src/App.tsx:42:5"` / `data-inspector-source`
 *   - `data-source-file` + `data-source-line`
 *   - react-dev-inspector's `data-inspector-relative-path` + `-line` + `-column`
 *   - `data-od-id` (component id only)
 */
export function dataAttrResolver(): SourceResolver {
  return {
    name: 'data-attr',
    resolve(el) {
      const loc = el.getAttribute('data-source-loc') ?? el.getAttribute('data-inspector-source')
      if (loc) {
        const m = loc.match(/^(.+?):(\d+)(?::(\d+))?$/)
        if (m) {
          return {
            file: m[1],
            line: Number(m[2]),
            column: m[3] ? Number(m[3]) : undefined,
            method: 'data-attr',
            confidence: 'high',
          }
        }
      }
      // react-dev-inspector (popular dev tool) stamps the path/line/column as three attrs.
      const inspPath = el.getAttribute('data-inspector-relative-path')
      if (inspPath) {
        const line = el.getAttribute('data-inspector-line')
        const col = el.getAttribute('data-inspector-column')
        return {
          file: inspPath,
          line: line ? Number(line) : undefined,
          column: col ? Number(col) : undefined,
          method: 'data-attr',
          confidence: 'high',
        }
      }
      const file = el.getAttribute('data-source-file')
      if (file) {
        const line = el.getAttribute('data-source-line')
        return {
          file,
          line: line ? Number(line) : undefined,
          method: 'data-attr',
          confidence: 'high',
        }
      }
      const od = el.getAttribute('data-od-id')
      if (od) return { component: od, method: 'data-attr', confidence: 'medium' }
      return null
    },
  }
}

interface FiberDebugSource {
  fileName: string
  lineNumber: number
  columnNumber?: number
}
interface Fiber {
  _debugSource?: FiberDebugSource
  _debugOwner?: Fiber
  memoizedProps?: { __source?: FiberDebugSource } | null
  return?: Fiber | null
  type?: unknown
}

/**
 * The JSX source for a fiber, from either of the two places dev transforms put it:
 * `_debugSource` (React ≤18 automatic runtime) or the `__source` prop
 * (classic runtime / Babel `development:true` — and the only one left in React 19,
 * which dropped `_debugSource`). Read-only; no component invocation.
 */
function fiberDebugSource(fiber: Fiber): FiberDebugSource | undefined {
  const src = fiber._debugSource ?? fiber.memoizedProps?.__source
  return src?.fileName ? src : undefined
}

function fiberFromElement(el: Element): Fiber | null {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  )
  if (!key) return null
  return (el as unknown as Record<string, Fiber>)[key] ?? null
}

function componentName(fiber: Fiber): string | undefined {
  const t = fiber.type as { displayName?: string; name?: string } | string | undefined
  if (!t || typeof t === 'string') return undefined
  return t.displayName ?? t.name
}

/**
 * Component ancestry from the React fiber, outer→inner (e.g. "Sidebar › Button").
 * Works in dev even when `_debugSource` is stripped (React 19 / SWC / react-compiler),
 * because component display names survive — a strong grep anchor for the agent.
 * Returns undefined for non-React pages.
 */
export function reactComponentPath(el: Element, max = 4): string | undefined {
  let fiber = fiberFromElement(el)
  if (!fiber) return undefined
  const names: string[] = []
  let depth = 0
  while (fiber && depth < 60 && names.length < max) {
    const name = componentName(fiber)
    if (name && name !== names[names.length - 1] && !/^(?:_c|Anonymous)$/.test(name)) {
      names.push(name)
    }
    fiber = fiber.return ?? null
    depth++
  }
  if (names.length === 0) return undefined
  return names.reverse().join(' › ')
}

/**
 * Reads JSX source from the fiber (dev builds) — both `_debugSource` and the
 * `__source` prop, walking `_debugOwner` then `return`. No component invocation,
 * no side effects.
 */
export function reactFiberResolver(maxDepth = 30): SourceResolver {
  return {
    name: 'react-fiber',
    resolve(el) {
      let fiber = fiberFromElement(el)
      let depth = 0
      while (fiber && depth < maxDepth) {
        const own = fiberDebugSource(fiber)
        const src = own ?? (fiber._debugOwner ? fiberDebugSource(fiber._debugOwner) : undefined)
        if (src) {
          const owner = own ? fiber : fiber._debugOwner!
          return {
            file: src.fileName,
            line: src.lineNumber,
            column: src.columnNumber,
            component: componentName(owner),
            method: 'react-fiber',
            confidence: 'high',
          }
        }
        fiber = fiber.return ?? null
        depth++
      }
      return null
    },
  }
}

/**
 * Always-succeeds fallback: attribute the pick to the file we're serving. The host
 * passes the served file path; combined with the selector + nearby text the agent
 * greps the exact spot. `confidence: medium` (we know the file, not the line).
 */
function servedFileResolver(servedFile?: string): SourceResolver {
  return {
    name: 'served-file',
    resolve() {
      if (!servedFile) return null
      return { file: servedFile, method: 'served-file', confidence: 'medium' }
    },
  }
}

export interface ResolverChainOptions {
  servedFile?: string
}

export function createResolverChain(
  opts: ResolverChainOptions = {},
): (el: Element) => VfSource | null {
  // The fiber resolver self-noops on non-React pages (no __reactFiber$ key → null),
  // so it runs unconditionally — there is nothing to gate on.
  const resolvers: SourceResolver[] = [dataAttrResolver(), reactFiberResolver()]
  resolvers.push(servedFileResolver(opts.servedFile))

  const cache = new WeakMap<Element, VfSource | null>()
  return (el: Element): VfSource | null => {
    const cached = cache.get(el)
    if (cached !== undefined) return cached
    let result: VfSource | null = null
    for (const r of resolvers) {
      result = r.resolve(el)
      if (result) break
    }
    cache.set(el, result)
    return result
  }
}
