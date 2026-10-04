import { ProgressBar } from '@localixai/kit/progress-bar'

/** Per-core utilization. `null` until the reader has two counter samples to diff. */
export function CoreGrid({
  cores,
  logicalCores,
}: {
  cores: number[] | null
  logicalCores: number
}) {
  return (
    <section
      aria-label="Logical CPU cores"
      className="overflow-hidden rounded-lg border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Logical cores</h2>
        <span className="text-xs text-text-faint">{logicalCores} detected</span>
      </div>
      {cores ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 @lg:grid-cols-4 @4xl:grid-cols-6">
          {cores.map((value, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-soft">CPU {index + 1}</span>
                <span className="font-mono tabular-nums">{Math.round(value)}%</span>
              </div>
              <ProgressBar
                value={value}
                className="h-1"
                aria-label={`CPU ${index + 1} utilization`}
                aria-valuenow={Math.round(value)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-5 text-xs text-text-faint">
          Utilization appears after two valid samples.
        </div>
      )}
    </section>
  )
}
