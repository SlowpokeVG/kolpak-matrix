//! Kolpak: a notification device, so a push is decrypted natively even when the room key
//! reached the phone while the app slept.
//!
//! The way Element X does it (matrix-rust-sdk's `NotificationClient`): when the event in a
//! push cannot be decrypted, run a short "encryption sync" that fetches to-device messages,
//! which carry the room keys, and try again. Element shares one crypto store between the app
//! and the notification code. Kolpak's app keeps its crypto in the webview (wasm, IndexedDB),
//! which native code cannot share, and Sable's attempt to move the whole client's crypto to
//! native code was rolled back within weeks. So the native side gets a device of its own on
//! the same account, "Kolpak notifications": senders share room keys with every device of
//! the account, so this one receives them too, in its own to-device inbox, into its own
//! store. Nothing is shared with the webview's device, so nothing can be corrupted, and the
//! main encryption is untouched. The webview cross-signs the device so it counts as verified.
//!
//! The device only receives: it uploads its keys, syncs to-device messages when a push needs
//! a key (`decrypt_event`), and never sends messages. Its session (homeserver, access token,
//! sync token) sits in app-private storage next to its crypto store, like the webview's own.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use matrix_sdk::ruma::api::client::sync::sync_events::DeviceLists;
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::{OneTimeKeyAlgorithm, RoomId, UInt, UserId};
use matrix_sdk_crypto::types::events::room::encrypted::EncryptedEvent;
use matrix_sdk_crypto::{DecryptionSettings, EncryptionSyncChanges, OlmMachine, TrustRequirement};
use matrix_sdk_sqlite::SqliteCryptoStore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri_plugin_http::reqwest;

use crate::matrix_crypto::requests;
use crate::matrix_crypto::wasm_enums::request_type;

const DIR: &str = "kolpak-notify";
const SESSION_FILE: &str = "session.json";
const STORE_FILE: &str = "crypto.sqlite3";
pub const DEVICE_NAME: &str = "Kolpak notifications";
/// Only what carries keys: no rooms, presence or account data.
const SYNC_FILTER: &str =
    r#"{"room":{"rooms":[]},"presence":{"types":[]},"account_data":{"types":[]}}"#;

/// What is kept about the device between runs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    homeserver: String,
    user_id: String,
    device_id: String,
    access_token: String,
    next_batch: Option<String>,
    last_sync_at: Option<u64>,
    last_error: Option<String>,
    /// Room keys this device received, all told.
    keys_received: u64,
}

/// For the notification settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyDeviceStatus {
    pub device_id: String,
    pub last_sync_at: Option<u64>,
    pub last_error: Option<String>,
    pub keys_received: u64,
}

struct Device {
    dir: PathBuf,
    machine: Arc<OlmMachine>,
    /// One sync at a time; holds the session, whose sync token each sync advances.
    session: tokio::sync::Mutex<Session>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn device_dir(base: &Path, user_id: &str) -> PathBuf {
    let account = user_id.replace(['/', ':', '|', '\\', '<', '>', '"', '?', '*'], "_");
    base.join(DIR).join(account)
}

fn devices() -> &'static Mutex<HashMap<PathBuf, Arc<Device>>> {
    static DEVICES: OnceLock<Mutex<HashMap<PathBuf, Arc<Device>>>> = OnceLock::new();
    DEVICES.get_or_init(Default::default)
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn read_session(dir: &Path) -> Option<Session> {
    std::fs::read(dir.join(SESSION_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn write_session(dir: &Path, session: &Session) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(session).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{SESSION_FILE}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SESSION_FILE)).map_err(|e| e.to_string())
}

fn api(homeserver: &str, path: &str) -> String {
    format!(
        "{}/_matrix/client/v3{path}",
        homeserver.trim_end_matches('/')
    )
}

async fn send(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    let request = match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    };
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok((status, body))
}

fn matrix_error(status: u16, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    match (parsed["errcode"].as_str(), parsed["error"].as_str()) {
        (Some(code), Some(message)) => format!("{code}: {message}"),
        (Some(code), None) => code.to_owned(),
        _ => format!("HTTP {status}"),
    }
}

