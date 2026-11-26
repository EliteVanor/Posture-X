# PostureX: notes for contributors and coding agents

## Layout
- Frontend (static, deployed to GitHub Pages): `index.html`, `setup.html`, `setup/`, `settings.html`, `login.html`, `register.html`, `css/`, `js/`, `styles.css`, `video.css`.
- Posture logic: `js/posture-core.js` (pure, unit-tested). Keep it free of DOM and MediaPipe so Node can test it.
- MediaPipe wrapper: `js/detector.js`. Camera loop and states: `js/monitor.js`.
- Optional backend: `backend/` (Flask, original hackathon server-side version).
- Thresholds live in one place, `THRESHOLDS` in `js/posture-core.js`, and must match `backend/posture.py` until the backend is retired or synced.

## Commands
- Unit tests: `npm test` (Node 22, no install needed).
- Run locally: `npm start`, then open http://localhost:8000 (the camera needs localhost or HTTPS).

## Git conventions
- One branch per version round, named `v_<version>_<short-description>`, for example `v_1_readme-live-demo`, `v_2_backend-fixes`. v0 is the original hackathon code.
- Branch from `main`. Merge into `main` to deploy the demo.
- Commits are authored as `Khoi Bui <98100649+EliteVanor@users.noreply.github.com>` (links to the EliteVanor GitHub profile and keeps the personal email private).
- Cloud sessions set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` environment variables, which override the repo's git config. Export the name and email above in those variables before committing, then check with `git log --format='%an <%ae>'`.

## When compacting
Keep the list of modified files, the test commands and open decisions.
