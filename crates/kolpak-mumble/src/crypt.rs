//! Encryption of UDP voice packets: OCB2 with AES-128, as Mumble has always done it.
//!
//! Written against upstream's `src/crypto/CryptStateOCB2.cpp` (read 2026-11-25) and checked
//! with the test vectors from its `TestCrypt.cpp`. Every packet is `[iv byte][3 tag bytes]
//! [ciphertext]`; the sender bumps a 128-bit counter per packet and only its low byte
//! travels, so the receiver has to track the rest, tolerate reordering, and refuse replays.
//!
//! OCB2 is an old mode with a known weakness (the "XEX*" attack). Upstream's mitigations
//! are reproduced here: the sender nudges one bit in the rare vulnerable plaintext, and the
//! receiver rejects the packets an attacker would have to send.

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;

pub const BLOCK: usize = 16;
/// Bytes added to every packet: the IV byte and three bytes of the tag.
pub const OVERHEAD: usize = 4;

type Block = [u8; BLOCK];

fn xor(a: &Block, b: &Block) -> Block {
    let mut out = [0u8; BLOCK];
    for i in 0..BLOCK {
        out[i] = a[i] ^ b[i];
    }
    out
}

/// Multiply by 2 in GF(2^128), the block read as a big-endian number.
fn times2(block: &Block) -> Block {
    let value = u128::from_be_bytes(*block);
    let carry = value >> 127;
    ((value << 1) ^ (carry * 0x87)).to_be_bytes()
}

/// Multiply by 3: the value plus its double.
fn times3(block: &Block) -> Block {
    xor(block, &times2(block))
}

fn length_block(len: usize) -> Block {
    ((len as u128) * 8).to_be_bytes()
}

struct Cipher(Aes128);

impl Cipher {
    fn encrypt(&self, block: &Block) -> Block {
        let mut out = *block;
        self.0.encrypt_block(GenericArray::from_mut_slice(&mut out));
        out
    }

    fn decrypt(&self, block: &Block) -> Block {
        let mut out = *block;
        self.0.decrypt_block(GenericArray::from_mut_slice(&mut out));
        out
    }
}

fn block_at(data: &[u8], offset: usize) -> Block {
    let mut block = [0u8; BLOCK];
    block.copy_from_slice(&data[offset..offset + BLOCK]);
    block
}

/// Returns the ciphertext (same length as `plain`) and the full 16-byte tag.
fn ocb_encrypt(cipher: &Cipher, plain: &[u8], nonce: &Block) -> (Vec<u8>, Block) {
    let mut delta = cipher.encrypt(nonce);
    let mut checksum = [0u8; BLOCK];
    let mut out = Vec::with_capacity(plain.len());
    let mut offset = 0;
    let mut len = plain.len();

    while len > BLOCK {
        let block = block_at(plain, offset);
        // The second-to-last block being all zeros (except possibly its last byte) is what
        // the XEX* attack needs. Upstream flips one bit so that never goes out.
        let flip = len - BLOCK <= BLOCK && block[..BLOCK - 1].iter().all(|byte| *byte == 0);

        delta = times2(&delta);
        let mut tmp = xor(&delta, &block);
        if flip {
            tmp[0] ^= 1;
        }
        let tmp = cipher.encrypt(&tmp);
        out.extend_from_slice(&xor(&delta, &tmp));
        checksum = xor(&checksum, &block);
        if flip {
            checksum[0] ^= 1;
        }
        len -= BLOCK;
        offset += BLOCK;
    }

    delta = times2(&delta);
    let pad = cipher.encrypt(&xor(&length_block(len), &delta));
    let mut tmp = pad;
    tmp[..len].copy_from_slice(&plain[offset..offset + len]);
    checksum = xor(&checksum, &tmp);
    let last = xor(&pad, &tmp);
    out.extend_from_slice(&last[..len]);

    delta = times3(&delta);
    let tag = cipher.encrypt(&xor(&delta, &checksum));
    (out, tag)
}

