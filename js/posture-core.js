// Pure posture logic: no DOM, no MediaPipe. Runs in the browser and in Node tests.
// Ported from backend/posture.py so both versions use the same checks and thresholds.

// MediaPipe landmark indices (same in the Python and JS APIs).
export const POSE = { NOSE: 0, LEFT_EAR: 7, RIGHT_EAR: 8, LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12 };
export const FACE = { LEFT_EYE: 33, RIGHT_EYE: 263 };

// Same values as backend/posture.py.
export const THRESHOLDS = Object.freeze({
  headTiltAngle: 5, // degrees of change in the ear-shoulder-nose angle
  shoulderTilt: 0.04, // change in vertical shoulder gap (normalized image units)
  headSinkFactor: 1.2, // nose y may grow to baseline * 1.2 before it counts as slouching back
  eyeDistRatio: 1.6, // eye distance may grow to baseline * 1.6 before it counts as too close
});

// Keys match the stat names the Flask backend uses, so stats can sync later.
export const ISSUES = Object.freeze({
  FRONT_SLOUCH: "front-slouch",
  SHOULDER_TILT: "shoulder-tilt",
  BACK_SLOUCH: "back-slouch",
  FACE_CLOSE: "face-close",
});

export const ISSUE_MESSAGES = Object.freeze({
  [ISSUES.FRONT_SLOUCH]: "Head is leaning forward. Keep your head up.",
  [ISSUES.SHOULDER_TILT]: "Shoulders are uneven. Straighten them.",
  [ISSUES.BACK_SLOUCH]: "You are sinking into the chair. Sit upright.",
  [ISSUES.FACE_CLOSE]: "Too close to the screen. Move back.",
});

const METRIC_KEYS = ["headTiltAngle", "shoulderTilt", "headY", "eyeDist"];

/** Angle ABC in degrees, with B as the vertex. Returns null for a zero-length side. */
export function angleDeg(a, b, c) {
  const bax = a.x - b.x, bay = a.y - b.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const norm = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (norm === 0) return null;
  const cos = Math.min(1, Math.max(-1, (bax * bcx + bay * bcy) / norm));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Turn raw landmarks into the 4 numbers the checks use.
 * pose: array of {x, y} (33 points) or null. face: array of {x, y} (478 points) or null.
 * A metric is null when the landmarks it needs are missing.
 */
export function computeMetrics(pose, face) {
  const m = { headTiltAngle: null, shoulderTilt: null, headY: null, eyeDist: null };
  if (pose && pose.length > POSE.RIGHT_SHOULDER) {
    const nose = pose[POSE.NOSE];
    const lEar = pose[POSE.LEFT_EAR], rEar = pose[POSE.RIGHT_EAR];
    const lSh = pose[POSE.LEFT_SHOULDER], rSh = pose[POSE.RIGHT_SHOULDER];
    const left = angleDeg(lEar, lSh, nose);
    const right = angleDeg(rEar, rSh, nose);
    if (left !== null && right !== null) m.headTiltAngle = (left + right) / 2;
    m.shoulderTilt = Math.abs(lSh.y - rSh.y);
    m.headY = nose.y;
  }
  if (face && face.length > FACE.RIGHT_EYE) {
    const l = face[FACE.LEFT_EYE], r = face[FACE.RIGHT_EYE];
    m.eyeDist = Math.hypot(l.x - r.x, l.y - r.y);
  }
  return m;
}

/** Mean of each metric over many frames, ignoring nulls. A metric with no samples stays null. */
export function averageMetrics(samples) {
  const out = {};
  for (const key of METRIC_KEYS) {
    const vals = samples.map((s) => s[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
    out[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return out;
}

/** True when the baseline has the pose metrics, which every check except "too close" needs. */
export function isUsableBaseline(baseline) {
  return !!baseline && baseline.headTiltAngle !== null && baseline.shoulderTilt !== null && baseline.headY !== null;
}

/**
 * Compare current metrics with the calibrated baseline. Returns a list of ISSUES values.
 * A check is skipped when either side is missing, so a missing face never crashes detection.
 */
export function detectIssues(metrics, baseline, t = THRESHOLDS) {
  const issues = [];
  if (!baseline) return issues;
  const has = (k) => metrics[k] !== null && baseline[k] !== null;

  if (has("headTiltAngle") && Math.abs(metrics.headTiltAngle - baseline.headTiltAngle) > t.headTiltAngle) {
    issues.push(ISSUES.FRONT_SLOUCH);
  }
  if (has("shoulderTilt") && Math.abs(metrics.shoulderTilt - baseline.shoulderTilt) > t.shoulderTilt) {
    issues.push(ISSUES.SHOULDER_TILT);
  }
  if (has("headY") && metrics.headY > baseline.headY * t.headSinkFactor) {
    issues.push(ISSUES.BACK_SLOUCH);
  }
  if (has("eyeDist") && baseline.eyeDist > 0 && metrics.eyeDist / baseline.eyeDist > t.eyeDistRatio) {
    issues.push(ISSUES.FACE_CLOSE);
  }
  return issues;
}

/**
 * Only alert on an issue that lasts. A single noisy frame should not ping the user.
 * update() returns the issues that just crossed holdMs, once each until they clear.
 */
export class IssueTracker {
  constructor(holdMs = 2000) {
    this.holdMs = holdMs;
    this.since = new Map(); // issue -> first time seen in the current streak
    this.alerted = new Set();
  }

  update(issues, now) {
    const current = new Set(issues);
    for (const key of [...this.since.keys()]) {
      if (!current.has(key)) {
        this.since.delete(key);
        this.alerted.delete(key);
      }
    }
    const fired = [];
    for (const key of current) {
      if (!this.since.has(key)) this.since.set(key, now);
      if (!this.alerted.has(key) && now - this.since.get(key) >= this.holdMs) {
        this.alerted.add(key);
        fired.push(key);
      }
    }
    return fired;
  }

  /** Issues that have lasted at least holdMs right now. */
  confirmed(now) {
    return [...this.since.entries()].filter(([, t]) => now - t >= this.holdMs).map(([k]) => k);
  }
}

// ---- Daily stats (same field names as the Flask backend's "days" records) ----

export function emptyDay() {
  return {
    "good-posture-time": 0,
    "front-slouch-time": 0,
    "shoulder-tilt-time": 0,
    "back-slouch-time": 0,
    "face-close-time": 0,
  };
}

/** Add `seconds` of tracked time. No issues counts as good posture. Returns a new object. */
export function addSample(day, issues, seconds) {
  const next = { ...emptyDay(), ...day };
  if (issues.length === 0) next["good-posture-time"] += seconds;
  for (const issue of issues) next[`${issue}-time`] += seconds;
  return next;
}

/**
 * Share of tracked time with good posture, 0-100, or null with no data.
 * Uses trackedSeconds, not the sum of the fields: two issues can overlap in the
 * same second, so summing the fields would count that second twice.
 */
export function goodPercent(day) {
  if (!day || !day.trackedSeconds) return null;
  return Math.round((100 * day["good-posture-time"]) / day.trackedSeconds);
}

/** addSample plus total tracked time, so goodPercent stays exact when issues overlap. */
export function recordTime(day, issues, seconds) {
  const next = addSample(day, issues, seconds);
  next.trackedSeconds = (day?.trackedSeconds || 0) + seconds;
  return next;
}
