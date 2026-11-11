import type { ComponentType } from 'react'
import { ApprovalScene } from './scenes/ApprovalScene'
import { DecisionAction, DecisionScene } from './scenes/DecisionScene'
import { AppearanceAction, AppearanceScene } from './scenes/AppearanceScene'
import { IslandAction, IslandScene } from './scenes/IslandScene'
import { KeymapAction, KeymapScene } from './scenes/KeymapScene'
import { MentionScene } from './scenes/MentionScene'
import { MiniAppsAction, MiniAppsScene } from './scenes/MiniAppsScene'
import { ModelAction, ModelScene } from './scenes/ModelScene'
import { PaletteScene } from './scenes/PaletteScene'
import { ProjectAction, ProjectScene } from './scenes/ProjectScene'

/**
 * One slide: a looping miniature of a real surface and a two-tone sentence (the lead in full
 * ink, the rest faint). When the slide asks for a choice, the sentence ends in it: `rest`
 * then leads into `Action`, the current value, which opens the pick.
 */
export interface WorkspaceTip {
  id: string
  lead: string
  rest: string
  Scene: ComponentType
  Action?: ComponentType
  /** Shown only in the macOS desktop app, the one place the agent island exists. */
  needsIsland?: boolean
}

/**
 * Ranked by what a new user sets up first: how the app looks, then the model nothing sends
 * without and the OpenRouter sign-in that turns on decision models; what the agent may do on its
 * own and where it works come next; then how to point it at things and how to move fast. Choices
 * alternate with how-it-works slides so the carousel never reads as a settings form. Every scene
 * draws a surface that exists today — no split groups, no rail theme button. The current slide is
 * held by id, so a slide that appears later does not move the person; each opening starts at the
 * first. The island slide is left out outside the macOS desktop app.
 */
export const WORKSPACE_TIPS: WorkspaceTip[] = [
  {
    id: 'appearance',
    lead: 'Make it yours.',
    rest: 'Fonts and code style live in Preferences; one click sets the theme —',
    Scene: AppearanceScene,
    Action: AppearanceAction,
  },
  {
    id: 'island',
    lead: 'An agent at the notch.',
    rest: 'When an agent needs your answer and Localix is in the background, the request opens at the notch —',
    Scene: IslandScene,
    Action: IslandAction,
    needsIsland: true,
  },
  {
    id: 'model',
    lead: 'Connect a model.',
    rest: 'Sign in, paste an API key or run an open model here, then pick what new conversations start on —',
    Scene: ModelScene,
    Action: ModelAction,
  },
  {
    id: 'decisions',
    lead: 'Connect OpenRouter for decisions.',
    rest: 'Small decision models, a fraction of a cent each, play games, drive the Browser and run mini apps —',
    Scene: DecisionScene,
    Action: DecisionAction,
  },
  {
    id: 'mini-apps',
    lead: 'Add mini apps.',
    rest: 'Apps with their own screens and tools — games, a board, a reader. A few install on their own:',
    Scene: MiniAppsScene,
    Action: MiniAppsAction,
  },
  {
    id: 'approvals',
    lead: 'You approve what matters.',
    rest: 'Commands the rules ask about wait for you. The shield chip switches to Plan, Bypass or Autonomous.',
    Scene: ApprovalScene,
  },
  {
    id: 'project',
    lead: 'Open a project folder.',
    rest: 'The agent works inside it, with its files, terminal and Git —',
    Scene: ProjectScene,
    Action: ProjectAction,
  },
  {
    id: 'mentions',
    lead: 'Point at anything with @.',
    rest: 'Type @ to browse the project, narrow by name and link files, folders, conversations or terminals.',
    Scene: MentionScene,
  },
  {
    id: 'keymap',
    lead: 'Keep the keys you know.',
    rest: 'Every shortcut follows the keymap you pick —',
    Scene: KeymapScene,
    Action: KeymapAction,
  },
  {
    id: 'palette',
    lead: 'Every command, one search.',
    rest: 'Open the command palette and type — files, conversations and symbols sit one key away.',
    Scene: PaletteScene,
  },
]

/** What the optional slides need, as known now. */
export interface TipRequirements {
  island: boolean
}

/** The slides to show now: the full list minus those whose requirement is unmet. */
export function visibleTips(met: TipRequirements): WorkspaceTip[] {
  return WORKSPACE_TIPS.filter((tip) => !tip.needsIsland || met.island)
}
