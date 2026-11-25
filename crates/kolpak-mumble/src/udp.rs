//! The UDP voice channel: the low-delay path for voice, next to the control connection.
//!
//! The server hands out the key material in `CryptSetup`. We then send encrypted pings to
//! find out whether UDP gets through at all. While pongs keep coming back, voice goes over
//! UDP; when they stop (a firewall, a NAT that forgot us), voice falls back to the tunnel
//! through the control connection, and the server follows suit for what it sends us.

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use bytes::Bytes;
use prost::Message;
use tokio::net::UdpSocket;

use crate::codec::encode_frame;
use crate::crypt::CryptState;
use crate::proto::{self, MessageType};
use crate::voice::{HEADER_AUDIO, HEADER_PING};

/// How often to ping over UDP.
pub(crate) const PING_INTERVAL: Duration = Duration::from_secs(5);
/// Without a reply for this long, UDP is treated as not working.
const ALIVE_TIMEOUT: Duration = Duration::from_secs(12);
/// Larger than any voice packet: Opus tops out at 1275 bytes per frame.
pub(crate) const MAX_DATAGRAM: usize = 2048;

/// The 1.5 UDP ping. The server echoes it back.
#[derive(Clone, PartialEq, prost::Message)]
struct UdpPing {
    #[prost(uint64, tag = "1")]
    timestamp: u64,
    #[prost(bool, tag = "2")]
    request_extended_information: bool,
}

pub(crate) struct UdpLink {
    target: Option<SocketAddr>,
    socket: Option<UdpSocket>,
    crypt: Option<CryptState>,
    last_reply: Option<Instant>,
    alive: bool,
    started: Instant,
}

impl UdpLink {
    /// `target` is the server's address, or `None` to never use UDP (tests, odd transports).
    pub(crate) fn new(target: Option<SocketAddr>) -> Self {
        Self {
            target,
            socket: None,
            crypt: None,
            last_reply: None,
            alive: false,
            started: Instant::now(),
        }
    }

    /// Whether voice should go over UDP right now.
    #[cfg(test)]
    pub(crate) fn is_alive(&self) -> bool {
        self.alive
    }

    /// Re-evaluate whether UDP works. Returns the new state when it changed.
    pub(crate) fn refresh(&mut self) -> Option<bool> {
        let alive = self
            .last_reply
            .is_some_and(|at| at.elapsed() < ALIVE_TIMEOUT);
        (alive != self.alive).then(|| {
            self.alive = alive;
            alive
        })
    }

    /// Handle the server's `CryptSetup`. Returns a control frame to send back, if any.
    pub(crate) async fn on_crypt_setup(&mut self, msg: proto::CryptSetup) -> Option<Bytes> {
        match (&msg.key, &msg.client_nonce, &msg.server_nonce) {
            // Full key material: (re)start the channel.
            (Some(key), Some(client_nonce), Some(server_nonce)) => {
                self.crypt = CryptState::new(key, client_nonce, server_nonce);
                if self.crypt.is_none() {
                    log::warn!("the server sent key material of the wrong size; staying on TCP");
                    return None;
                }
                self.open_socket().await;
                self.send_ping().await;
                None
            }
            // Only its nonce: the server lost track of our packets and is resyncing.
            (None, None, Some(server_nonce)) => {
                if let Some(crypt) = &mut self.crypt {
                    crypt.set_decrypt_iv(server_nonce);
                }
                None
            }
            // Nothing: the server asks for our nonce so that it can resync.
            _ => self.crypt.as_ref().map(|crypt| {
                encode_frame(
                    MessageType::CryptSetup,
                    &proto::CryptSetup {
                        key: None,
                        client_nonce: Some(crypt.encrypt_iv().to_vec()),
                        server_nonce: None,
                    },
                )
            }),
        }
    }

    async fn open_socket(&mut self) {
        if self.socket.is_some() {
            return;
        }
        let Some(target) = self.target else {
            return;
        };
        let local: SocketAddr = if target.is_ipv4() {
            ([0, 0, 0, 0], 0).into()
        } else {
            ([0u16; 8], 0).into()
        };
        let opened = async {
            let socket = UdpSocket::bind(local).await?;
            socket.connect(target).await?;
            Ok::<_, std::io::Error>(socket)
        };
        match opened.await {
            Ok(socket) => self.socket = Some(socket),
            Err(error) => log::warn!("no UDP socket, voice stays on TCP: {error}"),
        }
    }

    /// Wait for the next datagram. Never resolves while there is no socket.
    pub(crate) async fn recv(&self, buf: &mut [u8]) -> std::io::Result<usize> {
        match &self.socket {
            Some(socket) => socket.recv(buf).await,
            None => std::future::pending().await,
        }
    }

    /// Decrypt one datagram. Returns the voice packet inside, if that is what it was.
    pub(crate) fn on_datagram(&mut self, data: &[u8]) -> Option<Bytes> {
        let plain = self.crypt.as_mut()?.decrypt(data)?;
        // Anything that authenticates proves the server reaches us over UDP.
        self.last_reply = Some(Instant::now());
        match plain.first() {
            Some(&HEADER_AUDIO) => Some(Bytes::from(plain)),
            _ => None,
        }
    }

