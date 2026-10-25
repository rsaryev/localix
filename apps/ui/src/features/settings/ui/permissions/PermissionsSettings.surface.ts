import { ShieldCheck } from 'lucide-react'
import { defineSettingsSurface } from '../../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'permissions',
  title: 'Permissions',
  description: 'Open the allow, ask and deny rules for an agent',
  keywords: ['permission', 'rules', 'allow', 'deny', 'ask', 'policy', 'security', 'order'],
  Icon: ShieldCheck,
})
