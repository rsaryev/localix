import { describe, expect, test } from 'bun:test'

import { withoutAppImageEnv } from './appimage-env'

const APPDIR = '/tmp/.mount_LocalixAbC123'

/** What Tauri's AppImage (AppRun + linuxdeploy GTK/GStreamer hooks) hands the process. */
const injected: NodeJS.ProcessEnv = {
  APPDIR,
  APPIMAGE: '/home/me/Apps/Localix.AppImage',
  ARGV0: 'Localix.AppImage',
  OWD: '/home/me',
  LD_LIBRARY_PATH: `${APPDIR}/usr/lib:${APPDIR}/usr/lib/x86_64-linux-gnu`,
  GDK_PIXBUF_MODULE_FILE: `${APPDIR}/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache`,
  GIO_MODULE_DIR: `${APPDIR}/usr/lib/gio/modules`,
  GST_PLUGIN_SYSTEM_PATH_1_0: `${APPDIR}/usr/lib/gstreamer-1.0`,
  PYTHONHOME: `${APPDIR}/usr`,
  XDG_DATA_DIRS: `${APPDIR}/usr/share:/usr/local/share:/usr/share`,
  PATH: `${APPDIR}/usr/bin:/home/me/.local/bin:/usr/bin`,
  HOME: '/home/me',
  DISPLAY: ':0',
  GTK_THEME: 'Adwaita:dark',
}

describe('withoutAppImageEnv', () => {
  // A user's shell, dev server or Python inherited the bundle's library paths and loaded
  // the bundle's GTK/glib/python instead of the host's.
  test('drops every value the runtime pointed into its mount', () => {
    const env = withoutAppImageEnv(injected, injected)
    for (const name of [
      'LD_LIBRARY_PATH',
      'GDK_PIXBUF_MODULE_FILE',
      'GIO_MODULE_DIR',
      'GST_PLUGIN_SYSTEM_PATH_1_0',
      'PYTHONHOME',
    ]) {
      expect(env[name]).toBeUndefined()
    }
  })

  test('list variables keep their host entries', () => {
    const env = withoutAppImageEnv(injected, injected)
    expect(env.PATH).toBe('/home/me/.local/bin:/usr/bin')
    expect(env.XDG_DATA_DIRS).toBe('/usr/local/share:/usr/share')
  })

  test("removes the runtime's own markers and keeps everything else", () => {
    const env = withoutAppImageEnv(injected, injected)
    expect(env.APPDIR).toBeUndefined()
    expect(env.APPIMAGE).toBeUndefined()
    expect(env.ARGV0).toBeUndefined()
    expect(env.OWD).toBeUndefined()
    expect(env.HOME).toBe('/home/me')
    expect(env.DISPLAY).toBe(':0')
    expect(env.GTK_THEME).toBe('Adwaita:dark')
  })

  test('a sibling path that merely shares the prefix is not the mount', () => {
    const env = withoutAppImageEnv({ TOOL: `${APPDIR}-other/bin` }, { APPDIR })
    expect(env.TOOL).toBe(`${APPDIR}-other/bin`)
  })

  test('outside an AppImage the environment is returned untouched', () => {
    const plain = { PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/cuda/lib64' }
    expect(withoutAppImageEnv(plain, {})).toBe(plain)
  })
})
