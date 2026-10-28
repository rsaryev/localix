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
import { Input } from '@localixai/kit/input'
import type { SqlConsoleState } from '../model/useSqlConsole'
import { focusOnMount } from './focusOnMount'

/**
 * Pre-run bind-value confirmation: a compact query-parameter flow that
 * intentionally contains no SQL editor or detached suggestion
 * widget: values are simple native inputs, and the SQL remains untouched in the console.
 */
export function QueryParametersDialog({ console: state }: { console: SqlConsoleState }) {
  const prompt = state.parameterPrompt

  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && state.cancelParameters()}>
      <DialogContent size="md" showCloseButton={false} className="gap-3 p-0">
        <form
          className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void state.submitParameters()
          }}
        >
          <DialogHeader className="border-b border-border-soft px-4 py-3">
            <DialogTitle>Query parameters</DialogTitle>
            <DialogDescription>
              Confirm values before this query runs. They stay available in this console.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-2 px-4 py-3">
            {prompt?.fields.map((field, index) => (
              <label
                key={field.key}
                className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] items-center gap-3"
              >
                <span className="truncate font-mono text-xs text-text-soft" title={field.label}>
                  {field.label}
                </span>
                <Input
                  ref={index === 0 ? focusOnMount : undefined}
                  value={state.paramValues[field.key] ?? ''}
                  onChange={(event) => state.setParam(field.key, event.target.value)}
                  aria-label={`Value for ${field.label}`}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Value"
                  className="font-mono"
                />
              </label>
            ))}
          </DialogBody>

          <DialogFooter className="items-center border-t border-border-soft px-4 py-3 sm:justify-between">
            <span className="text-2xs text-text-faint">
              NULL binds null · numbers stay numeric · empty stays text
            </span>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={state.cancelParameters}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Run query
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
