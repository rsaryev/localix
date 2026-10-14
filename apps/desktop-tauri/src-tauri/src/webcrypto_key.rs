//! The WebCrypto master key WebKit wraps persisted `CryptoKey`s with, held by the shell.
//!
//! A page that stores a `CryptoKey` in IndexedDB (Google, BBC, …) makes WebKit wrap it with a
//! per-app master key. When the host does not supply one, WebKit keeps it in the login keychain
//! behind an ACL bound to the code signature of the binary that created the item, so every rebuilt
//! dev binary met a "wants to access key … WebCrypto Master Key" password prompt the user had no
//! way to reason about. WebKit asks the data store's `_delegate` first (`webCryptoMasterKey:`,
//! macOS 15+, for both page and worker requests: `WebPageProxy::getWebCryptoMasterKey`,
//! `WebProcessProxy::getWebCryptoMasterKey`) and only falls back to the keychain when that answers
//! nil. The shell answers it, from a 0600 file in the app config dir beside its other native state,
//! the same way Apple's WebKitTestRunner answers it (`TestWebsiteDataStoreDelegate.mm`).
//!
//! The key decrypts every stored `CryptoKey`, so REPLACING it silently orphans them. A key is
//! therefore created only when there is no file, a malformed file is an error rather than a
//! regeneration, and a new key is published with `hard_link`, which never overwrites: the file is
//! either absent or complete, and a second launch sharing the config dir (dev and release do)
//! adopts the key the first one already serves instead of clobbering it.
//!
//! On macOS < 15 the selector is never sent and WebKit keeps its keychain item; the release build's
//! Developer ID signature is stable across updates, so that item stays readable without a prompt.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

/// WebKit `RELEASE_ASSERT`s exactly this length (`masterKeySizeInBytes` in
/// `SerializedCryptoKeyWrapCocoa.mm`); any other size crashes the web process.
const KEY_LEN: usize = 16;
const FILE_NAME: &str = "webcrypto-master-key";

/// The key the delegate serves. Set once, before the delegate is attached.
static KEY: OnceLock<[u8; KEY_LEN]> = OnceLock::new();

/// Load the key and make WebKit ask the shell for it. On failure the delegate is not attached
/// and WebKit keeps its own keychain path — a prompt is better than a web process without a key.
pub(crate) fn install<R: tauri::Runtime>(app: &AppHandle<R>) {
    let loaded = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("no app config dir: {error}"))
        .and_then(|dir| load_or_create(&dir));
    match loaded {
        Ok(key) => {
            let _ = KEY.set(key);
            delegate::attach();
        }
        Err(error) => crate::log::logln_at(format!(
            "webcrypto key: {error}; WebKit keeps its keychain master key"
        )),
    }
}

/// Load `<dir>/webcrypto-master-key`, creating a random 0600 one ONLY when there is no file.
fn load_or_create(dir: &Path) -> Result<[u8; KEY_LEN], String> {
    let file = dir.join(FILE_NAME);
    match std::fs::read(&file) {
        Ok(bytes) => return parse(&file, &bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        // A transient read failure is not "no key yet": minting one here would orphan the real one.
        Err(error) => return Err(format!("cannot read {}: {error}", file.display())),
    }
    let mut key = [0u8; KEY_LEN];
    getrandom::fill(&mut key).map_err(|error| format!("no system randomness: {error}"))?;
    publish(dir, key)
}

/// Publish `key` as `<dir>/webcrypto-master-key` unless a key is already there, and return the
/// key that is published afterwards — ours, or the one another launch published first.
fn publish(dir: &Path, key: [u8; KEY_LEN]) -> Result<[u8; KEY_LEN], String> {
    let file = dir.join(FILE_NAME);
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let staged = dir.join(format!(".{FILE_NAME}.{}", std::process::id()));
    write_private(&staged, &key)?;
    let published = std::fs::hard_link(&staged, &file);
    let _ = std::fs::remove_file(&staged);
    match published {
        Ok(()) => Ok(key),
        // Another launch published first; its key is the one already wrapping stored keys.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let bytes = std::fs::read(&file)
                .map_err(|error| format!("cannot read {}: {error}", file.display()))?;
            parse(&file, &bytes)
        }
        Err(error) => Err(format!("cannot publish {}: {error}", file.display())),
    }
}

