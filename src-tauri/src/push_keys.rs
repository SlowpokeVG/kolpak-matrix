//! Kolpak: decrypting push notifications on Android without the webview.
//!
//! The room keys live in the webview's crypto store (matrix-js-sdk with the wasm Rust
//! crypto, in IndexedDB), which nothing outside the webview can read. When the app is in
//! the background the webview runs slowly or not at all, so a notification that waits for it
//! comes late, and one that does not shows "Encrypted message".
//!
//! So the webview keeps a copy of its room keys here (`kolpak_push_keys_import`, fed with
//! `exportRoomKeysAsJson()` when the app goes to the background and every few minutes), in
//! an SQLite crypto store of its own, and the notifications plugin's native push path asks
//! this module to decrypt (`PushPayloadDecryptor.nativeDecryptPush`, the JNI symbol the
//! plugin looks up in the app's library). Only Megolm room keys are copied: no identity, no
//! cross-signing secrets, and nothing is ever sent anywhere from this store.
//!
//! The copy sits apart from the native crypto engine's store (`matrix_crypto`), on purpose:
//! the app refuses to start the webview's crypto while that one exists.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(target_os = "android")]
use jni::objects::{JObject, JString};
#[cfg(target_os = "android")]
use jni::EnvUnowned;
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{DeviceId, RoomId, UserId};
use matrix_sdk_crypto::olm::ExportedRoomKey;
use matrix_sdk_crypto::types::events::room::encrypted::EncryptedEvent;
use matrix_sdk_crypto::{DecryptionSettings, OlmMachine, TrustRequirement};
use matrix_sdk_sqlite::SqliteCryptoStore;
#[cfg(target_os = "android")]
use tauri::Manager as _;

/// Under the app's data directory, which is what the plugin passes as `storeDir` (on Android
/// Tauri's app local data dir and the plugin's `context.dataDir` are the same place).
const MIRROR_DIR: &str = "kolpak-push-keys";

fn mirror_dir(base: &Path, user_id: &str, device_id: &str) -> PathBuf {
    let account = format!("{user_id}|{device_id}")
        .replace(['/', ':', '|', '\\', '<', '>', '"', '?', '*'], "_");
    base.join(MIRROR_DIR).join(account)
}

/// One machine per store, shared by the importer (a Tauri command) and the decryptor (a JNI
/// call from the push service's thread).
fn machines() -> &'static Mutex<HashMap<PathBuf, Arc<OlmMachine>>> {
    static MACHINES: OnceLock<Mutex<HashMap<PathBuf, Arc<OlmMachine>>>> = OnceLock::new();
    MACHINES.get_or_init(Default::default)
}

async fn machine_at(dir: &Path, user_id: &str, device_id: &str) -> Result<Arc<OlmMachine>, String> {
    if let Some(machine) = machines().lock().map_err(|e| e.to_string())?.get(dir) {
        return Ok(Arc::clone(machine));
    }
    let user: &UserId = user_id
        .try_into()
        .map_err(|e| format!("bad user id: {e}"))?;
    let device: &DeviceId = device_id.into();
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| e.to_string())?;
    let store = SqliteCryptoStore::open(dir.join("push-keys.sqlite3"), None)
        .await
        .map_err(|e| format!("opening the push key store failed: {e}"))?;
    let machine = Arc::new(
        OlmMachine::with_store(user, device, Arc::new(store), None)
            .await
            .map_err(|e| format!("creating the push key machine failed: {e}"))?,
    );
    // Never ask other devices for keys from here; this store only reads.
    machine.set_room_key_requests_enabled(false);
    let mut cache = machines().lock().map_err(|e| e.to_string())?;
    Ok(Arc::clone(cache.entry(dir.to_owned()).or_insert(machine)))
}

#[cfg(target_os = "android")]
fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("resolving the app data dir failed: {e}"))
}

/// Copy room keys (the JSON of `exportRoomKeysAsJson()`) into the push key store. Keys
/// already there are kept or replaced by better ones; returns how many were new.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_import(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
    keys_json: String,
) -> Result<usize, String> {
    import_keys(&base_dir(&app)?, &user_id, &device_id, &keys_json).await
}

async fn import_keys(
    base: &Path,
    user_id: &str,
    device_id: &str,
    keys_json: &str,
) -> Result<usize, String> {
    let keys: Vec<ExportedRoomKey> =
        serde_json::from_str(keys_json).map_err(|e| format!("bad key export: {e}"))?;
    let dir = mirror_dir(base, user_id, device_id);
    let machine = machine_at(&dir, user_id, device_id).await?;
    let result = machine
        .store()
        .import_exported_room_keys(keys, |_, _| {})
        .await
        .map_err(|e| format!("importing push keys failed: {e}"))?;
    Ok(result.imported_count)
}

/// Remove the push key store of an account (on logout).
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_wipe(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
) -> Result<(), String> {
    let dir = mirror_dir(&base_dir(&app)?, &user_id, &device_id);
    machines().lock().map_err(|e| e.to_string())?.remove(&dir);
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("removing the push key store failed: {error}")),
    }
}

