export {
  REDUCED_MOTION_QUERY,
  motionSafeScrollBehavior,
  prefersReducedMotion,
  useReducedMotion,
} from '../lib/use-reduced-motion'
export { getDesktopApiPort, getDesktopOAuthPort, isDesktop, isDesktopRuntime } from '../lib/desktop'
export {
  IS_MAC,
  OS_FAMILY,
  REVEAL_IN_OS_LABEL,
  applyPlatformDataset,
  classifyOsFamily,
  hasNativeWindowMaterial,
} from '../lib/platform'
export type { OsFamily } from '../lib/platform'
