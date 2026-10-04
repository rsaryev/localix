import { Plug } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'mcp',
  title: 'MCP servers',
  description: 'Open MCP server connection and availability settings',
  keywords: ['capabilities', 'servers', 'connections'],
  Icon: Plug,
})
