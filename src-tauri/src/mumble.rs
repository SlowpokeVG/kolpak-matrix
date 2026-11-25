//! Kolpak: the bridge between the webview and the Mumble client (crates/kolpak-mumble).
//!
//! The webview sends commands and receives state; it never sees audio (AI/SPEC.md §3, §5.5).
//! Built so far: the control connection and the sending half of voice. The microphone is
//! captured, gated and encoded on the Rust side and tunnelled through the control
//! connection. Nothing is played back yet.
//!
//! Events:
//!   mumble://state     { status, session?, serverVersion?, error? }
//!   mumble://snapshot  { session, channels, users }   the whole tree, on every change
//!   mumble://stats     { pingMs }
//!   mumble://text      { actor?, message }
//!   audio://levels     { input, transmitting }        about ten times a second while connected
//!   audio://capture    { deviceName?, error? }        when the microphone opens or fails

use std::sync::Arc;
use std::time::Duration;

use kolpak_mumble::audio::{list_input_devices, pump_voice, Capture, Controls};
// Aliased so the generated TypeScript bindings can map it by a name that is ours
// (tauri.conf.json, plugins.typegen.typeMappings); the real shape is typed by hand in
// src/kolpak/voice/types.ts.
use kolpak_mumble::Snapshot as MumbleSnapshot;
use kolpak_mumble::{
    connect, Client, ConnectOptions, Disconnect, Event, RejectKind, TransmitMode, DEFAULT_PORT,
};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Runtime, State};

const EVENT_STATE: &str = "mumble://state";
const EVENT_SNAPSHOT: &str = "mumble://snapshot";
const EVENT_STATS: &str = "mumble://stats";
const EVENT_TEXT: &str = "mumble://text";
const EVENT_LEVELS: &str = "audio://levels";
const EVENT_CAPTURE: &str = "audio://capture";

