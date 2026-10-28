import './index.css'
import './inlineFonts'
import { applyStandaloneAppStartRoute } from '@/shared/lib/standaloneApp'

// Before the router module reads the location.
applyStandaloneAppStartRoute()
void import('./workspaceEntry')
