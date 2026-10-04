import { lazy, type ComponentType } from 'react'
import type {
  PluginContextBindingIconProps,
  PluginContextBindingPreviewProps,
  PluginFileTabProps,
  PluginInputProps,
  PluginProblemLineProps,
  PluginProblemStateProps,
  PluginTableGridProps,
  PluginTextareaProps,
  PluginUiComponents,
} from '@localixai/plugin-sdk/ui/components'

/**
 * The host components lent to plugins, and how they load.
 *
 * Each is lazy, so a window that never opens a plugin pays nothing for them. One loader per
 * component: `lazy()` renders through it, and {@link preloadPluginUiComponents} resolves the same
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
    import('./pluginBindingComponents').then(({ PluginContextBindingIcon }) => ({
      default: PluginContextBindingIcon,
    })),
  ContextBindingPreview: () =>
    import('./pluginBindingComponents').then(({ PluginContextBindingPreview }) => ({
      default: PluginContextBindingPreview,
    })),
  Input: () => import('@localixai/kit/input').then(({ Input }) => ({ default: Input })),
  Textarea: () => import('@localixai/kit/textarea').then(({ Textarea }) => ({ default: Textarea })),
  // A plugin's problems must look like the host's problems, so the host lends its own line rather
  // than letting each plugin draw a strip of its own.
  ProblemLine: () =>
    import('@/shared/ui/problem-report').then(({ ProblemLine }) => ({ default: ProblemLine })),
  ProblemState: () =>
    import('@/shared/ui/problem-report').then(({ ProblemState }) => ({ default: ProblemState })),
}

/**
 * Resolve every lent component's module now. A plugin test on the real host runtime rendered a
 * component whose module had not loaded yet; on a cold cache the lazy boundary had not resolved
 * by the assertion, so the problem line a test checked for was simply absent — a pass or a fail
 * decided by how warm the module cache was. Tests call it (as `@localixai/kit/testing/lent-components`)
 * AFTER registering a DOM: evaluating these modules without one fixes Radix's portals empty.
 */
export function preloadPluginUiComponents(): Promise<unknown> {
  return Promise.all(Object.values(loaders).map((load) => load()))
}

export const pluginUiComponents: PluginUiComponents = {
  FileTab: lazy(loaders.FileTab) as unknown as ComponentType<PluginFileTabProps>,
  TableGrid: lazy(loaders.TableGrid) as unknown as ComponentType<PluginTableGridProps>,
  ContextBindingIcon: lazy(
    loaders.ContextBindingIcon,
  ) as unknown as ComponentType<PluginContextBindingIconProps>,
  ContextBindingPreview: lazy(
    loaders.ContextBindingPreview,
  ) as unknown as ComponentType<PluginContextBindingPreviewProps>,
  Input: lazy(loaders.Input) as unknown as ComponentType<PluginInputProps>,
  Textarea: lazy(loaders.Textarea) as unknown as ComponentType<PluginTextareaProps>,
  ProblemLine: lazy(loaders.ProblemLine) as unknown as ComponentType<PluginProblemLineProps>,
  ProblemState: lazy(loaders.ProblemState) as unknown as ComponentType<PluginProblemStateProps>,
}
