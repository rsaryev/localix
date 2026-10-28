import { describe, expect, test } from 'bun:test'

import { assertSharedShimsExported, sharedShimsWithoutExports } from './ui-shared-check'

const global = '__LOCALIX_MINI_APP_UI_SHARED__'
const host = `globalThis.${global}`

// Shapes Bun 1.4 emitted for the Git mini app's UI, before and after the fix (minified, trimmed).
const lostExports = `var r=fo(function(io){var ha=${host}.require("react"),{createContext:Xo,useState:Yo}=ha,Sr=ha.default});var He=s(r(),1),no=He.createContext({});`
const commonJsShim = `var r=fo(function(io,Sa){var Se=${host}.require("react");Sa.exports={__esModule:!0,default:Se.default,createContext:Se.createContext}});var He=s(r(),1);`
const topLevelShim = `var Zt=await ${host}.load("@localixai/mini-app-sdk/ui/interactions"),{useCopied:tn}=Zt,on=Zt.default;function f(e){return tn(e)}`

describe('shared-module shims in a built chunk', () => {
  test('a shim wrapped in a function that never sets exports is reported', () => {
    expect(sharedShimsWithoutExports(lostExports, global)).toEqual(['react'])
  })

  test('a CommonJS shim that assigns module.exports, and a top-level ESM shim, pass', () => {
    expect(sharedShimsWithoutExports(commonJsShim + topLevelShim, global)).toEqual([])
  })

  test('the build fails naming the chunk and the module', () => {
    expect(() =>
      assertSharedShimsExported(new Map([['chunks/register-1.js', lostExports]]), global),
    ).toThrow('chunks/register-1.js: the shared module "react" was bundled as CommonJS')
    expect(() =>
      assertSharedShimsExported(new Map([['entry.js', commonJsShim + topLevelShim]]), global),
    ).not.toThrow()
  })
})