async fn open_device(base: &Path, user_id: &str) -> Result<Option<Arc<Device>>, String> {
    let dir = device_dir(base, user_id);
    if let Some(device) = devices().lock().map_err(|e| e.to_string())?.get(&dir) {
        return Ok(Some(Arc::clone(device)));
    }
    let Some(session) = read_session(&dir) else {
        return Ok(None);
    };
    let user: &UserId = session
        .user_id
        .as_str()
        .try_into()
        .map_err(|e| format!("bad user id: {e}"))?;
    let store = SqliteCryptoStore::open(dir.join(STORE_FILE), None)
        .await
        .map_err(|e| format!("opening the notification device's store failed: {e}"))?;
    let machine = OlmMachine::with_store(
        user,
        session.device_id.as_str().into(),
        Arc::new(store),
        None,
    )
    .await
    .map_err(|e| format!("opening the notification device failed: {e}"))?;
    // It only receives: never ask other devices for keys.
    machine.set_room_key_requests_enabled(false);
    let device = Arc::new(Device {
        dir: dir.clone(),
        machine: Arc::new(machine),
        session: tokio::sync::Mutex::new(session),
    });
    let mut cache = devices().lock().map_err(|e| e.to_string())?;
    Ok(Some(Arc::clone(cache.entry(dir).or_insert(device))))
}

/// Send what the crypto machine wants sent that a receive-only device needs: its keys
/// (upload) and other devices' keys (query). Everything else stays queued.
async fn send_outgoing(machine: &OlmMachine, session: &Session) -> Result<(), String> {
    let list = requests::outgoing_requests(machine).await?;
    for entry in list.as_array().into_iter().flatten() {
        let kind = entry["type"].as_u64().unwrap_or(u64::MAX) as u8;
        let path = match kind {
            request_type::KEYS_UPLOAD => "/keys/upload",
            request_type::KEYS_QUERY => "/keys/query",
            _ => continue,
        };
        let body = entry["body"].as_str().unwrap_or("{}").to_owned();
        let request = http()
            .post(api(&session.homeserver, path))
            .header("Content-Type", "application/json")
            .body(body);
        let (status, response) = send(request, Some(&session.access_token)).await?;
        if status != 200 {
            return Err(format!("{path}: {}", matrix_error(status, &response)));
        }
        requests::mark_request_sent(
            machine,
            &json!({ "requestId": entry["id"], "requestType": kind, "response": response }),
        )
        .await?;
    }
    Ok(())
}

/// One sync of to-device messages, device lists and key counts, fed to the machine. Returns
/// how many room keys came with it.
async fn sync_once(device: &Device, timeout_ms: u64) -> Result<usize, String> {
    let mut session = device.session.lock().await;
    let result = sync_locked(device, &mut session, timeout_ms).await;
    match &result {
        Ok(keys) => {
            session.last_sync_at = Some(now_ms());
            session.last_error = None;
            session.keys_received += *keys as u64;
        }
        Err(error) => session.last_error = Some(error.clone()),
    }
    let _ = write_session(&device.dir, &session);
    result
}

