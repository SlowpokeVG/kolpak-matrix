//! Kolpak: the bridge between the webview and the Mumble client (crates/kolpak-mumble).
//! Desktop and Android; on Android the app side of voice (foreground service, audio mode)
//! is in mobile.rs and the Kotlin VoiceService / VoiceAudio.
//!
//! The webview sends commands and receives state; it never sees audio (AI/SPEC.md §3, §5.5).
//! Built so far: the control connection and voice in both directions. The microphone is
//! captured, gated and encoded on the Rust side; incoming voice is decoded, mixed and
//! played on the Rust side. Voice travels over the encrypted UDP channel when that gets
//! through, and tunnelled through the control connection when it does not.
//!
//! Events:
//!   mumble://state     { status, session?, serverVersion?, error? }
//!   mumble://snapshot  { session, channels, users }   the whole tree, on every change
//!   mumble://stats     { pingMs }
//!   mumble://text      { actor?, message }
//!   mumble://transport { udp }                        voice switched between UDP and the tunnel
//!   mumble://talking   { sessions }                   who is speaking, when it changes
//!   mumble://denied    { reason }                     the server refused something (a move, say)
//!   audio://levels     { input, output, transmitting }  about ten times a second while connected
//!   audio://capture    { deviceName?, error?, outputDeviceName?, outputError? }
//!                                                     when a device opens or fails

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use kolpak_mumble::audio::{list_input_devices, pump_voice, Capture, Controls};
use kolpak_mumble::key_state;
use kolpak_mumble::playback::{list_output_devices, Mixer, Playback};
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
const EVENT_TALKING: &str = "mumble://talking";
const EVENT_TRANSPORT: &str = "mumble://transport";
const EVENT_DENIED: &str = "mumble://denied";
const EVENT_LEVELS: &str = "audio://levels";
const EVENT_CAPTURE: &str = "audio://capture";

