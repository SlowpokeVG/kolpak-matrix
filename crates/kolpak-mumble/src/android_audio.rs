//! Android: the microphone and the speaker through AAudio directly, not through cpal.
//!
//! cpal opens AAudio streams with the default input preset and usage, which on a phone means
//! no echo cancellation: whoever listens on the loudspeaker sends everyone their own voice
//! back. Opening the streams here lets us ask for what a voice call asks for:
//!
//! - **Call mode** (the default): input preset `VoiceCommunication` and output usage
//!   `VoiceCommunication`, content type speech. The phone's own echo canceller, noise
//!   suppressor and gain control work on the microphone, and the app (Kotlin side) puts the
//!   audio system in communication mode and routes to the loudspeaker, a wired headset or a
//!   Bluetooth headset.
//! - **Media mode**: input preset `VoiceRecognition`, output usage `Media`. No echo
//!   cancellation, but Bluetooth headphones stay on their high-quality (A2DP) link and the
//!   media volume applies. For headphone users.
//!
//! A stream that AAudio disconnects (a headset plugged in or out, a Bluetooth device coming
//! or going) is closed and opened again on the new route, so voice does not go silent.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;

use ndk::audio::{
    AudioCallbackResult, AudioContentType, AudioDirection, AudioFormat, AudioInputPreset,
    AudioPerformanceMode, AudioSharingMode, AudioStream, AudioStreamBuilder, AudioUsage,
};
use tokio::sync::mpsc::UnboundedSender;

use crate::audio::{AudioError, CaptureInfo, Controls, Processor, VoiceFrame, SAMPLE_RATE};
use crate::playback::{Mixer, PlaybackInfo, Renderer};

static CALL_MODE: AtomicBool = AtomicBool::new(true);

/// Call mode (true, the default) or media mode for streams opened from now on. The caller
/// reopens running streams if it wants a change to apply at once.
pub fn set_call_mode(enabled: bool) {
    CALL_MODE.store(enabled, Ordering::Relaxed);
}

pub fn call_mode() -> bool {
    CALL_MODE.load(Ordering::Relaxed)
}

/// How long to wait before trying again when a stream will not open after a route change.
const REOPEN_DELAY: Duration = Duration::from_millis(500);
/// How often the stream thread looks at the stop and disconnect flags.
const POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy)]
struct Params {
    sample_rate: u32,
    channels: u16,
}

fn builder(direction: AudioDirection, call: bool) -> Result<AudioStreamBuilder, AudioError> {
    let builder = AudioStreamBuilder::new()
        .map_err(|error| AudioError::Device(error.to_string()))?
        .direction(direction)
        .format(AudioFormat::PCM_Float)
        .sharing_mode(AudioSharingMode::Shared)
        .performance_mode(AudioPerformanceMode::LowLatency)
        .content_type(AudioContentType::Speech);
    Ok(match direction {
        AudioDirection::Input => builder.input_preset(if call {
            AudioInputPreset::VoiceCommunication
        } else {
            AudioInputPreset::VoiceRecognition
        }),
        _ => builder.usage(if call {
            AudioUsage::VoiceCommunication
        } else {
            AudioUsage::Media
        }),
    })
}

/// The rate and channel count to open with: 48 kHz mono when the device takes it (no
/// resampling at all), otherwise whatever AAudio picks for it.
fn negotiate(direction: AudioDirection, call: bool) -> Result<Params, AudioError> {
    let exact = builder(direction, call)?
        .sample_rate(SAMPLE_RATE as i32)
        .channel_count(1)
        .open_stream();
    if exact.is_ok() {
        return Ok(Params {
            sample_rate: SAMPLE_RATE,
            channels: 1,
        });
    }
    let stream = builder(direction, call)?
        .open_stream()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    Ok(Params {
        sample_rate: u32::try_from(stream.sample_rate()).unwrap_or(SAMPLE_RATE),
        channels: u16::try_from(stream.channel_count().max(1)).unwrap_or(1),
    })
}

fn mode_name(call: bool) -> &'static str {
    if call {
        "phone audio, call mode"
    } else {
        "phone audio, media mode"
    }
}

