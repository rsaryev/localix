import * as React from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

interface FieldContextValue {
  controlId: string
  labelId: string
  descriptionId?: string
  errorId?: string
  disabled: boolean
  required: boolean
  invalid: boolean
  readOnly: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

type FieldProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  /** Stable identity shared by the visible label and its control. */
  controlId?: string
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  optional?: boolean
  disabled?: boolean
  readOnly?: boolean
  /** Compact checkbox/switch row; the label keeps its native association. */
  layout?: 'stacked' | 'inline'
  children: React.ReactNode
}

/**
 * Semantic shell for one form control. It owns label/help/error identity and
 * shares state with Input, Textarea, Select, and Combobox through context.
 */
function Field({
  controlId: controlIdProp,
  label,
  description,
  error,
  required = false,
  optional = false,
  disabled = false,
  readOnly = false,
  layout = 'stacked',
  children,
  className,
  ...props
}: FieldProps) {
  const reactId = React.useId()
  const controlId = controlIdProp ?? `field-${reactId}`
  const labelId = `${controlId}-label`
  const descriptionId = description == null ? undefined : `${controlId}-description`
  const errorId = error == null ? undefined : `${controlId}-error`
  const invalid = error != null
  const context = React.useMemo<FieldContextValue>(
    () => ({
      controlId,
      labelId,
      descriptionId,
      errorId,
      disabled,
      required,
      invalid,
      readOnly,
    }),
    [controlId, descriptionId, disabled, errorId, invalid, labelId, readOnly, required],
  )

  return (
    <FieldContext.Provider value={context}>
      <div
        data-slot="field"
        data-disabled={disabled || undefined}
        data-invalid={invalid || undefined}
        className={cn('flex w-full flex-col gap-1.5', className)}
        {...props}
      >
        <div className={layout === 'inline' ? 'flex min-w-0 items-center gap-2' : 'contents'}>
          {layout === 'inline' && children}
          <label
            id={labelId}
            htmlFor={controlId}
            data-slot="field-label"
            className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-text-soft data-[disabled=true]:opacity-50"
            data-disabled={disabled || undefined}
          >
            <span className="min-w-0">{label}</span>
            {required ? (
              <span className="shrink-0 text-status-error/90">
                <span aria-hidden="true">*</span>
                <span className="sr-only">Required</span>
              </span>
            ) : optional ? (
              <span className="shrink-0 font-normal text-text-faint">Optional</span>
            ) : null}
          </label>
        </div>
        {description != null && (
          <p
            id={descriptionId}
            data-slot="field-description"
            className="text-xs/relaxed text-text-faint"
          >
            {description}
          </p>
        )}
        {layout === 'stacked' && children}
        {error != null && (
          <p
            id={errorId}
            data-slot="field-error"
            role="alert"
            className="text-xs/relaxed text-status-error"
          >
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

interface FieldCompatibleProps {
  id?: string
  disabled?: boolean
  required?: boolean
  readOnly?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  'aria-required'?: React.AriaAttributes['aria-required']
  'aria-readonly'?: React.AriaAttributes['aria-readonly']
}

const joinIds = (...ids: Array<string | undefined>): string | undefined => {
  const joined = ids.filter(Boolean).join(' ')
  return joined || undefined
}

/** Merge explicit control props with the nearest Field without overriding callers. */
export function useFieldControlProps<T extends FieldCompatibleProps>(
  props: T,
  nativeControl = false,
): T {
  const field = React.useContext(FieldContext)
  if (!field) return props
  const explicitlyNamed = props['aria-label'] != null || props['aria-labelledby'] != null
  return {
    ...props,
    id: props.id ?? field.controlId,
    disabled: props.disabled ?? field.disabled,
    ...(nativeControl
      ? {
          required: props.required ?? field.required,
          readOnly: props.readOnly ?? field.readOnly,
        }
      : {}),
    'aria-labelledby': explicitlyNamed ? props['aria-labelledby'] : field.labelId,
    'aria-describedby': joinIds(field.errorId, field.descriptionId, props['aria-describedby']),
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    'aria-required': props['aria-required'] ?? (field.required || undefined),
    'aria-readonly': props['aria-readonly'] ?? (field.readOnly || undefined),
  } as T
}

export { Field }
export type { FieldProps }
