import { useDeferredValue, useMemo, useState } from 'react'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { ALL_LOG_SEVERITIES, filterLogLines, parseLogLines, type LogSeverity } from './logLines'
import { logDownloadFilename, toggleLogSeverity as updateLogSeverities } from './logViewer'

export function useLiveLogViewerState(content: string, downloadName: string) {
  const [query, setQuery] = useState('')
  const [wrap, setWrap] = useState(true)
  const [severities, setSeverities] = useState<LogSeverity[]>(() => [...ALL_LOG_SEVERITIES])
  const { copied, copy } = useCopied()
  const deferredQuery = useDeferredValue(query)
  const lines = useMemo(() => parseLogLines(content), [content])
  const visibleLines = useMemo(
    () => filterLogLines(lines, deferredQuery, severities),
    [lines, deferredQuery, severities],
  )
  const visibleText = useMemo(() => visibleLines.map((line) => line.raw).join('\n'), [visibleLines])
  const filteringSeverity = severities.length !== ALL_LOG_SEVERITIES.length

  const toggleSeverity = (severity: LogSeverity, checked: boolean) => {
    setSeverities((current) => updateLogSeverities(current, severity, checked))
  }

  const download = () => {
    const filename = logDownloadFilename(downloadName)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    void miniAppFiles.saveBlob(filename, blob)
  }

  return {
    copied,
    deferredQuery,
    download,
    filteringSeverity,
    lines,
    query,
    setQuery,
    severities,
    toggleSeverity,
    visibleLines,
    visibleText,
    wrap,
    setWrap,
    copyVisible: () => copy(visibleText),
  }
}
