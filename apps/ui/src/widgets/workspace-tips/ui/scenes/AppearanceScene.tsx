import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import {
  SegmentedRadioGroup,
  type SegmentedRadioOption,
} from '@localixai/plugin-sdk/ui/segmented-control'
import { useTheme, type ThemeMode } from '@/shared/theme/useTheme'
import './appearance-scene.css'

/** Settings navigation exactly as `settingsNavigation.ts` groups it. */
const NAV = [
  { group: 'Personal', items: ['Preferences', 'Editor', 'Shortcuts'] },
  { group: 'Workspace', items: ['Agents', 'Capabilities', 'Project'] },
  { group: 'Application', items: ['System'] },
]

/** Settings → Preferences → Appearance → Theme, drawn in one fixed appearance. */
function SettingsMiniature({ tone }: { tone: 'dark' | 'light' }) {
  return (
    <div className="wt-ws" data-tone={tone}>
      <nav className="wt-set-nav">
        {NAV.map(({ group, items }) => (
          <div key={group} className="wt-set-group">
            <span className="wt-set-label">{group}</span>
            {items.map((item) => (
              <span
                key={item}
                className="wt-set-item"
                data-active={item === 'Preferences' || undefined}
              >
                {item}
              </span>
            ))}
          </div>
        ))}
      </nav>
      <div className="wt-set-main">
        <b className="wt-set-title">Preferences</b>
        <span className="wt-set-desc">Make the workspace comfortable for the way you work.</span>
        <span className="wt-set-section">Appearance</span>
        <div className="wt-set-row">
          <span className="wt-set-row-text">
            <b>Theme</b>
            <span>Appearance on this device. System follows your operating system.</span>
          </span>
          <span className="wt-set-select">
            {tone === 'dark' ? 'Dark' : 'Light'} <ChevronDown className="size-2.5" />
          </span>
        </div>
        <div className="wt-set-row">
          <span className="wt-set-row-text">
            <b>Interface font</b>
          </span>
          <span className="wt-set-select">
            System <ChevronDown className="size-2.5" />
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The real path: the Theme select in Preferences opens System / Light / Dark, Light is
 * picked and the page switches appearance; then back to Dark so the loop closes.
 */
export function AppearanceScene() {
  return (
    <div aria-hidden className="wt-appearance">
      <div className="wt-pane wt-ws-frame">
        <SettingsMiniature tone="dark" />
        <div className="wt-ws-light">
          <SettingsMiniature tone="light" />
        </div>
        <div className="wt-set-menu">
          <span className="wt-set-hover" />
          <span className="wt-row">System</span>
          <span className="wt-row">Light</span>
          <span className="wt-row">
            Dark <Check className="ml-auto" />
          </span>
        </div>
      </div>
    </div>
  )
}

const OPTIONS = [
  { value: 'system', label: <Monitor className="size-3.5" />, 'aria-label': 'System' },
  { value: 'dark', label: <Moon className="size-3.5" />, 'aria-label': 'Dark' },
  { value: 'light', label: <Sun className="size-3.5" />, 'aria-label': 'Light' },
] as const satisfies readonly SegmentedRadioOption<ThemeMode>[]

/** The same setting as Preferences → Theme, one click away. */
export function AppearanceAction() {
  const { themeMode, setThemeMode } = useTheme()
  return (
    <div className="flex items-center gap-3">
      <SegmentedRadioGroup
        aria-label="Theme"
        value={themeMode}
        onValueChange={(mode) => setThemeMode(mode)}
        options={OPTIONS}
      />
      <span className="text-xs text-text-faint capitalize">{themeMode}</span>
    </div>
  )
}
