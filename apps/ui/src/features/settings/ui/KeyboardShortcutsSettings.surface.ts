import { Keyboard } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'shortcuts',
  title: 'Keyboard shortcuts',
  description: 'Open keybindings and keyboard chord settings',
  keywords: ['keybindings', 'hotkeys', 'chords'],
  Icon: Keyboard,
})
