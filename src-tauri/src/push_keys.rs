//! Kolpak: decrypting push notifications on Android without the webview.
//!
//! The room keys live in the webview's crypto store (matrix-js-sdk with the wasm Rust
//! crypto, in IndexedDB), which nothing outside the webview can read. When the app is in
//! the background the webview runs slowly or not at all, so a notification that waits for it
//! comes late, and one that does not shows "Encrypted message".
//!
//! So the webview keeps a copy of its room keys here (`kolpak_push_keys_import`, fed from
//! `src/kolpak/notifications/pushKeyMirror.ts` with the keys this copy does not have yet), in
//! an SQLite crypto store of its own, and the notifications plugin's native push path asks
//! this module to decrypt (`PushPayloadDecryptor.nativeDecryptPush`, the JNI symbol the
//! plugin looks up in the app's library). Only Megolm room keys are copied: no identity, no
//! cross-signing secrets, and nothing is ever sent anywhere from this store.
//!
//! Next to the keys: the room names, which some homeservers leave out of pushes
//! (`room-names.json`, read by the plugin), and what happened last (`status.json`), shown in
//! the notification settings.
//!
//! The copy sits apart from the native crypto engine's store (`matrix_crypto`), on purpose:
//! the app refuses to start the webview's crypto while that one exists.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

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
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager as _;

/// Under the app's data directory, which is what the plugin passes as `storeDir` (on Android
/// Tauri's app local data dir and the plugin's `context.dataDir` are the same place).
const MIRROR_DIR: &str = "kolpak-push-keys";
/// Room id to name, for every account; the plugin reads it when a push has no room name.
const ROOM_NAMES_FILE: &str = "room-names.json";
const STATUS_FILE: &str = "status.json";
const STORE_FILE: &str = "push-keys.sqlite3";

/// Whether keys were ever copied for this account (the folder alone may hold just a status).
async fn has_store(dir: &Path) -> bool {
    tokio::fs::metadata(dir.join(STORE_FILE)).await.is_ok()
}

fn mirror_dir(base: &Path, user_id: &str, device_id: &str) -> PathBuf {
    let account = format!("{user_id}|{device_id}")
        .replace(['/', ':', '|', '\\', '<', '>', '"', '?', '*'], "_");
    base.join(MIRROR_DIR).join(account)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
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
    let store = SqliteCryptoStore::open(dir.join(STORE_FILE), None)
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

/// The last copy of keys into this store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyStatus {
    /// Unix time, ms.
    pub at: u64,
    /// Keys the webview handed over, and how many of them were new here.
    pub offered: usize,
    pub added: usize,
    pub ms: u64,
    pub error: Option<String>,
}

/// The last push this store was asked to decrypt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushStatus {
    pub at: u64,
    pub ok: bool,
    pub error: Option<String>,
    /// "copy" (the app's copy of its keys) or "device" (the notification device).
    #[serde(default)]
    pub via: Option<String>,
}

/// What the app (the webview) reported about itself: whether it runs at all while in the
/// background, and whether pushes reach it there.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    /// "classic", or "sliding" (which the app pauses in the background).
    pub sync_mode: Option<String>,
    /// Last sign of life while the app was in the background.
    pub last_background_run: Option<u64>,
    /// Last push the app itself received.
    pub last_push_seen: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredStatus {
    last_copy: Option<CopyStatus>,
    last_push: Option<PushStatus>,
    #[serde(default)]
    app: AppStatus,
}

/// What the notification settings show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushKeysStatus {
    /// Room keys in the copy.
    pub sessions: usize,
    pub last_copy: Option<CopyStatus>,
    pub last_push: Option<PushStatus>,
    pub app: AppStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushKeysImport {
    pub added: usize,
    /// Room keys in the copy afterwards.
    pub sessions: usize,
}

/// The result of decrypting an event the way a push is decrypted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushKeysCheck {
    pub ok: bool,
    pub body: Option<String>,
    pub error: Option<String>,
}

