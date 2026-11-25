//! The control connection: connect, authenticate, keep the server state up to date, ping.
//! No audio. Voice packets the server tunnels over TCP are dropped.

use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};
use prost::Message;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

use crate::codec::{decode_frame, encode_frame, encode_raw_frame, Frame};
use crate::proto::{self, MessageType};
use crate::state::{ServerState, Snapshot};
use crate::tls;
use crate::udp::{self, UdpLink};

pub const DEFAULT_PORT: u16 = 64738;

/// The protocol version we announce. 1.5.0 is the first with the protobuf UDP format.
const PROTOCOL_VERSION: (u16, u16, u16) = (1, 5, 0);

/// The server drops clients that stay silent for 30 seconds.
const PING_INTERVAL: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct ConnectOptions {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    /// SHA-256 fingerprint of the server certificate from an earlier connection.
    /// `None` accepts whatever the server presents and reports it in [`Event::Secured`].
    pub pinned_fingerprint: Option<String>,
    /// Shown to other users as the client name, for example "Kolpak 0.1".
    pub client_name: String,
    /// Mark ourselves muted as soon as we are in, so the microphone stays closed until the
    /// user opens it.
    pub join_muted: bool,
    /// Mark ourselves deafened (which also mutes) as soon as we are in. The server then
    /// sends us no voice at all.
    pub join_deafened: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RejectKind {
    None,
    WrongVersion,
    InvalidUsername,
    WrongUserPassword,
    WrongServerPassword,
    UsernameInUse,
    ServerFull,
    NoCertificate,
    AuthenticatorFail,
    NoNewConnections,
    Unknown,
}

impl RejectKind {
    fn from_wire(value: Option<i32>) -> Self {
        match value {
            Some(0) | None => Self::None,
            Some(1) => Self::WrongVersion,
            Some(2) => Self::InvalidUsername,
            Some(3) => Self::WrongUserPassword,
            Some(4) => Self::WrongServerPassword,
            Some(5) => Self::UsernameInUse,
            Some(6) => Self::ServerFull,
            Some(7) => Self::NoCertificate,
            Some(8) => Self::AuthenticatorFail,
            Some(9) => Self::NoNewConnections,
            Some(_) => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Disconnect {
    /// We asked for it.
    Requested,
    /// The server refused the login.
    Rejected {
        reject: RejectKind,
        reason: String,
    },
    /// The server closed the connection.
    Closed,
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The server's own version, the first thing it sends.
    ServerVersion {
        version: Option<String>,
        release: Option<String>,
        os: Option<String>,
    },
    /// Login accepted; the state received so far is complete.
    Synced {
        session: u32,
        max_bandwidth: Option<u32>,
        welcome_text: Option<String>,
    },
    /// Channels or users changed. Sent once on sync and then on every change.
    State(Snapshot),
    /// Round trip of a control-channel ping.
    Ping {
        rtt_ms: f32,
    },
    /// Voice switched between the UDP channel (`true`) and the tunnel through the control
    /// connection (`false`). Starts on the tunnel.
    Udp {
        active: bool,
    },
    Text {
        actor: Option<u32>,
        message: String,
    },
    /// The server refused something we asked for; `reason` is a sentence for the user.
    Denied {
        reason: String,
    },
    /// Always the last event.
    Disconnected(Disconnect),
}

#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    #[error("\"{0}\" is not a valid host name")]
    InvalidHost(String),
    #[error("could not reach the server: {0}")]
    Io(#[from] std::io::Error),
    #[error("timed out connecting to the server")]
    Timeout,
    #[error("TLS setup failed: {0}")]
    Tls(String),
    #[error(
        "the server's certificate changed: expected fingerprint {expected}, got {actual}. \
         Connect only if you know the server was reinstalled."
    )]
    FingerprintMismatch { expected: String, actual: String },
}

/// What [`connect`] hands back once TLS is up.
#[derive(Debug)]
pub struct Connection {
    pub client: Client,
    pub events: mpsc::Receiver<Event>,
    /// Voice packets from the server, as raw bytes for `crate::voice::decode_audio_packet`.
    /// Unbounded so that a slow consumer cannot stall the control connection; dropping the
    /// receiver just discards incoming voice.
    pub voice: mpsc::UnboundedReceiver<Bytes>,
    /// SHA-256 fingerprint of the certificate the server presented. Store it and pass it
    /// as `pinned_fingerprint` next time.
    pub fingerprint: String,
    /// False when this certificate was accepted on first use rather than matched to a pin.
    pub pinned: bool,
}

enum Command {
    Disconnect,
    JoinChannel(u32),
    SetSelf {
        mute: Option<bool>,
        deaf: Option<bool>,
    },
    /// A finished voice packet (see `crate::voice`) to tunnel through this connection.
    Voice(Bytes),
}

/// Handle for talking to a live connection. Dropping it disconnects.
#[derive(Debug, Clone)]
pub struct Client {
    commands: mpsc::Sender<Command>,
}

impl Client {
    pub async fn disconnect(&self) {
        let _ = self.commands.send(Command::Disconnect).await;
    }

    pub async fn join_channel(&self, channel_id: u32) {
        let _ = self.commands.send(Command::JoinChannel(channel_id)).await;
    }

    pub async fn set_self(&self, mute: Option<bool>, deaf: Option<bool>) {
        let _ = self.commands.send(Command::SetSelf { mute, deaf }).await;
    }

    /// Queue one voice packet. Never waits: if the connection is backed up, the packet is
    /// dropped, because late audio is worse than missing audio.
    pub fn send_voice(&self, packet: Bytes) {
        let _ = self.commands.try_send(Command::Voice(packet));
    }
}

/// `major.minor.patch` from either version field, preferring the 1.5 one.
pub fn format_version(version_v1: Option<u32>, version_v2: Option<u64>) -> Option<String> {
    if let Some(v2) = version_v2 {
        return Some(format!(
            "{}.{}.{}",
            (v2 >> 48) & 0xffff,
            (v2 >> 32) & 0xffff,
            (v2 >> 16) & 0xffff
        ));
    }
    version_v1.map(|v1| format!("{}.{}.{}", (v1 >> 16) & 0xffff, (v1 >> 8) & 0xff, v1 & 0xff))
}

fn version_message(client_name: &str) -> proto::Version {
    let (major, minor, patch) = PROTOCOL_VERSION;
    proto::Version {
        version_v1: Some(
            (u32::from(major) << 16) | (u32::from(minor) << 8) | u32::from(patch.min(255)),
        ),
        version_v2: Some(
            (u64::from(major) << 48) | (u64::from(minor) << 32) | (u64::from(patch) << 16),
        ),
        release: Some(client_name.to_owned()),
        os: Some(std::env::consts::OS.to_owned()),
        os_version: None,
    }
}

/// Open the control connection and start the login. Returns as soon as TLS is established;
/// everything after that, including a rejected login, arrives as an [`Event`].
pub async fn connect(options: ConnectOptions) -> Result<Connection, ConnectError> {
    let server_name = ServerName::try_from(options.host.clone())
        .map_err(|_| ConnectError::InvalidHost(options.host.clone()))?;
    let (config, seen) = tls::client_config(options.pinned_fingerprint.clone())
        .map_err(|error| ConnectError::Tls(error.to_string()))?;
    let connector = TlsConnector::from(Arc::new(config));

    let handshake = async {
        let tcp = TcpStream::connect((options.host.as_str(), options.port)).await?;
        tcp.set_nodelay(true)?;
        // Voice over UDP goes to the same address and port as the control connection.
        let peer = tcp.peer_addr().ok();
        let stream = connector.connect(server_name, tcp).await?;
        Ok::<_, std::io::Error>((stream, peer))
    };
    let stream = match tokio::time::timeout(CONNECT_TIMEOUT, handshake).await {
        Err(_) => return Err(ConnectError::Timeout),
        Ok(Err(error)) => {
            let actual = seen.lock().unwrap_or_else(|p| p.into_inner()).clone();
            return Err(match (&options.pinned_fingerprint, actual) {
                (Some(expected), Some(actual)) if !tls::fingerprints_match(expected, &actual) => {
                    ConnectError::FingerprintMismatch {
                        expected: expected.clone(),
                        actual,
                    }
                }
                _ => ConnectError::Io(error),
            });
        }
        Ok(Ok(connected)) => connected,
    };
    let (stream, udp_target) = stream;

    let fingerprint = seen
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or_else(|| ConnectError::Tls("the server presented no certificate".into()))?;
    let pinned = options.pinned_fingerprint.is_some();

    let (event_tx, event_rx) = mpsc::channel(64);
    // Room for a few seconds of 20 ms voice packets on top of ordinary commands.
    let (command_tx, command_rx) = mpsc::channel(256);
    let (voice_tx, voice_rx) = mpsc::unbounded_channel();
    tokio::spawn(run(
        stream, options, event_tx, command_rx, voice_tx, udp_target,
    ));

    Ok(Connection {
        client: Client {
            commands: command_tx,
        },
        events: event_rx,
        voice: voice_rx,
        fingerprint,
        pinned,
    })
}

/// What handling one frame asks the connection loop to do.
#[derive(Default)]
struct Outcome {
    events: Vec<Event>,
    send: Vec<Bytes>,
    stop: Option<Disconnect>,
}

/// Protocol logic with no I/O in it, so it can be tested by feeding it frames.
struct Session {
    state: ServerState,
    synced: bool,
    /// State changed since the last snapshot was sent.
    dirty: bool,
    started: Instant,
    join_muted: bool,
    join_deafened: bool,
}

impl Session {
    fn new(join_muted: bool, join_deafened: bool) -> Self {
        Self {
            state: ServerState::new(),
            synced: false,
            dirty: false,
            started: Instant::now(),
            join_muted,
            join_deafened,
        }
    }

    fn now_micros(&self) -> u64 {
        self.started.elapsed().as_micros() as u64
    }

    fn ping_frame(&self) -> Bytes {
        encode_frame(
            MessageType::Ping,
            &proto::Ping {
                timestamp: Some(self.now_micros()),
                ..Default::default()
            },
        )
    }

    fn handle(&mut self, frame: Frame) -> Outcome {
        let mut out = Outcome::default();
        let Some(kind) = MessageType::from_u16(frame.kind) else {
            log::debug!("ignoring unknown control message type {}", frame.kind);
            return out;
        };
        let payload = frame.payload;
        // A message we cannot parse is logged and skipped; one bad message should not
        // cost the whole connection.
        macro_rules! decode {
            ($ty:ty) => {
                match <$ty>::decode(payload) {
                    Ok(message) => message,
                    Err(error) => {
                        log::warn!("could not decode {:?}: {error}", kind);
                        return out;
                    }
                }
            };
        }

        match kind {
            MessageType::Version => {
                let msg = decode!(proto::Version);
                out.events.push(Event::ServerVersion {
                    version: format_version(msg.version_v1, msg.version_v2),
                    release: msg.release,
                    os: msg.os,
                });
            }
            MessageType::Reject => {
                let msg = decode!(proto::Reject);
                out.stop = Some(Disconnect::Rejected {
                    reject: RejectKind::from_wire(msg.r#type),
                    reason: msg.reason.unwrap_or_default(),
                });
            }
            MessageType::ChannelState => {
                let msg = decode!(proto::ChannelState);
                self.dirty |= self.state.apply_channel_state(&msg);
            }
            MessageType::ChannelRemove => {
                let msg = decode!(proto::ChannelRemove);
                self.dirty |= self.state.remove_channel(msg.channel_id);
            }
            MessageType::UserState => {
                let msg = decode!(proto::UserState);
                self.dirty |= self.state.apply_user_state(&msg);
            }
            MessageType::UserRemove => {
                let msg = decode!(proto::UserRemove);
                if Some(msg.session) == self.state.session() {
                    // We were kicked or banned.
                    out.stop = Some(Disconnect::Rejected {
                        reject: RejectKind::None,
                        reason: msg
                            .reason
                            .unwrap_or_else(|| "removed from the server".into()),
                    });
                } else {
                    self.dirty |= self.state.remove_user(msg.session);
                }
            }
            MessageType::ServerSync => {
                let msg = decode!(proto::ServerSync);
                let session = msg.session.unwrap_or_default();
                self.state.set_session(session);
                self.synced = true;
                self.dirty = true;
                out.events.push(Event::Synced {
                    session,
                    max_bandwidth: msg.max_bandwidth,
                    welcome_text: msg.welcome_text,
                });
                if self.join_muted || self.join_deafened {
                    out.send.push(encode_frame(
                        MessageType::UserState,
                        &proto::UserState {
                            session: Some(session),
                            self_mute: Some(true),
                            self_deaf: Some(self.join_deafened),
                            ..Default::default()
                        },
                    ));
                }
                // An early ping gives the UI a latency figure without waiting 15 seconds.
                out.send.push(self.ping_frame());
            }
            MessageType::Ping => {
                let msg = decode!(proto::Ping);
                if let Some(sent) = msg.timestamp {
                    let rtt = self.now_micros().saturating_sub(sent);
                    out.events.push(Event::Ping {
                        rtt_ms: rtt as f32 / 1000.0,
                    });
                }
            }
            MessageType::TextMessage => {
                let msg = decode!(proto::TextMessage);
                out.events.push(Event::Text {
                    actor: msg.actor,
                    message: msg.message,
                });
            }
            MessageType::PermissionDenied => {
                let msg = decode!(proto::PermissionDenied);
                out.events.push(Event::Denied {
                    reason: describe_denial(&msg),
                });
            }
            // Everything Kolpak does not use yet. Tunnelled voice and the UDP key material
            // never reach here: the connection loop takes them before parsing.
            _ => {}
        }
        out
    }

    /// The snapshot to send after a batch of frames, if anything changed since the last one.
    fn take_snapshot(&mut self) -> Option<Snapshot> {
        if self.synced && self.dirty {
            self.dirty = false;
            Some(self.state.snapshot())
        } else {
            None
        }
    }

    fn command_frame(&self, command: &Command) -> Option<Bytes> {
        let session = self.state.session()?;
        let state = match command {
            Command::Disconnect => return None,
            // Voice is not a protobuf control message; it goes out as raw bytes. Only once
            // we are in: the server ignores audio from clients it has not synced.
            Command::Voice(packet) => {
                return Some(encode_raw_frame(MessageType::UdpTunnel, packet));
            }
            Command::JoinChannel(channel_id) => proto::UserState {
                session: Some(session),
                channel_id: Some(*channel_id),
                ..Default::default()
            },
            Command::SetSelf { mute, deaf } => proto::UserState {
                session: Some(session),
                self_mute: *mute,
                self_deaf: *deaf,
                ..Default::default()
            },
        };
        Some(encode_frame(MessageType::UserState, &state))
    }
}

async fn run<S>(
    stream: S,
    options: ConnectOptions,
    events: mpsc::Sender<Event>,
    mut commands: mpsc::Receiver<Command>,
    voice: mpsc::UnboundedSender<Bytes>,
    udp_target: Option<std::net::SocketAddr>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut session = Session::new(options.join_muted, options.join_deafened);
    let mut udp = UdpLink::new(udp_target);
    let mut datagram = [0u8; udp::MAX_DATAGRAM];

    let hello = [
        encode_frame(MessageType::Version, &version_message(&options.client_name)),
        encode_frame(
            MessageType::Authenticate,
            &proto::Authenticate {
                username: Some(options.username.clone()),
                password: options.password.clone(),
                opus: Some(true),
                ..Default::default()
            },
        ),
    ];

    let reason = 'conn: {
        for frame in &hello {
            if let Err(error) = writer.write_all(frame).await {
                break 'conn Disconnect::Error {
                    message: error.to_string(),
                };
            }
        }

        let mut buf = BytesMut::with_capacity(16 * 1024);
        let mut ping =
            tokio::time::interval_at(tokio::time::Instant::now() + PING_INTERVAL, PING_INTERVAL);
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut udp_ping = tokio::time::interval(udp::PING_INTERVAL);
        udp_ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                read = reader.read_buf(&mut buf) => {
                    match read {
                        Ok(0) => break 'conn Disconnect::Closed,
                        Ok(_) => {}
                        Err(error) => break 'conn Disconnect::Error { message: error.to_string() },
                    }
                    loop {
                        let frame = match decode_frame(&mut buf) {
                            Ok(Some(frame)) => frame,
                            Ok(None) => break,
                            Err(error) => break 'conn Disconnect::Error { message: error.to_string() },
                        };
                        // Voice is not a control message: pass the bytes on untouched.
                        if frame.kind == MessageType::UdpTunnel as u16 {
                            let _ = voice.send(frame.payload);
                            continue;
                        }
                        // Key material for the UDP voice channel.
                        if frame.kind == MessageType::CryptSetup as u16 {
                            if let Ok(setup) = proto::CryptSetup::decode(frame.payload) {
                                if let Some(reply) = udp.on_crypt_setup(setup).await {
                                    if let Err(error) = writer.write_all(&reply).await {
                                        break 'conn Disconnect::Error { message: error.to_string() };
                                    }
                                }
                            }
                            continue;
                        }
                        let outcome = session.handle(frame);
                        for event in outcome.events {
                            if events.send(event).await.is_err() {
                                break 'conn Disconnect::Requested;
                            }
                        }
                        for frame in outcome.send {
                            if let Err(error) = writer.write_all(&frame).await {
                                break 'conn Disconnect::Error { message: error.to_string() };
                            }
                        }
                        if let Some(stop) = outcome.stop {
                            break 'conn stop;
                        }
                    }
                    if let Some(snapshot) = session.take_snapshot() {
                        if events.send(Event::State(snapshot)).await.is_err() {
                            break 'conn Disconnect::Requested;
                        }
                    }
                }
                _ = ping.tick() => {
                    if let Err(error) = writer.write_all(&session.ping_frame()).await {
                        break 'conn Disconnect::Error { message: error.to_string() };
                    }
                }
                received = udp.recv(&mut datagram) => {
                    // A socket error here is a UDP hiccup, not a reason to drop the connection.
                    if let Ok(len) = received {
                        if let Some(packet) = udp.on_datagram(&datagram[..len]) {
                            let _ = voice.send(packet);
                        }
                        if let Some(active) = udp.refresh() {
                            if events.send(Event::Udp { active }).await.is_err() {
                                break 'conn Disconnect::Requested;
                            }
                        }
                    }
                }
                _ = udp_ping.tick() => {
                    udp.send_ping().await;
                    if let Some(active) = udp.refresh() {
                        if events.send(Event::Udp { active }).await.is_err() {
                            break 'conn Disconnect::Requested;
                        }
                    }
                }
                command = commands.recv() => {
                    match command {
                        // Every `Client` handle was dropped, or we were told to leave.
                        None | Some(Command::Disconnect) => break 'conn Disconnect::Requested,
                        Some(Command::Voice(packet)) => {
                            // UDP when it works, the tunnel when it does not.
                            let sent = session.state.session().is_some()
                                && udp.send_voice(&packet).await;
                            if !sent {
                                if let Some(frame) = session.command_frame(&Command::Voice(packet)) {
                                    if let Err(error) = writer.write_all(&frame).await {
                                        break 'conn Disconnect::Error { message: error.to_string() };
                                    }
                                }
                            }
                        }
                        Some(command) => {
                            if let Some(frame) = session.command_frame(&command) {
                                if let Err(error) = writer.write_all(&frame).await {
                                    break 'conn Disconnect::Error { message: error.to_string() };
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    let _ = writer.shutdown().await;
    let _ = events.send(Event::Disconnected(reason)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame<M: Message>(kind: MessageType, message: &M) -> Frame {
        Frame {
            kind: kind as u16,
            payload: Bytes::from(message.encode_to_vec()),
        }
    }

    fn decode_sent<M: Message + Default>(wire: &Bytes) -> (u16, M) {
        let mut buf = BytesMut::from(&wire[..]);
        let frame = decode_frame(&mut buf).unwrap().unwrap();
        (frame.kind, M::decode(frame.payload).unwrap())
    }

    #[test]
    fn formats_versions_from_either_field() {
        assert_eq!(
            format_version(Some(0x0001_05ff), None).as_deref(),
            Some("1.5.255")
        );
        let v2 = (1u64 << 48) | (5 << 32) | (735 << 16);
        assert_eq!(
            format_version(Some(0x0001_05ff), Some(v2)).as_deref(),
            Some("1.5.735")
        );
        assert_eq!(format_version(None, None), None);
    }

    #[test]
    fn announces_1_5_in_both_version_fields() {
        let version = version_message("Kolpak test");
        assert_eq!(version.version_v1, Some(0x0001_0500));
        assert_eq!(version.version_v2, Some((1 << 48) | (5 << 32)));
        assert_eq!(version.release.as_deref(), Some("Kolpak test"));
    }

    #[test]
    fn holds_the_snapshot_until_sync_then_sends_one() {
        let mut session = Session::new(true, true);
        session.handle(frame(
            MessageType::ChannelState,
            &proto::ChannelState {
                channel_id: Some(0),
                name: Some("Root".into()),
                ..Default::default()
            },
        ));
        session.handle(frame(
            MessageType::UserState,
            &proto::UserState {
                session: Some(5),
                name: Some("kolpak".into()),
                ..Default::default()
            },
        ));
        assert!(
            session.take_snapshot().is_none(),
            "nothing before ServerSync"
        );

        let outcome = session.handle(frame(
            MessageType::ServerSync,
            &proto::ServerSync {
                session: Some(5),
                max_bandwidth: Some(558_000),
                ..Default::default()
            },
        ));
        assert_eq!(
            outcome.events,
            [Event::Synced {
                session: 5,
                max_bandwidth: Some(558_000),
                welcome_text: None
            }]
        );

        // First thing sent after sync: mark ourselves muted and deafened, then ping.
        assert_eq!(outcome.send.len(), 2);
        let (kind, state): (u16, proto::UserState) = decode_sent(&outcome.send[0]);
        assert_eq!(kind, MessageType::UserState as u16);
        assert_eq!(
            (state.session, state.self_mute, state.self_deaf),
            (Some(5), Some(true), Some(true))
        );
        let (kind, _): (u16, proto::Ping) = decode_sent(&outcome.send[1]);
        assert_eq!(kind, MessageType::Ping as u16);

        let snapshot = session.take_snapshot().expect("one snapshot after sync");
        assert_eq!(snapshot.session, Some(5));
        assert_eq!(snapshot.users.len(), 1);
        assert!(
            session.take_snapshot().is_none(),
            "no second snapshot without a change"
        );
    }

    #[test]
    fn joining_muted_closes_the_microphone_without_deafening() {
        let mut session = Session::new(true, false);
        let outcome = session.handle(frame(
            MessageType::ServerSync,
            &proto::ServerSync {
                session: Some(5),
                ..Default::default()
            },
        ));
        let (_, state): (u16, proto::UserState) = decode_sent(&outcome.send[0]);
        assert_eq!(
            (state.self_mute, state.self_deaf),
            (Some(true), Some(false))
        );
    }

    #[test]
    fn a_reject_stops_the_connection_with_its_reason() {
        let mut session = Session::new(false, false);
        let outcome = session.handle(frame(
            MessageType::Reject,
            &proto::Reject {
                r#type: Some(4),
                reason: Some("Wrong server password".into()),
            },
        ));
        assert_eq!(
            outcome.stop,
            Some(Disconnect::Rejected {
                reject: RejectKind::WrongServerPassword,
                reason: "Wrong server password".into()
            })
        );
    }

    #[test]
    fn being_removed_ends_the_session_but_others_leaving_does_not() {
        let mut session = Session::new(false, false);
        session.handle(frame(
            MessageType::ServerSync,
            &proto::ServerSync {
                session: Some(5),
                ..Default::default()
            },
        ));
        session.handle(frame(
            MessageType::UserState,
            &proto::UserState {
                session: Some(9),
                name: Some("other".into()),
                ..Default::default()
            },
        ));

        let other_left = session.handle(frame(
            MessageType::UserRemove,
            &proto::UserRemove {
                session: 9,
                ..Default::default()
            },
        ));
        assert!(other_left.stop.is_none());

        let kicked = session.handle(frame(
            MessageType::UserRemove,
            &proto::UserRemove {
                session: 5,
                reason: Some("bye".into()),
                ..Default::default()
            },
        ));
        assert!(
            matches!(kicked.stop, Some(Disconnect::Rejected { reason, .. }) if reason == "bye")
        );
    }

    #[test]
    fn unknown_and_unused_message_types_are_ignored() {
        let mut session = Session::new(false, false);
        let unknown = session.handle(Frame {
            kind: 999,
            payload: Bytes::from_static(b"\xff\xff"),
        });
        assert!(unknown.events.is_empty() && unknown.stop.is_none());

        // Tunnelled voice is not protobuf at all; it must not be parsed.
        let voice = session.handle(Frame {
            kind: MessageType::UdpTunnel as u16,
            payload: Bytes::from_static(b"\x80\x01\x02\x03"),
        });
        assert!(voice.events.is_empty() && voice.stop.is_none());
    }

    #[test]
    fn commands_need_a_session_and_target_ourselves() {
        let mut session = Session::new(false, false);
        assert!(
            session.command_frame(&Command::JoinChannel(3)).is_none(),
            "not synced yet"
        );

        session.handle(frame(
            MessageType::ServerSync,
            &proto::ServerSync {
                session: Some(5),
                ..Default::default()
            },
        ));
        let wire = session.command_frame(&Command::JoinChannel(3)).unwrap();
        let (_, state): (u16, proto::UserState) = decode_sent(&wire);
        assert_eq!((state.session, state.channel_id), (Some(5), Some(3)));
        assert_eq!(state.self_mute, None, "a move must not touch mute state");
    }

    /// The whole loop against an in-memory "server": login, sync, a later change, disconnect.
    #[tokio::test]
    async fn runs_a_session_end_to_end_over_a_stream() {
        let (client_side, mut server_side) = tokio::io::duplex(64 * 1024);
        let (event_tx, mut events) = mpsc::channel(64);
        let (command_tx, command_rx) = mpsc::channel(16);
        let options = ConnectOptions {
            host: "example.test".into(),
            port: DEFAULT_PORT,
            username: "kolpak".into(),
            password: None,
            pinned_fingerprint: None,
            client_name: "Kolpak test".into(),
            join_muted: false,
            join_deafened: false,
        };
        let (voice_tx, mut voice_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            client_side,
            options,
            event_tx,
            command_rx,
            voice_tx,
            None,
        ));

        // The client speaks first: Version, then Authenticate.
        let mut inbox = BytesMut::new();
        let mut received = Vec::new();
        while received.len() < 2 {
            server_side.read_buf(&mut inbox).await.unwrap();
            while let Some(frame) = decode_frame(&mut inbox).unwrap() {
                received.push(frame);
            }
        }
        assert_eq!(received[0].kind, MessageType::Version as u16);
        let auth = proto::Authenticate::decode(received[1].payload.clone()).unwrap();
        assert_eq!(auth.username.as_deref(), Some("kolpak"));
        assert_eq!(auth.opus, Some(true));

        let mut burst = BytesMut::new();
        burst.extend_from_slice(&encode_frame(
            MessageType::ChannelState,
            &proto::ChannelState {
                channel_id: Some(0),
                name: Some("Root".into()),
                ..Default::default()
            },
        ));
        burst.extend_from_slice(&encode_frame(
            MessageType::UserState,
            &proto::UserState {
                session: Some(1),
                name: Some("kolpak".into()),
                ..Default::default()
            },
        ));
        burst.extend_from_slice(&encode_frame(
            MessageType::ServerSync,
            &proto::ServerSync {
                session: Some(1),
                ..Default::default()
            },
        ));
        server_side.write_all(&burst).await.unwrap();

        assert!(matches!(
            events.recv().await,
            Some(Event::Synced { session: 1, .. })
        ));
        let Some(Event::State(first)) = events.recv().await else {
            panic!("expected the first snapshot");
        };
        assert_eq!(first.users.len(), 1);

        server_side
            .write_all(&encode_frame(
                MessageType::UserState,
                &proto::UserState {
                    session: Some(2),
                    name: Some("pyro".into()),
                    ..Default::default()
                },
            ))
            .await
            .unwrap();
        let Some(Event::State(second)) = events.recv().await else {
            panic!("expected a snapshot after a user joined");
        };
        assert_eq!(second.users.len(), 2);

        // Tunnelled voice comes out of the voice channel byte for byte, not as an event.
        server_side
            .write_all(&encode_raw_frame(
                MessageType::UdpTunnel,
                &[0x00, 0x08, 0x00],
            ))
            .await
            .unwrap();
        assert_eq!(
            voice_rx.recv().await.as_deref(),
            Some(&[0x00, 0x08, 0x00][..])
        );

        Client {
            commands: command_tx,
        }
        .disconnect()
        .await;
        loop {
            match events.recv().await {
                Some(Event::Disconnected(reason)) => {
                    assert_eq!(reason, Disconnect::Requested);
                    break;
                }
                Some(_) => {}
                None => panic!("the event stream ended without a Disconnected event"),
            }
        }
        task.await.unwrap();
    }
}

/// Bit for "enter this channel" in Mumble's permission mask.
const PERMISSION_ENTER: u32 = 0x4;

/// A sentence for a PermissionDenied: the server's own text when it sends one, otherwise
/// one made from the denial type (Mumble.proto `PermissionDenied.DenyType`).
pub(crate) fn describe_denial(msg: &proto::PermissionDenied) -> String {
    if let Some(reason) = msg
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        return reason.to_string();
    }
    match msg.r#type.unwrap_or(0) {
        1 if msg.permission.is_some_and(|p| p & PERMISSION_ENTER != 0) => {
            "you are not allowed into that channel.".into()
        }
        1 => "you are not allowed to do that here.".into(),
        2 => "only the server's superuser can do that.".into(),
        7 => "that needs a registered certificate.".into(),
        9 => "that channel is full.".into(),
        _ => "the server refused that.".into(),
    }
}

#[cfg(test)]
mod denial_tests {
    use super::*;

    fn denied(
        r#type: i32,
        permission: Option<u32>,
        reason: Option<&str>,
    ) -> proto::PermissionDenied {
        proto::PermissionDenied {
            permission,
            channel_id: Some(3),
            session: None,
            reason: reason.map(Into::into),
            r#type: Some(r#type),
            name: None,
        }
    }

    #[test]
    fn server_text_wins() {
        assert_eq!(
            describe_denial(&denied(0, None, Some(" go away "))),
            "go away"
        );
    }

    #[test]
    fn entering_a_closed_channel() {
        assert_eq!(
            describe_denial(&denied(1, Some(0x4), None)),
            "you are not allowed into that channel."
        );
        assert_eq!(
            describe_denial(&denied(1, Some(0x1), Some(""))),
            "you are not allowed to do that here."
        );
    }

    #[test]
    fn full_channel_and_unknown() {
        assert_eq!(
            describe_denial(&denied(9, None, None)),
            "that channel is full."
        );
        assert_eq!(
            describe_denial(&denied(42, None, None)),
            "the server refused that."
        );
    }
}