const LEVELS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MumbleStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleStatePayload {
    pub status: MumbleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    /// Why the last connection ended or failed, in words a person can read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleStatsPayload {
    pub ping_ms: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleTextPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevelsPayload {
    /// RMS of the most recent microphone frame, 0.0 to 1.0.
    pub input: f32,
    /// Whether that frame was sent.
    pub transmitting: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCapturePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Everything a webview needs to draw the voice UI after a reload, since events are not replayed.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleFullState {
    pub state: MumbleStatePayload,
    pub snapshot: MumbleSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ping_ms: Option<f32>,
    pub capture: AudioCapturePayload,
}

/// The microphone side of a live connection. Dropping it closes the microphone.
struct AudioSession {
    controls: Arc<Controls>,
    _capture: Option<Capture>,
}

#[derive(Default)]
struct Inner {
    /// Bumped on every connect and disconnect, so a finished connection's task cannot
    /// overwrite the state of the one that replaced it.
    generation: u64,
    client: Option<Client>,
    audio: Option<AudioSession>,
    full: MumbleFullState,
    // Transmit settings. They outlive connections so a change made while disconnected
    // applies to the next one.
    mode: TransmitMode,
    vad_threshold: Option<f32>,
    input_device: Option<String>,
}

#[derive(Default)]
pub struct MumbleState {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleConnectArgs {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    /// SHA-256 fingerprint saved from an earlier connection to this server.
    pub pinned_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleConnected {
    /// The server certificate's SHA-256 fingerprint. Save it and send it back next time.
    pub fingerprint: String,
    /// False when the certificate was accepted on first use.
    pub pinned: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleTransmitArgs {
    /// "ptt", "vad" or "continuous".
    pub mode: String,
    /// RMS level, 0.0 to 1.0, above which voice activity opens the microphone.
    pub vad_threshold: Option<f32>,
    /// Input device ID from `audio_list_input_devices`; empty or absent for the default.
    pub input_device: Option<String>,
}

fn parse_mode(mode: &str) -> Result<TransmitMode, String> {
    match mode {
        "ptt" => Ok(TransmitMode::Ptt),
        "vad" => Ok(TransmitMode::Vad),
        "continuous" => Ok(TransmitMode::Continuous),
        other => Err(format!("unknown transmit mode \"{other}\"")),
    }
}

fn describe_disconnect(reason: &Disconnect) -> Option<String> {
    match reason {
        Disconnect::Requested => None,
        Disconnect::Closed => Some("the server closed the connection".into()),
        Disconnect::Error { message } => Some(message.clone()),
        Disconnect::Rejected { reject, reason } => Some(match reject {
            RejectKind::WrongServerPassword => "the server needs a password".into(),
            RejectKind::WrongUserPassword => {
                "that name is registered to someone else on the server".into()
            }
            RejectKind::UsernameInUse => "that name is already in use on the server".into(),
            RejectKind::InvalidUsername => "the server does not accept that name".into(),
            RejectKind::ServerFull => "the server is full".into(),
            RejectKind::NoCertificate => "the server only accepts users with a certificate".into(),
            _ if reason.is_empty() => "the server refused the connection".into(),
            _ => reason.clone(),
        }),
    }
}

/// Whether the server's view of us means our microphone must stay closed.
fn is_muted(snapshot: &MumbleSnapshot) -> bool {
    snapshot
        .users
        .iter()
        .find(|user| Some(user.session) == snapshot.session)
        .is_none_or(|me| me.self_mute || me.self_deaf || me.mute || me.suppress)
}

async fn set_state<R: Runtime>(
    app: &AppHandle<R>,
    inner: &Arc<Mutex<Inner>>,
    generation: u64,
    update: impl FnOnce(&mut MumbleFullState),
) {
    let payload = {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        update(&mut guard.full);
        guard.full.state.clone()
    };
    let _ = app.emit(EVENT_STATE, payload);
}

/// Open the microphone for the connection `generation` and start sending.
async fn start_audio<R: Runtime>(
    app: &AppHandle<R>,
    inner: &Arc<Mutex<Inner>>,
    generation: u64,
    client: Client,
) {
    let (mode, vad_threshold, device) = {
        let guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        (guard.mode, guard.vad_threshold, guard.input_device.clone())
    };
    let controls = Arc::new(Controls::new(mode));
    if let Some(threshold) = vad_threshold {
        controls.set_vad_threshold(threshold);
    }

    let (frame_tx, frame_rx) = tokio::sync::mpsc::unbounded_channel();
    let capture_controls = controls.clone();
    // Opening a device blocks for a moment; keep it off the async threads.
    let opened = tauri::async_runtime::spawn_blocking(move || {
        Capture::start(device, capture_controls, frame_tx)
    })
    .await;

    let (capture, payload) = match opened {
        Ok(Ok(capture)) => {
            let payload = AudioCapturePayload {
                device_name: Some(capture.info.device_name.clone()),
                error: None,
            };
            (Some(capture), payload)
        }
        Ok(Err(error)) => (
            None,
            AudioCapturePayload {
                device_name: None,
                error: Some(error.to_string()),
            },
        ),
        Err(error) => (
            None,
            AudioCapturePayload {
                device_name: None,
                error: Some(error.to_string()),
            },
        ),
    };
    if let Some(error) = &payload.error {
        log::warn!("mumble: microphone unavailable: {error}");
    }

    {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            // Dropping `capture` here closes the microphone again.
            return;
        }
        controls.set_muted(is_muted(&guard.full.snapshot));
        guard.full.capture = payload.clone();
        guard.audio = Some(AudioSession {
            controls: controls.clone(),
            _capture: capture,
        });
    }
    let _ = app.emit(EVENT_CAPTURE, payload);

    tauri::async_runtime::spawn(pump_voice(client, frame_rx));

    // Level meter and talking light for the UI.
    let levels_app = app.clone();
    let levels_inner = inner.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = (f32::NAN, false);
        loop {
            tokio::time::sleep(LEVELS_INTERVAL).await;
            {
                let guard = levels_inner.lock().await;
                let same_session = guard
                    .audio
                    .as_ref()
                    .is_some_and(|audio| Arc::ptr_eq(&audio.controls, &controls));
                if guard.generation != generation || !same_session {
                    break;
                }
            }
            let now = (controls.level(), controls.is_transmitting());
            if now != last {
                last = now;
                let _ = levels_app.emit(
                    EVENT_LEVELS,
                    AudioLevelsPayload {
                        input: now.0,
                        transmitting: now.1,
                    },
                );
            }
        }
    });
}

#[tauri::command]
pub async fn mumble_connect<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MumbleState>,
    args: MumbleConnectArgs,
) -> Result<MumbleConnected, String> {
    let inner = state.inner.clone();

    // One connection at a time: replace whatever is there.
    let generation = {
        let mut guard = inner.lock().await;
        if let Some(previous) = guard.client.take() {
            previous.disconnect().await;
        }
        guard.audio = None;
        guard.generation += 1;
        guard.full = MumbleFullState {
            state: MumbleStatePayload {
                status: MumbleStatus::Connecting,
                ..Default::default()
            },
            ..Default::default()
        };
        guard.generation
    };
    let _ = app.emit(
        EVENT_STATE,
        MumbleStatePayload {
            status: MumbleStatus::Connecting,
            ..Default::default()
        },
    );

    let options = ConnectOptions {
        host: args.host.trim().to_owned(),
        port: args.port.unwrap_or(DEFAULT_PORT),
        username: args.username.trim().to_owned(),
        password: args.password.filter(|password| !password.is_empty()),
        pinned_fingerprint: args.pinned_fingerprint.filter(|pin| !pin.trim().is_empty()),
        client_name: format!("Kolpak {}", app.package_info().version),
        // Nothing is played back yet, so we join deafened, which also mutes. Unmuting in
        // the UI opens the microphone.
        join_deafened: true,
    };

    let connection = match connect(options).await {
        Ok(connection) => connection,
        Err(error) => {
            let message = error.to_string();
            set_state(&app, &inner, generation, |full| {
                full.state = MumbleStatePayload {
                    status: MumbleStatus::Disconnected,
                    error: Some(message.clone()),
                    ..Default::default()
                };
            })
            .await;
            return Err(message);
        }
    };

    let connected = MumbleConnected {
        fingerprint: connection.fingerprint.clone(),
        pinned: connection.pinned,
    };
    let client = connection.client.clone();
    {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            // Superseded while the handshake was in flight.
            client.disconnect().await;
            return Err("superseded by a newer connection".into());
        }
        guard.client = Some(client.clone());
    }

    let mut events = connection.events;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                Event::ServerVersion { version, .. } => {
                    let mut guard = inner.lock().await;
                    if guard.generation == generation {
                        guard.full.state.server_version = version;
                    }
                }
                Event::Synced { session, .. } => {
                    set_state(&app, &inner, generation, |full| {
                        full.state.status = MumbleStatus::Connected;
                        full.state.session = Some(session);
                        full.state.error = None;
                    })
                    .await;
                    start_audio(&app, &inner, generation, client.clone()).await;
                }
                Event::State(snapshot) => {
                    {
                        let mut guard = inner.lock().await;
                        if guard.generation != generation {
                            continue;
                        }
                        if let Some(audio) = &guard.audio {
                            audio.controls.set_muted(is_muted(&snapshot));
                        }
                        guard.full.snapshot = snapshot.clone();
                    }
                    let _ = app.emit(EVENT_SNAPSHOT, snapshot);
                }
                Event::Ping { rtt_ms } => {
                    {
                        let mut guard = inner.lock().await;
                        if guard.generation != generation {
                            continue;
                        }
                        guard.full.ping_ms = Some(rtt_ms);
                    }
                    let _ = app.emit(EVENT_STATS, MumbleStatsPayload { ping_ms: rtt_ms });
                }
                Event::Text { actor, message } => {
                    let _ = app.emit(EVENT_TEXT, MumbleTextPayload { actor, message });
                }
                Event::Denied { reason } => {
                    log::warn!("mumble: permission denied: {reason}");
                }
                Event::Disconnected(reason) => {
                    let error = describe_disconnect(&reason);
                    {
                        let mut guard = inner.lock().await;
                        if guard.generation == generation {
                            guard.client = None;
                            guard.audio = None;
                        }
                    }
                    set_state(&app, &inner, generation, |full| {
                        *full = MumbleFullState {
                            state: MumbleStatePayload {
                                status: MumbleStatus::Disconnected,
                                error,
                                ..Default::default()
                            },
                            ..Default::default()
                        };
                    })
                    .await;
                    let _ = app.emit(EVENT_SNAPSHOT, MumbleSnapshot::default());
                    break;
                }
            }
        }
    });

    Ok(connected)
}

