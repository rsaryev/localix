import { Cpu } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'models',
  title: 'Models',
  description: 'Download models that run on this computer and check for new provider models',
  keywords: [
    'models',
    'local',
    'offline',
    'gguf',
    'llama',
    'hugging face',
    'download',
    'model list',
    'catalog',
    'providers',
  ],
  Icon: Cpu,
})
