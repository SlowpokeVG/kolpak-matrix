//! Hearing other people: voice packets → per-speaker Opus decoder → per-speaker buffer →
//! mix → output device.
//!
//! Each speaker has a small buffer that has to fill a little before it starts playing
//! (a fixed jitter cushion) and is trimmed if it grows too long, so delay cannot build up.
//! This is deliberately simple: no adaptive jitter buffer and no loss concealment yet.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc as std_mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use unsafe_libopus::{opus_decode_float, opus_decoder_create, opus_decoder_destroy, OpusDecoder};

use crate::audio::{AudioError, InputDevice, Resampler, SAMPLE_RATE};
use crate::gate::rms;
use crate::voice::decode_audio_packet;

/// The longest frame Opus can carry: 120 ms at 48 kHz.
const MAX_FRAME_SAMPLES: usize = 5760;
/// How much audio a speaker's buffer must hold before it starts playing: 60 ms.
const PREBUFFER_SAMPLES: usize = 2880;
/// Beyond this the oldest audio is dropped: 400 ms.
const MAX_BUFFER_SAMPLES: usize = 19_200;
/// A speaker with no packet for this long is no longer "talking".
const TALKING_TIMEOUT: Duration = Duration::from_millis(350);

/// An output device has the same shape as an input one.
pub type OutputDevice = InputDevice;

pub fn list_output_devices() -> Result<Vec<OutputDevice>, AudioError> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|device| device.id().ok())
        .map(|id| id.to_string());
    let devices = host
        .output_devices()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    let mut out = Vec::new();
    for device in devices {
        let Ok(id) = device.id() else { continue };
        let id = id.to_string();
        let name = device
            .description()
            .map(|description| description.name().to_owned())
            .unwrap_or_else(|_| id.clone());
        out.push(OutputDevice {
            is_default: Some(&id) == default_id.as_ref(),
            id,
            name,
        });
    }
    Ok(out)
}

struct Decoder(*mut OpusDecoder);

// A decoder is only ever used under the mixer's lock.
unsafe impl Send for Decoder {}

impl Decoder {
    fn new() -> Result<Self, AudioError> {
        let mut error = 0;
        // SAFETY: plain constructor call; `error` outlives it.
        let raw = unsafe { opus_decoder_create(SAMPLE_RATE as i32, 1, &mut error) };
        if raw.is_null() || error != 0 {
            return Err(AudioError::Encoder(error));
        }
        Ok(Self(raw))
    }

    /// Decode one packet into `out`; returns the number of samples written.
    fn decode(&mut self, data: &[u8], out: &mut [f32]) -> Result<usize, AudioError> {
        // SAFETY: `data` and `out` are valid for their lengths; the frame size passed is the
        // capacity of `out` in samples, as the API requires.
        let samples = unsafe {
            opus_decode_float(
                self.0,
                data.as_ptr(),
                data.len() as i32,
                out.as_mut_ptr(),
                out.len() as i32,
                0,
            )
        };
        if samples < 0 {
            Err(AudioError::Encoder(samples))
        } else {
            Ok(samples as usize)
        }
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: created by opus_decoder_create and destroyed exactly once.
        unsafe { opus_decoder_destroy(self.0) };
    }
}

struct Speaker {
    /// Absent only in tests that feed PCM directly.
    decoder: Option<Decoder>,
    buffer: VecDeque<f32>,
    /// False while the buffer is filling up again after running dry.
    playing: bool,
    talking: bool,
    last_packet: Instant,
}

impl Speaker {
    fn new(decoder: Option<Decoder>) -> Self {
        Self {
            decoder,
            buffer: VecDeque::with_capacity(MAX_BUFFER_SAMPLES),
            playing: false,
            talking: false,
            last_packet: Instant::now(),
        }
    }

    fn push(&mut self, pcm: &[f32], last: bool) {
        self.buffer.extend(pcm.iter().copied());
        if self.buffer.len() > MAX_BUFFER_SAMPLES {
            let excess = self.buffer.len() - MAX_BUFFER_SAMPLES;
            self.buffer.drain(..excess);
        }
        self.talking = !last;
        self.last_packet = Instant::now();
    }
}

/// Everyone we can hear, mixed down to one 48 kHz mono stream.
pub struct Mixer {
    speakers: Mutex<HashMap<u32, Speaker>>,
    volume: AtomicU32,
    level: AtomicU32,
    /// Set while we are deafened: nothing is played and incoming packets are dropped.
    silenced: AtomicBool,
}

impl std::fmt::Debug for Mixer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Mixer").finish_non_exhaustive()
    }
}