/// Returns the plaintext and the tag it should carry, or `None` for a packet shaped like
/// an XEX* attack.
fn ocb_decrypt(cipher: &Cipher, encrypted: &[u8], nonce: &Block) -> Option<(Vec<u8>, Block)> {
    let mut delta = cipher.encrypt(nonce);
    let mut checksum = [0u8; BLOCK];
    let mut out = Vec::with_capacity(encrypted.len());
    let mut offset = 0;
    let mut len = encrypted.len();

    while len > BLOCK {
        delta = times2(&delta);
        let tmp = cipher.decrypt(&xor(&delta, &block_at(encrypted, offset)));
        let plain = xor(&delta, &tmp);
        out.extend_from_slice(&plain);
        checksum = xor(&checksum, &plain);
        len -= BLOCK;
        offset += BLOCK;
    }

    delta = times2(&delta);
    let pad = cipher.encrypt(&xor(&length_block(len), &delta));
    let mut tmp = [0u8; BLOCK];
    tmp[..len].copy_from_slice(&encrypted[offset..offset + len]);
    let tmp = xor(&tmp, &pad);
    checksum = xor(&checksum, &tmp);
    out.extend_from_slice(&tmp[..len]);

    let attack = tmp[..BLOCK - 1] == delta[..BLOCK - 1];

    delta = times3(&delta);
    let tag = cipher.encrypt(&xor(&delta, &checksum));
    (!attack).then_some((out, tag))
}

fn increment(iv: &mut Block, from: usize) {
    for byte in iv.iter_mut().skip(from) {
        *byte = byte.wrapping_add(1);
        if *byte != 0 {
            break;
        }
    }
}

fn decrement(iv: &mut Block, from: usize) {
    for byte in iv.iter_mut().skip(from) {
        let before = *byte;
        *byte = byte.wrapping_sub(1);
        if before != 0 {
            break;
        }
    }
}

/// Both directions of the voice channel's encryption, from the client's side.
pub struct CryptState {
    cipher: Cipher,
    encrypt_iv: Block,
    decrypt_iv: Block,
    /// For each low IV byte, the next-higher byte last seen with it: catches replays.
    decrypt_history: [u8; 256],
    pub good: u32,
    pub late: u32,
    pub lost: u32,
}

impl std::fmt::Debug for CryptState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never the key or the counters.
        f.debug_struct("CryptState")
            .field("good", &self.good)
            .field("late", &self.late)
            .field("lost", &self.lost)
            .finish_non_exhaustive()
    }
}

impl CryptState {
    /// From the server's `CryptSetup`: we encrypt with `client_nonce` and decrypt with
    /// `server_nonce`. `None` unless all three are exactly 16 bytes.
    pub fn new(key: &[u8], client_nonce: &[u8], server_nonce: &[u8]) -> Option<Self> {
        let key: Block = key.try_into().ok()?;
        Some(Self {
            cipher: Cipher(Aes128::new(GenericArray::from_slice(&key))),
            encrypt_iv: client_nonce.try_into().ok()?,
            decrypt_iv: server_nonce.try_into().ok()?,
            decrypt_history: [0; 256],
            good: 0,
            late: 0,
            lost: 0,
        })
    }

    /// The server sent a new nonce for its direction, after losing track of ours.
    pub fn set_decrypt_iv(&mut self, server_nonce: &[u8]) -> bool {
        match server_nonce.try_into() {
            Ok(iv) => {
                self.decrypt_iv = iv;
                true
            }
            Err(_) => false,
        }
    }

    /// Our current nonce, for when the server asks us to resend it.
    pub fn encrypt_iv(&self) -> Block {
        self.encrypt_iv
    }

    pub fn encrypt(&mut self, plain: &[u8]) -> Vec<u8> {
        increment(&mut self.encrypt_iv, 0);
        let (ciphertext, tag) = ocb_encrypt(&self.cipher, plain, &self.encrypt_iv);
        let mut out = Vec::with_capacity(OVERHEAD + ciphertext.len());
        out.push(self.encrypt_iv[0]);
        out.extend_from_slice(&tag[..3]);
        out.extend_from_slice(&ciphertext);
        out
    }