#[tauri::command]
pub async fn mumble_disconnect<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MumbleState>,
) -> Result<(), String> {
    let client = {
        let mut guard = state.inner.lock().await;
        guard.generation += 1;
        guard.full = MumbleFullState::default();
        guard.audio = None;
        guard.client.take()
    };
    if let Some(client) = client {
        client.disconnect().await;
    }
    let _ = app.emit(EVENT_STATE, MumbleStatePayload::default());
    let _ = app.emit(EVENT_SNAPSHOT, MumbleSnapshot::default());
    Ok(())
}

#[tauri::command]
pub async fn mumble_join_channel(
    state: State<'_, MumbleState>,
    channel_id: u32,
) -> Result<(), String> {
    let client = state.inner.lock().await.client.clone();
    match client {
        Some(client) => {
            client.join_channel(channel_id).await;
            Ok(())
        }
        None => Err("not connected to Mumble".into()),
    }
}

/// Set our own mute and deafen flags on the server. The server echoes the change back as a
/// user state update, which is what the UI draws and what opens or closes the microphone;
/// nothing is assumed locally.
#[tauri::command]
pub async fn mumble_set_self(
    state: State<'_, MumbleState>,
    mute: Option<bool>,
    deaf: Option<bool>,
) -> Result<(), String> {
    let client = state.inner.lock().await.client.clone();
    match client {
        Some(client) => {
            client.set_self(mute, deaf).await;
            Ok(())
        }
        None => Err("not connected to Mumble".into()),
    }
}

