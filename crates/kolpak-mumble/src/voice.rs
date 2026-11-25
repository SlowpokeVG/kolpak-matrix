//! Voice packets in the Mumble 1.5 format: one header byte, then a protobuf `Audio` message
//! (upstream `src/MumbleUDP.proto` and `src/MumbleProtocol.cpp`, read 2026-11-25).
//!
//! The same bytes travel either over UDP (encrypted, not built yet) or inside a `UDPTunnel`
//! control message over the TLS connection, which is how Kolpak sends them for now.

use bytes::Bytes;
use prost::Message;

/// First byte of every 1.5 voice-channel packet.
pub const HEADER_AUDIO: u8 = 0;
pub const HEADER_PING: u8 = 1;

/// Mumble counts audio in 10 ms units; a 20 ms Opus frame advances the counter by two.
pub const FRAME_NUMBER_STEP_20MS: u64 = 2;

/// `target` 0 is normal talking in the current channel.
pub const TARGET_NORMAL: u32 = 0;

#[derive(Clone, PartialEq, prost::Oneof)]
pub enum AudioHeader {
    /// Client to server: who should hear this (0 = the current channel).
    #[prost(uint32, tag = "1")]
    Target(u32),
    /// Server to client: how the audio reached us.
    #[prost(uint32, tag = "2")]
    Context(u32),
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Audio {
    #[prost(oneof = "AudioHeader", tags = "1, 2")]
    pub header: Option<AudioHeader>,
    /// Set by the server on audio it forwards; clients leave it out.
    #[prost(uint32, tag = "3")]
    pub sender_session: u32,
    #[prost(uint64, tag = "4")]
    pub frame_number: u64,
    #[prost(bytes = "vec", tag = "5")]
    pub opus_data: Vec<u8>,
    #[prost(float, repeated, tag = "6")]
    pub positional_data: Vec<f32>,
    #[prost(float, tag = "7")]
    pub volume_adjustment: f32,
    /// The last packet of a stretch of speech.
    #[prost(bool, tag = "16")]
    pub is_terminator: bool,
}

/// One outgoing voice packet for normal talking.
pub fn encode_audio_packet(frame_number: u64, opus_data: &[u8], is_terminator: bool) -> Bytes {
    let audio = Audio {
        header: Some(AudioHeader::Target(TARGET_NORMAL)),
        sender_session: 0,
        frame_number,
        opus_data: opus_data.to_vec(),
        positional_data: Vec::new(),
        volume_adjustment: 0.0,
        is_terminator,
    };
    let mut out = Vec::with_capacity(1 + audio.encoded_len());
    out.push(HEADER_AUDIO);
    audio
        .encode(&mut out)
        .expect("a Vec grows, so encoding cannot run out of space");
    Bytes::from(out)
}

/// The other direction, for tests now and for receive later.
pub fn decode_audio_packet(packet: &[u8]) -> Option<Audio> {
    match packet.split_first() {
        Some((&HEADER_AUDIO, body)) => Audio::decode(body).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_packets_start_with_the_audio_header_and_round_trip() {
        let packet = encode_audio_packet(42, &[1, 2, 3], false);
        assert_eq!(packet[0], HEADER_AUDIO);

        let audio = decode_audio_packet(&packet).unwrap();
        assert_eq!(audio.header, Some(AudioHeader::Target(TARGET_NORMAL)));
        assert_eq!(audio.frame_number, 42);
        assert_eq!(audio.opus_data, [1, 2, 3]);
        assert!(!audio.is_terminator);
        assert_eq!(audio.sender_session, 0, "clients do not claim a session");
    }

    #[test]
    fn the_target_is_written_even_though_it_is_zero() {
        // proto3 drops zero-valued plain fields, but a set oneof member is always written,
        // and the server uses its presence to tell the header variant.
        let packet = encode_audio_packet(0, &[], false);
        assert_eq!(&packet[..], &[HEADER_AUDIO, 0x08, 0x00]);
    }

    #[test]
    fn the_terminator_flag_survives() {
        let packet = encode_audio_packet(7, &[9], true);
        assert!(decode_audio_packet(&packet).unwrap().is_terminator);
    }

    #[test]
    fn only_audio_packets_decode_as_audio() {
        assert!(decode_audio_packet(&[HEADER_PING, 0x08, 0x01]).is_none());
        assert!(decode_audio_packet(&[]).is_none());
    }
}
