import { RefreshCw } from 'lucide-react'
import { defineSettingsSurface } from '../model/defineSettingsSurface'

export default defineSettingsSurface({
  tab: 'model-list',
  title: 'Model list',
  description: 'Check for new provider models and prices',
  keywords: ['models', 'catalog', 'refresh', 'models.dev', 'openrouter', 'providers', 'prices'],
  Icon: RefreshCw,
})
