// Account pages. Accounts live in the optional Flask backend (backend/app.py).
// Monitoring works without an account: stats stay in this browser.
// Point the pages at another server with ?api=https://your-server.

const API_BASE = new URLSearchParams(location.search).get("api") || "http://127.0.0.1:5000";

const msg = document.getElementById("auth-message");

function show(text, ok = false) {
  msg.textContent = text;
  msg.className = ok ? "notice notice-ok" : "notice";
  msg.hidden = false;
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const get = (id) => document.getElementById(id).value.trim();
    const user = { username: get("full_name"), email: get("email"), gender: get("gender"), country: get("country") };
    try {
      const res = await fetch(`${API_BASE}/create_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      show("Account created. Taking you to the dashboard…", true);
      setTimeout(() => (location.href = "index.html"), 1200);
    } catch (err) {
      show(
        `Could not reach the account server at ${API_BASE}. Accounts need the Flask backend running locally ` +
          `(see the README). You can still use the dashboard without an account.`,
      );
      console.warn(err);
    }
  });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // The backend has no password check yet (planned for v2), so login only opens the dashboard.
    location.href = "index.html";
  });
}
