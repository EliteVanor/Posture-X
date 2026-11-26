// Camera + detection loop. States: idle -> loading -> calibrating -> monitoring -> idle.

import { getDetector } from "./detector.js";
import { computeMetrics, averageMetrics, detectIssues, isUsableBaseline, IssueTracker } from "./posture-core.js";

const TICK_MS = 100; // about 10 checks per second; browsers slow this to 1/s in background tabs
const MAX_DT_S = 1.5; // cap one tick's time so a frozen tab does not add minutes of stats

export class Monitor {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video
   * @param {HTMLCanvasElement} opts.overlay  canvas drawn over the video
   * @param {object|null} [opts.baseline]     skip calibration and use this baseline
   * @param {boolean} [opts.detect=true]      false = preview only (skeleton, no posture checks)
   * @param {number} [opts.calibrationMs=2000]
   * @param {(state: string, info?: object) => void} [opts.onState]
   * @param {(frame: object) => void} [opts.onFrame]
   * @param {(issues: string[]) => void} [opts.onAlert]  issues that lasted holdMs
   */
  constructor(opts) {
    this.video = opts.video;
    this.overlay = opts.overlay;
    this.ctx = this.overlay.getContext("2d");
    this.detectEnabled = opts.detect !== false;
    this.calibrationMs = opts.calibrationMs ?? 2000;
    this.presetBaseline = opts.baseline || null;
    this.onState = opts.onState || (() => {});
    this.onFrame = opts.onFrame || (() => {});
    this.onAlert = opts.onAlert || (() => {});
    this.state = "idle";
    this.stream = null;
    this.timer = null;
  }

  setState(state, info) {
    this.state = state;
    this.onState(state, info);
  }

  async start() {
    if (this.state !== "idle" && this.state !== "error") return;
    this.setState("loading");
    try {
      const [detector, stream] = await Promise.all([
        getDetector(),
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }),
      ]);
      if (this.state !== "loading") {
        // stop() was pressed while loading.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.detector = detector;
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
    } catch (err) {
      this.stop();
      this.setState("error", { error: err });
      return;
    }

    this.baseline = this.presetBaseline;
    this.samples = [];
    this.tracker = new IssueTracker();
    this.calibrationStart = null;
    this.lastTick = performance.now();
    if (!this.detectEnabled) this.setState("preview");
    else if (isUsableBaseline(this.baseline)) this.setState("monitoring", { baseline: this.baseline });
    else this.setState("calibrating");
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.state !== "idle") this.setState("idle");
  }

  /** Throw away the baseline and calibrate again without restarting the camera. */
  recalibrate() {
    if (!this.timer || !this.detectEnabled) return;
    this.baseline = null;
    this.samples = [];
    this.calibrationStart = null;
    this.tracker = new IssueTracker();
    this.setState("calibrating");
  }

  tick() {
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return;
    if (this.overlay.width !== v.videoWidth) {
      this.overlay.width = v.videoWidth;
      this.overlay.height = v.videoHeight;
    }

    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, MAX_DT_S);
    this.lastTick = now;

    const result = this.detector.detect(v);
    this.detector.draw(this.ctx, result);
    const personFound = !!result.pose;
    const faceFound = !!result.face;

    if (this.state === "preview") {
      this.onFrame({ personFound, faceFound, issues: [], dt });
      return;
    }

    const metrics = computeMetrics(result.pose, result.face);

    if (this.state === "calibrating") {
      // Only frames with a person count. Calibration time starts at the first such frame.
      if (personFound) {
        if (this.calibrationStart === null) this.calibrationStart = now;
        this.samples.push(metrics);
      }
      const elapsed = this.calibrationStart === null ? 0 : now - this.calibrationStart;
      const progress = Math.min(1, elapsed / this.calibrationMs);
      this.onFrame({ personFound, faceFound, issues: [], dt, calibrationProgress: progress });
      if (progress >= 1 && this.samples.length >= 5) {
        this.baseline = averageMetrics(this.samples);
        this.setState("monitoring", { baseline: this.baseline });
      }
      return;
    }

    if (this.state === "monitoring") {
      const issues = personFound ? detectIssues(metrics, this.baseline) : [];
      const fired = this.tracker.update(issues, now);
      this.onFrame({ personFound, faceFound, issues, confirmed: this.tracker.confirmed(now), metrics, dt });
      if (fired.length) this.onAlert(fired);
    }
  }
}