impl Default for Mixer {
    fn default() -> Self {
        Self {
            speakers: Mutex::new(HashMap::new()),
            volume: AtomicU32::new(1f32.to_bits()),
            level: AtomicU32::new(0f32.to_bits()),
            silenced: AtomicBool::new(false),
        }
    }
}

impl Mixer {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u32, Speaker>> {
        self.speakers
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Output volume, 0.0 to 2.0 (1.0 is unchanged).
    pub fn set_volume(&self, volume: f32) {
        self.volume
            .store(volume.clamp(0.0, 2.0).to_bits(), Ordering::Relaxed);
    }

    pub fn set_silenced(&self, silenced: bool) {
        self.silenced.store(silenced, Ordering::Relaxed);
        if silenced {
            self.lock().clear();
        }
    }

    /// RMS of the most recent mixed block, 0.0 to 1.0.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// One voice packet as it came off the wire.
    pub fn push_packet(&self, packet: &[u8]) {
        if self.silenced.load(Ordering::Relaxed) {
            return;
        }
        let Some(audio) = decode_audio_packet(packet) else {
            return;
        };
        let mut speakers = self.lock();
        let speaker = match speakers.entry(audio.sender_session) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => match Decoder::new() {
                Ok(decoder) => entry.insert(Speaker::new(Some(decoder))),
                Err(error) => {
                    log::warn!("no decoder for a new speaker: {error}");
                    return;
                }
            },
        };
        if audio.opus_data.is_empty() {
            // A bare terminator: the speech ended.
            speaker.talking = false;
            return;
        }
        let mut pcm = [0f32; MAX_FRAME_SAMPLES];
        let decoded = match speaker.decoder.as_mut() {
            Some(decoder) => decoder.decode(&audio.opus_data, &mut pcm),
            None => return,
        };
        match decoded {
            Ok(samples) => speaker.push(&pcm[..samples], audio.is_terminator),
            Err(error) => log::debug!("dropping an undecodable voice packet: {error}"),
        }
    }

    /// Decoded audio for a speaker, bypassing Opus. For tests.
    #[cfg(test)]
    fn push_pcm(&self, session: u32, pcm: &[f32], last: bool) {
        self.lock()
            .entry(session)
            .or_insert_with(|| Speaker::new(None))
            .push(pcm, last);
    }

    /// Forget speakers who are no longer on the server.
    pub fn retain_sessions(&self, present: &HashSet<u32>) {
        self.lock().retain(|session, _| present.contains(session));
    }

    /// Sessions that are speaking right now.
    pub fn talking(&self) -> Vec<u32> {
        let now = Instant::now();
        let mut sessions: Vec<u32> = self
            .lock()
            .iter()
            .filter(|(_, speaker)| {
                speaker.talking && now.duration_since(speaker.last_packet) < TALKING_TIMEOUT
            })
            .map(|(session, _)| *session)
            .collect();
        sessions.sort_unstable();
        sessions
    }

    /// Fill `out` with the next block of mixed audio.
    pub fn mix(&self, out: &mut [f32]) {
        out.fill(0.0);
        if !self.silenced.load(Ordering::Relaxed) {
            let mut speakers = self.lock();
            for speaker in speakers.values_mut() {
                if !speaker.playing {
                    if speaker.buffer.len() < PREBUFFER_SAMPLES {
                        continue;
                    }
                    speaker.playing = true;
                }
                let take = out.len().min(speaker.buffer.len());
                for (slot, sample) in out.iter_mut().zip(speaker.buffer.drain(..take)) {
                    *slot += sample;
                }
                if speaker.buffer.is_empty() {
                    // Ran dry: wait for the cushion to refill before playing again.
                    speaker.playing = false;
                }
            }
        }
        let volume = f32::from_bits(self.volume.load(Ordering::Relaxed));
        for sample in out.iter_mut() {
            *sample = (*sample * volume).clamp(-1.0, 1.0);
        }
        self.level.store(rms(out).to_bits(), Ordering::Relaxed);
    }
}

/// What the playback thread reports once the output device is open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackInfo {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

/// A running output stream. Dropping it stops playback.
#[derive(Debug)]
pub struct Playback {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub info: PlaybackInfo,
}

impl Playback {
    /// Open `device_id` (or the system default) and play whatever `mixer` produces.
    pub fn start(device_id: Option<String>, mixer: Arc<Mixer>) -> Result<Self, AudioError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std_mpsc::channel::<Result<PlaybackInfo, AudioError>>();
        let thread_stop = stop.clone();

