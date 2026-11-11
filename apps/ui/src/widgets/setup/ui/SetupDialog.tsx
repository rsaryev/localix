import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { SidebarNav } from '@localixai/kit/sidebar-nav'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { closeSetup } from '@/shared/lib/setupDialog'
import {
  forgetSetupStep,
  loadSetupStep,
  saveSetupStep,
  SETUP_STEPS,
  stepAfter,
  stepNumber,
  type SetupStepId,
} from '../model/setupSteps'
import { useSetupDone } from '../model/useSetupDone'
import { BasicsStep } from './steps/BasicsStep'
import { FolderStep } from './steps/FolderStep'
import { ModelStep } from './steps/ModelStep'
import { PreferencesStep } from './steps/PreferencesStep'

const STEP_BODY: Record<SetupStepId, ComponentType> = {
  model: ModelStep,
  folder: FolderStep,
  preferences: PreferencesStep,
  basics: BasicsStep,
}

/** Targets whose own Enter means something: Enter on them is theirs, not "Next". */
const OWNS_ENTER =
  'button, a[href], input, textarea, select, [role="combobox"], [role="switch"], [role="slider"], [contenteditable="true"]'

/**
 * Setup, in a dialog over the chat the launch opened: four steps in a list on the left, one at a
 * time on the right, Back and Next below. Every step is optional (Next never waits on a choice),
 * a step the app already finds done is ticked, and the step is kept until "Start chatting", so the
 * palette reopens setup where it was left. Closing it any other way ends setup for later launches.
 * The height is fixed, so moving between steps of different lengths never moves the footer.
 */
export default function SetupDialog() {
  const [step, setStep] = useState(loadSetupStep)
  const done = useSetupDone()
  const section = useRef<HTMLElement>(null)
  // A phone-sized window folds the step list into one select above the step.
  const narrow = useIsMobile()
  const next = stepAfter(step, 1)
  const back = stepAfter(step, -1)
  const Body = STEP_BODY[step]
  const title = SETUP_STEPS[stepNumber(step) - 1]!.title

  // Focus follows the step, so a screen reader reads the new one and Enter moves on from it.
  useEffect(() => {
    section.current?.focus({ preventScroll: true })
  }, [step])

  const go = (id: SetupStepId) => {
    setStep(id)
    saveSetupStep(id)
  }
  const finish = () => {
    forgetSetupStep()
    closeSetup()
  }
  const forward = () => (next ? go(next) : finish())

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
    if (event.target instanceof Element && event.target.closest(OWNS_ENTER)) return
    event.preventDefault()
    forward()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeSetup()
      }}
    >
      <DialogContent
        size="3xl"
        className="h-[min(36rem,calc(100dvh-2rem))]"
        // The step takes focus instead of the first control, so Enter is "Next" from the start.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          section.current?.focus({ preventScroll: true })
        }}
        onKeyDown={onKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Set up Localix</DialogTitle>
          <DialogDescription className="text-pretty">
            Four short steps to a first conversation. Skip any of them: each choice changes later,
            and the command palette opens setup again.
          </DialogDescription>
        </DialogHeader>
        {/* The container the steps' settings rows size against: beside the step list there is room
            for a control next to its label, and in a narrow window they stack. */}
        <div className={cn('@container flex min-h-0 flex-1', narrow ? 'flex-col' : 'flex-row')}>
          <SidebarNav
            label="Setup steps"
            mode={narrow ? 'select' : 'full'}
            selectSize="xl"
            className={narrow ? 'px-4 pb-3' : 'w-52 shrink-0 px-3 pb-4'}
            active={step}
            onSelect={(id) => go(id as SetupStepId)}
            groups={[
              {
                id: 'steps',
                items: SETUP_STEPS.map(({ id, title: label }) => ({
                  id,
                  label,
                  ...(done[id]
                    ? {
                        description: 'Done',
                        badge: (
                          <span className="flex shrink-0 items-center">
                            <Check className="size-3.5 text-status-success" aria-hidden />
                            <span className="sr-only">, done</span>
                          </span>
                        ),
                      }
                    : {}),
                })),
              },
            ]}
          />
          <DialogBody className={cn(!narrow && 'border-l border-border-faint')}>
            <section
              ref={section}
              key={step}
              data-setup-step={step}
              aria-label={title}
              tabIndex={-1}
              className="outline-none"
            >
              <h3 className="pb-1 text-sm font-semibold text-foreground">{title}</h3>
              <Body />
            </section>
          </DialogBody>
        </div>
        <DialogFooter
          actionsLabel="Setup actions"
          aside={
            <span className="text-xs text-text-faint tabular-nums">
              Step {stepNumber(step)} of {SETUP_STEPS.length}
            </span>
          }
        >
          <Button
            variant="ghost"
            className="text-text-soft"
            disabled={!back}
            onClick={() => back && go(back)}
          >
            Back
          </Button>
          <Button variant="mono" onClick={forward}>
            {next ? 'Next' : 'Start chatting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
