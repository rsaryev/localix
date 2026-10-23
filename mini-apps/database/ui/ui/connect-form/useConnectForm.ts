/** All connect/edit-form state. One config assembler keeps React and driver libraries apart. */
import { useMemo, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type {
  ConnectionColor,
  DbConnectionConfig,
  DbConnectionInfo,
  DbDialect,
  DbSslConfig,
} from '../../dbClient'
import { isSecretToken } from '../../model/connectionSecret'
import {
  buildConnectionConfig,
  EMPTY_TLS_ADVANCED,
  initialFields,
  parseConnectionUrl,
  portAfterTlsToggle,
  tlsClientIdentityIssue,
  type ConnectFormEdit,
  type TlsAdvanced,
} from './model'
import { useConnectActions } from './useConnectActions'
import { useSshTunnel } from './useSshTunnel'
import { getDatabaseDriverManifest, isFileDatabaseDialect } from '../../../shared/driver-catalog'

export type ConnectFormState = ReturnType<typeof useConnectForm>
export type FileTargetMode = 'file' | 'memory'

export function useConnectForm(
  edit: ConnectFormEdit | undefined,
  onConnected: (connection: DbConnectionInfo) => void,
) {
  const [dialect, setDialect] = useState<DbDialect>(edit?.connection.dialect ?? 'sqlite')
  const editFields = edit ? initialFields(edit.config) : undefined
  const editFile = edit?.config && 'file' in edit.config ? edit.config.file : ''
  const [targetMode, setTargetModeState] = useState<FileTargetMode>(() =>
    editFile === ':memory:' || editFile === ':memory' ? 'memory' : 'file',
  )
  const [file, setFile] = useState(() =>
    editFile === ':memory:' || editFile === ':memory' ? '' : editFile,
  )

  const [importUrl, setImportUrl] = useState(() => editFields?.importUrl ?? '')
  const [lastImportedUrl, setLastImportedUrl] = useState(() => editFields?.importUrl ?? '')
  const [importError, setImportError] = useState<string | null>(null)
  const [host, setHost] = useState(() => editFields?.host ?? 'localhost')
  const [port, setPort] = useState(
    () =>
      editFields?.port ??
      String(getDatabaseDriverManifest(edit?.connection.dialect ?? 'sqlite').defaultPort ?? ''),
  )
  const [user, setUser] = useState(() => editFields?.user ?? '')
  const [password, setPassword] = useState(() => editFields?.password ?? '')
  const [database, setDatabase] = useState(() => editFields?.database ?? '')
  const [tls, setTlsState] = useState(() => editFields?.tls ?? false)
  const [tlsAdv, setTlsAdv] = useState<TlsAdvanced>(() => editFields?.adv ?? EMPTY_TLS_ADVANCED)
  const [showTlsAdv, setShowTlsAdv] = useState(
    () => !!editFields && editFields.adv !== EMPTY_TLS_ADVANCED,
  )
  const [storeTlsKey, setStoreTlsKey] = useState(true)

  const [name, setName] = useState(() => edit?.connection.name ?? '')
  const [readonly, setReadonly] = useState(() => !!edit?.config.readonly)
  const [color, setColor] = useState<ConnectionColor | undefined>(() => edit?.config.color)
  const [showOptions, setShowOptions] = useState(
    () => !!(edit && (edit.config.readonly || edit.config.color)),
  )
  const [storeSecret, setStoreSecret] = useState(true)

  const editSsh = edit?.config && !('file' in edit.config) ? edit.config.ssh : undefined
  const sshState = useSshTunnel(dialect, editSsh)
  const { ssh, issue: sshIssue, canStoreSshSecret, storeSshSecret } = sshState

  const manifest = getDatabaseDriverManifest(dialect)
  const isFile = isFileDatabaseDialect(dialect)
  const isNetwork = !isFile
  const setTls = (enabled: boolean) => {
    setPort((current) => portAfterTlsToggle(dialect, current, enabled))
    setTlsState(enabled)
  }

  const sslValue = useMemo<DbSslConfig | undefined>(() => {
    if (!tls || !manifest.capabilities.tls) return undefined
    const hasAdvanced = !tlsAdv.rejectUnauthorized || tlsAdv.ca || tlsAdv.cert || tlsAdv.key
    if (!hasAdvanced) return true
    return {
      ...(tlsAdv.rejectUnauthorized ? {} : { rejectUnauthorized: false }),
      ...(tlsAdv.ca ? { ca: tlsAdv.ca } : {}),
      ...(tlsAdv.cert ? { cert: tlsAdv.cert } : {}),
      ...(tlsAdv.key ? { key: tlsAdv.key } : {}),
    }
  }, [manifest.capabilities.tls, tls, tlsAdv])

  const canStoreSecret = isNetwork && !!password && !isSecretToken(password)
  const canStoreTlsKey = isNetwork && !!tlsAdv.key && !isSecretToken(tlsAdv.key)
  const tlsIssue = tlsClientIdentityIssue(tls, tlsAdv)
  const config = useMemo<DbConnectionConfig | null>(() => {
    if (sshIssue || tlsIssue) return null
    return buildConnectionConfig({
      dialect,
      targetMode,
      file,
      host,
      port,
      user,
      password,
      database,
      ssl: sslValue,
      ssh,
      readonly,
      color,
    })
  }, [
    dialect,
    targetMode,
    file,
    host,
    port,
    user,
    password,
    database,
    sslValue,
    ssh,
    sshIssue,
    tlsIssue,
    readonly,
    color,
  ])

  const actions = useConnectActions({
    config,
    name,
    edit,
    onConnected,
    vaultPassword: storeSecret && canStoreSecret,
    isFields: true,
    vaultSsh: storeSshSecret && canStoreSshSecret,
    vaultTlsKey: storeTlsKey && canStoreTlsKey,
    setTls,
    setTlsAdv,
  })

  const resetConnectionState = (nextDialect: DbDialect) => {
    const next = getDatabaseDriverManifest(nextDialect)
    setDialect(nextDialect)
    setTargetModeState('file')
    setFile('')
    setImportUrl('')
    setLastImportedUrl('')
    setImportError(null)
    setHost(next.transport === 'network' ? 'localhost' : '')
    setPort(next.defaultPort ? String(next.defaultPort) : '')
    setUser('')
    setPassword('')
    setDatabase('')
    setTlsState(false)
    setTlsAdv(EMPTY_TLS_ADVANCED)
    setStoreTlsKey(true)
    setShowTlsAdv(false)
    sshState.setSshEnabled(false)
    actions.setError(null)
    actions.resetTest()
  }

  const selectDialect = (nextDialect: DbDialect) => {
    if (nextDialect === dialect) return
    resetConnectionState(nextDialect)
  }

  const importConnectionUrl = (raw = importUrl) => {
    try {
      const parsed = parseConnectionUrl(raw, dialect)
      setImportUrl(raw.trim())
      setHost(parsed.host)
      setPort(parsed.port)
      setUser(parsed.user)
      setPassword(parsed.password)
      setDatabase(parsed.database)
      setTls(parsed.tls)
      setTlsAdv(parsed.adv)
      setImportError(null)
      setLastImportedUrl(raw.trim())
      actions.setError(null)
      actions.resetTest()
      return true
    } catch (error) {
      acknowledgeInline(error)
      setImportError(error instanceof Error ? error.message : 'Could not import this URL.')
      return false
    }
  }

  const configIssue = useMemo(() => {
    if (isFile) {
      if (targetMode === 'file' && !file.trim()) return 'Choose a database file or use memory.'
      return null
    }
    if (!host.trim()) return 'Host is required.'
    if (port.trim()) {
      const parsed = Number(port)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
        return 'Port must be between 1 and 65535.'
    }
    if (sshIssue) return sshIssue
    if (tlsIssue) return tlsIssue
    return null
  }, [file, host, isFile, port, sshIssue, targetMode, tlsIssue])

  return {
    dialect,
    selectDialect,
    manifest,
    targetMode,
    setTargetMode: (next: FileTargetMode) => {
      setTargetModeState(next)
      actions.resetTest()
    },
    file,
    setFile,
    importUrl,
    setImportUrl: (next: string) => {
      setImportUrl(next)
      setImportError(null)
      if (next.trim() !== lastImportedUrl) actions.resetTest()
    },
    importError,
    urlImported: !!importUrl.trim() && importUrl.trim() === lastImportedUrl,
    importConnectionUrl,
    host,
    setHost,
    port,
    setPort,
    user,
    setUser,
    password,
    setPassword,
    database,
    setDatabase,
    tls,
    setTls,
    tlsAdv,
    setTlsAdv,
    showTlsAdv,
    setShowTlsAdv,
    name,
    setName,
    readonly,
    setReadonly,
    color,
    setColor,
    showOptions,
    setShowOptions,
    storeSecret,
    setStoreSecret,
    sshState,
    isFile,
    isNetwork,
    canStoreSecret,
    canStoreTlsKey,
    storeTlsKey,
    setStoreTlsKey,
    config,
    configIssue,
    ...actions,
  }
}