fn status_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn read_status(dir: &Path) -> StoredStatus {
    std::fs::read(dir.join(STATUS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn update_status(dir: &Path, change: impl FnOnce(&mut StoredStatus)) {
    let _guard = status_lock().lock();
    let mut status = read_status(dir);
    change(&mut status);
    if std::fs::create_dir_all(dir).is_ok() {
        if let Ok(bytes) = serde_json::to_vec(&status) {
            let _ = std::fs::write(dir.join(STATUS_FILE), bytes);
        }
    }
}

async fn session_count(machine: &OlmMachine) -> Result<usize, String> {
    machine
        .store()
        .inbound_group_session_counts(None)
        .await
        .map(|counts| counts.total)
        .map_err(|e| format!("counting push keys failed: {e}"))
}

#[cfg(target_os = "android")]
fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("resolving the app data dir failed: {e}"))
}

/// Copy room keys (the JSON of an `exportRoomKeys` call) into the push key store, and the
/// room names when given (`{roomId: name}`). Keys already there are kept or replaced by
/// better ones.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_import(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
    keys_json: String,
    room_names_json: Option<String>,
) -> Result<PushKeysImport, String> {
    let base = base_dir(&app)?;
    if let Some(names) = room_names_json {
        write_room_names(&base, &names).await?;
    }
    import_keys(&base, &user_id, &device_id, &keys_json).await
}

/// Merged into what is there, so several accounts can share the file.
async fn write_room_names(base: &Path, names_json: &str) -> Result<(), String> {
    let names: HashMap<String, String> =
        serde_json::from_str(names_json).map_err(|e| format!("bad room names: {e}"))?;
    let path = base.join(MIRROR_DIR).join(ROOM_NAMES_FILE);
    let mut all: HashMap<String, String> = tokio::fs::read(&path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    all.extend(names);
    tokio::fs::create_dir_all(base.join(MIRROR_DIR))
        .await
        .map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&all).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| format!("writing room names failed: {e}"))
}

async fn import_keys(
    base: &Path,
    user_id: &str,
    device_id: &str,
    keys_json: &str,
) -> Result<PushKeysImport, String> {
    let started = Instant::now();
    let dir = mirror_dir(base, user_id, device_id);
    let result = async {
        let keys: Vec<ExportedRoomKey> =
            serde_json::from_str(keys_json).map_err(|e| format!("bad key export: {e}"))?;
        let offered = keys.len();
        let machine = machine_at(&dir, user_id, device_id).await?;
        let result = machine
            .store()
            .import_exported_room_keys(keys, |_, _| {})
            .await
            .map_err(|e| format!("importing push keys failed: {e}"))?;
        let sessions = session_count(&machine).await?;
        Ok::<_, String>((offered, result.imported_count, sessions))
    }
    .await;
    let ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let copy = match &result {
        Ok((offered, added, _)) => CopyStatus {
            at: now_ms(),
            offered: *offered,
            added: *added,
            ms,
            error: None,
        },
        Err(error) => CopyStatus {
            at: now_ms(),
            offered: 0,
            added: 0,
            ms,
            error: Some(error.clone()),
        },
    };
    update_status(&dir, |status| status.last_copy = Some(copy));
    let (_, added, sessions) = result?;
    Ok(PushKeysImport { added, sessions })
}

/// The ids of the room keys already in the copy, so the webview hands over only new ones.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_known(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
) -> Result<Vec<String>, String> {
    known_sessions(&base_dir(&app)?, &user_id, &device_id).await
}

async fn known_sessions(
    base: &Path,
    user_id: &str,
    device_id: &str,
) -> Result<Vec<String>, String> {
    let dir = mirror_dir(base, user_id, device_id);
    if !has_store(&dir).await {
        return Ok(Vec::new());
    }
    let machine = machine_at(&dir, user_id, device_id).await?;
    let sessions = machine
        .store()
        .get_inbound_group_sessions()
        .await
        .map_err(|e| format!("listing push keys failed: {e}"))?;
    Ok(sessions
        .iter()
        .map(|session| session.session_id().to_owned())
        .collect())
}

/// How the copy is doing, for the notification settings.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_status(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
) -> Result<PushKeysStatus, String> {
    keys_status(&base_dir(&app)?, &user_id, &device_id).await
}

