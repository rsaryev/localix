import { Bot } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'agents',
  title: 'Agents',
  description: 'Open custom agent definitions and availability settings',
  keywords: ['capabilities', 'delegation', 'subagents'],
  Icon: Bot,
})
