//! Microphone capture: device → mono 48 kHz → 20 ms frames → transmit gate → Opus.
//!
//! Capture runs on its own thread because a cpal stream is not `Send`. The audio callback
//! does all the processing and hands finished Opus frames to an async task through an
//! unbounded channel; [`pump_voice`] numbers them and sends them over the connection.
//! Audio samples never leave this crate (AI/SPEC.md §3).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{mpsc as std_mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use serde::Serialize;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use unsafe_libopus::{
    opus_encode_float, opus_encoder_create, opus_encoder_ctl, opus_encoder_destroy, OpusEncoder,
    OPUS_APPLICATION_VOIP, OPUS_SET_BITRATE_REQUEST,
};

use crate::client::Client;
use crate::gate::{rms, FrameAction, Gate, TransmitMode, DEFAULT_VAD_THRESHOLD};
use crate::voice::{encode_audio_packet, FRAME_NUMBER_STEP_20MS};

/// Mumble's Opus audio is 48 kHz mono.
pub const SAMPLE_RATE: u32 = 48_000;
/// 20 ms at 48 kHz.
pub const FRAME_SAMPLES: usize = 960;
/// Speech at this rate is clear and far below the server's per-user cap.
const BITRATE_BPS: i32 = 40_000;
/// The largest packet Opus can produce for one frame.
const MAX_OPUS_PACKET: usize = 1275;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no microphone found")]
    NoInputDevice,
    #[error("the selected microphone is not available")]
    DeviceNotFound,
    #[error("the microphone uses a sample format Kolpak cannot read ({0})")]
    UnsupportedFormat(String),
    #[error("could not open the microphone: {0}")]
    Device(String),
    #[error("the Opus encoder failed (code {0})")]
    Encoder(i32),
    #[error("the microphone did not start in time")]
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    /// Stable identifier to store in settings.
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub fn list_input_devices() -> Result<Vec<InputDevice>, AudioError> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|device| device.id().ok())
        .map(|id| id.to_string());
    let devices = host
        .input_devices()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    let mut out = Vec::new();
    for device in devices {
        let Ok(id) = device.id() else { continue };
        let id = id.to_string();
        let name = device
            .description()
            .map(|description| description.name().to_owned())
            .unwrap_or_else(|_| id.clone());
        out.push(InputDevice {
            is_default: Some(&id) == default_id.as_ref(),
            id,
            name,
        });
    }
    Ok(out)
}

/// Settings and readings shared between the capture thread and whoever controls it.
#[derive(Debug)]
pub struct Controls {
    mode: AtomicU8,
    ptt_down: AtomicBool,
    muted: AtomicBool,
    vad_threshold: AtomicU32,
    level: AtomicU32,
    transmitting: AtomicBool,
}

impl Controls {
    pub fn new(mode: TransmitMode) -> Self {
        Self {
            mode: AtomicU8::new(mode as u8),
            ptt_down: AtomicBool::new(false),
            // Muted until told otherwise, so nothing is sent before the UI says so.
            muted: AtomicBool::new(true),
            vad_threshold: AtomicU32::new(DEFAULT_VAD_THRESHOLD.to_bits()),
            level: AtomicU32::new(0f32.to_bits()),
            transmitting: AtomicBool::new(false),
        }
    }

    pub fn set_mode(&self, mode: TransmitMode) {
        self.mode.store(mode as u8, Ordering::Relaxed);
    }

    pub fn mode(&self) -> TransmitMode {
        match self.mode.load(Ordering::Relaxed) {
            value if value == TransmitMode::Ptt as u8 => TransmitMode::Ptt,
            value if value == TransmitMode::Continuous as u8 => TransmitMode::Continuous,
            _ => TransmitMode::Vad,
        }
    }

    pub fn set_ptt(&self, down: bool) {
        self.ptt_down.store(down, Ordering::Relaxed);
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
    }

    pub fn set_vad_threshold(&self, threshold: f32) {
        self.vad_threshold
            .store(threshold.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    /// RMS level of the most recent frame, 0.0 to 1.0, whether or not it was sent.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// Whether the most recent frame was sent.
    pub fn is_transmitting(&self) -> bool {
        self.transmitting.load(Ordering::Relaxed)
    }
}

/// One encoded 20 ms frame, ready to be numbered and sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceFrame {
    pub opus: Vec<u8>,
    /// The last frame of a stretch of speech.
    pub last: bool,
}

struct Encoder(*mut OpusEncoder);

// The encoder is only ever touched from the capture callback that owns it.
unsafe impl Send for Encoder {}

impl Encoder {
    fn new() -> Result<Self, AudioError> {
        let mut error = 0;
        // SAFETY: plain constructor call; `error` outlives it.
        let raw = unsafe {
            opus_encoder_create(SAMPLE_RATE as i32, 1, OPUS_APPLICATION_VOIP, &mut error)
        };
        if raw.is_null() || error != 0 {
            return Err(AudioError::Encoder(error));
        }
        let encoder = Self(raw);
        // SAFETY: `raw` is a live encoder; the request takes one i32.
        let result = unsafe { opus_encoder_ctl!(encoder.0, OPUS_SET_BITRATE_REQUEST, BITRATE_BPS) };
        if result != 0 {
            return Err(AudioError::Encoder(result));
        }
        Ok(encoder)
    }