    /// `None` for anything that does not authenticate, is a replay, or is too old.
    pub fn decrypt(&mut self, packet: &[u8]) -> Option<Vec<u8>> {
        if packet.len() < OVERHEAD {
            return None;
        }
        let saved = self.decrypt_iv;
        let iv_byte = packet[0];
        let mut restore = false;
        let mut late = false;
        let mut lost: i32 = 0;

        if self.decrypt_iv[0].wrapping_add(1) == iv_byte {
            // The next packet in order.
            if iv_byte > self.decrypt_iv[0] {
                self.decrypt_iv[0] = iv_byte;
            } else if iv_byte < self.decrypt_iv[0] {
                // The low byte wrapped.
                self.decrypt_iv[0] = iv_byte;
                increment(&mut self.decrypt_iv, 1);
            } else {
                return None;
            }
        } else {
            // Out of order or after a gap.
            let mut diff = i32::from(iv_byte) - i32::from(self.decrypt_iv[0]);
            if diff > 128 {
                diff -= 256;
            } else if diff < -128 {
                diff += 256;
            }

            if iv_byte < self.decrypt_iv[0] && diff > -30 && diff < 0 {
                // Late, same wrap.
                late = true;
                lost = -1;
                self.decrypt_iv[0] = iv_byte;
                restore = true;
            } else if iv_byte > self.decrypt_iv[0] && diff > -30 && diff < 0 {
                // Late, from before the last wrap.
                late = true;
                lost = -1;
                self.decrypt_iv[0] = iv_byte;
                decrement(&mut self.decrypt_iv, 1);
                restore = true;
            } else if iv_byte > self.decrypt_iv[0] && diff > 0 {
                // Some packets were lost.
                lost = i32::from(iv_byte) - i32::from(self.decrypt_iv[0]) - 1;
                self.decrypt_iv[0] = iv_byte;
            } else if iv_byte < self.decrypt_iv[0] && diff > 0 {
                // Lost packets across a wrap.
                lost = 256 - i32::from(self.decrypt_iv[0]) + i32::from(iv_byte) - 1;
                self.decrypt_iv[0] = iv_byte;
                increment(&mut self.decrypt_iv, 1);
            } else {
                return None;
            }

            if self.decrypt_history[usize::from(self.decrypt_iv[0])] == self.decrypt_iv[1] {
                self.decrypt_iv = saved;
                return None;
            }
        }

        let decrypted = ocb_decrypt(&self.cipher, &packet[OVERHEAD..], &self.decrypt_iv);
        let Some((plain, _)) = decrypted.filter(|(_, tag)| tag[..3] == packet[1..4]) else {
            self.decrypt_iv = saved;
            return None;
        };
        self.decrypt_history[usize::from(self.decrypt_iv[0])] = self.decrypt_iv[1];
        if restore {
            self.decrypt_iv = saved;
        }

        self.good = self.good.wrapping_add(1);
        if late {
            self.late = self.late.wrapping_add(1);
        }
        if lost > 0 {
            self.lost = self.lost.wrapping_add(lost as u32);
        } else if lost < 0 {
            self.lost = self.lost.saturating_sub(1);
        }
        Some(plain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: Block = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f,
    ];

    fn cipher() -> Cipher {
        Cipher(Aes128::new(GenericArray::from_slice(&KEY)))
    }

    /// The two vectors upstream's TestCrypt checks, from draft-krovetz-ocb-00.
    #[test]
    fn matches_the_reference_vectors() {
        let (empty, tag) = ocb_encrypt(&cipher(), &[], &KEY);
        assert!(empty.is_empty());
        assert_eq!(
            tag,
            [
                0xbf, 0x31, 0x08, 0x13, 0x07, 0x73, 0xad, 0x5e, 0xc7, 0x0e, 0xc6, 0x9e, 0x78, 0x75,
                0xa7, 0xb0
            ]
        );

        let source: Vec<u8> = (0..40).collect();
        let (crypted, tag) = ocb_encrypt(&cipher(), &source, &KEY);
        assert_eq!(
            tag,
            [
                0x9d, 0xb0, 0xcd, 0xf8, 0x80, 0xf7, 0x3e, 0x3e, 0x10, 0xd4, 0xeb, 0x32, 0x17, 0x76,
                0x66, 0x88
            ]
        );
        assert_eq!(
            crypted,
            [
                0xf7, 0x5d, 0x6b, 0xc8, 0xb4, 0xdc, 0x8d, 0x66, 0xb8, 0x36, 0xa2, 0xb0, 0x8b, 0x32,
                0xa6, 0x36, 0x9f, 0x1c, 0xd3, 0xc5, 0x22, 0x8d, 0x79, 0xfd, 0x6c, 0x26, 0x7f, 0x5f,
                0x6a, 0xa7, 0xb2, 0x31, 0xc7, 0xdf, 0xb9, 0xd5, 0x99, 0x51, 0xae, 0x9c
            ]
        );
    }

    /// Upstream's `authcrypt`: every length up to 127 round-trips with matching tags.
    #[test]
    fn round_trips_every_length() {
        let nonce: Block = [
            0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22,
            0x11, 0x00,
        ];
        for len in 0..128usize {
            let source: Vec<u8> = (0..len).map(|i| (i + 1) as u8).collect();
            let (encrypted, enc_tag) = ocb_encrypt(&cipher(), &source, &nonce);
            let (decrypted, dec_tag) = ocb_decrypt(&cipher(), &encrypted, &nonce).unwrap();
            assert_eq!(enc_tag, dec_tag, "tags differ at length {len}");
            assert_eq!(source, decrypted, "plaintext differs at length {len}");
        }
    }

    fn pair() -> (CryptState, CryptState) {
        let client_nonce = [0x11u8; BLOCK];
        let server_nonce = [0x22u8; BLOCK];
        // The server's state is ours with the nonces the other way round.
        (
            CryptState::new(&KEY, &client_nonce, &server_nonce).unwrap(),
            CryptState::new(&KEY, &server_nonce, &client_nonce).unwrap(),
        )
    }

    #[test]
    fn packets_cross_between_two_states_in_order() {
        let (mut client, mut server) = pair();
        for i in 0..600u32 {
            // Enough packets to wrap the IV byte twice.
            let message = format!("voice packet {i}");
            let packet = client.encrypt(message.as_bytes());
            assert_eq!(packet.len(), message.len() + OVERHEAD);
            assert_eq!(server.decrypt(&packet).as_deref(), Some(message.as_bytes()));
        }
        assert_eq!(server.good, 600);
        assert_eq!((server.late, server.lost), (0, 0));
    }

    #[test]
    fn tolerates_loss_and_reordering_but_not_replays_or_tampering() {
        let (mut client, mut server) = pair();
        let packets: Vec<Vec<u8>> = (0..6u8).map(|i| client.encrypt(&[i; 20])).collect();

        assert!(server.decrypt(&packets[0]).is_some());
        // 1 and 2 go missing for now; 3 arrives.
        assert_eq!(server.decrypt(&packets[3]).as_deref(), Some(&[3u8; 20][..]));
        assert_eq!(server.lost, 2);
        // 2 turns up late.
        assert_eq!(server.decrypt(&packets[2]).as_deref(), Some(&[2u8; 20][..]));
        assert_eq!(server.late, 1);
        assert_eq!(server.lost, 1);
        // The same packet again is a replay.
        assert!(server.decrypt(&packets[2]).is_none());
        assert!(server.decrypt(&packets[3]).is_none());
        // Order resumes.
        assert!(server.decrypt(&packets[4]).is_some());

        let mut tampered = packets[5].clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(server.decrypt(&tampered).is_none());
        // A failed packet must not advance the state: the real one still decrypts.
        assert!(server.decrypt(&packets[5]).is_some());
    }

    #[test]
    fn a_packet_from_a_different_key_or_too_short_is_rejected() {
        let (mut client, _) = pair();
        let mut other = CryptState::new(&[9u8; BLOCK], &[0x22; BLOCK], &[0x11; BLOCK]).unwrap();
        let packet = client.encrypt(b"hello");
        assert!(other.decrypt(&packet).is_none());
        assert!(other.decrypt(&[1, 2, 3]).is_none());
    }

    #[test]
    fn the_vulnerable_plaintext_shape_is_never_sent_as_is() {
        // Two blocks, the first all zero: exactly the XEX* case. The sender flips a bit, so
        // the receiver gets a plaintext that differs in that one bit, as upstream does.
        let (mut client, mut server) = pair();
        let mut plain = vec![0u8; 32];
        plain[20] = 7;
        let decrypted = server.decrypt(&client.encrypt(&plain)).unwrap();
        assert_eq!(decrypted[0], 1);
        assert_eq!(&decrypted[1..], &plain[1..]);
    }

    #[test]
    fn rejects_key_material_of_the_wrong_size() {
        assert!(CryptState::new(&KEY[..15], &[0; BLOCK], &[0; BLOCK]).is_none());
        assert!(CryptState::new(&KEY, &[0; 8], &[0; BLOCK]).is_none());
        let (mut client, _) = pair();
        assert!(!client.set_decrypt_iv(&[0; 3]));
        assert!(client.set_decrypt_iv(&[5; BLOCK]));
    }
}
