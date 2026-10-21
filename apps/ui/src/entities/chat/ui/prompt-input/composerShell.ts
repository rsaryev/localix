import { DROP_TARGET_FOCUS_GLOW, DROP_TARGET_SURFACE_ACTIVE } from '@localixai/kit/drop-target'

/** Shared by the workspace and compact chat; one material and focus treatment. */
export function composerShellClassName(focused: boolean, dropActive = false) {
  const border = dropActive
    ? DROP_TARGET_SURFACE_ACTIVE
    : focused
      ? DROP_TARGET_FOCUS_GLOW
      : 'border-control-border/60 hover:border-control-border-hover'
  return `relative flex flex-col overflow-visible rounded-(--radius-composer) border bg-background/40 backdrop-blur-xl transition-[border-color,box-shadow] duration-(--dur-base) ${border}`
}