    pub(crate) async fn send_ping(&mut self) {
        let (Some(socket), Some(crypt)) = (&self.socket, &mut self.crypt) else {
            return;
        };
        let ping = UdpPing {
            // Never zero: proto3 would leave a zero field out entirely.
            timestamp: self.started.elapsed().as_micros() as u64 + 1,
            request_extended_information: false,
        };
        let mut plain = vec![HEADER_PING];
        ping.encode(&mut plain)
            .expect("a Vec grows, so encoding cannot run out of space");
        // A failed send is the same as a lost packet: the missing pong tells us.
        let _ = socket.send(&crypt.encrypt(&plain)).await;
    }

    /// Send one voice packet over UDP. False means the caller should tunnel it instead.
    pub(crate) async fn send_voice(&mut self, packet: &[u8]) -> bool {
        if !self.alive {
            return false;
        }
        let (Some(socket), Some(crypt)) = (&self.socket, &mut self.crypt) else {
            return false;
        };
        socket.send(&crypt.encrypt(packet)).await.is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::encode_audio_packet;

    const KEY: [u8; 16] = [7; 16];
    const CLIENT_NONCE: [u8; 16] = [1; 16];
    const SERVER_NONCE: [u8; 16] = [2; 16];

    fn setup() -> proto::CryptSetup {
        proto::CryptSetup {
            key: Some(KEY.to_vec()),
            client_nonce: Some(CLIENT_NONCE.to_vec()),
            server_nonce: Some(SERVER_NONCE.to_vec()),
        }
    }

    /// The server's half: same key, nonces the other way round.
    fn server_crypt() -> CryptState {
        CryptState::new(&KEY, &SERVER_NONCE, &CLIENT_NONCE).unwrap()
    }

    #[tokio::test]
    async fn pings_the_server_and_switches_to_udp_when_it_answers() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut server_crypt = server_crypt();
        let mut link = UdpLink::new(Some(server.local_addr().unwrap()));

        assert!(link.on_crypt_setup(setup()).await.is_none());
        assert!(!link.is_alive(), "not alive before any reply");
        assert!(
            !link.send_voice(b"x").await,
            "voice is tunnelled until then"
        );

        // The server receives our first ping, encrypted.
        let mut buf = [0u8; MAX_DATAGRAM];
        let (len, client_addr) = server.recv_from(&mut buf).await.unwrap();
        let ping = server_crypt.decrypt(&buf[..len]).expect("ping decrypts");
        assert_eq!(ping[0], HEADER_PING);

        // It echoes the ping; that makes UDP alive.
        server
            .send_to(&server_crypt.encrypt(&ping), client_addr)
            .await
            .unwrap();
        let len = link.recv(&mut buf).await.unwrap();
        assert!(
            link.on_datagram(&buf[..len]).is_none(),
            "a pong is not voice"
        );
        assert_eq!(link.refresh(), Some(true));
        assert!(link.is_alive());
        assert_eq!(link.refresh(), None, "no change, nothing to report");

        // Now voice goes over UDP, and arrives intact.
        let packet = encode_audio_packet(4, &[9, 9, 9], false);
        assert!(link.send_voice(&packet).await);
        let (len, _) = server.recv_from(&mut buf).await.unwrap();
        assert_eq!(
            server_crypt.decrypt(&buf[..len]).as_deref(),
            Some(&packet[..])
        );

        // And voice from the server comes out as a voice packet.
        server
            .send_to(&server_crypt.encrypt(&packet), client_addr)
            .await
            .unwrap();
        let len = link.recv(&mut buf).await.unwrap();
        assert_eq!(link.on_datagram(&buf[..len]).as_deref(), Some(&packet[..]));
    }

    #[tokio::test]
    async fn garbage_and_foreign_datagrams_change_nothing() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut link = UdpLink::new(Some(server.local_addr().unwrap()));
        link.on_crypt_setup(setup()).await;

        assert!(link.on_datagram(&[1, 2, 3]).is_none());
        assert!(link.on_datagram(&[0u8; 40]).is_none());
        let mut other = CryptState::new(&[9; 16], &SERVER_NONCE, &CLIENT_NONCE).unwrap();
        assert!(link.on_datagram(&other.encrypt(b"\x00hello")).is_none());
        assert_eq!(link.refresh(), None);
        assert!(!link.is_alive());
    }

    #[tokio::test]
    async fn answers_a_resync_request_with_its_own_nonce_and_accepts_a_new_server_nonce() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut link = UdpLink::new(Some(server.local_addr().unwrap()));

        // Asked for a nonce before any key material: nothing to say.
        assert!(link
            .on_crypt_setup(proto::CryptSetup::default())
            .await
            .is_none());

        link.on_crypt_setup(setup()).await;
        let reply = link
            .on_crypt_setup(proto::CryptSetup::default())
            .await
            .expect("a nonce reply");
        assert_eq!(&reply[..2], &[0, MessageType::CryptSetup as u8]);
        let message = proto::CryptSetup::decode(&reply[6..]).unwrap();
        assert!(message.key.is_none());
        assert_eq!(message.client_nonce.map(|nonce| nonce.len()), Some(16));

        // A new server nonce is taken without a reply.
        let resync = proto::CryptSetup {
            key: None,
            client_nonce: None,
            server_nonce: Some(vec![5; 16]),
        };
        assert!(link.on_crypt_setup(resync).await.is_none());
    }

    #[tokio::test]
    async fn without_a_target_udp_is_never_used() {
        let mut link = UdpLink::new(None);
        link.on_crypt_setup(setup()).await;
        link.send_ping().await;
        assert!(!link.send_voice(b"x").await);
        assert!(!link.is_alive());
    }
}