/// Transmit mode, voice-activity threshold and microphone. Takes effect at once when
/// connected (changing the microphone reopens it) and is kept for the next connection.
#[tauri::command]
pub async fn mumble_set_transmit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MumbleState>,
    args: MumbleTransmitArgs,
) -> Result<(), String> {
    let mode = parse_mode(&args.mode)?;
    let inner = state.inner.clone();
    let device = args.input_device.filter(|id| !id.is_empty());
    let restart = {
        let mut guard = inner.lock().await;
        guard.mode = mode;
        guard.vad_threshold = args.vad_threshold;
        let device_changed = guard.input_device != device;
        guard.input_device = device;
        if let Some(audio) = &guard.audio {
            audio.controls.set_mode(mode);
            if let Some(threshold) = args.vad_threshold {
                audio.controls.set_vad_threshold(threshold);
            }
        }
        if device_changed && guard.audio.is_some() {
            // Close the old microphone before opening the new one.
            guard.audio = None;
            guard
                .client
                .clone()
                .map(|client| (guard.generation, client))
        } else {
            None
        }
    };
    if let Some((generation, client)) = restart {
        start_audio(&app, &inner, generation, client).await;
    }
    Ok(())
}

/// Push-to-talk key state. Only matters in push-to-talk mode.
#[tauri::command]
pub async fn mumble_ptt(state: State<'_, MumbleState>, down: bool) -> Result<(), String> {
    if let Some(audio) = &state.inner.lock().await.audio {
        audio.controls.set_ptt(down);
    }
    Ok(())
}

