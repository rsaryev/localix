/** Vite only proxies /rpc and /desktop; /vf must use the API origin directly. */
export function nativeProbeUrl(
  apiBaseUrl: string,
  isDev: boolean,
  devApiBaseUrl: string | undefined,
): string {
  return `${(isDev && devApiBaseUrl ? devApiBaseUrl : apiBaseUrl).replace(/\/$/, '')}/vf/native-probe.js`
}
