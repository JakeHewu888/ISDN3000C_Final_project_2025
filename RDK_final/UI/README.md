# Guided Skin Screening UI

Operator-facing, UI-only prototype for the guided screening workflow: Ready → Portrait Confirm → Patient Profile → Capture (Face → Arm) → Review → Analysis → Results → Session End → Ready.

## Run locally
- Open `index.html` directly in a browser **or** serve the folder: `python -m http.server 8000` then visit `http://localhost:8000`.
- No build or backend required (vanilla HTML/CSS/JS).

## Simulated hardware controls
- Keyboard: `1` = Hardware Button 1, `2` = Hardware Button 2.
- On-screen debug panel also fires Button 1/2 and shows the last press.
- Capture page mapping: Button 1 captures image for the current area; Button 2 advances to the next area (or to Review on Arm). Ready screen: Button 1 starts session + captures portrait.

## Persistence
Client-side persistence is implemented using **SQLite** (via `sql.js` WebAssembly) stored in **IndexedDB**.
- **Active Session**: Managed in-memory by `js/sessionStore.js`.
- **History**: Persisted to SQLite database `guided_screening_db`. Managed by `js/recordsRepo.js` and `js/sqliteDb.js`.
- **Database Location**: Browser IndexedDB -> `guided_screening_db` -> `sqlite_file` store -> `db_file` key.
- **Dependencies**: `vendor/sql-wasm.js` and `vendor/sql-wasm.wasm` (sql.js v1.8.0).

## Where to integrate real hardware
Replace the stubs in `js/hardwareAdapter.js`:
- `startSession()`
- `capturePortrait(sessionId)`
- `captureImage(sessionId, area)`
- `deleteImage(sessionId, area, imageId)`
- `onHardwareButtonPress(handler)` (return unsubscribe)
- `getCameraPreviewStream()` (attach MediaStream to the preview)

UI expects these to return Promises; current stubs generate placeholder images and use keyboard events for button presses.

## How to connect to RDK AI API
- Set `APP_MODE = "rdk"` in `js/config.js` (defaults to `"mock"`).
- Configure `RDK_API_BASE` in `js/config.js` (default `http://localhost:5000`).
- Adapter contract in `js/analysisAdapter.js` (UI calls only through this layer):
  - `submitForAnalysis(sessionId, payload)` → `{ jobId }`
  - `getAnalysisStatus(jobId)` → `{ status: "queued"|"running"|"done"|"failed", progress?, step?, error? }`
  - `getAnalysisResult(jobId)` → `AnalysisResult` with overall + per-area details.
- REST endpoints (placeholders, update as needed):
  - `POST ${RDK_API_BASE}/api/analysis/submit`
  - `GET ${RDK_API_BASE}/api/analysis/status/{jobId}`
  - `GET ${RDK_API_BASE}/api/analysis/result/{jobId}`
- Payload builder: `buildAnalysisPayload(sessionStore)` currently sends URLs and metadata; swap to base64/file tokens later without touching UI screens.
- Failure handling in RDK mode: network/status failures show “Cannot reach RDK analysis service.” with Retry / Return to Review options; UI does **not** silently fall back to mock results.

## State model
In-memory single source (`js/sessionStore.js`):
- `sessionId`, `portraitUrl`
- `profile` (name, age, gender, history)
- `images` keyed by `face/arm` with `{id, url, createdAt}`
- `analysis` results (overall status + per-area confidence/text)

History and completed sessions are stored in SQLite and accessed via `js/recordsRepo.js`.

## Notes
- Back links provided on all screens except Analysis.
- Session is cleared only when “End Session” is used (or when cancelling back to Ready).
- Database persistence happens automatically when a session is finalized (after analysis results are fetched).
