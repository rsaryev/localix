import { CircleHelp } from 'lucide-react'
import type { EnvVariable } from '../../backend/contracts'
import type { Pair } from '../../backend/request-spec'
import { PairEditor } from './PairEditor'

/**
 * Params geometry: authored Query table, then URL-derived Path values.
 *
 * The two grids span the pane, like every other PairEditor surface (Headers, form
 * body). They used to sit in a `max-w-3xl` box, so on any pane wider than that the
 * Query and Path tables stopped short of the URL bar directly above them while
 * Headers — the same grid, one tab over — ran the full width. A value column is
 * the thing users need room for; there is no reading-measure argument for capping
 * a table of `name`/`value` inputs.
 */
export function ParamsEditor({
  query,
  path,
  variables,
  onQueryChange,
  onPathChange,
}: {
  query: Pair[]
  path: Pair[]
  variables?: ReadonlyArray<EnvVariable>
  onQueryChange: (next: Pair[]) => void
  onPathChange: (next: Pair[]) => void
}) {
  return (
    <div>
      <PairEditor
        label="Query"
        showLabel
        pairs={query}
        onChange={onQueryChange}
        namePlaceholder="Name"
        valuePlaceholder="Value"
        variables={variables}
      />
      {path.length > 0 && (
        <PairEditor
          label="Path"
          labelMeta={
            <CircleHelp
              className="size-3.5"
              aria-label="Path parameters come from :name placeholders in the URL"
            />
          }
          showLabel
          readOnlyNames
          showCheckbox={false}
          showDelete={false}
          showEmptyRow={false}
          allowBulkEdit={false}
          pairs={path}
          onChange={onPathChange}
          variables={variables}
        />
      )}
    </div>
  )
}
