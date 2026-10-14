import { ShieldCheck } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'rules',
  title: 'Permission rules',
  description: 'Open the ordered permission rules for a scope',
  keywords: ['permission', 'allow', 'deny', 'ask', 'policy', 'security', 'order'],
  Icon: ShieldCheck,
})
