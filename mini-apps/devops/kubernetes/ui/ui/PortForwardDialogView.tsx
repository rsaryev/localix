import { ArrowRight, CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Button } from '@localixai/kit/button'
import { Combobox } from '@localixai/kit/combobox'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Spinner } from '@localixai/kit/spinner'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import {
  CUSTOM_POD_PORT,
  type PortForwardChoice,
  type PortForwardFailure,
} from '../model/portForward'

export interface PortForwardDialogViewProps {
  open: boolean
  podName: string
  namespace: string
  ownerScoped: boolean
  choices: readonly PortForwardChoice[]
  portChoice: string
  customPodPort: string
  localPort: string
  validationError: string | null
  failure: PortForwardFailure | null
  busy: boolean
  onClose: () => void
  onPortChoiceChange: (value: string) => void
  onCustomPodPortChange: (value: string) => void
  onLocalPortChange: (value: string) => void
  onStart: () => void
}

/** Pure presentation for the local → pod mapping; state and API lifecycle stay in the dialog. */
export function PortForwardDialogView(props: PortForwardDialogViewProps) {
  const selected = props.choices.find((choice) => choice.value === props.portChoice)
  const podPortText = props.portChoice === CUSTOM_POD_PORT ? props.customPodPort : props.portChoice
  const mappingTarget = podPortText || 'choose port'
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose()
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Forward a pod port</DialogTitle>
          <DialogDescription>
            Create a TCP connection from this machine to a port inside the pod.{' '}
            {props.ownerScoped
              ? 'It stops when this pod tab closes.'
              : 'It stays active until stopped from Port forwards.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4 pr-1">
          <div className="border-y border-border-soft py-2">
            <div className="text-2xs font-medium text-text-faint">Target pod</div>
            <div className="mt-0.5 truncate text-xs font-medium text-foreground">
              {props.podName}
            </div>
            <div className="truncate text-2xs text-text-faint">{props.namespace}</div>
          </div>

          <div className="grid gap-3">
            <Field label="Pod port">
              <Combobox
                value={props.portChoice}
                onValueChange={props.onPortChoiceChange}
                options={props.choices.map(({ value, label, hint }) => ({ value, label, hint }))}
                placeholder="Choose a pod port…"
                searchPlaceholder="Filter ports…"
                emptyLabel="No matching ports"
                aria-label="Pod port"
              />
            </Field>

            {props.portChoice === CUSTOM_POD_PORT && (
              <Field label="Custom pod port">
                <Input
                  size="lg"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  value={props.customPodPort}
                  onChange={(event) => props.onCustomPodPortChange(event.target.value)}
                  placeholder="e.g. 8080"
                  aria-invalid={props.validationError ? true : undefined}
                />
              </Field>
            )}

            {selected?.port && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-text-faint">
                {selected.recommended && (
                  <span className="flex items-center gap-1 text-status-success">
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                    Recommended
                  </span>
                )}
                <span>{selected.port.container || 'Pod'}</span>
                <span aria-hidden="true">·</span>
                <span>{selected.port.protocol}</span>
                {selected.port.probe && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{selected.port.probe} probe</span>
                  </>
                )}
              </div>
            )}

            <Field label="Local port">
              <Input
                size="lg"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                value={props.localPort}
                onChange={(event) => props.onLocalPortChange(event.target.value)}
                placeholder="Automatic"
                aria-invalid={props.validationError ? true : undefined}
              />
              <span className="text-2xs font-normal text-text-faint">
                Leave empty to choose an available loopback port automatically.
              </span>
            </Field>
          </div>

          <div className="flex min-w-0 items-center gap-2 border-y border-border-soft py-2 font-mono text-xs">
            <span className="min-w-0 truncate">127.0.0.1:{props.localPort || 'automatic'}</span>
            <ArrowRight className="size-3.5 shrink-0 text-text-faint" />
            <span className="min-w-0 truncate">
              {props.podName}:{mappingTarget}
            </span>
          </div>

          {props.validationError && (
            <p role="alert" className="text-xs text-status-warning">
              {props.validationError}
            </p>
          )}
          {props.failure && (
            <DevOpsProblem
              subject="Port forward"
              issue={{ message: props.failure.message, detail: props.failure.detail }}
            />
          )}
        </DialogBody>

        <DialogFooter className="flex-row justify-end">
          <Button variant="ghost" size="sm" onClick={props.onClose} disabled={props.busy}>
            Cancel
          </Button>
          <Button
            className="min-w-28"
            variant="ghost"
            size="sm"
            onClick={props.onStart}
            disabled={
              props.busy ||
              !props.portChoice ||
              (props.portChoice === CUSTOM_POD_PORT && !props.customPodPort)
            }
          >
            {props.busy ? (
              <>
                <Spinner className="size-3" />
                Starting
              </>
            ) : (
              'Start forward'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
