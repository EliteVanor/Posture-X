// MediaPipe Tasks Vision wrapper. Loads the pose and face models once per page and
// runs them on the video in the browser, so camera frames never leave the device.

const VERSION = "0.10.14";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let detectorPromise = null;

async function createWithFallback(Task, fileset, modelAssetPath, extra) {
  // GPU is faster, but some machines and headless browsers lack WebGL support. Fall back to CPU.
  try {
    return await Task.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      ...extra,
    });
  } catch (err) {
    console.warn(`GPU delegate failed for ${Task.name}, using CPU`, err);
    return Task.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: "CPU" },
      runningMode: "VIDEO",
      ...extra,
    });
  }
}

async function create() {
  const vision = await import(`${CDN}/vision_bundle.mjs`);
  const { FilesetResolver, PoseLandmarker, FaceLandmarker, DrawingUtils } = vision;
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const [pose, face] = await Promise.all([
    createWithFallback(PoseLandmarker, fileset, POSE_MODEL, { numPoses: 1 }),
    createWithFallback(FaceLandmarker, fileset, FACE_MODEL, { numFaces: 1 }),
  ]);

  let lastTs = 0;
  return {
    /** Run both models on the current video frame. Missing results come back as null. */
    detect(video) {
      // detectForVideo needs strictly increasing timestamps.
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const p = pose.detectForVideo(video, ts);
      const f = face.detectForVideo(video, ts);
      return {
        pose: p.landmarks?.[0] || null,
        face: f.faceLandmarks?.[0] || null,
      };
    },

    /** Draw the pose skeleton and the eye points on a 2D canvas the same size as the video. */
    draw(ctx, result) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const utils = new DrawingUtils(ctx);
      if (result.pose) {
        utils.drawConnectors(result.pose, PoseLandmarker.POSE_CONNECTIONS, { color: "#ff8800", lineWidth: 3 });
        utils.drawLandmarks(result.pose, { color: "#2c3e50", fillColor: "#ffffff", radius: 3 });
      }
      if (result.face) {
        utils.drawConnectors(result.face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#3498db", lineWidth: 2 });
      }
    },
  };
}

/** Shared detector for the page. The first call downloads about 5 MB of models. */
export function getDetector() {
  if (!detectorPromise) {
    detectorPromise = create().catch((err) => {
      detectorPromise = null; // allow a retry
      throw err;
    });
  }
  return detectorPromise;
}
