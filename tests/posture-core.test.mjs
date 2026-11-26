// Unit tests for the posture logic. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  POSE, FACE, THRESHOLDS, ISSUES,
  angleDeg, computeMetrics, averageMetrics, detectIssues, isUsableBaseline,
  IssueTracker, emptyDay, recordTime, goodPercent,
} from "../js/posture-core.js";

// Build landmark arrays with only the points the checks read.
function makePose({ nose, lEar, rEar, lSh, rSh }) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  pts[POSE.NOSE] = nose;
  pts[POSE.LEFT_EAR] = lEar;
  pts[POSE.RIGHT_EAR] = rEar;
  pts[POSE.LEFT_SHOULDER] = lSh;
  pts[POSE.RIGHT_SHOULDER] = rSh;
  return pts;
}

function makeFace(eyeDist) {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.3 }));
  pts[FACE.LEFT_EYE] = { x: 0.5 - eyeDist / 2, y: 0.3 };
  pts[FACE.RIGHT_EYE] = { x: 0.5 + eyeDist / 2, y: 0.3 };
  return pts;
}

const upright = makePose({
  nose: { x: 0.5, y: 0.3 },
  lEar: { x: 0.45, y: 0.28 },
  rEar: { x: 0.55, y: 0.28 },
  lSh: { x: 0.35, y: 0.55 },
  rSh: { x: 0.65, y: 0.55 },
});
const baseline = computeMetrics(upright, makeFace(0.1));

test("angleDeg: right angle and degenerate input", () => {
  assert.equal(Math.round(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 90);
  assert.equal(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test("computeMetrics: values from pose and face", () => {
  assert.ok(baseline.headTiltAngle > 0);
  assert.equal(baseline.shoulderTilt, 0);
  assert.equal(baseline.headY, 0.3);
  assert.ok(Math.abs(baseline.eyeDist - 0.1) < 1e-9);
});

test("computeMetrics: missing face or pose gives nulls, not a crash", () => {
  const noFace = computeMetrics(upright, null);
  assert.equal(noFace.eyeDist, null);
  assert.equal(noFace.headY, 0.3);
  const nothing = computeMetrics(null, null);
  assert.deepEqual(nothing, { headTiltAngle: null, shoulderTilt: null, headY: null, eyeDist: null });
});

test("averageMetrics ignores nulls", () => {
  const avg = averageMetrics([
    { headTiltAngle: 10, shoulderTilt: 0.1, headY: 0.3, eyeDist: null },
    { headTiltAngle: 20, shoulderTilt: 0.3, headY: 0.5, eyeDist: 0.2 },
  ]);
  assert.equal(avg.headTiltAngle, 15);
  assert.ok(Math.abs(avg.shoulderTilt - 0.2) < 1e-9);
  assert.equal(avg.eyeDist, 0.2);
  assert.equal(averageMetrics([]).headY, null);
});

test("isUsableBaseline needs the pose metrics", () => {
  assert.equal(isUsableBaseline(baseline), true);
  assert.equal(isUsableBaseline({ ...baseline, headY: null }), false);
  assert.equal(isUsableBaseline(null), false);
});

test("detectIssues: the calibrated pose itself is good posture", () => {
  assert.deepEqual(detectIssues(baseline, baseline), []);
});

test("detectIssues: head forward (angle change over 5 degrees)", () => {
  const m = { ...baseline, headTiltAngle: baseline.headTiltAngle + THRESHOLDS.headTiltAngle + 0.1 };
  assert.deepEqual(detectIssues(m, baseline), [ISSUES.FRONT_SLOUCH]);
  const small = { ...baseline, headTiltAngle: baseline.headTiltAngle + THRESHOLDS.headTiltAngle - 0.1 };
  assert.deepEqual(detectIssues(small, baseline), []);
});

test("detectIssues: uneven shoulders", () => {
  const m = { ...baseline, shoulderTilt: baseline.shoulderTilt + 0.05 };
  assert.deepEqual(detectIssues(m, baseline), [ISSUES.SHOULDER_TILT]);
});

test("detectIssues: sinking back (nose y over baseline * 1.2)", () => {
  assert.deepEqual(detectIssues({ ...baseline, headY: 0.37 }, baseline), [ISSUES.BACK_SLOUCH]);
  assert.deepEqual(detectIssues({ ...baseline, headY: 0.35 }, baseline), []);
});

test("detectIssues: too close (eye distance over 1.6x)", () => {
  assert.deepEqual(detectIssues({ ...baseline, eyeDist: 0.17 }, baseline), [ISSUES.FACE_CLOSE]);
  assert.deepEqual(detectIssues({ ...baseline, eyeDist: 0.15 }, baseline), []);
});

test("detectIssues: face missing at calibration skips only the distance check", () => {
  const noFaceBaseline = { ...baseline, eyeDist: null };
  assert.deepEqual(detectIssues({ ...baseline, eyeDist: 0.5 }, noFaceBaseline), []);
  assert.deepEqual(detectIssues({ ...baseline, eyeDist: 0.5, headY: 0.5 }, noFaceBaseline), [ISSUES.BACK_SLOUCH]);
});

test("detectIssues: no baseline means no issues", () => {
  assert.deepEqual(detectIssues(baseline, null), []);
});

test("detectIssues: several issues at once", () => {
  const m = { ...baseline, headY: 0.5, eyeDist: 0.2 };
  assert.deepEqual(detectIssues(m, baseline), [ISSUES.BACK_SLOUCH, ISSUES.FACE_CLOSE]);
});

test("IssueTracker: alerts once after the hold time, resets when the issue clears", () => {
  const t = new IssueTracker(2000);
  assert.deepEqual(t.update(["back-slouch"], 0), []);
  assert.deepEqual(t.update(["back-slouch"], 1999), []);
  assert.deepEqual(t.update(["back-slouch"], 2000), ["back-slouch"]);
  assert.deepEqual(t.update(["back-slouch"], 5000), []); // no repeat while it continues
  assert.deepEqual(t.confirmed(5000), ["back-slouch"]);
  assert.deepEqual(t.update([], 5100), []);
  assert.deepEqual(t.confirmed(5100), []);
  assert.deepEqual(t.update(["back-slouch"], 6000), []); // streak restarts
  assert.deepEqual(t.update(["back-slouch"], 8000), ["back-slouch"]);
});

test("IssueTracker: a one-frame blip never alerts", () => {
  const t = new IssueTracker(2000);
  t.update(["face-close"], 0);
  t.update([], 100);
  assert.deepEqual(t.update(["face-close"], 2100), []);
});

test("recordTime + goodPercent: overlapping issues are not double counted", () => {
  let day = emptyDay();
  assert.equal(goodPercent(day), null);
  day = recordTime(day, [], 3);
  day = recordTime(day, ["back-slouch", "face-close"], 1);
  assert.equal(day["good-posture-time"], 3);
  assert.equal(day["back-slouch-time"], 1);
  assert.equal(day["face-close-time"], 1);
  assert.equal(day.trackedSeconds, 4);
  assert.equal(goodPercent(day), 75);
});
