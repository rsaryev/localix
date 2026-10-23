import { lastLook } from './lastLook'
import { spaceTypes } from '../../shared/types'
import { viewOf } from '../elements'

/** Resolve one placement recipe, including presets and schema defaults, before drawing or placing. */
export function placementOf(tool: string, overrides?: Record<string, unknown>) {
  const view = viewOf(tool)
  const spec = spaceTypes.get(tool)
  if (!view?.insert || !spec) return null
  // The look last given to this kind comes first; a remembered value the type no longer takes is
  // dropped rather than refusing the placement.
  const remembered = spec.props.safeParse({ ...view.insert.props, ...lastLook(tool), ...overrides })
  const parsed = remembered.success
    ? remembered
    : spec.props.safeParse({ ...view.insert.props, ...overrides })
  if (!parsed.success) return null
  const natural = spec.measure?.(parsed.data) ?? spec.size
  const size = {
    w: Math.max(spec.minSize?.w ?? 1, natural.w),
    h: Math.max(spec.minSize?.h ?? 1, natural.h),
  }
  return { view, spec, props: parsed.data as Record<string, unknown>, size }
}
