// Setup pages. The page's <main data-setup-mode="..."> picks the behavior:
//   preview   - camera + skeleton, so the user can check framing
//   calibrate - record a good-posture baseline and keep it for this browser session
//   check     - use that baseline and show which issues are detected while the user slouches

import { Monitor } from "./monitor.js";
import { loadBaseline, saveBaseline } from "./storage.js";
import { setStatus, renderIssues, errorMessage } from "./ui.js";

const main = document.querySelector("[data-setup-mode]");
const mode = main.dataset.setupMode;
const $ = (id) => document.getElementById(id);
const status = $("status");
const issues = $("issues");
const info = $("setup-info");
const start = $("startRecording");
const stop = $("stopRecording");
const placeholder = $("video-placeholder");
const calBar = $("calibration-bar");
let calibrated = false;

const monitor = new Monitor({
  video: $("camera-feed"),
  overlay: $("overlay"),
  detect: mode !== "preview",
  baseline: mode === "check" ? loadBaseline() : null,
  onState(state, data) {
    const running = state !== "idle" && state !== "error";
    start.disabled = running;
    stop.disabled = !running;
    placeholder.hidden = running && state !== "loading";
    if (calBar) calBar.hidden = state !== "calibrating";
    setStatus(status, state);
    document.body.dataset.monitorState = state;
    if (state === "error") info.textContent = errorMessage(data?.error);
    if (state === "calibrating" && mode === "check") {
      info.textContent = "No saved calibration yet. Sit up straight for 2 seconds first, then slouch.";
    }
    if (state === "monitoring" && mode === "calibrate") {
      saveBaseline(data.baseline);
      calibrated = true;
      monitor.stop(); // calls onState("idle"), which shows the result
      return;
    }
    if (state === "idle" && calibrated) {
      setStatus(status, "monitoring", "Calibrated ✓");
      info.textContent = "Good posture saved. Press Next to see how PostureX reacts when you slouch.";
      calibrated = false;
    }
    if (state === "monitoring" && mode === "check") {
      saveBaseline(data.baseline);
      info.textContent = "Now slouch, lean forward or move closer. Each issue appears after it lasts 2 seconds.";
    }
    if (state === "idle") issues.replaceChildren();
  },
  onFrame(frame) {
    if (calBar && frame.calibrationProgress !== undefined) {
      calBar.firstElementChild.style.width = `${Math.round(frame.calibrationProgress * 100)}%`;
    }
    if (mode === "preview") {
      info.textContent = frame.personFound
        ? frame.faceFound
          ? "Head and shoulders found. You're framed well."
          : "Body found, but not your face. Face the camera."
        : "No person found. Move so your head and shoulders are in view.";
      return;
    }
    if (monitor.state === "monitoring") {
      renderIssues(issues, frame.confirmed || [], { personFound: frame.personFound });
    }
  },
});

start.addEventListener("click", () => monitor.start());
stop.addEventListener("click", () => monitor.stop());
