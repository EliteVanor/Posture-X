// Small DOM helpers shared by the dashboard and the setup pages.

import { ISSUE_MESSAGES } from "./posture-core.js";

const STATUS = {
  idle: ["Not running", "status-idle"],
  loading: ["Loading models…", "status-busy"],
  calibrating: ["Calibrating: sit up straight", "status-busy"],
  preview: ["Camera on", "status-good"],
  monitoring: ["Monitoring", "status-good"],
  error: ["Error", "status-bad"],
};

export function setStatus(el, state, override) {
  const [text, cls] = STATUS[state] || STATUS.idle;
  el.textContent = override || text;
  el.className = `status-pill ${cls}`;
}

/** Render the active issues, or a positive message when posture is fine. */
export function renderIssues(listEl, issues, { personFound = true } = {}) {
  listEl.replaceChildren();
  let items;
  if (!personFound) items = [["No person in view. Make sure your head and shoulders are visible.", "issue-warn"]];
  else if (issues.length === 0) items = [["Good posture 👍", "issue-good"]];
  else items = issues.map((i) => [ISSUE_MESSAGES[i] || i, "issue-bad"]);
  for (const [text, cls] of items) {
    const li = document.createElement("li");
    li.className = cls;
    li.textContent = text;
    listEl.append(li);
  }
}

/** Plain-language message for camera and model errors. */
export function errorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError") return "Camera permission was denied. Allow camera access in the address bar and try again.";
  if (name === "NotFoundError") return "No camera found.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  if (!window.isSecureContext) return "The camera needs HTTPS or localhost.";
  return `Could not start: ${err?.message || err}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
