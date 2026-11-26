// Dashboard: live monitor, today's breakdown and the 7-day chart.

import { Monitor } from "./monitor.js";
import { ISSUE_MESSAGES, recordTime, goodPercent, emptyDay } from "./posture-core.js";
import { dateKey, loadDays, saveDay, lastNDays, loadSettings } from "./storage.js";
import { setStatus, renderIssues, errorMessage, formatDuration } from "./ui.js";

const $ = (id) => document.getElementById(id);
const els = {
  video: $("camera-feed"),
  overlay: $("overlay"),
  placeholder: $("video-placeholder"),
  calBar: $("calibration-bar"),
  status: $("status"),
  start: $("startMonitoring"),
  stop: $("stopMonitoring"),
  recal: $("recalibrate"),
  issues: $("issues"),
  session: $("session-info"),
  todayPercent: $("today-percent"),
  breakdown: $("today-breakdown"),
  weekly: $("weeklyChart"),
};

const BREAKDOWN_ROWS = [
  ["good-posture-time", "Good posture"],
  ["front-slouch-time", "Head forward"],
  ["shoulder-tilt-time", "Uneven shoulders"],
  ["back-slouch-time", "Sinking back"],
  ["face-close-time", "Too close"],
];

const SAVE_EVERY_S = 5;
const NOTIFY_COOLDOWN_MS = 30_000;

let today = dateKey();
let day = loadDays()[today] || emptyDay();
let unsaved = 0;
let sessionSeconds = 0;
let lastNotify = 0;
let chart = null;

// ---- Stats rendering ----

function renderToday() {
  const pct = goodPercent(day);
  els.todayPercent.textContent = pct === null ? "–" : `${pct}%`;
  els.breakdown.replaceChildren();
  for (const [key, label] of BREAKDOWN_ROWS) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = formatDuration(day[key] || 0);
    els.breakdown.append(dt, dd);
  }
}

function renderWeek() {
  if (typeof Chart === "undefined") return; // chart library blocked: the rest still works
  const rows = lastNDays(7);
  const labels = rows.map((r) => r.date.toLocaleDateString(undefined, { weekday: "short" }));
  const data = rows.map((r) => (r.key === today ? goodPercent(day) : goodPercent(r.day)));
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update("none");
    return;
  }
  chart = new Chart(els.weekly, {
    type: "bar",
    data: { labels, datasets: [{ label: "Good posture %", data, backgroundColor: "#ff6600", borderRadius: 6 }] },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } } },
    },
  });
}

function persist(force = false) {
  if (unsaved === 0) return;
  if (force || unsaved >= SAVE_EVERY_S) {
    saveDay(today, day);
    unsaved = 0;
    renderWeek();
  }
}

// ---- Notifications ----

async function askNotificationPermission() {
  if (!("Notification" in window) || !loadSettings().notifications) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // Some browsers only support the callback form. Not worth failing over.
    }
  }
}

function notify(issues) {
  // On-page alerts already show while the tab is visible. Notify only when the user is elsewhere.
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  if (!loadSettings().notifications) return;
  const now = Date.now();
  if (now - lastNotify < NOTIFY_COOLDOWN_MS) return;
  lastNotify = now;
  new Notification("PostureX", { body: issues.map((i) => ISSUE_MESSAGES[i]).join("\n"), tag: "posturex" });
}

// ---- Monitor wiring ----

const monitor = new Monitor({
  video: els.video,
  overlay: els.overlay,
  onState(state, info) {
    const running = state !== "idle" && state !== "error";
    els.start.disabled = running;
    els.stop.disabled = !running;
    els.recal.disabled = state !== "monitoring";
    els.placeholder.hidden = running && state !== "loading";
    els.calBar.hidden = state !== "calibrating";
    setStatus(els.status, state);
    if (state === "error") {
      els.issues.replaceChildren();
      els.session.textContent = errorMessage(info?.error);
    }
    if (state === "calibrating") {
      els.issues.replaceChildren();
      els.session.textContent = "Sit up straight and look at the screen.";
    }
    if (state === "idle") {
      persist(true);
      els.issues.replaceChildren();
      els.session.textContent = sessionSeconds ? `Last session: ${formatDuration(sessionSeconds)} tracked.` : "";
    }
    document.body.dataset.monitorState = state; // used by the end-to-end test
  },
  onFrame(frame) {
    if (frame.calibrationProgress !== undefined) {
      els.calBar.firstElementChild.style.width = `${Math.round(frame.calibrationProgress * 100)}%`;
      if (!frame.personFound) els.session.textContent = "Waiting for you to appear in the camera…";
      return;
    }
    // Show only issues that have lasted, so one noisy frame does not flash a warning.
    renderIssues(els.issues, frame.confirmed || [], { personFound: frame.personFound });
    document.body.dataset.issues = (frame.issues || []).join(",");
    if (!frame.personFound) return; // away from the desk: not tracked

    if (dateKey() !== today) {
      // Midnight passed during a session.
      persist(true);
      today = dateKey();
      day = emptyDay();
    }
    day = recordTime(day, frame.issues, frame.dt);
    sessionSeconds += frame.dt;
    unsaved += frame.dt;
    els.session.textContent = `Session: ${formatDuration(sessionSeconds)} tracked.`;
    renderToday();
    persist();
  },
  onAlert: notify,
});

els.start.addEventListener("click", () => {
  sessionSeconds = 0;
  askNotificationPermission();
  monitor.start();
});
els.stop.addEventListener("click", () => monitor.stop());
els.recal.addEventListener("click", () => monitor.recalibrate());
window.addEventListener("pagehide", () => persist(true));

renderToday();
renderWeek();
