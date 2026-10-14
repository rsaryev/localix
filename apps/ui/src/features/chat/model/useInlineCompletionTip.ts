import { useMemo } from 'react'
import { isModelRoutingTaskEnabled } from '@localixai/api/model-task-catalog'
import { HINT, dismiss, isDismissed } from '@localixai/kit/lib'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import type { ComposerTip } from '@/shared/api/tips'

const inlineCompletionTip: ComposerTip = {
  id: HINT.composerSuggest,
  text: 'Inline completion — dimmed text can complete chat, commit, and editor inputs. Press Tab to accept it.',
  eligible: () => !isDismissed(HINT.composerSuggest),
  onDismiss: () => dismiss(HINT.composerSuggest),
  actions: [
    {
      kind: 'local',
      label: 'Turn it on',
      onAction: () => {
        const { settings, update } = useUserSettings.getState()
        const base = settings.agentSettings ?? {}
        update({
          agentSettings: {
            ...base,
            modelRouting: {
              ...base.modelRouting,
              inlineCompletion: { ...base.modelRouting?.inlineCompletion, enabled: true },
            },
          },
        })
        dismiss(HINT.composerSuggest)
      },
    },
  ],
}

/** Scope advice stays server-owned; this one UI setting joins the same rotation. */
export function useInlineCompletionTip(tips: readonly ComposerTip[], idle: boolean) {
  const enabled = useUserSettings((state) =>
    isModelRoutingTaskEnabled(state.settings.agentSettings, 'inlineCompletion'),
  )
  return useMemo(
    () => (idle && !enabled ? [...tips, inlineCompletionTip] : tips),
    [tips, idle, enabled],
  )
}
