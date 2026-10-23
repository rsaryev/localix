/** Test/submit/trust-cert actions + their busy/error/test-outcome state. */
import { useCallback, useRef, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { DbConnectionConfig, DbConnectionInfo } from '../../dbClient'
import { databaseApi } from '../../api/databaseApi'
import { errCode, vaultSecrets, type ConnectFormEdit, type TlsAdvanced } from './model'

export function useConnectActions(deps: {
  config: DbConnectionConfig | null
  name: string
  edit: ConnectFormEdit | undefined
  onConnected: (conn: DbConnectionInfo) => void
  /** Vault the raw DB password on save (checkbox on + a bare password present). */
  vaultPassword: boolean
  /** The password lives in the discrete fields (vs the URL). */
  isFields: boolean
  /** Vault the raw SSH credential on save (checkbox on + a bare credential present). */
  vaultSsh: boolean
  /** Vault the raw TLS client private key on save. */
  vaultTlsKey: boolean
  setTls: (v: boolean) => void
  setTlsAdv: (update: (a: TlsAdvanced) => TlsAdvanced) => void
}) {
  const {
    config,
    name,
    edit,
    onConnected,
    vaultPassword,
    isFields,
    vaultSsh,
    vaultTlsKey,
    setTls,
    setTlsAdv,
  } = deps
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Typed error code from the last failed test/connect (e.g. 'tls_failed'), to offer a
  // targeted recovery action (trust the server certificate + retry).
  const [errorCode, setErrorCode] = useState<string | null>(null)
  // "Test connection" outcome for the current input (reset whenever the target changes).
  const [testing, setTesting] = useState(false)
  const [testOk, setTestOk] = useState<boolean | null>(null)
  /** The SSH host key the last passing test met — shown so the user sees what a save trusts. */
  const [testedHostKey, setTestedHostKey] = useState<string | null>(null)
  const testRequest = useRef(0)
  const testActive = useRef(false)
  const submitActive = useRef(false)

  const resetTest = useCallback(() => {
    testRequest.current += 1
    testActive.current = false
    setTesting(false)
    setTestOk(null)
    setTestedHostKey(null)
    setError(null)
    setErrorCode(null)
  }, [])

  const test = useCallback(
    async (cfgOverride?: DbConnectionConfig) => {
      const cfg = cfgOverride ?? config
      if (!cfg || testActive.current) return
      const request = ++testRequest.current
      testActive.current = true
      setTesting(true)
      setError(null)
      setErrorCode(null)
      setTestOk(null)
      setTestedHostKey(null)
      try {
        const tested = await databaseApi.test(cfg)
        if (testRequest.current !== request) return
        setTestOk(true)
        setTestedHostKey(tested.hostKeyFingerprint ?? null)
      } catch (e) {
        if (testRequest.current !== request) return
        setTestOk(false)
        acknowledgeInline(e)
        setError(e instanceof Error ? e.message : 'Could not connect to the database.')
        setErrorCode(errCode(e))
      } finally {
        if (testRequest.current === request) {
          testActive.current = false
          setTesting(false)
        }
      }
    },
    [config],
  )

  const submit = useCallback(async () => {
    if (!config || submitActive.current) return
    submitActive.current = true
    setBusy(true)
    setError(null)
    setErrorCode(null)
    try {
      // Vault raw credentials (DB password + TLS/SSH private material) so the saved
      // config keeps only `${secret:…}` tokens.
      const finalConfig = await vaultSecrets(config, {
        vaultPassword,
        passwordInFields: isFields,
        vaultSsh,
        vaultTlsKey,
      })
      const trimmedName = name.trim()
      const result = edit
        ? await edit.save({ config: finalConfig, name: trimmedName || undefined })
        : await databaseApi.connect({ config: finalConfig, name: trimmedName || undefined })
      onConnected(result)
    } catch (e) {
      acknowledgeInline(e)
      const fallback = edit
        ? 'Could not save the connection.'
        : 'Could not connect to the database.'
      setError(e instanceof Error ? e.message : fallback)
      setErrorCode(errCode(e))
    } finally {
      submitActive.current = false
      setBusy(false)
    }
  }, [config, name, onConnected, vaultPassword, isFields, vaultSsh, vaultTlsKey, edit])

  // One-click recovery for a TLS/cert failure (field mode): trust the server certificate
  // (rejectUnauthorized:false), reflect it in the TLS state, and re-test against a config
  // override right away (no wait for the state to settle). Common for self-signed
  // local/internal databases.
  const trustCertAndRetry = useCallback(() => {
    setTls(true)
    setTlsAdv((a) => ({ ...a, rejectUnauthorized: false }))
    if (!config || 'file' in config) return
    const existing = typeof config.ssl === 'object' && config.ssl ? config.ssl : {}
    void test({ ...config, ssl: { ...existing, rejectUnauthorized: false } })
  }, [config, test, setTls, setTlsAdv])

  return {
    busy,
    error,
    setError,
    errorCode,
    testing,
    testOk,
    testedHostKey,
    resetTest,
    test,
    submit,
    trustCertAndRetry,
  }
}