async fn keys_status(
    base: &Path,
    user_id: &str,
    device_id: &str,
) -> Result<PushKeysStatus, String> {
    let dir = mirror_dir(base, user_id, device_id);
    let stored = read_status(&dir);
    let sessions = if has_store(&dir).await {
        session_count(&*machine_at(&dir, user_id, device_id).await?).await?
    } else {
        0
    };
    Ok(PushKeysStatus {
        sessions,
        last_copy: stored.last_copy,
        last_push: stored.last_push,
        app: stored.app,
    })
}

/// The app reports a sign of life in the background (`event` "background") or a push it
/// received ("push"), with the kind of sync it runs.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_app_report(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
    sync_mode: String,
    event: String,
) -> Result<(), String> {
    record_app_report(&base_dir(&app)?, &user_id, &device_id, &sync_mode, &event);
    Ok(())
}

fn record_app_report(base: &Path, user_id: &str, device_id: &str, sync_mode: &str, event: &str) {
    let now = now_ms();
    update_status(&mirror_dir(base, user_id, device_id), |status| {
        status.app.sync_mode = Some(sync_mode.to_owned());
        match event {
            "background" => status.app.last_background_run = Some(now),
            "push" => status.app.last_push_seen = Some(now),
            _ => {}
        }
    });
}

/// Decrypt an event exactly as a push would be, for the "check" button in the settings.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_push_keys_check(
    app: tauri::AppHandle,
    user_id: String,
    device_id: String,
    room_id: String,
    event_json: String,
) -> Result<PushKeysCheck, String> {
    let base = base_dir(&app)?;
    Ok(check(&base, &user_id, &device_id, &room_id, &event_json).await)
}

