import { useNavigate } from 'react-router'
import { OnboardingWizard } from '@/features/onboarding/ui/OnboardingWizard'

/**
 * `/setup` route — the first-run / "Replay setup" wizard as a DEDICATED full
 * page, not an overlay over the workspace. As its own route nothing renders
 * behind it (home greeting, suggestion pills, sidebar) so nothing bleeds through,
 * and its steps' portaled menus need no z-index fight. Thin by design: it only
 * wires where to go when the wizard exits (home).
 */
export function SetupPage() {
  const navigate = useNavigate()
  return (
    <OnboardingWizard
      onExit={() => {
        void navigate('/', { replace: true })
      }}
    />
  )
}
