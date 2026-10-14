import { WelcomeStep } from '../ui/steps/WelcomeStep'
import { ProviderStep } from '../ui/steps/ProviderStep'
import { ReadyStep } from '../ui/steps/ReadyStep'
import type { OnboardingStep } from './types'

/**
 * First-run path: orient the user, wire one provider/model pair, confirm the agent can run.
 *
 * The bar for being a step is that the choice is worth making BEFORE the first session and cannot
 * be discovered later. Provider/model qualifies — nothing runs without it. Appearance USED to be a
 * step and is not one any more: the app ships two built-in appearances plus system, switched by one
 * button in the rail, so asking about it up front spent a page on something a single visible click
 * answers. Profile, keymaps, plugins, workbenches and channels stay out for the same
 * reason: they are discoverable in their own surfaces, and as mandatory pages they only delayed the
 * first useful session. Every step here is skippable and re-runnable from
 * Settings → Preferences → Replay setup.
 *
 * Steps are identified by `id`, which is also what the wizard persists — see
 * `onboardingProgress`. Renaming an id resets an in-flight wizard to the start.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    description: 'Get started',
    Component: WelcomeStep,
  },
  {
    id: 'provider',
    title: 'Provider',
    description: 'Connect and choose a model',
    wide: true,
    Component: ProviderStep,
  },
  {
    id: 'ready',
    title: 'Ready',
    description: 'Confirm the connection',
    Component: ReadyStep,
  },
]