    fn encode(&mut self, pcm: &[f32], out: &mut [u8]) -> Result<usize, AudioError> {
        debug_assert_eq!(pcm.len(), FRAME_SAMPLES);
        // SAFETY: `pcm` holds exactly one mono frame and `out` is writable for its length.
        let written = unsafe {
            opus_encode_float(
                self.0,
                pcm.as_ptr(),
                FRAME_SAMPLES as i32,
                out.as_mut_ptr(),
                out.len() as i32,
            )
        };
        if written < 0 {
            Err(AudioError::Encoder(written))
        } else {
            Ok(written as usize)
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // SAFETY: created by opus_encoder_create and destroyed exactly once.
        unsafe { opus_encoder_destroy(self.0) };
    }
}

/// Linear-interpolation resampler. Good enough for speech from a 44.1 kHz microphone;
/// most Windows devices already run at 48 kHz and skip it entirely.
struct Resampler {
    step: f64,
    pos: f64,
    prev: f32,
}

impl Resampler {
    fn new(input_rate: u32) -> Self {
        Self {
            step: f64::from(input_rate) / f64::from(SAMPLE_RATE),
            pos: 0.0,
            prev: 0.0,
        }
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        let len = input.len() as isize;
        loop {
            let index = self.pos.floor() as isize;
            if index + 1 >= len {
                break;
            }
            let a = if index < 0 {
                self.prev
            } else {
                input[index as usize]
            };
            let b = input[(index + 1) as usize];
            let frac = (self.pos - index as f64) as f32;
            out.push(a + (b - a) * frac);
            self.pos += self.step;
        }
        self.prev = input[input.len() - 1];
        self.pos -= input.len() as f64;
    }
}

/// Everything the audio callback owns.
struct Processor {
    channels: usize,
    resampler: Option<Resampler>,
    mono: Vec<f32>,
    pending: Vec<f32>,
    packet: [u8; MAX_OPUS_PACKET],
    encoder: Encoder,
    gate: Gate,
    controls: Arc<Controls>,
    sink: UnboundedSender<VoiceFrame>,
}

impl Processor {
    fn push<T>(&mut self, data: &[T])
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        // Interleaved channels to mono.
        self.mono.clear();
        for frame in data.chunks(self.channels) {
            let sum: f32 = frame.iter().map(|sample| sample.to_sample::<f32>()).sum();
            self.mono.push(sum / frame.len() as f32);
        }
        match &mut self.resampler {
            Some(resampler) => resampler.process(&self.mono, &mut self.pending),
            None => self.pending.extend_from_slice(&self.mono),
        }

        let mut offset = 0;
        while self.pending.len() - offset >= FRAME_SAMPLES {
            let frame = &self.pending[offset..offset + FRAME_SAMPLES];
            offset += FRAME_SAMPLES;

            let level = rms(frame);
            self.controls
                .level
                .store(level.to_bits(), Ordering::Relaxed);
            let action = self.gate.next(
                self.controls.mode(),
                self.controls.muted.load(Ordering::Relaxed),
                self.controls.ptt_down.load(Ordering::Relaxed),
                level,
                f32::from_bits(self.controls.vad_threshold.load(Ordering::Relaxed)),
            );
            self.controls
                .transmitting
                .store(action == FrameAction::Send, Ordering::Relaxed);
            if action == FrameAction::Drop {
                continue;
            }
            match self.encoder.encode(frame, &mut self.packet) {
                Ok(len) => {
                    // A closed receiver means the connection is gone; capture stops soon after.
                    let _ = self.sink.send(VoiceFrame {
                        opus: self.packet[..len].to_vec(),
                        last: action == FrameAction::SendLast,
                    });
                }
                Err(error) => log::warn!("dropping a voice frame: {error}"),
            }
        }
        self.pending.drain(..offset);
    }
}

/// What the capture thread reports once the microphone is open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
}

/// A running microphone capture. Dropping it stops the microphone.
#[derive(Debug)]
pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub info: CaptureInfo,
}

impl Capture {
    /// Open `device_id` (or the system default) and start producing frames into `sink`.
    pub fn start(
        device_id: Option<String>,
        controls: Arc<Controls>,
        sink: UnboundedSender<VoiceFrame>,
    ) -> Result<Self, AudioError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std_mpsc::channel::<Result<CaptureInfo, AudioError>>();
        let thread_stop = stop.clone();

