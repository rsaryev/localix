import { FolderLock } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'context',
  title: 'Access and context',
  description: 'Open global research access and context exclusions',
  keywords: ['research', 'private', 'local', 'context', 'exclude', 'paths'],
  Icon: FolderLock,
})