        let thread = std::thread::Builder::new()
            .name("kolpak-playback".into())
            .spawn(move || match open_stream(device_id, mixer) {
                Ok((stream, info)) => {
                    if let Err(error) = stream.play() {
                        let _ = ready_tx.send(Err(AudioError::Device(error.to_string())));
                        return;
                    }
                    let _ = ready_tx.send(Ok(info));
                    while !thread_stop.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                }
            })
            .map_err(|error| AudioError::Device(error.to_string()))?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(info)) => Ok(Self {
                stop,
                thread: Some(thread),
                info,
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                stop.store(true, Ordering::Relaxed);
                Err(AudioError::Timeout)
            }
        }
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Pulls 48 kHz mono from the mixer and shapes it for the device.
struct Renderer {
    mixer: Arc<Mixer>,
    channels: usize,
    resampler: Option<Resampler>,
    block: Vec<f32>,
    ready: VecDeque<f32>,
}

impl Renderer {
    fn fill<T>(&mut self, data: &mut [T])
    where
        T: SizedSample + FromSample<f32>,
    {
        let frames = data.len() / self.channels;
        match &mut self.resampler {
            None => {
                self.block.resize(frames, 0.0);
                self.mixer.mix(&mut self.block);
                self.ready.extend(self.block.iter().copied());
            }
            Some(resampler) => {
                // 10 ms at a time until there is enough for this callback.
                while self.ready.len() < frames {
                    self.block.resize(480, 0.0);
                    self.mixer.mix(&mut self.block);
                    resampler.process(&self.block, &mut self.ready);
                }
            }
        }
        for frame in data.chunks_mut(self.channels) {
            let sample = T::from_sample(self.ready.pop_front().unwrap_or(0.0));
            frame.fill(sample);
        }
    }
}

