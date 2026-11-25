// Kolpak build progress, read by index.html every few seconds.
// Edit and save; the widget picks it up without a reload.
//   state: "done" | "now" | "todo"
//   part:  0..1, how far the "now" step is (optional)
window.KOLPAK_PROGRESS = {
  now: "kolpak sends voice: mic picker, level meter, push to talk, voice activity. hearing others is next",
  steps: [
    { name: "docs",    state: "done" },
    { name: "fork",    state: "now", part: 0.85 },
    { name: "styling", state: "done" },
    { name: "mumble",  state: "now", part: 0.6 },
    { name: "streams", state: "now", part: 0.15 },
    { name: "design",  state: "now", part: 0.5 },
    { name: "mobile",  state: "todo" }
  ]
};