fn open_input(
    controls: &Arc<Controls>,
    sink: &UnboundedSender<VoiceFrame>,
    lost: Arc<AtomicBool>,
) -> Result<(AudioStream, CaptureInfo), AudioError> {
    let call = call_mode();
    let params = negotiate(AudioDirection::Input, call)?;
    let mut processor = Processor::new(
        params.channels,
        params.sample_rate,
        controls.clone(),
        sink.clone(),
    )?;
    let channels = usize::from(params.channels);
    let stream = builder(AudioDirection::Input, call)?
        .sample_rate(params.sample_rate as i32)
        .channel_count(i32::from(params.channels))
        .data_callback(Box::new(move |_, data: *mut c_void, frames| {
            let len = usize::try_from(frames).unwrap_or(0) * channels;
            if len > 0 {
                // SAFETY: AAudio hands an input callback `frames` frames of the format the
                // stream was opened with (f32, `channels` interleaved), valid for the call.
                let samples = unsafe { std::slice::from_raw_parts(data as *const f32, len) };
                processor.push(samples);
            }
            AudioCallbackResult::Continue
        }))
        .error_callback(Box::new(move |_, error| {
            log::warn!("microphone stream error: {error}");
            lost.store(true, Ordering::Relaxed);
        }))
        .open_stream()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    Ok((
        stream,
        CaptureInfo {
            device_name: mode_name(call).to_owned(),
            sample_rate: params.sample_rate,
            channels: params.channels,
        },
    ))
}

fn open_output(
    mixer: &Arc<Mixer>,
    lost: Arc<AtomicBool>,
) -> Result<(AudioStream, PlaybackInfo), AudioError> {
    let call = call_mode();
    let params = negotiate(AudioDirection::Output, call)?;
    let mut renderer = Renderer::new(mixer.clone(), params.channels, params.sample_rate);
    let channels = usize::from(params.channels);
    let stream = builder(AudioDirection::Output, call)?
        .sample_rate(params.sample_rate as i32)
        .channel_count(i32::from(params.channels))
        .data_callback(Box::new(move |_, data: *mut c_void, frames| {
            let len = usize::try_from(frames).unwrap_or(0) * channels;
            if len > 0 {
                // SAFETY: AAudio hands an output callback a buffer for `frames` frames of the
                // stream's format (f32, `channels` interleaved), ours to fill for the call.
                let samples = unsafe { std::slice::from_raw_parts_mut(data as *mut f32, len) };
                renderer.fill(samples);
            }
            AudioCallbackResult::Continue
        }))
        .error_callback(Box::new(move |_, error| {
            log::warn!("output stream error: {error}");
            lost.store(true, Ordering::Relaxed);
        }))
        .open_stream()
        .map_err(|error| AudioError::Device(error.to_string()))?;
    Ok((
        stream,
        PlaybackInfo {
            device_name: mode_name(call).to_owned(),
            sample_rate: params.sample_rate,
            channels: params.channels,
        },
    ))
}

/// Keep a stream open until `stop`, reopening it whenever AAudio drops it. The first open's
/// result goes to `ready`; a failure there ends the thread, later ones are retried.
fn run<I>(
    stop: &AtomicBool,
    ready: Sender<Result<I, AudioError>>,
    what: &str,
    mut open: impl FnMut(Arc<AtomicBool>) -> Result<(AudioStream, I), AudioError>,
) {
    let mut ready = Some(ready);
    while !stop.load(Ordering::Relaxed) {
        let lost = Arc::new(AtomicBool::new(false));
        let opened = open(lost.clone()).and_then(|(stream, info)| {
            stream
                .request_start()
                .map_err(|error| AudioError::Device(error.to_string()))?;
            Ok((stream, info))
        });
        match opened {
            Ok((stream, info)) => {
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Ok(info));
                } else {
                    log::info!("{what} reopened on the new audio route");
                }
                while !stop.load(Ordering::Relaxed) && !lost.load(Ordering::Relaxed) {
                    std::thread::sleep(POLL);
                }
                let _ = stream.request_stop();
                drop(stream);
            }
            Err(error) => {
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(error));
                    return;
                }
                log::warn!("{what} did not reopen: {error}");
                std::thread::sleep(REOPEN_DELAY);
            }
        }
    }
}

/// The body of the capture thread on Android.
pub(crate) fn run_capture(
    controls: Arc<Controls>,
    sink: UnboundedSender<VoiceFrame>,
    ready: Sender<Result<CaptureInfo, AudioError>>,
    stop: Arc<AtomicBool>,
) {
    run(&stop, ready, "microphone", |lost| {
        open_input(&controls, &sink, lost)
    });
}

/// The body of the playback thread on Android.
pub(crate) fn run_playback(
    mixer: Arc<Mixer>,
    ready: Sender<Result<PlaybackInfo, AudioError>>,
    stop: Arc<AtomicBool>,
) {
    run(&stop, ready, "output", |lost| open_output(&mixer, lost));
}