/// The decrypted event as JSON, or `None` when the key is not (yet) in the copy.
async fn decrypt(
    store_dir: &str,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> Result<Option<String>, String> {
    let dir = mirror_dir(Path::new(store_dir), user_id, device_id);
    if tokio::fs::metadata(&dir).await.is_err() {
        return Ok(None);
    }
    let machine = machine_at(&dir, user_id, device_id).await?;
    let room: &RoomId = room_id
        .try_into()
        .map_err(|e| format!("bad room id: {e}"))?;
    let event: Raw<EncryptedEvent> =
        serde_json::from_str(event_json).map_err(|e| format!("bad event: {e}"))?;
    let settings = DecryptionSettings {
        sender_device_trust_requirement: TrustRequirement::Untrusted,
    };
    match machine.decrypt_room_event(&event, room, &settings).await {
        Ok(decrypted) => Ok(Some(decrypted.event.json().get().to_owned())),
        Err(error) => {
            log::info!("push key store could not decrypt: {error}");
            Ok(None)
        }
    }
}

/// `PushPayloadDecryptor.nativeDecryptPush` in the notifications plugin
/// (crates/tauri-plugin-notifications): called on the push service's thread, possibly in a
/// process the webview never started in. Returns the clear event JSON or null.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_app_tauri_notification_PushPayloadDecryptor_nativeDecryptPush<
    'caller,
>(
    mut env: EnvUnowned<'caller>,
    _this: JObject<'caller>,
    store_dir: JString<'caller>,
    user_id: JString<'caller>,
    device_id: JString<'caller>,
    room_id: JString<'caller>,
    event_json: JString<'caller>,
) -> JObject<'caller> {
    env.with_env(|env| -> jni::errors::Result<JObject<'caller>> {
        let store_dir = store_dir.try_to_string(env)?;
        let user_id = user_id.try_to_string(env)?;
        let device_id = device_id.try_to_string(env)?;
        let room_id = room_id.try_to_string(env)?;
        let event_json = event_json.try_to_string(env)?;
        let clear = tauri::async_runtime::block_on(decrypt(
            &store_dir,
            &user_id,
            &device_id,
            &room_id,
            &event_json,
        ));
        match clear {
            Ok(Some(json)) => Ok(env.new_string(json)?.into()),
            Ok(None) => Ok(JObject::null()),
            Err(error) => {
                log::warn!("push decryption failed: {error}");
                Ok(JObject::null())
            }
        }
    })
    .resolve::<jni::errors::LogErrorAndDefault>()
}

#[cfg(test)]
mod tests {
    use matrix_sdk::ruma::{room_id, user_id};
    use matrix_sdk_crypto::EncryptionSettings;
    use serde_json::{json, Value};

    use super::*;

    #[test]
    fn mirror_dir_is_apart_from_the_engine_store() {
        let dir = mirror_dir(Path::new("/data/app"), "@a:b.c", "DEV");
        assert_eq!(dir, Path::new("/data/app/kolpak-push-keys/@a_b.c_DEV"));
        assert!(!dir.starts_with("/data/app/matrix-crypto"));
    }

    /// The whole trip: Alice sends in a room, Bob's webview exports its keys into the copy,
    /// and the push path decrypts the event built the way UnifiedPushNotifier builds it,
    /// knowing nothing about Alice's device.
    #[tokio::test]
    async fn decrypts_a_push_with_the_copied_keys() {
        let base = std::env::temp_dir().join(format!("kolpak-push-keys-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let room = room_id!("!room:example.org");

        let alice = OlmMachine::new(user_id!("@alice:example.org"), "ALICE".into()).await;
        alice
            .share_room_key(room, std::iter::empty(), EncryptionSettings::default())
            .await
            .unwrap();
        let encrypted = alice
            .encrypt_room_event_raw(
                room,
                "m.room.message",
                &Raw::new(&json!({ "msgtype": "m.text", "body": "дать пососать" }))
                    .unwrap()
                    .cast_unchecked(),
            )
            .await
            .unwrap();
        let export = alice.store().export_room_keys(|_| true).await.unwrap();
        let keys_json = serde_json::to_string(&export).unwrap();

        let (bob, dev) = ("@bob:example.org", "BOBPHONE");
        let event = json!({
            "type": "m.room.encrypted",
            "room_id": room,
            "content": encrypted.content,
            "event_id": "$event",
            "sender": "@alice:example.org",
            "origin_server_ts": 1_700_000_000_000u64,
        })
        .to_string();
        let store = base.to_str().unwrap();

        // Nothing copied yet: no store, no answer, and none created.
        let none = decrypt(store, bob, dev, room.as_str(), &event)
            .await
            .unwrap();
        assert!(none.is_none());
        assert!(!mirror_dir(&base, bob, dev).exists());

        assert_eq!(import_keys(&base, bob, dev, &keys_json).await.unwrap(), 1);
        // Copying the same keys again adds nothing.
        assert_eq!(import_keys(&base, bob, dev, &keys_json).await.unwrap(), 0);

        let clear = decrypt(store, bob, dev, room.as_str(), &event)
            .await
            .unwrap()
            .expect("decrypted");
        let clear: Value = serde_json::from_str(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "дать пососать");
        assert_eq!(clear["type"], "m.room.message");

        // A machine opened afresh (another process) reads the same copy.
        machines().lock().unwrap().clear();
        assert!(decrypt(store, bob, dev, room.as_str(), &event)
            .await
            .unwrap()
            .is_some());

        let _ = std::fs::remove_dir_all(&base);
    }
}