async fn sync_locked(
    device: &Device,
    session: &mut Session,
    timeout_ms: u64,
) -> Result<usize, String> {
    let mut query = vec![
        ("filter", SYNC_FILTER.to_owned()),
        ("timeout", timeout_ms.to_string()),
        ("set_presence", "offline".to_owned()),
    ];
    if let Some(since) = &session.next_batch {
        query.push(("since", since.clone()));
    }
    let request = http().get(api(&session.homeserver, "/sync")).query(&query);
    let (status, body) = send(request, Some(&session.access_token)).await?;
    if status != 200 {
        return Err(format!("sync: {}", matrix_error(status, &body)));
    }
    let sync: Value = serde_json::from_str(&body).map_err(|e| format!("sync: bad json: {e}"))?;

    let to_device_events: Vec<Raw<_>> = sync["to_device"]["events"]
        .as_array()
        .map(|events| {
            events
                .iter()
                .filter_map(|event| serde_json::from_value(event.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    let users = |key: &str| -> Vec<matrix_sdk::ruma::OwnedUserId> {
        sync["device_lists"][key]
            .as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| UserId::parse(id.as_str()?).ok())
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut device_lists = DeviceLists::new();
    device_lists.changed = users("changed");
    device_lists.left = users("left");
    let key_counts: BTreeMap<OneTimeKeyAlgorithm, UInt> = sync["device_one_time_keys_count"]
        .as_object()
        .map(|counts| {
            counts
                .iter()
                .filter_map(|(alg, count)| {
                    Some((
                        OneTimeKeyAlgorithm::from(alg.as_str()),
                        UInt::try_from(count.as_u64()?).ok()?,
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let fallback_keys: Option<Vec<OneTimeKeyAlgorithm>> = sync["device_unused_fallback_key_types"]
        .as_array()
        .map(|keys| {
            keys.iter()
                .filter_map(Value::as_str)
                .map(OneTimeKeyAlgorithm::from)
                .collect()
        });
    let next_batch = sync["next_batch"].as_str().map(str::to_owned);

    let (_, room_keys) = device
        .machine
        .receive_sync_changes(
            EncryptionSyncChanges {
                to_device_events,
                changed_devices: &device_lists,
                one_time_keys_counts: &key_counts,
                unused_fallback_keys: fallback_keys.as_deref(),
                next_batch_token: next_batch.clone(),
            },
            &decryption_settings(),
        )
        .await
        .map_err(|e| format!("processing the sync failed: {e}"))?;
    if next_batch.is_some() {
        session.next_batch = next_batch;
    }
    send_outgoing(&device.machine, session).await?;
    Ok(room_keys.len())
}

fn decryption_settings() -> DecryptionSettings {
    DecryptionSettings {
        sender_device_trust_requirement: TrustRequirement::Untrusted,
    }
}

async fn try_decrypt(
    machine: &OlmMachine,
    room: &RoomId,
    event: &Raw<EncryptedEvent>,
) -> Result<String, String> {
    machine
        .decrypt_room_event(event, room, &decryption_settings())
        .await
        .map(|decrypted| decrypted.event.json().get().to_owned())
        .map_err(|error| error.to_string())
}

/// Decrypt a push's event with the notification device, syncing its keys when it does not
/// have the one needed: at once, then once more waiting a little for a key still on its way.
pub async fn decrypt_event(
    base: &Path,
    user_id: &str,
    room_id: &str,
    event_json: &str,
) -> Result<String, String> {
    let device = open_device(base, user_id)
        .await?
        .ok_or_else(|| "no notification device".to_owned())?;
    let room: &RoomId = room_id
        .try_into()
        .map_err(|e| format!("bad room id: {e}"))?;
    let event: Raw<EncryptedEvent> =
        serde_json::from_str(event_json).map_err(|e| format!("bad event: {e}"))?;
    if let Ok(clear) = try_decrypt(&device.machine, room, &event).await {
        return Ok(clear);
    }
    let mut last = String::new();
    for timeout_ms in [0, 3000] {
        sync_once(&device, timeout_ms).await?;
        match try_decrypt(&device.machine, room, &event).await {
            Ok(clear) => return Ok(clear),
            Err(error) => last = error,
        }
    }
    Err(last)
}

/// Sign the device in (with a password or a login token from the app's own session),
/// upload its keys and take a first sync. Replaces a device signed in before.
pub async fn login(
    base: &Path,
    homeserver: &str,
    user_id: &str,
    password: Option<&str>,
    login_token: Option<&str>,
) -> Result<String, String> {
    let body = match (login_token, password) {
        (Some(token), _) => json!({
            "type": "m.login.token",
            "token": token,
            "initial_device_display_name": DEVICE_NAME,
        }),
        (None, Some(password)) => json!({
            "type": "m.login.password",
            "identifier": { "type": "m.id.user", "user": user_id },
            "password": password,
            "initial_device_display_name": DEVICE_NAME,
        }),
        (None, None) => return Err("a password or a login token is needed".into()),
    };
    let request = http()
        .post(api(homeserver, "/login"))
        .header("Content-Type", "application/json")
        .body(body.to_string());
    let (status, response) = send(request, None).await?;
    if status != 200 {
        return Err(format!("login: {}", matrix_error(status, &response)));
    }
    let response: Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
    let (Some(token), Some(device_id), Some(logged_in_as)) = (
        response["access_token"].as_str(),
        response["device_id"].as_str(),
        response["user_id"].as_str(),
    ) else {
        return Err("login: the server's answer has no token or device".into());
    };
    if logged_in_as != user_id {
        return Err(format!("login: signed in as {logged_in_as}, not {user_id}"));
    }

    logout(base, user_id).await.ok();
    let dir = device_dir(base, user_id);
    let session = Session {
        homeserver: homeserver.trim_end_matches('/').to_owned(),
        user_id: user_id.to_owned(),
        device_id: device_id.to_owned(),
        access_token: token.to_owned(),
        ..Default::default()
    };
    write_session(&dir, &session)?;
    let device = open_device(base, user_id)
        .await?
        .ok_or_else(|| "the new device's session was not saved".to_owned())?;
    {
        let session = device.session.lock().await;
        send_outgoing(&device.machine, &session).await?;
    }
    sync_once(&device, 0).await?;
    Ok(device_id.to_owned())
}

/// Sign the device out on the server and forget it here.
pub async fn logout(base: &Path, user_id: &str) -> Result<(), String> {
    let dir = device_dir(base, user_id);
    devices().lock().map_err(|e| e.to_string())?.remove(&dir);
    if let Some(session) = read_session(&dir) {
        let request = http()
            .post(api(&session.homeserver, "/logout"))
            .header("Content-Type", "application/json")
            .body("{}");
        // Best effort: the token may be gone already.
        let _ = send(request, Some(&session.access_token)).await;
    }
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn status(base: &Path, user_id: &str) -> Option<NotifyDeviceStatus> {
    read_session(&device_dir(base, user_id)).map(|session| NotifyDeviceStatus {
        device_id: session.device_id,
        last_sync_at: session.last_sync_at,
        last_error: session.last_error,
        keys_received: session.keys_received,
    })
}

#[cfg(target_os = "android")]
fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager as _;
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("resolving the app data dir failed: {e}"))
}

/// Sign in the notification device; returns its device id, which the webview then
/// cross-signs.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_notify_login(
    app: tauri::AppHandle,
    homeserver: String,
    user_id: String,
    password: Option<String>,
    login_token: Option<String>,
) -> Result<String, String> {
    login(
        &base_dir(&app)?,
        &homeserver,
        &user_id,
        password.as_deref(),
        login_token.as_deref(),
    )
    .await
}

/// Sign the notification device out and forget it.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_notify_logout(app: tauri::AppHandle, user_id: String) -> Result<(), String> {
    logout(&base_dir(&app)?, &user_id).await
}

/// The notification device of an account, if one is signed in.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn kolpak_notify_status(
    app: tauri::AppHandle,
    user_id: String,
) -> Result<Option<NotifyDeviceStatus>, String> {
    Ok(status(&base_dir(&app)?, &user_id))
}

#[cfg(test)]
mod tests {
    use matrix_sdk::config::SyncSettings;
    use matrix_sdk::ruma::api::client::room::create_room::v3::Request as CreateRoom;
    use matrix_sdk::ruma::events::room::encryption::RoomEncryptionEventContent;
    use matrix_sdk::ruma::events::room::message::RoomMessageEventContent;
    use matrix_sdk::ruma::events::InitialStateEvent;

    use super::*;

    #[test]
    fn device_dir_is_per_account_and_apart_from_the_key_copy() {
        let dir = device_dir(Path::new("/data/app"), "@a:b.c");
        assert_eq!(dir, Path::new("/data/app/kolpak-notify/@a_b.c"));
    }

    async fn register(homeserver: &str, user: &str, password: &str) -> String {
        let body =
            json!({ "username": user, "password": password, "auth": { "type": "m.login.dummy" } });
        let request = http()
            .post(api(homeserver, "/register"))
            .header("Content-Type", "application/json")
            .body(body.to_string());
        let (status, response) = send(request, None).await.unwrap();
        assert_eq!(status, 200, "register {user}: {response}");
        let response: Value = serde_json::from_str(&response).unwrap();
        response["access_token"].as_str().unwrap().to_owned()
    }

    /// The whole trip against a real homeserver: Bob signs in a notification device, Alice (a
    /// real Matrix client, matrix-sdk) sends him an encrypted message, and the device fetches
    /// the room key with a to-device sync and decrypts the event as a push would carry it.
    /// `KOLPAK_TEST_HOMESERVER=http://127.0.0.1:8008 cargo test notify_device -- --ignored`
    /// (a Synapse with open registration).
    #[tokio::test]
    #[ignore = "needs a homeserver with open registration"]
    async fn decrypts_a_message_sent_after_the_device_signed_in() {
        let homeserver = std::env::var("KOLPAK_TEST_HOMESERVER").unwrap();
        let tag = now_ms();
        let (alice_name, bob_name, password) =
            (format!("alice{tag}"), format!("bob{tag}"), "pass-word-1");
        register(&homeserver, &alice_name, password).await;
        let bob_token = register(&homeserver, &bob_name, password).await;
        let host = homeserver
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        let server_name =
            std::env::var("KOLPAK_TEST_SERVER_NAME").unwrap_or_else(|_| host.to_owned());
        let bob_id = format!("@{bob_name}:{server_name}");

        let base = std::env::temp_dir().join(format!("kolpak-notify-test-{tag}"));
        let device_id = login(&base, &homeserver, &bob_id, Some(password), None)
            .await
            .unwrap();
        assert_eq!(status(&base, &bob_id).unwrap().device_id, device_id);

        let alice = matrix_sdk::Client::builder()
            .homeserver_url(&homeserver)
            .sqlite_store(base.join("alice"), None)
            .build()
            .await
            .unwrap();
        alice
            .matrix_auth()
            .login_username(&alice_name, password)
            .send()
            .await
            .unwrap();
        alice.sync_once(SyncSettings::default()).await.unwrap();
        let mut create = CreateRoom::new();
        create.invite = vec![UserId::parse(&bob_id).unwrap()];
        create.initial_state = vec![InitialStateEvent::with_empty_state_key(
            RoomEncryptionEventContent::with_recommended_defaults(),
        )
        .to_raw_any()];
        let room = alice.create_room(create).await.unwrap();
        let room_id = room.room_id().to_owned();

        let join = http()
            .post(api(
                &homeserver,
                &format!("/join/{}", urlencode(room_id.as_str())),
            ))
            .header("Content-Type", "application/json")
            .body("{}");
        let (status_code, response) = send(join, Some(&bob_token)).await.unwrap();
        assert_eq!(status_code, 200, "join: {response}");
        alice.sync_once(SyncSettings::default()).await.unwrap();
        let sent = room
            .send(RoomMessageEventContent::text_plain(
                "дать пососать, natively",
            ))
            .await
            .unwrap();

        let fetch = http().get(api(
            &homeserver,
            &format!(
                "/rooms/{}/event/{}",
                urlencode(room_id.as_str()),
                urlencode(sent.response.event_id.as_str())
            ),
        ));
        let (status_code, raw) = send(fetch, Some(&bob_token)).await.unwrap();
        assert_eq!(status_code, 200, "event: {raw}");
        let raw: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(raw["type"], "m.room.encrypted");
        // Built the way the plugin builds it from a push.
        let event = json!({
            "type": "m.room.encrypted",
            "room_id": room_id.as_str(),
            "content": raw["content"],
            "event_id": raw["event_id"],
            "sender": raw["sender"],
            "origin_server_ts": now_ms(),
        })
        .to_string();

        let clear = decrypt_event(&base, &bob_id, room_id.as_str(), &event)
            .await
            .unwrap();
        let clear: Value = serde_json::from_str(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "дать пососать, natively");
        assert!(status(&base, &bob_id).unwrap().keys_received >= 1);

        // The chain the push service runs: no copy of the app's keys here, so the device.
        let (_, via) =
            crate::push_keys::decrypt_any(&base, &bob_id, "MAINDEVICE", room_id.as_str(), &event)
                .await
                .unwrap();
        assert_eq!(via, "device");

        // A fresh process reads the same device from disk.
        devices().lock().unwrap().clear();
        assert!(decrypt_event(&base, &bob_id, room_id.as_str(), &event)
            .await
            .is_ok());

        logout(&base, &bob_id).await.unwrap();
        assert!(status(&base, &bob_id).is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The usual case: a conversation already going (its Megolm session started before the
    /// device existed). The sender shares the session with the new device with its next
    /// message, and that message decrypts.
    #[tokio::test]
    #[ignore = "needs a homeserver with open registration"]
    async fn decrypts_in_a_session_that_started_before_the_device() {
        let homeserver = std::env::var("KOLPAK_TEST_HOMESERVER").unwrap();
        let tag = now_ms();
        let (alice_name, bob_name, password) =
            (format!("carol{tag}"), format!("dave{tag}"), "pass-word-1");
        register(&homeserver, &alice_name, password).await;
        let bob_token = register(&homeserver, &bob_name, password).await;
        let host = homeserver
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        let server_name =
            std::env::var("KOLPAK_TEST_SERVER_NAME").unwrap_or_else(|_| host.to_owned());
        let bob_id = format!("@{bob_name}:{server_name}");
        let base = std::env::temp_dir().join(format!("kolpak-notify-test2-{tag}"));

        let alice = matrix_sdk::Client::builder()
            .homeserver_url(&homeserver)
            .sqlite_store(base.join("alice"), None)
            .build()
            .await
            .unwrap();
        alice
            .matrix_auth()
            .login_username(&alice_name, password)
            .send()
            .await
            .unwrap();
        alice.sync_once(SyncSettings::default()).await.unwrap();
        let mut create = CreateRoom::new();
        create.invite = vec![UserId::parse(&bob_id).unwrap()];
        create.initial_state = vec![InitialStateEvent::with_empty_state_key(
            RoomEncryptionEventContent::with_recommended_defaults(),
        )
        .to_raw_any()];
        let room = alice.create_room(create).await.unwrap();
        let room_id = room.room_id().to_owned();
        let join = http()
            .post(api(
                &homeserver,
                &format!("/join/{}", urlencode(room_id.as_str())),
            ))
            .header("Content-Type", "application/json")
            .body("{}");
        assert_eq!(send(join, Some(&bob_token)).await.unwrap().0, 200);
        alice.sync_once(SyncSettings::default()).await.unwrap();
        room.send(RoomMessageEventContent::text_plain("before the device"))
            .await
            .unwrap();

        // Now the notification device appears; Alice's client learns of it by syncing.
        login(&base, &homeserver, &bob_id, Some(password), None)
            .await
            .unwrap();
        alice.sync_once(SyncSettings::default()).await.unwrap();
        let sent = room
            .send(RoomMessageEventContent::text_plain("after the device"))
            .await
            .unwrap();

        let fetch = http().get(api(
            &homeserver,
            &format!(
                "/rooms/{}/event/{}",
                urlencode(room_id.as_str()),
                urlencode(sent.response.event_id.as_str())
            ),
        ));
        let (_, raw) = send(fetch, Some(&bob_token)).await.unwrap();
        let raw: Value = serde_json::from_str(&raw).unwrap();
        let event = json!({
            "type": "m.room.encrypted",
            "room_id": room_id.as_str(),
            "content": raw["content"],
            "event_id": raw["event_id"],
            "sender": raw["sender"],
            "origin_server_ts": now_ms(),
        })
        .to_string();
        let clear = decrypt_event(&base, &bob_id, room_id.as_str(), &event)
            .await
            .unwrap();
        let clear: Value = serde_json::from_str(&clear).unwrap();
        assert_eq!(clear["content"]["body"], "after the device");
        logout(&base, &bob_id).await.unwrap();
        let _ = std::fs::remove_dir_all(&base);
    }

    fn urlencode(value: &str) -> String {
        value
            .bytes()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (byte as char).to_string()
                }
                _ => format!("%{byte:02X}"),
            })
            .collect()
    }
}