const LEVELS_INTERVAL: Duration = Duration::from_millis(100);
/// How often the push-to-talk key is read. 10 ms is half a voice frame.
const PTT_POLL_INTERVAL: Duration = Duration::from_millis(10);

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
pub struct MumbleDeniedPayload {
    pub reason: String,
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
    /// RMS of the most recent block played, 0.0 to 1.0.
    pub output: f32,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleTransportPayload {
    /// True while voice uses the UDP channel; false while it is tunnelled over TCP.
    pub udp: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleTalkingPayload {
    /// Sessions of the people speaking right now, not counting ourselves.
    pub sessions: Vec<u32>,
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
    /// True while voice uses the UDP channel.
    pub udp: bool,
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
    /// Everyone we can hear. Lives for the whole connection; the output stream that plays
    /// it can be reopened on another device.
    mixer: Option<Arc<Mixer>>,
    playback: Option<Playback>,
    full: MumbleFullState,
    // Transmit settings. They outlive connections so a change made while disconnected
    // applies to the next one.
    mode: TransmitMode,
    vad_threshold: Option<f32>,
    input_device: Option<String>,
    output_device: Option<String>,
    /// 0.0 to 2.0; absent means unchanged (1.0).
    output_volume: Option<f32>,
    /// Per-person volume for this connection, session to gain (0.0 is muted for us). Set
    /// by the webview, which keeps the settings by name; applied to every new mixer.
    user_gains: HashMap<u32, f32>,
    /// Virtual-key code of the push-to-talk key, 0 for none. Shared with the task that
    /// reads the key, so a rebind applies without restarting anything.
    ptt_key: Arc<AtomicU32>,
    /// Noise suppression on the microphone; absent means on.
    denoise: Option<bool>,
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
    /// `KeyboardEvent.code` of the push-to-talk key; empty or absent for none.
    pub ptt_key: Option<String>,
    /// Noise suppression on the microphone; absent leaves it as it is.
    pub noise_suppression: Option<bool>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleOutputArgs {
    /// Output device ID from `audio_list_output_devices`; empty or absent for the default.
    pub output_device: Option<String>,
    /// 0.0 to 2.0, where 1.0 leaves the level unchanged.
    pub volume: Option<f32>,
}

/// Whether the server's view of us means we must not play anything.
fn is_deafened(snapshot: &MumbleSnapshot) -> bool {
    snapshot
        .users
        .iter()
        .find(|user| Some(user.session) == snapshot.session)
        .is_some_and(|me| me.self_deaf || me.deaf)
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

/// Android: while connected, a foreground service keeps the app (and so the connection and
/// the audio threads) alive with the screen off, and in call mode the audio system is put in
/// communication mode with the route picked for voice. Nothing to do elsewhere.
fn voice_session(active: bool) {
    #[cfg(target_os = "android")]
    {
        let result = if active {
            crate::mobile::start_voice_session(kolpak_mumble::android_audio::call_mode())
        } else {
            crate::mobile::stop_voice_session()
        };
        if let Err(error) = result {
            let what = if active { "start" } else { "stop" };
            log::warn!("mumble: could not {what} the Android voice session: {error}");
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = active;
}

/// Open the microphone for the connection `generation` and start sending.
async fn start_audio<R: Runtime>(
    app: &AppHandle<R>,
    inner: &Arc<Mutex<Inner>>,
    generation: u64,
    client: Client,
) {
    let (mode, vad_threshold, device, ptt_key, denoise) = {
        let guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        (
            guard.mode,
            guard.vad_threshold,
            guard.input_device.clone(),
            guard.ptt_key.clone(),
            guard.denoise,
        )
    };
    let controls = Arc::new(Controls::new(mode));
    if let Some(threshold) = vad_threshold {
        controls.set_vad_threshold(threshold);
    }
    controls.set_denoise(denoise.unwrap_or(true));

    let (frame_tx, frame_rx) = tokio::sync::mpsc::unbounded_channel();
    let capture_controls = controls.clone();
    // Opening a device blocks for a moment; keep it off the async threads.
    let opened = tauri::async_runtime::spawn_blocking(move || {
        Capture::start(device, capture_controls, frame_tx)
    })
    .await;

    let (capture, device_name, error) = match opened {
        Ok(Ok(capture)) => {
            let name = capture.info.device_name.clone();
            (Some(capture), Some(name), None)
        }
        Ok(Err(error)) => (None, None, Some(error.to_string())),
        Err(error) => (None, None, Some(error.to_string())),
    };
    if let Some(error) = &error {
        log::warn!("mumble: microphone unavailable: {error}");
    }

    let payload = {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            // Dropping `capture` here closes the microphone again.
            return;
        }
        controls.set_muted(is_muted(&guard.full.snapshot));
        guard.full.capture.device_name = device_name;
        guard.full.capture.error = error;
        guard.audio = Some(AudioSession {
            controls: controls.clone(),
            _capture: capture,
        });
        guard.full.capture.clone()
    };
    let _ = app.emit(EVENT_CAPTURE, payload);

    tauri::async_runtime::spawn(pump_voice(client, frame_rx));

    // Push to talk from anywhere: read the key's state, which works while another app has
    // focus and does not take the key away from it. Ends when this microphone session does.
    if key_state::is_supported() {
        let session = Arc::downgrade(&controls);
        tauri::async_runtime::spawn(async move {
            let mut was_down = false;
            loop {
                tokio::time::sleep(PTT_POLL_INTERVAL).await;
                let Some(controls) = session.upgrade() else {
                    break;
                };
                let key = ptt_key.load(Ordering::Relaxed);
                let down = key != 0
                    && controls.mode() == TransmitMode::Ptt
                    && key_state::is_key_down(key as u16).unwrap_or(false);
                if down != was_down {
                    was_down = down;
                    controls.set_ptt(down);
                }
            }
        });
    }

    // Level meter and talking light for the UI.
    let levels_app = app.clone();
    let levels_inner = inner.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = (f32::NAN, f32::NAN, false);
        loop {
            tokio::time::sleep(LEVELS_INTERVAL).await;
            let output = {
                let guard = levels_inner.lock().await;
                let same_session = guard
                    .audio
                    .as_ref()
                    .is_some_and(|audio| Arc::ptr_eq(&audio.controls, &controls));
                if guard.generation != generation || !same_session {
                    break;
                }
                guard.mixer.as_ref().map_or(0.0, |mixer| mixer.level())
            };
            let now = (controls.level(), output, controls.is_transmitting());
            if now != last {
                last = now;
                let _ = levels_app.emit(
                    EVENT_LEVELS,
                    AudioLevelsPayload {
                        input: now.0,
                        output: now.1,
                        transmitting: now.2,
                    },
                );
            }
        }
    });
}

/// Open the output device for the connection `generation` and play the mixer through it.
async fn open_playback<R: Runtime>(app: &AppHandle<R>, inner: &Arc<Mutex<Inner>>, generation: u64) {
    let (mixer, device) = {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        // Close the old stream first; two streams would play the same audio twice.
        guard.playback = None;
        let Some(mixer) = guard.mixer.clone() else {
            return;
        };
        (mixer, guard.output_device.clone())
    };
    let opened = tauri::async_runtime::spawn_blocking(move || Playback::start(device, mixer)).await;
    let (playback, name, error) = match opened {
        Ok(Ok(playback)) => {
            let name = playback.info.device_name.clone();
            (Some(playback), Some(name), None)
        }
        Ok(Err(error)) => (None, None, Some(error.to_string())),
        Err(error) => (None, None, Some(error.to_string())),
    };
    if let Some(error) = &error {
        log::warn!("mumble: output device unavailable: {error}");
    }
    let payload = {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        guard.playback = playback;
        guard.full.capture.output_device_name = name;
        guard.full.capture.output_error = error;
        guard.full.capture.clone()
    };
    let _ = app.emit(EVENT_CAPTURE, payload);
}

/// Start hearing: a mixer for the connection, a task feeding it from the wire, the output
/// stream, and a task reporting who is talking.
async fn start_playback<R: Runtime>(
    app: &AppHandle<R>,
    inner: &Arc<Mutex<Inner>>,
    generation: u64,
    mut voice: tokio::sync::mpsc::UnboundedReceiver<bytes::Bytes>,
) {
    let mixer = Arc::new(Mixer::new());
    {
        let mut guard = inner.lock().await;
        if guard.generation != generation {
            return;
        }
        if let Some(volume) = guard.output_volume {
            mixer.set_volume(volume);
        }
        mixer.set_session_gains(&guard.user_gains);
        mixer.set_silenced(is_deafened(&guard.full.snapshot));
        guard.mixer = Some(mixer.clone());
    }

    // Decoding happens here, off the audio thread; the channel ends with the connection.
    let feed = mixer.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(packet) = voice.recv().await {
            feed.push_packet(&packet);
        }
    });

    open_playback(app, inner, generation).await;

    let talking_app = app.clone();
    let talking_inner = inner.clone();
    tauri::async_runtime::spawn(async move {
        let mut last: Vec<u32> = Vec::new();
        loop {
            tokio::time::sleep(LEVELS_INTERVAL).await;
            {
                let guard = talking_inner.lock().await;
                let same = guard
                    .mixer
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &mixer));
                if guard.generation != generation || !same {
                    break;
                }
            }
            let now = mixer.talking();
            if now != last {
                last.clone_from(&now);
                let _ = talking_app.emit(EVENT_TALKING, MumbleTalkingPayload { sessions: now });
            }
        }
        let _ = talking_app.emit(
            EVENT_TALKING,
            MumbleTalkingPayload {
                sessions: Vec::new(),
            },
        );
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
        guard.playback = None;
        guard.mixer = None;
        // Sessions belong to a connection; the webview sends the gains again once synced.
        guard.user_gains.clear();
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
    // Before any audio stream opens, so the streams start on the voice route.
    voice_session(true);

    let options = ConnectOptions {
        host: args.host.trim().to_owned(),
        port: args.port.unwrap_or(DEFAULT_PORT),
        username: args.username.trim().to_owned(),
        password: args.password.filter(|password| !password.is_empty()),
        pinned_fingerprint: args.pinned_fingerprint.filter(|pin| !pin.trim().is_empty()),
        client_name: format!("Kolpak {}", app.package_info().version),
        // Join hearing but with the microphone closed, so nothing is sent until the user
        // opens it. Deafening in the UI stops playback too.
        join_muted: true,
        join_deafened: false,
    };

    let connection = match connect(options).await {
        Ok(connection) => connection,
        Err(error) => {
            let message = error.to_string();
            if inner.lock().await.generation == generation {
                voice_session(false);
            }
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
    let mut voice = Some(connection.voice);
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
                    if let Some(voice) = voice.take() {
                        start_playback(&app, &inner, generation, voice).await;
                    }
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
                        if let Some(mixer) = &guard.mixer {
                            mixer.set_silenced(is_deafened(&snapshot));
                            let present: HashSet<u32> =
                                snapshot.users.iter().map(|user| user.session).collect();
                            mixer.retain_sessions(&present);
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
                Event::Udp { active } => {
                    {
                        let mut guard = inner.lock().await;
                        if guard.generation != generation {
                            continue;
                        }
                        guard.full.udp = active;
                    }
                    let _ = app.emit(EVENT_TRANSPORT, MumbleTransportPayload { udp: active });
                }
                Event::Text { actor, message } => {
                    let _ = app.emit(EVENT_TEXT, MumbleTextPayload { actor, message });
                }
                Event::Denied { reason } => {
                    log::warn!("mumble: permission denied: {reason}");
                    let _ = app.emit(EVENT_DENIED, MumbleDeniedPayload { reason });
                }
                Event::Disconnected(reason) => {
                    let error = describe_disconnect(&reason);
                    {
                        let mut guard = inner.lock().await;
                        if guard.generation == generation {
                            guard.client = None;
                            guard.audio = None;
                            guard.playback = None;
                            guard.mixer = None;
                            voice_session(false);
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
        guard.playback = None;
        guard.mixer = None;
        guard.client.take()
    };
    if let Some(client) = client {
        client.disconnect().await;
    }
    voice_session(false);
    let _ = app.emit(EVENT_STATE, MumbleStatePayload::default());
    let _ = app.emit(EVENT_SNAPSHOT, MumbleSnapshot::default());
    Ok(())
}

/// Disconnect from outside the webview: the Leave button on Android's voice notification.
#[cfg(target_os = "android")]
pub fn leave_voice<R: Runtime>(app: AppHandle<R>) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let state = app.state::<MumbleState>();
        if let Err(error) = mumble_disconnect(app.clone(), state).await {
            log::warn!("mumble: leaving from the notification failed: {error}");
        }
    });
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
        let key = args
            .ptt_key
            .as_deref()
            .and_then(key_state::virtual_key_from_code)
            .unwrap_or(0);
        guard.ptt_key.store(u32::from(key), Ordering::Relaxed);
        if args.noise_suppression.is_some() {
            guard.denoise = args.noise_suppression;
        }
        let device_changed = guard.input_device != device;
        guard.input_device = device;
        if let Some(audio) = &guard.audio {
            audio.controls.set_mode(mode);
            if let Some(threshold) = args.vad_threshold {
                audio.controls.set_vad_threshold(threshold);
            }
            if let Some(enabled) = args.noise_suppression {
                audio.controls.set_denoise(enabled);
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

/// Output device and volume. Takes effect at once when connected (changing the device
/// reopens it) and is kept for the next connection.
#[tauri::command]
pub async fn mumble_set_output<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MumbleState>,
    args: MumbleOutputArgs,
) -> Result<(), String> {
    let inner = state.inner.clone();
    let device = args.output_device.filter(|id| !id.is_empty());
    let reopen = {
        let mut guard = inner.lock().await;
        guard.output_volume = args.volume;
        if let (Some(mixer), Some(volume)) = (&guard.mixer, args.volume) {
            mixer.set_volume(volume);
        }
        let device_changed = guard.output_device != device;
        guard.output_device = device;
        (device_changed && guard.mixer.is_some()).then_some(guard.generation)
    };
    if let Some(generation) = reopen {
        open_playback(&app, &inner, generation).await;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MumbleUserGain {
    pub session: u32,
    /// 0.0 (muted for us) to 2.0.
    pub gain: f32,
}

/// Per-person volume, replacing the previous set. Only people whose volume is not 100%
/// need to be listed. Sessions are per connection, so the webview sends the set again
/// whenever the people on the server change.
#[tauri::command]
pub async fn mumble_set_user_gains(
    state: State<'_, MumbleState>,
    gains: Vec<MumbleUserGain>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    guard.user_gains = gains
        .into_iter()
        .filter(|entry| entry.gain.is_finite())
        .map(|entry| (entry.session, entry.gain.clamp(0.0, 2.0)))
        .collect();
    let mut summary: Vec<String> = guard
        .user_gains
        .iter()
        .map(|(session, gain)| format!("{session}={gain:.2}"))
        .collect();
    summary.sort_unstable();
    log::info!("mumble: per-person volume [{}]", summary.join(", "));
    if let Some(mixer) = &guard.mixer {
        mixer.set_session_gains(&guard.user_gains);
    }
    Ok(())
}

#[tauri::command]
pub async fn audio_list_output_devices() -> Result<Vec<AudioInputDevice>, String> {
    let devices = tauri::async_runtime::spawn_blocking(list_output_devices)
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

/// Push-to-talk key state as seen by the webview, which only knows about keys pressed
/// while its own window has focus. Used where the key cannot be read system-wide; where it
/// can, the native reading is the only source, so the two never disagree.
#[tauri::command]
pub async fn mumble_ptt(state: State<'_, MumbleState>, down: bool) -> Result<(), String> {
    if key_state::is_supported() {
        return Ok(());
    }
    if let Some(audio) = &state.inner.lock().await.audio {
        audio.controls.set_ptt(down);
    }
    Ok(())
}

/// A microphone or an output the user can pick. Mirrors the crate's type so the generated
/// TypeScript bindings get a real interface for it.
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

/// Android: call mode (the phone's echo cancellation, voice routing) or media mode (no echo
/// cancellation, Bluetooth stays on its high-quality link). Kept for the next connection;
/// while connected, the speaker and the microphone are reopened in the new mode. Does
/// nothing on other platforms.
#[tauri::command]
pub async fn mumble_set_call_audio<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, MumbleState>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use kolpak_mumble::android_audio;
        if android_audio::call_mode() == enabled {
            return Ok(());
        }
        android_audio::set_call_mode(enabled);
        let inner = state.inner.clone();
        let reopen = {
            let mut guard = inner.lock().await;
            match guard.client.clone() {
                Some(client) => {
                    // Close both streams before the audio system changes mode under them.
                    guard.audio = None;
                    guard.playback = None;
                    Some((guard.generation, client))
                }
                None => None,
            }
        };
        if let Some((generation, client)) = reopen {
            if let Err(error) = crate::mobile::start_voice_session(enabled) {
                log::warn!("mumble: could not switch the Android audio mode: {error}");
            }
            open_playback(&app, &inner, generation).await;
            start_audio(&app, &inner, generation, client).await;
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, state, enabled);
    Ok(())
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
    fn playback_stops_only_when_we_are_deafened() {
        assert!(!is_deafened(&MumbleSnapshot::default()));
        let mut snapshot = MumbleSnapshot {
            session: Some(2),
            channels: Vec::new(),
            users: vec![user(1), user(2)],
        };
        assert!(!is_deafened(&snapshot));
        // Muted is not deafened: we still hear.
        snapshot.users[1].self_mute = true;
        assert!(!is_deafened(&snapshot));
        snapshot.users[1].self_deaf = true;
        assert!(is_deafened(&snapshot));
        snapshot.users[1].self_deaf = false;
        snapshot.users[1].deaf = true;
        assert!(is_deafened(&snapshot));
        // Someone else being deafened is not our business.
        snapshot.users[1].deaf = false;
        snapshot.users[0].self_deaf = true;
        assert!(!is_deafened(&snapshot));
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
