import { Activity } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'diagnostics',
  title: 'Diagnostics',
  description: 'Open runtime and configuration diagnostics',
  keywords: ['health', 'logs', 'configuration'],
  Icon: Activity,
})
