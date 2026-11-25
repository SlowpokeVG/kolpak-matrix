//! Control-channel framing: a 2-byte message type and a 4-byte payload length, both
//! big-endian, followed by the protobuf payload.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use prost::Message;

use crate::proto::MessageType;

pub const HEADER_LEN: usize = 6;

/// Upstream caps control messages at 8 MiB minus one; anything larger is a broken or
/// hostile peer, not a message to wait for.
pub const MAX_PAYLOAD_LEN: usize = 0x7f_ffff;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FrameError {
    #[error("control message of {0} bytes is over the protocol limit")]
    TooLarge(usize),
}

/// A frame as read off the wire. The type is kept raw: unknown types are skipped by the
/// caller rather than treated as errors, so newer servers do not break us.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: u16,
    pub payload: Bytes,
}

/// Take one complete frame off the front of `buf`, or return `None` if more bytes are needed.
pub fn decode_frame(buf: &mut BytesMut) -> Result<Option<Frame>, FrameError> {
    if buf.len() < HEADER_LEN {
        return Ok(None);
    }
    let kind = u16::from_be_bytes([buf[0], buf[1]]);
    let len = u32::from_be_bytes([buf[2], buf[3], buf[4], buf[5]]) as usize;
    if len > MAX_PAYLOAD_LEN {
        return Err(FrameError::TooLarge(len));
    }
    if buf.len() < HEADER_LEN + len {
        buf.reserve(HEADER_LEN + len - buf.len());
        return Ok(None);
    }
    buf.advance(HEADER_LEN);
    let payload = buf.split_to(len).freeze();
    Ok(Some(Frame { kind, payload }))
}

/// Encode one message as a frame.
pub fn encode_frame<M: Message>(kind: MessageType, message: &M) -> Bytes {
    let len = message.encoded_len();
    let mut out = BytesMut::with_capacity(HEADER_LEN + len);
    out.put_u16(kind as u16);
    out.put_u32(len as u32);
    message
        .encode(&mut out)
        .expect("BytesMut grows, so encoding cannot run out of space");
    out.freeze()
}

/// Encode a frame whose payload is not protobuf: tunnelled voice packets.
pub fn encode_raw_frame(kind: MessageType, payload: &[u8]) -> Bytes {
    let mut out = BytesMut::with_capacity(HEADER_LEN + payload.len());
    out.put_u16(kind as u16);
    out.put_u32(payload.len() as u32);
    out.put_slice(payload);
    out.freeze()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto;

    #[test]
    fn round_trips_a_message() {
        let ping = proto::Ping {
            timestamp: Some(42),
            ..Default::default()
        };
        let wire = encode_frame(MessageType::Ping, &ping);
        assert_eq!(&wire[..2], &[0, 3], "type 3 is Ping");

        let mut buf = BytesMut::from(&wire[..]);
        let frame = decode_frame(&mut buf).unwrap().unwrap();
        assert_eq!(frame.kind, MessageType::Ping as u16);
        assert_eq!(proto::Ping::decode(frame.payload).unwrap(), ping);
        assert!(buf.is_empty());
    }

    #[test]
    fn waits_for_a_split_frame_and_keeps_the_next_one() {
        let first = encode_frame(
            MessageType::ChannelState,
            &proto::ChannelState {
                channel_id: Some(1),
                name: Some("lobby".into()),
                ..Default::default()
            },
        );
        let second = encode_frame(MessageType::Ping, &proto::Ping::default());

        let mut buf = BytesMut::new();
        buf.extend_from_slice(&first[..4]);
        assert_eq!(decode_frame(&mut buf), Ok(None), "header incomplete");
        buf.extend_from_slice(&first[4..first.len() - 1]);
        assert_eq!(decode_frame(&mut buf), Ok(None), "payload incomplete");
        buf.extend_from_slice(&first[first.len() - 1..]);
        buf.extend_from_slice(&second);

        let one = decode_frame(&mut buf).unwrap().unwrap();
        assert_eq!(one.kind, MessageType::ChannelState as u16);
        let two = decode_frame(&mut buf).unwrap().unwrap();
        assert_eq!(two.kind, MessageType::Ping as u16);
        assert!(
            two.payload.is_empty(),
            "an empty message has an empty payload"
        );
        assert_eq!(decode_frame(&mut buf), Ok(None));
    }

    #[test]
    fn raw_frames_carry_their_payload_untouched() {
        let wire = encode_raw_frame(MessageType::UdpTunnel, &[0x00, 0x08, 0x00]);
        assert_eq!(&wire[..], &[0, 1, 0, 0, 0, 3, 0x00, 0x08, 0x00]);
    }

    #[test]
    fn rejects_an_oversized_length_without_waiting_for_it() {
        let mut buf = BytesMut::new();
        buf.put_u16(MessageType::TextMessage as u16);
        buf.put_u32(0x0100_0000);
        assert_eq!(
            decode_frame(&mut buf),
            Err(FrameError::TooLarge(0x0100_0000))
        );
    }
}