fn parse(file: &Path, bytes: &[u8]) -> Result<[u8; KEY_LEN], String> {
    bytes.try_into().map_err(|_| {
        format!(
            "{} is present but malformed ({} bytes, expected {KEY_LEN}); refusing to replace it. \
             Move it aside to start with a fresh key.",
            file.display(),
            bytes.len()
        )
    })
}

/// Write `key` to `path` as 0600 from the first byte, so it never exists world-readable.
fn write_private(path: &Path, key: &[u8]) -> Result<(), String> {
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    out.write_all(key)
        .and_then(|()| out.sync_all())
        .map_err(|error| format!("cannot write {}: {error}", path.display()))
}

mod delegate {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, AnyThread, MainThreadMarker};
    use objc2_foundation::NSData;
    use objc2_web_kit::WKWebsiteDataStore;

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and this class adds no ivars.
        #[unsafe(super(NSObject))]
        #[name = "LocalixWebCryptoKeyDelegate"]
        struct KeyDelegate;

        unsafe impl NSObjectProtocol for KeyDelegate {}

        impl KeyDelegate {
            /// `_WKWebsiteDataStoreDelegate`'s `- (void)webCryptoMasterKey:(void (^)(NSData *))`.
            #[unsafe(method(webCryptoMasterKey:))]
            fn web_crypto_master_key(&self, completion: &block2::DynBlock<dyn Fn(*mut NSData)>) {
                let data = super::KEY.get().map(|key| NSData::with_bytes(key));
                let raw = data
                    .as_deref()
                    .map_or(std::ptr::null_mut(), |data| data as *const NSData as *mut NSData);
                completion.call((raw,));
            }
        }
    );

    /// Attach the delegate to the default data store, which every shell webview uses (wry takes
    /// `defaultDataStore` when no data-store identifier is set, and the shell sets none).
    pub(super) fn attach() {
        let Some(mtm) = MainThreadMarker::new() else {
            crate::log::logln_at("webcrypto key: not on the main thread; delegate not attached");
            return;
        };
        let store = unsafe { WKWebsiteDataStore::defaultDataStore(mtm) };
        let delegate: Retained<KeyDelegate> = unsafe { msg_send![KeyDelegate::alloc(), init] };
        // `_delegate` is private SPI (`WKWebsiteDataStorePrivate.h`); its setter is `set_delegate:`.
        let _: () = unsafe { msg_send![&store, set_delegate: &*delegate] };
        // The property is `weak`: a dropped delegate would silently hand the key back to the
        // keychain. It lives for the process, as WebKitTestRunner's `NeverDestroyed` one does.
        std::mem::forget(delegate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("localix-webcrypto-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn creates_a_private_key_once_and_serves_it_again() {
        let dir = scratch("create");
        let first = load_or_create(&dir).unwrap();
        let file = dir.join(FILE_NAME);
        assert_eq!(std::fs::read(&file).unwrap(), first);
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(load_or_create(&dir).unwrap(), first);
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "the staged file is removed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_malformed_key_is_an_error_and_is_left_in_place() {
        let dir = scratch("malformed");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(FILE_NAME);
        std::fs::write(&file, b"short").unwrap();
        let error = load_or_create(&dir).unwrap_err();
        assert!(error.contains("malformed (5 bytes"), "{error}");
        assert_eq!(std::fs::read(&file).unwrap(), b"short");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_key_published_first_by_another_launch_is_adopted() {
        let dir = scratch("race");
        std::fs::create_dir_all(&dir).unwrap();
        let theirs = [7u8; KEY_LEN];
        // The other launch published between our NotFound read and our publish.
        std::fs::write(dir.join(FILE_NAME), theirs).unwrap();
        assert_eq!(publish(&dir, [9u8; KEY_LEN]).unwrap(), theirs);
        assert_eq!(std::fs::read(dir.join(FILE_NAME)).unwrap(), theirs);
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "the staged file is removed");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
