import { Folder } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'project',
  title: 'Project settings',
  description: 'Choose a project and edit its name and instructions',
  keywords: ['project', 'folder', 'instructions', 'system prompt'],
  Icon: Folder,
})