async fn check(
    base: &Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> PushKeysCheck {
    match decrypt_any(base, user_id, device_id, room_id, event_json).await {
        Ok((clear, _)) => PushKeysCheck {
            ok: true,
            body: serde_json::from_str::<serde_json::Value>(&clear)
                .ok()
                .and_then(|event| event["content"]["body"].as_str().map(str::to_owned)),
            error: None,
        },
        Err(error) => PushKeysCheck {
            ok: false,
            body: None,
            error: Some(error),
        },
    }
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

/// The decrypted event as JSON, or why not, in words for the settings screen.
async fn decrypt(
    base: &Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> Result<String, String> {
    let dir = mirror_dir(base, user_id, device_id);
    if !has_store(&dir).await {
        return Err("no keys copied for this account yet".into());
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
    machine
        .decrypt_room_event(&event, room, &settings)
        .await
        .map(|decrypted| decrypted.event.json().get().to_owned())
        .map_err(|error| error.to_string())
}

/// Decrypt for the push path and remember how it went.
/// The copy of the app's keys first (local and quick), then the notification device, which
/// fetches a missing key itself (src/notify_device.rs). Says which one did it.
pub(crate) async fn decrypt_any(
    base: &Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> Result<(String, &'static str), String> {
    let copy_error = match decrypt(base, user_id, device_id, room_id, event_json).await {
        Ok(clear) => return Ok((clear, "copy")),
        Err(error) => error,
    };
    match crate::notify_device::decrypt_event(base, user_id, room_id, event_json).await {
        Ok(clear) => Ok((clear, "device")),
        Err(device_error) => Err(format!(
            "{copy_error} (notification device: {device_error})"
        )),
    }
}

async fn decrypt_push(
    base: &Path,
    user_id: &str,
    device_id: &str,
    room_id: &str,
    event_json: &str,
) -> Option<String> {
    let result = decrypt_any(base, user_id, device_id, room_id, event_json).await;
    let push = PushStatus {
        at: now_ms(),
        ok: result.is_ok(),
        error: result.as_ref().err().cloned(),
        via: result.as_ref().ok().map(|(_, via)| (*via).to_owned()),
    };
    if let Err(error) = &result {
        log::info!("push could not be decrypted: {error}");
    }
    update_status(&mirror_dir(base, user_id, device_id), |status| {
        status.last_push = Some(push)
    });
    result.ok().map(|(clear, _)| clear)
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
        let clear = tauri::async_runtime::block_on(decrypt_push(
            Path::new(&store_dir),
            &user_id,
            &device_id,
            &room_id,
            &event_json,
        ));
        match clear {
            Some(json) => Ok(env.new_string(json)?.into()),
            None => Ok(JObject::null()),
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
        let session_id = export[0].session_id.clone();
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

        // Nothing copied yet: no answer, a reason, and no store created.
        assert!(decrypt_push(&base, bob, dev, room.as_str(), &event)
            .await
            .is_none());
        assert!(!mirror_dir(&base, bob, dev).join(STORE_FILE).exists());
        assert!(known_sessions(&base, bob, dev).await.unwrap().is_empty());
        let failed = check(&base, bob, dev, room.as_str(), &event).await;
        assert!(!failed.ok);
        assert!(failed.error.unwrap().contains("no keys copied"));

        let imported = import_keys(&base, bob, dev, &keys_json).await.unwrap();
        assert_eq!((imported.added, imported.sessions), (1, 1));
        // Copying the same keys again adds nothing.
        assert_eq!(
            import_keys(&base, bob, dev, &keys_json)
                .await
                .unwrap()
                .added,
            0
        );
        assert_eq!(
            known_sessions(&base, bob, dev).await.unwrap(),
            vec![session_id]
        );

        let clear = decrypt_push(&base, bob, dev, room.as_str(), &event)
            .await
            .expect("decrypted");
        let clear: Value = serde_json::from_str(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "дать пососать");
        assert_eq!(clear["type"], "m.room.message");

        let checked = check(&base, bob, dev, room.as_str(), &event).await;
        assert!(checked.ok);
        assert_eq!(checked.body.as_deref(), Some("дать пососать"));

        record_app_report(&base, bob, dev, "classic", "push");
        let status = keys_status(&base, bob, dev).await.unwrap();
        assert_eq!(status.sessions, 1);
        assert_eq!(status.app.sync_mode.as_deref(), Some("classic"));
        assert!(status.app.last_push_seen.is_some());
        assert!(status.app.last_background_run.is_none());
        assert_eq!(status.last_copy.unwrap().offered, 1);
        assert!(status.last_push.unwrap().ok);

        // A machine opened afresh (another process) reads the same copy.
        machines().lock().unwrap().clear();
        assert!(decrypt_push(&base, bob, dev, room.as_str(), &event)
            .await
            .is_some());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// The webview's side for real: keys exported and an event encrypted by
    /// matrix-sdk-crypto-wasm (what matrix-js-sdk runs), from files a Node script wrote.
    /// `KOLPAK_WASM_CHECK=<dir with keys.json and event.json> cargo test wasm_export -- --ignored`
    #[tokio::test]
    #[ignore = "needs files written by the wasm crypto"]
    async fn decrypts_with_a_wasm_export() {
        let dir = PathBuf::from(std::env::var("KOLPAK_WASM_CHECK").unwrap());
        let keys = std::fs::read_to_string(dir.join("keys.json")).unwrap();
        let event = std::fs::read_to_string(dir.join("event.json")).unwrap();
        let base = std::env::temp_dir().join(format!("kolpak-wasm-check-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (bob, dev) = ("@bob:example.org", "BOBPHONE");
        assert_eq!(import_keys(&base, bob, dev, &keys).await.unwrap().added, 1);
        let checked = check(&base, bob, dev, "!room:example.org", &event).await;
        assert_eq!(checked.error, None);
        assert_eq!(checked.body.as_deref(), Some("через wasm"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn room_names_merge_across_accounts() {
        let base = std::env::temp_dir().join(format!("kolpak-room-names-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        write_room_names(&base, r#"{"!a:x":"Alpha"}"#)
            .await
            .unwrap();
        write_room_names(&base, r#"{"!b:x":"Beta","!a:x":"Alpha 2"}"#)
            .await
            .unwrap();
        let names: HashMap<String, String> = serde_json::from_slice(
            &std::fs::read(base.join(MIRROR_DIR).join(ROOM_NAMES_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(names["!a:x"], "Alpha 2");
        assert_eq!(names["!b:x"], "Beta");
        let _ = std::fs::remove_dir_all(&base);
    }
}
