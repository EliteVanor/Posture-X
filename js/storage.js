// Browser storage for daily stats and settings. Every access is wrapped because
// storage can be blocked (private mode, disabled site data) and the app must still run.

const DAYS_KEY = "posturex.days";
const SETTINGS_KEY = "posturex.settings";
const BASELINE_KEY = "posturex.baseline"; // sessionStorage: setup pages share one calibration

function read(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: keep running without persistence.
  }
}

/** Local date as YYYY-MM-DD (not UTC, so "today" matches the user's clock). */
export function dateKey(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function loadDays() {
  return read(localStorage, DAYS_KEY, {});
}

export function saveDay(key, day) {
  const days = loadDays();
  days[key] = day;
  write(localStorage, DAYS_KEY, days);
}

/** The last n dates, oldest first, with their stats (or null). */
export function lastNDays(n, today = new Date()) {
  const days = loadDays();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dateKey(d);
    out.push({ key, date: d, day: days[key] || null });
  }
  return out;
}

export function clearDays() {
  write(localStorage, DAYS_KEY, {});
}

export function loadSettings() {
  return { notifications: true, ...read(localStorage, SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(localStorage, SETTINGS_KEY, settings);
}

export function loadBaseline() {
  return read(sessionStorage, BASELINE_KEY, null);
}

export function saveBaseline(baseline) {
  write(sessionStorage, BASELINE_KEY, baseline);
}