fn open_stream(
    device_id: Option<String>,
    mixer: Arc<Mixer>,
) -> Result<(cpal::Stream, PlaybackInfo), AudioError> {
    let host = cpal::default_host();
    let device = match device_id.as_deref().filter(|id| !id.is_empty()) {
        Some(wanted) => host
            .output_devices()
            .map_err(|error| AudioError::Device(error.to_string()))?
            .find(|device| device.id().is_ok_and(|id| id.to_string() == wanted))
            .ok_or(AudioError::DeviceNotFound)?,
        None => host
            .default_output_device()
            .ok_or(AudioError::NoOutputDevice)?,
    };
    let device_name = device
        .description()
        .map(|description| description.name().to_owned())
        .unwrap_or_else(|_| "speakers".to_owned());
    let supported = device
        .default_output_config()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    let format = supported.sample_format();
    let config = supported.config();
    let sample_rate = config.sample_rate;
    let channels = config.channels;

    let mut renderer = Renderer {
        mixer,
        channels: usize::from(channels.max(1)),
        resampler: (sample_rate != SAMPLE_RATE)
            .then(|| Resampler::between(SAMPLE_RATE, sample_rate)),
        block: Vec::with_capacity(4096),
        ready: VecDeque::with_capacity(8192),
    };
    let on_error = |error: cpal::Error| log::warn!("output stream error: {error}");

    let stream = match format {
        SampleFormat::F32 => device.build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| renderer.fill(data),
            on_error,
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            config,
            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| renderer.fill(data),
            on_error,
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            config,
            move |data: &mut [u16], _: &cpal::OutputCallbackInfo| renderer.fill(data),
            on_error,
            None,
        ),
        SampleFormat::I32 => device.build_output_stream(
            config,
            move |data: &mut [i32], _: &cpal::OutputCallbackInfo| renderer.fill(data),
            on_error,
            None,
        ),
        other => return Err(AudioError::UnsupportedFormat(other.to_string())),
    }
    .map_err(|error| AudioError::Device(error.to_string()))?;

    Ok((
        stream,
        PlaybackInfo {
            device_name,
            sample_rate,
            channels,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{Encoder, FRAME_SAMPLES, MAX_OPUS_PACKET};
    use crate::voice::{Audio, AudioHeader, HEADER_AUDIO};
    use prost::Message;

    fn tone(samples: usize, amplitude: f32) -> Vec<f32> {
        (0..samples)
            .map(|i| {
                (i as f32 * 440.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * amplitude
            })
            .collect()
    }

    /// A packet the way the server forwards it: with a context and the sender's session.
    fn server_packet(session: u32, frame_number: u64, opus: &[u8], last: bool) -> Vec<u8> {
        let audio = Audio {
            header: Some(AudioHeader::Context(0)),
            sender_session: session,
            frame_number,
            opus_data: opus.to_vec(),
            positional_data: Vec::new(),
            volume_adjustment: 0.0,
            is_terminator: last,
        };
        let mut out = vec![HEADER_AUDIO];
        audio.encode(&mut out).unwrap();
        out
    }

    #[test]
    fn waits_for_the_cushion_then_plays_and_stops_when_dry() {
        let mixer = Mixer::new();
        let mut out = vec![1.0f32; 480];

        mixer.push_pcm(7, &vec![0.25; PREBUFFER_SAMPLES - 1], false);
        mixer.mix(&mut out);
        assert!(out.iter().all(|sample| *sample == 0.0), "still filling");

        mixer.push_pcm(7, &[0.25], false);
        mixer.mix(&mut out);
        assert!(
            out.iter().all(|sample| *sample == 0.25),
            "cushion full: playing"
        );
        assert!(mixer.level() > 0.2);

        // Drain the rest; the last block is partly silence, and then it waits again.
        for _ in 0..(PREBUFFER_SAMPLES / 480) {
            mixer.mix(&mut out);
        }
        mixer.push_pcm(7, &[0.25; 100], false);
        mixer.mix(&mut out);
        assert!(
            out.iter().all(|sample| *sample == 0.0),
            "refilling after running dry"
        );
    }

    #[test]
    fn mixes_speakers_together_and_clamps() {
        let mixer = Mixer::new();
        mixer.push_pcm(1, &vec![0.4; PREBUFFER_SAMPLES], false);
        mixer.push_pcm(2, &vec![0.3; PREBUFFER_SAMPLES], false);
        mixer.push_pcm(3, &vec![0.9; PREBUFFER_SAMPLES], false);
        let mut out = vec![0.0f32; 480];
        mixer.mix(&mut out);
        // 0.4 + 0.3 + 0.9 would be 1.6.
        assert!(out.iter().all(|sample| *sample == 1.0));
    }

    #[test]
    fn volume_scales_and_silencing_drops_everything() {
        let mixer = Mixer::new();
        mixer.push_pcm(1, &vec![0.5; PREBUFFER_SAMPLES * 2], false);
        mixer.set_volume(0.5);
        let mut out = vec![0.0f32; 480];
        mixer.mix(&mut out);
        assert!(out.iter().all(|sample| (*sample - 0.25).abs() < 1e-6));

        mixer.set_silenced(true);
        mixer.mix(&mut out);
        assert!(out.iter().all(|sample| *sample == 0.0));
        assert!(mixer.talking().is_empty(), "silencing forgets the speakers");
    }

    #[test]
    fn a_long_backlog_is_trimmed_to_the_newest_audio() {
        let mixer = Mixer::new();
        mixer.push_pcm(1, &vec![0.1; MAX_BUFFER_SAMPLES], false);
        mixer.push_pcm(1, &vec![0.9; 480], false);
        let buffered = mixer.lock().get(&1).unwrap().buffer.len();
        assert_eq!(buffered, MAX_BUFFER_SAMPLES);
        assert_eq!(mixer.lock().get(&1).unwrap().buffer.back(), Some(&0.9));
    }

    #[test]
    fn talking_follows_packets_and_the_terminator() {
        let mixer = Mixer::new();
        mixer.push_pcm(4, &[0.1; 960], false);
        mixer.push_pcm(9, &[0.1; 960], false);
        assert_eq!(mixer.talking(), [4, 9]);

        mixer.push_pcm(9, &[0.1; 960], true);
        assert_eq!(mixer.talking(), [4]);

        mixer.retain_sessions(&HashSet::from([9]));
        assert!(mixer.talking().is_empty(), "session 4 left the server");
    }

    #[test]
    fn decodes_real_opus_packets_from_the_wire_format() {
        let mut encoder = Encoder::new().unwrap();
        let mixer = Mixer::new();
        let signal = tone(FRAME_SAMPLES * 6, 0.4);
        let mut packet = [0u8; MAX_OPUS_PACKET];

        for (index, frame) in signal.chunks(FRAME_SAMPLES).enumerate() {
            let len = encoder.encode(frame, &mut packet).unwrap();
            mixer.push_packet(&server_packet(12, index as u64 * 2, &packet[..len], false));
        }
        assert_eq!(mixer.talking(), [12]);

        let mut out = vec![0.0f32; FRAME_SAMPLES * 3];
        mixer.mix(&mut out);
        let level = rms(&out);
        // A 0.4 amplitude sine has an RMS of about 0.28; the codec keeps it close.
        assert!((0.15..0.4).contains(&level), "decoded level {level}");

        // A bare terminator ends the talking state without adding audio.
        mixer.push_packet(&server_packet(12, 12, &[], true));
        assert!(mixer.talking().is_empty());
    }

    #[test]
    fn garbage_and_non_audio_packets_are_ignored() {
        let mixer = Mixer::new();
        mixer.push_packet(&[]);
        mixer.push_packet(&[1, 2, 3]);
        mixer.push_packet(&server_packet(5, 0, &[0xff, 0xff, 0xff], false));
        let mut out = vec![0.0f32; 480];
        mixer.mix(&mut out);
        assert!(out.iter().all(|sample| *sample == 0.0));
    }
}
