import { UserRound } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'general',
  title: 'General settings',
  description: 'Open profile, response, command-line, update, and notification settings',
  keywords: ['profile', 'notifications', 'command line', 'updates', 'check for updates', 'version'],
  Icon: UserRound,
})
