// Kolpak build progress, read by index.html every few seconds.
// Edit and save; the widget picks it up without a reload.
//   state: "done" | "now" | "todo"
//   part:  0..1, how far the "now" step is (optional)
window.KOLPAK_PROGRESS = {
  now: "it is kolpak now: name, icon, links. sable's keys are gone. tests pass",
  steps: [
    { name: "docs",    state: "done" },
    { name: "fork",    state: "now", part: 0.85 },
    { name: "styling", state: "done" },
    { name: "mumble",  state: "todo" },
    { name: "streams", state: "todo" },
    { name: "design",  state: "todo" },
    { name: "mobile",  state: "todo" }
  ]
};
