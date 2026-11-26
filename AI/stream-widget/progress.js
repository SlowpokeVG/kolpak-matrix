// Kolpak build progress, read by index.html every few seconds.
// Edit and save; the widget picks it up without a reload.
//   state: "done" | "now" | "todo"
//   part:  0..1, how far the "now" step is (optional)
window.KOLPAK_PROGRESS = {
  now: "Android: APK with voice, streams and the phone layout; not yet run on a phone",
  steps: [
    { name: "docs",    state: "done" },
    { name: "fork",    state: "now", part: 0.85 },
    { name: "styling", state: "done" },
    { name: "mumble",  state: "now", part: 0.92 },
    { name: "streams", state: "now", part: 0.85 },
    { name: "design",  state: "now", part: 0.75 },
    { name: "mobile",  state: "now", part: 0.6 }
  ]
};
