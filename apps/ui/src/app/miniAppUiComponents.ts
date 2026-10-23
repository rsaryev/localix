import { lazy, type ComponentType } from 'react'
import type {
  MiniAppFileTabProps,
  MiniAppUiComponents,
} from '@localixai/mini-app-sdk/ui/components'

/**
 * The host components lent to mini apps, and how they load.
 *
 * Each is lazy, so a window that never opens a mini app pays nothing for them. One loader per
 * component: `lazy()` renders through it, and {@link preloadMiniAppUiComponents} resolves the same
 * modules ahead of a first render.
 */
const loaders = {
  FileTab: () =>
    import('@/features/inspector/ui/FileTab').then(({ FileTab }) => ({ default: FileTab })),
  TableGrid: () =>
    import('@/features/inspector/ui/table/TableGrid').then(({ TableGrid }) => ({
      default: TableGrid,
    })),
  ContextBindingIcon: () =>
    import('./miniAppBindingComponents').then(({ MiniAppContextBindingIcon }) => ({
      default: MiniAppContextBindingIcon,
    })),
  ContextBindingPreview: () =>
    import('./miniAppBindingComponents').then(({ MiniAppContextBindingPreview }) => ({
      default: MiniAppContextBindingPreview,
    })),
  Input: () => import('@localixai/kit/input').then(({ Input }) => ({ default: Input })),
  Textarea: () => import('@localixai/kit/textarea').then(({ Textarea }) => ({ default: Textarea })),
  // A mini app's problems must look like the host's problems, so the host lends its own line rather
  // than letting each mini app draw a strip of its own.
  ProblemLine: () =>
    import('@/shared/ui/problem-report').then(({ ProblemLine }) => ({ default: ProblemLine })),
  ProblemState: () =>
    import('@/shared/ui/problem-report').then(({ ProblemState }) => ({ default: ProblemState })),
}

/**
 * Resolve every lent component's module now. A mini app test on the real host runtime rendered a
 * component whose module had not loaded yet; on a cold cache the lazy boundary had not resolved
 * by the assertion, so the problem line a test checked for was simply absent — a pass or a fail
 * decided by how warm the module cache was. Tests call it (as `@localixai/kit/testing/lent-components`)
 * AFTER registering a DOM: evaluating these modules without one fixes Radix's portals empty.
 */
export function preloadMiniAppUiComponents(): Promise<unknown> {
  return Promise.all(Object.values(loaders).map((load) => load()))
}

export const miniAppUiComponents: MiniAppUiComponents = {
  // The SDK types editor `extensions` as `unknown[]` so mini apps need no Monaco types; the host
  // component takes Monaco's own. Every other lent component matches its contract as-is.
  FileTab: lazy(loaders.FileTab) as unknown as ComponentType<MiniAppFileTabProps>,
  TableGrid: lazy(loaders.TableGrid),
  ContextBindingIcon: lazy(loaders.ContextBindingIcon),
  ContextBindingPreview: lazy(loaders.ContextBindingPreview),
  Input: lazy(loaders.Input),
  Textarea: lazy(loaders.Textarea),
  ProblemLine: lazy(loaders.ProblemLine),
  ProblemState: lazy(loaders.ProblemState),
}