        let thread = std::thread::Builder::new()
            .name("kolpak-capture".into())
            .spawn(move || match open_stream(device_id, controls, sink) {
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

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn open_stream(
    device_id: Option<String>,
    controls: Arc<Controls>,
    sink: UnboundedSender<VoiceFrame>,
) -> Result<(cpal::Stream, CaptureInfo), AudioError> {
    let host = cpal::default_host();
    let device = match device_id.as_deref().filter(|id| !id.is_empty()) {
        Some(wanted) => host
            .input_devices()
            .map_err(|error| AudioError::Device(error.to_string()))?
            .find(|device| device.id().is_ok_and(|id| id.to_string() == wanted))
            .ok_or(AudioError::DeviceNotFound)?,
        None => host
            .default_input_device()
            .ok_or(AudioError::NoInputDevice)?,
    };
    let device_name = device
        .description()
        .map(|description| description.name().to_owned())
        .unwrap_or_else(|_| "microphone".to_owned());
    let supported = device
        .default_input_config()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    let format = supported.sample_format();
    let config = supported.config();
    let sample_rate = config.sample_rate;
    let channels = config.channels;

    let mut processor = Processor {
        channels: usize::from(channels.max(1)),
        resampler: (sample_rate != SAMPLE_RATE).then(|| Resampler::new(sample_rate)),
        mono: Vec::with_capacity(4096),
        pending: Vec::with_capacity(FRAME_SAMPLES * 4),
        packet: [0; MAX_OPUS_PACKET],
        encoder: Encoder::new()?,
        gate: Gate::new(),
        controls,
        sink,
    };
    let on_error = |error: cpal::Error| log::warn!("microphone stream error: {error}");

    let stream = match format {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| processor.push(data),
            on_error,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| processor.push(data),
            on_error,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| processor.push(data),
            on_error,
            None,
        ),
        SampleFormat::I32 => device.build_input_stream(
            config,
            move |data: &[i32], _: &cpal::InputCallbackInfo| processor.push(data),
            on_error,
            None,
        ),
        other => return Err(AudioError::UnsupportedFormat(other.to_string())),
    }
    .map_err(|error| AudioError::Device(error.to_string()))?;

    Ok((
        stream,
        CaptureInfo {
            device_name,
            sample_rate,
            channels,
        },
    ))
}

/// Number the frames and send them until the capture side goes away.
pub async fn pump_voice(client: Client, mut frames: UnboundedReceiver<VoiceFrame>) {
    let mut frame_number: u64 = 0;
    while let Some(frame) = frames.recv().await {
        client.send_voice(encode_audio_packet(frame_number, &frame.opus, frame.last));
        frame_number += FRAME_NUMBER_STEP_20MS;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_keeps_duration_when_converting_44100_to_48000() {
        let mut resampler = Resampler::new(44_100);
        let input = vec![0.5f32; 4410];
        let mut out = Vec::new();
        for chunk in input.chunks(441) {
            resampler.process(chunk, &mut out);
        }
        // 100 ms in, 100 ms out, give or take the one sample still held back.
        assert!(
            (out.len() as i64 - 4800).abs() <= 2,
            "got {} samples",
            out.len()
        );
        assert!(out
            .iter()
            .all(|sample| (sample - 0.5).abs() < 1e-6 || *sample <= 0.5));
    }

    #[test]
    fn resampler_interpolates_between_samples() {
        // Halving the rate's step doubles the samples: 24 kHz in, 48 kHz out.
        let mut resampler = Resampler::new(24_000);
        let mut out = Vec::new();
        resampler.process(&[0.0, 1.0, 0.0], &mut out);
        assert_eq!(out, [0.0, 0.5, 1.0, 0.5]);
    }

    #[test]
    fn encoder_turns_a_frame_into_a_small_opus_packet() {
        let mut encoder = Encoder::new().unwrap();
        let tone: Vec<f32> = (0..FRAME_SAMPLES)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * 0.3)
            .collect();
        let mut packet = [0u8; MAX_OPUS_PACKET];
        let len = encoder.encode(&tone, &mut packet).unwrap();
        // 40 kbit/s for 20 ms is about 100 bytes; allow a wide margin either way.
        assert!((10..400).contains(&len), "unexpected packet size {len}");
    }

    #[test]
    fn controls_start_muted_and_round_trip_their_settings() {
        let controls = Controls::new(TransmitMode::Ptt);
        assert_eq!(controls.mode(), TransmitMode::Ptt);
        assert!(controls.muted.load(Ordering::Relaxed));
        controls.set_mode(TransmitMode::Continuous);
        assert_eq!(controls.mode(), TransmitMode::Continuous);
        controls.set_vad_threshold(7.0);
        assert_eq!(
            f32::from_bits(controls.vad_threshold.load(Ordering::Relaxed)),
            1.0
        );
        assert_eq!(controls.level(), 0.0);
        assert!(!controls.is_transmitting());
    }
}
