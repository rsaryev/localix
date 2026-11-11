import { hasNativeWindowMaterial } from '@localixai/kit/environment'
import { Slider } from '@localixai/kit/slider'
import {
  DEFAULT_WINDOW_TRANSPARENCY,
  WINDOW_TRANSPARENCY_LABELS,
  WINDOW_TRANSPARENCY_LEVELS,
  setWindowTransparency,
  useWindowTransparency,
} from '@/shared/theme/windowTransparency'
import { SettingsControlRow } from './SettingsScaffold'

/** Offered only over the macOS window material: every other window is solid. */
export function TransparencyField() {
  if (!hasNativeWindowMaterial()) return null
  return <TransparencySlider />
}

function TransparencySlider() {
  const level = useWindowTransparency()
  return (
    <SettingsControlRow
      title="Window transparency"
      description="How much of the desktop shows through the window. Menus, dialogs and full screen stay opaque, and so does every level while Reduce transparency is on in System Settings."
    >
      <Slider
        aria-label="Window transparency"
        className="w-full @xl:w-56"
        steps={WINDOW_TRANSPARENCY_LEVELS.map((step) => WINDOW_TRANSPARENCY_LABELS[step])}
        value={WINDOW_TRANSPARENCY_LEVELS.indexOf(level)}
        onValueChange={(index) =>
          setWindowTransparency(WINDOW_TRANSPARENCY_LEVELS[index] ?? DEFAULT_WINDOW_TRANSPARENCY)
        }
      />
    </SettingsControlRow>
  )
}
