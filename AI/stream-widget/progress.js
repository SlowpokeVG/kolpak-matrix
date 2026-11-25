// Kolpak build progress, read by index.html every few seconds.
// Edit and save; the widget picks it up without a reload.
//   state: "done" | "now" | "todo"
//   part:  0..1, how far the "now" step is (optional)
window.KOLPAK_PROGRESS = {
  now: "status bar is in. black space rail, inverted selection, mockup type sizes",
  steps: [
    { name: "docs",    state: "done" },
    { name: "fork",    state: "now", part: 0.85 },
    { name: "styling", state: "done" },
    { name: "mumble",  state: "todo" },
    { name: "streams", state: "todo" },
    { name: "design",  state: "now", part: 0.4 },
    { name: "mobile",  state: "todo" }
  ]
};