/// A microphone the user can pick. Mirrors the crate's type so the generated TypeScript
/// bindings get a real interface for it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInputDevice {
    /// Stable identifier to store in settings.
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub async fn audio_list_input_devices() -> Result<Vec<AudioInputDevice>, String> {
    let devices = tauri::async_runtime::spawn_blocking(list_input_devices)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(devices
        .into_iter()
        .map(|device| AudioInputDevice {
            id: device.id,
            name: device.name,
            is_default: device.is_default,
        })
        .collect())
}

/// The current state, for a webview that has just loaded.
#[tauri::command]
pub async fn mumble_get_state(state: State<'_, MumbleState>) -> Result<MumbleFullState, String> {
    Ok(state.inner.lock().await.full.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kolpak_mumble::User;

    fn user(session: u32) -> User {
        User {
            session,
            name: format!("user{session}"),
            channel_id: 0,
            mute: false,
            deaf: false,
            suppress: false,
            self_mute: false,
            self_deaf: false,
            registered: false,
            priority_speaker: false,
            recording: false,
        }
    }

    #[test]
    fn rejections_are_described_for_people() {
        assert_eq!(describe_disconnect(&Disconnect::Requested), None);
        assert_eq!(
            describe_disconnect(&Disconnect::Rejected {
                reject: RejectKind::UsernameInUse,
                reason: "Username already in use".into(),
            })
            .as_deref(),
            Some("that name is already in use on the server")
        );
        assert_eq!(
            describe_disconnect(&Disconnect::Rejected {
                reject: RejectKind::Unknown,
                reason: "custom reason".into(),
            })
            .as_deref(),
            Some("custom reason")
        );
    }

    #[test]
    fn state_payload_uses_camel_case_and_omits_empty_fields() {
        let json = serde_json::to_value(MumbleStatePayload {
            status: MumbleStatus::Connected,
            session: Some(7),
            server_version: Some("1.5.634".into()),
            error: None,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "status": "connected", "session": 7, "serverVersion": "1.5.634" })
        );
    }

    #[test]
    fn transmit_modes_parse_from_their_setting_names() {
        assert_eq!(parse_mode("ptt"), Ok(TransmitMode::Ptt));
        assert_eq!(parse_mode("vad"), Ok(TransmitMode::Vad));
        assert_eq!(parse_mode("continuous"), Ok(TransmitMode::Continuous));
        assert!(parse_mode("shout").is_err());
    }

    #[test]
    fn the_microphone_stays_closed_unless_the_server_says_we_are_open() {
        // Not synced, or our own user not in the snapshot yet: closed.
        assert!(is_muted(&MumbleSnapshot::default()));

        let mut snapshot = MumbleSnapshot {
            session: Some(2),
            channels: Vec::new(),
            users: vec![user(1), user(2)],
        };
        assert!(!is_muted(&snapshot));

        snapshot.users[1].self_mute = true;
        assert!(is_muted(&snapshot));
        snapshot.users[1].self_mute = false;
        snapshot.users[1].self_deaf = true;
        assert!(is_muted(&snapshot));
        snapshot.users[1].self_deaf = false;
        // Muted by an admin, or not allowed to speak in this channel.
        snapshot.users[1].mute = true;
        assert!(is_muted(&snapshot));
        snapshot.users[1].mute = false;
        snapshot.users[1].suppress = true;
        assert!(is_muted(&snapshot));

        // Someone else being muted does not close our microphone.
        snapshot.users[1].suppress = false;
        snapshot.users[0].self_mute = true;
        assert!(!is_muted(&snapshot));
    }
}
