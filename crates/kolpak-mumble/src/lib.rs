//! Mumble for Kolpak.
//!
//! The control connection (AI/SPEC.md §5): connect over TLS, log in, keep the channel and
//! user tree up to date, ping. And the sending half of voice: microphone capture, Opus,
//! and voice packets tunnelled through the control connection.
//!
//! Not built yet: receiving and playing voice, and the separate encrypted UDP channel
//! that carries voice with less delay than the tunnel.
//!
//! The crate has no Tauri in it. The app wraps [`connect`] in commands and forwards
//! [`Event`]s to the webview; everything here can be built and tested on its own.

#[cfg(feature = "audio")]
pub mod audio;
pub mod client;
pub mod codec;
pub mod gate;
pub mod proto;
pub mod state;
pub mod tls;
pub mod voice;

pub use client::{
    connect, format_version, Client, ConnectError, ConnectOptions, Connection, Disconnect, Event,
    RejectKind, DEFAULT_PORT,
};
pub use gate::TransmitMode;
pub use state::{Channel, Snapshot, User, ROOT_CHANNEL};
