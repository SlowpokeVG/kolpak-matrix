//! Deciding when the microphone is sent: always, while a key is held, or while there is
//! sound. Pure logic over 20 ms frames, no audio devices, so it can be tested directly.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TransmitMode {
    /// Push to talk: only while the key is down.
    Ptt,
    /// Voice activity: while the input level is above a threshold.
    #[default]
    Vad,
    /// Always, unless muted.
    Continuous,
}

/// What to do with one captured frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameAction {
    /// Do not send it.
    Drop,
    /// Send it as part of a stretch of speech.
    Send,
    /// Send it and mark it as the last of this stretch.
    SendLast,
}

/// After the level falls below the threshold, keep sending this many more frames so the
/// ends of words are not clipped. 15 frames of 20 ms is 300 ms.
pub const VAD_HANGOVER_FRAMES: u32 = 15;

/// A reasonable default for a headset microphone, as RMS of samples in -1.0..1.0.
pub const DEFAULT_VAD_THRESHOLD: f32 = 0.02;

#[derive(Debug, Default)]
pub struct Gate {
    open: bool,
    hangover: u32,
}

impl Gate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Feed one frame's worth of state; get back what to do with that frame.
    pub fn next(
        &mut self,
        mode: TransmitMode,
        muted: bool,
        ptt_down: bool,
        level: f32,
        vad_threshold: f32,
    ) -> FrameAction {
        let want_open = if muted {
            false
        } else {
            match mode {
                TransmitMode::Continuous => true,
                TransmitMode::Ptt => ptt_down,
                TransmitMode::Vad => {
                    if level >= vad_threshold {
                        self.hangover = VAD_HANGOVER_FRAMES;
                        true
                    } else if self.open && self.hangover > 0 {
                        self.hangover -= 1;
                        true
                    } else {
                        false
                    }
                }
            }
        };

        match (self.open, want_open) {
            (_, true) => {
                self.open = true;
                FrameAction::Send
            }
            // The frame on which the gate closes is still sent, flagged as the last one,
            // so listeners know the speech ended rather than guessing from silence.
            (true, false) => {
                self.open = false;
                self.hangover = 0;
                FrameAction::SendLast
            }
            (false, false) => FrameAction::Drop,
        }
    }
}

/// Root mean square of a frame of samples in -1.0..1.0.
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|sample| sample * sample).sum();
    (sum / samples.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: f32 = DEFAULT_VAD_THRESHOLD;

    #[test]
    fn push_to_talk_follows_the_key_and_ends_with_a_last_frame() {
        let mut gate = Gate::new();
        assert_eq!(
            gate.next(TransmitMode::Ptt, false, false, 1.0, T),
            FrameAction::Drop
        );
        assert_eq!(
            gate.next(TransmitMode::Ptt, false, true, 0.0, T),
            FrameAction::Send
        );
        assert_eq!(
            gate.next(TransmitMode::Ptt, false, true, 0.0, T),
            FrameAction::Send
        );
        assert_eq!(
            gate.next(TransmitMode::Ptt, false, false, 0.0, T),
            FrameAction::SendLast
        );
        assert_eq!(
            gate.next(TransmitMode::Ptt, false, false, 0.0, T),
            FrameAction::Drop
        );
    }

    #[test]
    fn voice_activity_holds_on_for_a_while_after_the_sound_stops() {
        let mut gate = Gate::new();
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.001, T),
            FrameAction::Drop
        );
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.5, T),
            FrameAction::Send
        );
        for _ in 0..VAD_HANGOVER_FRAMES {
            assert_eq!(
                gate.next(TransmitMode::Vad, false, false, 0.0, T),
                FrameAction::Send
            );
        }
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.0, T),
            FrameAction::SendLast
        );
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.0, T),
            FrameAction::Drop
        );
    }

    #[test]
    fn sound_during_the_hangover_keeps_the_stretch_going() {
        let mut gate = Gate::new();
        gate.next(TransmitMode::Vad, false, false, 0.5, T);
        for _ in 0..VAD_HANGOVER_FRAMES - 1 {
            gate.next(TransmitMode::Vad, false, false, 0.0, T);
        }
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.5, T),
            FrameAction::Send
        );
        // The hangover starts over.
        for _ in 0..VAD_HANGOVER_FRAMES {
            assert_eq!(
                gate.next(TransmitMode::Vad, false, false, 0.0, T),
                FrameAction::Send
            );
        }
        assert_eq!(
            gate.next(TransmitMode::Vad, false, false, 0.0, T),
            FrameAction::SendLast
        );
    }

    #[test]
    fn continuous_sends_everything() {
        let mut gate = Gate::new();
        for _ in 0..3 {
            assert_eq!(
                gate.next(TransmitMode::Continuous, false, false, 0.0, T),
                FrameAction::Send
            );
        }
    }

    #[test]
    fn muting_closes_the_gate_in_every_mode() {
        let mut gate = Gate::new();
        assert_eq!(
            gate.next(TransmitMode::Continuous, false, false, 0.0, T),
            FrameAction::Send
        );
        assert_eq!(
            gate.next(TransmitMode::Continuous, true, false, 0.0, T),
            FrameAction::SendLast
        );
        assert_eq!(
            gate.next(TransmitMode::Continuous, true, false, 0.9, T),
            FrameAction::Drop
        );
        assert_eq!(
            gate.next(TransmitMode::Ptt, true, true, 0.9, T),
            FrameAction::Drop
        );
        assert_eq!(
            gate.next(TransmitMode::Vad, true, false, 0.9, T),
            FrameAction::Drop
        );
    }

    #[test]
    fn rms_of_silence_and_of_a_full_scale_square_wave() {
        assert_eq!(rms(&[]), 0.0);
        assert_eq!(rms(&[0.0; 960]), 0.0);
        let square: Vec<f32> = (0..960)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        assert!((rms(&square) - 1.0).abs() < 1e-6);
    }
}
