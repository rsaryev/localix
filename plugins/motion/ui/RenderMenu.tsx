import { useState } from 'react'
import { Clapperboard } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { renderSchema } from '../shared/contract'
import type { z } from 'zod'
import { ChoiceMenu } from './ChoiceMenu'

export type RenderSettings = z.infer<typeof renderSchema>

const QUALITY: Record<RenderSettings['quality'], { label: string; description: string }> = {
  draft: { label: 'Draft', description: 'Fast, lower bitrate — for a quick review.' },
  standard: { label: 'Standard', description: 'Balanced quality for sharing.' },
  high: { label: 'High', description: 'Best quality; takes the longest.' },
}
const FORMAT: Record<RenderSettings['format'], { label: string; description: string }> = {
  mp4: { label: 'MP4', description: 'H.264 — plays everywhere.' },
  webm: { label: 'WebM', description: 'VP9 — smaller files for the web.' },
}

/**
 * Render is one action with two settings, so it is one menu: the settings are submenus whose
 * hint shows the current pick (kept open while choosing), and the action row closes the menu.
 */
export function RenderMenu({
  disabled,
  onRender,
}: {
  disabled: boolean
  onRender: (settings: RenderSettings) => void
}) {
  const [settings, setSettings] = useState<RenderSettings>({ quality: 'standard', format: 'mp4' })
  const entries: MenuEntry[] = [
    {
      id: 'quality',
      label: 'Quality',
      hint: QUALITY[settings.quality].label,
      items: (Object.keys(QUALITY) as RenderSettings['quality'][]).map((quality) => ({
        id: quality,
        label: QUALITY[quality].label,
        description: QUALITY[quality].description,
        selected: settings.quality === quality,
        keepOpen: true,
        onSelect: () => setSettings((current) => ({ ...current, quality })),
      })),
    },
    {
      id: 'format',
      label: 'Format',
      hint: FORMAT[settings.format].label,
      items: (Object.keys(FORMAT) as RenderSettings['format'][]).map((format) => ({
        id: format,
        label: FORMAT[format].label,
        description: FORMAT[format].description,
        selected: settings.format === format,
        keepOpen: true,
        onSelect: () => setSettings((current) => ({ ...current, format })),
      })),
    },
    { separator: true },
    {
      id: 'render',
      label: `Render ${FORMAT[settings.format].label}`,
      icon: Clapperboard,
      hint: QUALITY[settings.quality].label,
      onSelect: () => onRender(settings),
    },
  ]
  return (
    <ChoiceMenu label="Render video" entries={entries} disabled={disabled} align="end">
      <Clapperboard data-icon="inline-start" />
      <span className="hidden @lg:inline">Render</span>
    </ChoiceMenu>
  )
}
