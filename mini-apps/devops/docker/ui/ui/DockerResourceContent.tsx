import { DetailField } from '@localixai/kit/detail-field'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import type { DockerResourceDetailModel } from '../model/useDockerResourceDetail'

export function DockerResourceContent({ model }: { model: DockerResourceDetailModel }) {
  if (model.loading && !model.detail) {
    return (
      <div className="min-h-0 flex-1">
        <LoadingHint className="p-4">Loading resource…</LoadingHint>
      </div>
    )
  }
  if (!model.detail) {
    return (
      <div className="min-h-0 flex-1">
        <DevOpsProblem
          centered
          subject={model.label}
          issue={model.error ?? { message: 'Docker did not return this resource.' }}
          onRetry={() => void model.refresh()}
        />
      </div>
    )
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
      <DevOpsProblem
        subject={model.label}
        issue={model.error}
        onRetry={() => void model.refresh()}
      />
      <section className="border-y border-border-soft p-3">
        <div className="grid gap-x-8 gap-y-2 text-xs @sm:grid-cols-2">
          {model.fields.map((field) => (
            <DetailField key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </section>
    </div>
  )
}
