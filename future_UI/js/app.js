import { hardwareAdapter } from './hardwareAdapter.js';
import { sessionStore } from './sessionStore.js';
import { analysisAdapter, buildAnalysisPayload } from './analysisAdapter.js';
import { ANALYSIS_POLL_INTERVAL } from './config.js';
import { buildAnalysisSummary } from './analysisSummary.js';
import { recordsRepo } from './recordsRepo.js';

const app = document.getElementById('app');

const Views = {
    READY: 'ready',
    HISTORY: 'history',
    PORTRAIT: 'portraitConfirm',
    PROFILE: 'profile',
    CAPTURE: 'capture',
    REVIEW: 'review',
    ANALYSIS: 'analysis',
    RESULTS: 'results',
    END: 'end'
};

const areaOrder = ['face', 'arm'];

const appState = {
    view: Views.READY,
    currentArea: 'face',
    warnAdvance: false,
    lastButtonPress: null,
    isBusy: false,
    lastCaptureArea: 'face',
    analysisJobId: null,
    analysisError: null,
    analysisStatus: null,
    analysisPollHandle: null,
    resultMode: 'active',
    viewingSessionId: null,
    resultsFilters: {
        class: 'all',
        area: 'all',
        sort: 'desc'
    },
    historyFilter: 'all',
    historySort: 'desc',
    modalImage: null,
    historyRecords: [], // Cache for history view
    historyLoading: false,
    viewingSessionRecord: null // Cache for specific session view
};

const statusLabels = {
    green: 'No concerning patterns identified',
    yellow: 'Review recommended',
    red: 'Priority follow-up suggested'
};

const classLabels = {
    normal: 'Normal',
    rash: 'Eczema',
    skin_cancer: 'Skin cancer'
};

const capitalize = (txt) => txt.charAt(0).toUpperCase() + txt.slice(1);

const formatPercent = (val, digits = 0) => {
    if (val === null || val === undefined) return '—';
    return `${val.toFixed(digits)}%`;
};

const formatDateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const resetResultFilters = () => {
    appState.resultsFilters = { class: 'all', area: 'all', sort: 'desc' };
};

const applyPredictionFilters = (predictions) => {
    const { area, class: cls } = appState.resultsFilters;
    return predictions.filter((p) => {
        const areaMatch = area === 'all' || p.area === area;
        const classMatch = cls === 'all' || p.predictedClass === cls;
        return areaMatch && classMatch;
    });
};

const sortPredictions = (predictions) => {
    const dir = appState.resultsFilters.sort === 'asc' ? 1 : -1;
    return [...predictions].sort((a, b) => {
        const aConf = a.confidence ?? 0;
        const bConf = b.confidence ?? 0;
        return (aConf - bConf) * dir;
    });
};

const setView = (view) => {
    if (appState.view === Views.ANALYSIS && view !== Views.ANALYSIS) {
        stopAnalysisPolling();
    }
    appState.view = view;
    render();
};

const handleHardwareButton = async (btn) => {
    appState.lastButtonPress = btn;
    if (appState.view === Views.ANALYSIS) return;

    if (appState.view === Views.READY && btn === 1) {
        await startPortraitFlow();
        return;
    }

    if (appState.view === Views.CAPTURE) {
        if (btn === 1) {
            await handleCaptureImage();
        }
        if (btn === 2) {
            await handleNextArea();
        }
    }

    render();
};

hardwareAdapter.onHardwareButtonPress(handleHardwareButton);

const startPortraitFlow = async () => {
    if (appState.isBusy) return;
    appState.isBusy = true;
    appState.resultMode = 'active';
    appState.viewingSessionId = null;
    appState.viewingSessionRecord = null;
    resetResultFilters();
    sessionStore.reset();
    render();
    const { sessionId } = await hardwareAdapter.startSession();
    sessionStore.setSession(sessionId);
    const { portraitUrl } = await hardwareAdapter.capturePortrait(sessionId);
    sessionStore.setPortrait(portraitUrl);
    appState.currentArea = 'face';
    appState.warnAdvance = false;
    appState.lastCaptureArea = 'face';
    appState.isBusy = false;
    setView(Views.PORTRAIT);
};

const handleRecapture = async () => {
    const { sessionId } = sessionStore.getState();
    if (!sessionId) return;
    const { portraitUrl } = await hardwareAdapter.capturePortrait(sessionId);
    sessionStore.setPortrait(portraitUrl);
    render();
};

const handleProfileSubmit = (evt) => {
    evt.preventDefault();
    const data = new FormData(evt.target);
    const name = data.get('name').trim();
    const age = Number(data.get('age'));
    const gender = data.get('gender').trim();
    const history = data.get('history').trim();
    const errors = [];
    if (!name) errors.push('Name is required.');
    if (Number.isNaN(age) || age < 0 || age > 120) {
        errors.push('Age must be between 0 and 120.');
    }
    const errorEl = evt.target.querySelector('[data-error]');
    if (errors.length) {
        errorEl.textContent = errors.join(' ');
        return;
    }
    errorEl.textContent = '';
    sessionStore.updateProfile({ name, age, gender, history });
    setView(Views.CAPTURE);
};

const handleCaptureImage = async () => {
    const { sessionId } = sessionStore.getState();
    if (!sessionId) return;
    const { imageUrl } = await hardwareAdapter.captureImage(sessionId, appState.currentArea);
    sessionStore.addImage(appState.currentArea, imageUrl);
    appState.warnAdvance = false;
    appState.lastCaptureArea = appState.currentArea;
    render();
};

const handleDeleteLast = async () => {
    const { sessionId } = sessionStore.getState();
    const removed = sessionStore.deleteLastImage(appState.currentArea);
    if (removed && sessionId) {
        await hardwareAdapter.deleteImage(sessionId, appState.currentArea, removed.id);
    }
    render();
};

const handleNextArea = async (force = false) => {
    const { images } = sessionStore.getState();
    const imgs = images[appState.currentArea];
    if (imgs.length === 0 && !force) {
        appState.warnAdvance = true;
        render();
        return;
    }
    appState.warnAdvance = false;
    const idx = areaOrder.indexOf(appState.currentArea);
    if (idx === areaOrder.length - 1) {
        setView(Views.REVIEW);
        return;
    }
    appState.currentArea = areaOrder[idx + 1];
    appState.lastCaptureArea = appState.currentArea;
    render();
};

const handleRetakeArea = (area) => {
    appState.currentArea = area;
    appState.lastCaptureArea = area;
    setView(Views.CAPTURE);
};

const handleSubmitAnalysis = async () => {
    stopAnalysisPolling();
    appState.analysisJobId = null;
    appState.analysisError = null;
    appState.analysisStatus = null;
    appState.resultMode = 'active';
    appState.viewingSessionId = sessionStore.getState().sessionId;
    resetResultFilters();
    setView(Views.ANALYSIS);
    await ensureAnalysisJob();
};

const handleExport = () => {
    const data = sessionStore.getState();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.sessionId || 'session'}-summary.json`;
    a.click();
    URL.revokeObjectURL(url);
};

const handleEndSession = () => {
    stopAnalysisPolling();
    sessionStore.markSessionEnded();
    // Persist final session state to DB if not already saved via fetchAnalysisResult
    // Ideally fetchAnalysisResult handles it, but if session ends abruptly or manually without analysis?
    // The current flow requires analysis to end.
    // If we want to be safe, we can try to save here if state.analysis exists.
    const current = sessionStore.getState();
    if (current.analysis) {
        recordsRepo.addSessionRecord(current).catch(err => console.error('Failed to save session on end', err));
    }

    resetResultFilters();
    appState.resultMode = 'active';
    appState.viewingSessionId = null;
    appState.viewingSessionRecord = null;
    sessionStore.reset();
    appState.view = Views.READY;
    appState.currentArea = 'face';
    appState.warnAdvance = false;
    appState.lastCaptureArea = 'face';
    appState.analysisJobId = null;
    appState.analysisError = null;
    appState.analysisStatus = null;
    render();
};

function stopAnalysisPolling() {
    if (appState.analysisPollHandle) {
        clearTimeout(appState.analysisPollHandle);
    }
    appState.analysisPollHandle = null;
}

const ensureAnalysisJob = async () => {
    const session = sessionStore.getState();
    if (!session.sessionId) {
        appState.analysisError = 'No active session found.';
        render();
        return;
    }
    if (appState.analysisJobId) {
        pollAnalysisStatus();
        return;
    }
    try {
        const payload = buildAnalysisPayload(session);
        const { jobId } = await analysisAdapter.submitForAnalysis(session.sessionId, payload);
        appState.analysisJobId = jobId;
        appState.analysisStatus = { status: 'queued', progress: 0, step: 'Detecting skin regions' };
        pollAnalysisStatus();
    } catch (err) {
        appState.analysisError = err.isNetwork ? 'Cannot reach RDK analysis service.' : err.message;
        render();
    }
};

const pollAnalysisStatus = async () => {
    stopAnalysisPolling();
    if (appState.view !== Views.ANALYSIS || !appState.analysisJobId) return;
    try {
        const status = await analysisAdapter.getAnalysisStatus(appState.analysisJobId);
        appState.analysisStatus = status;
        render();
        if (status.status === 'done') {
            await fetchAnalysisResult();
            return;
        }
        if (status.status === 'failed') {
            appState.analysisError = status.error || 'Analysis failed.';
            render();
            return;
        }
        appState.analysisPollHandle = setTimeout(pollAnalysisStatus, ANALYSIS_POLL_INTERVAL);
    } catch (err) {
        appState.analysisError = err.isNetwork ? 'Cannot reach RDK analysis service.' : err.message;
        render();
    }
};

const fetchAnalysisResult = async () => {
    try {
        const result = await analysisAdapter.getAnalysisResult(appState.analysisJobId);
        sessionStore.setAnalysis(result);
        
        // Save to DB immediately after getting results
        const completedSession = sessionStore.getState();
        await recordsRepo.addSessionRecord(completedSession);

        appState.analysisJobId = null;
        appState.analysisStatus = null;
        appState.analysisError = null;
        appState.resultMode = 'active';
        appState.viewingSessionId = completedSession.sessionId;
        resetResultFilters();
        setView(Views.RESULTS);
    } catch (err) {
        console.error(err);
        appState.analysisError = err.isNetwork ? 'Cannot reach RDK analysis service.' : err.message;
        render();
    }
};

const renderHeader = (session) => {
    const active = session.sessionId !== null;
    const processing = appState.view === Views.ANALYSIS;
    const historyMode = appState.view === Views.HISTORY || (appState.view === Views.RESULTS && appState.resultMode === 'history');
    const statusText = processing
        ? 'Processing analysis'
        : historyMode
            ? 'Viewing session records'
            : active
                ? 'Session Active'
                : 'Idle';
    const badgeSessionId = historyMode ? appState.viewingSessionId : session.sessionId;
    return `
        <header class="header">
            <div class="title">
                <h1>Guided Skin Screening</h1>
                <p>Operator console — Portrait → Profile → Capture → Review → Analysis</p>
            </div>
            <div class="badge">
                <span class="dot"></span>
                <span>${statusText}</span>
                ${badgeSessionId ? `<span style="color: var(--subtle); font-size: var(--text-1);">#${badgeSessionId}</span>` : ''}
            </div>
        </header>
    `;
};

const renderBackLink = (label, handlerName) => {
    return `<button class="btn link" data-action="${handlerName}">← ${label}</button>`;
};

const renderReady = (session) => {
    const disabled = appState.isBusy ? 'disabled' : '';
    return `
        <div class="card">
            <h2 class="page-title">Ready for next screening</h2>
            <p class="page-subtitle">Capture a portrait to initiate a profile. Hardware Button 1 or the button below will start a new session.</p>
            <div class="actions">
                <button class="btn primary" data-action="start" ${disabled}>Start / Capture Portrait</button>
                <button class="btn secondary" data-action="view-history">View Session Records</button>
            </div>
            <div class="help">Hardware: Button 1 = start, Button 2 (no action on this screen)</div>
        </div>
    `;
};

const renderPortraitConfirm = (session) => {
    return `
        ${renderBackLink('Cancel and return to Ready', 'back-ready')}
        <div class="card">
            <h2 class="page-title">Portrait captured</h2>
            <p class="page-subtitle">Confirm the portrait or recapture if needed. Portrait is linked to the active session.</p>
            <div class="grid two">
                <div class="preview">
                    ${session.portraitUrl ? `<img src="${session.portraitUrl}" alt="Portrait" style="max-width:100%;border-radius: var(--r-2);">` : 'No portrait'}
                </div>
                <div>
                    <p class="help">Session: ${session.sessionId}</p>
                    <div class="actions">
                        <button class="btn primary" data-action="continue-profile">Continue to Patient Info</button>
                        <button class="btn secondary" data-action="recapture">Recapture Portrait</button>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const renderProfile = (session) => {
    const p = session.profile;
    return `
        ${renderBackLink('Back to portrait', 'back-portrait')}
        <div class="card">
            <h2 class="page-title">Patient profile</h2>
            <p class="page-subtitle">Record basic details to keep capture data tied to the correct patient.</p>
            <div class="grid two">
                <form class="grid" data-form="profile">
                    <div>
                        <label class="label" for="name">Name</label>
                        <input class="input" id="name" name="name" value="${p.name}" required>
                    </div>
                    <div class="grid two">
                        <div>
                            <label class="label" for="age">Age</label>
                            <input class="input" id="age" name="age" type="number" min="0" max="120" value="${p.age}">
                        </div>
                        <div>
                            <label class="label" for="gender">Gender</label>
                            <select class="select" id="gender" name="gender">
                                <option value="">Select</option>
                                <option ${p.gender === 'Female' ? 'selected' : ''}>Female</option>
                                <option ${p.gender === 'Male' ? 'selected' : ''}>Male</option>
                                <option ${p.gender === 'Other' ? 'selected' : ''}>Other</option>
                                <option ${p.gender === 'Prefer not to say' ? 'selected' : ''}>Prefer not to say</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="label" for="history">Skin history / notes</label>
                        <textarea class="textarea" id="history" name="history" placeholder="e.g., prior concerns, sunscreen habits">${p.history}</textarea>
                    </div>
                    <div class="actions">
                        <button class="btn primary" type="submit">Save and Continue</button>
                    </div>
                    <div class="help" data-error style="color: #fb7185;"></div>
                </form>
                <div>
                    <div class="preview" style="min-height:220px;">
                        ${session.portraitUrl ? `<img src="${session.portraitUrl}" alt="Portrait" style="max-width:100%;border-radius: var(--r-2);">` : 'Portrait pending'}
                    </div>
                    <p class="help">Portrait is linked to session ${session.sessionId}</p>
                </div>
            </div>
        </div>
    `;
};

const renderProgress = (session) => {
    const steps = ['Portrait', 'Face', 'Arm'];
    const doneMap = {
        Portrait: !!session.portraitUrl,
        Face: session.images.face.length > 0 || appState.currentArea === 'arm',
        Arm: session.images.arm.length > 0
    };
    return `
        <div class="progress">
            ${steps.map((s) => {
                const key = s === 'Portrait' ? 'Portrait' : s;
                const isCurrent = appState.currentArea.toLowerCase() === s.toLowerCase();
                const done = doneMap[key];
                return `<span class="step ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}"><span class="mini-dot"></span>${s}</span>`;
            }).join('')}
        </div>
    `;
};

const renderCapture = (session) => {
    const area = appState.currentArea;
    const imgs = session.images[area] || [];
    return `
        ${renderBackLink('Back to profile', 'back-profile')}
        <div class="card">
            <h2 class="page-title">Capture images of ${area.toUpperCase()}</h2>
            <p class="page-subtitle">Use hardware Button 1 or on-screen controls to capture. Button 2 advances to the next area.</p>
            <div class="grid two">
                <div id="preview-area" class="preview" data-area="${area}">
                    <div id="preview-placeholder">Camera preview unavailable — placeholder shown</div>
                    <video id="camera-preview" autoplay playsinline style="width:100%;border-radius: var(--r-2);display:none;"></video>
                </div>
                <div>
                    <div class="actions">
                        <button class="btn primary" data-action="capture">Capture Image</button>
                        <button class="btn secondary" data-action="delete-last">Delete Last</button>
                        <button class="btn" data-action="next-area">Next Area</button>
                    </div>
                    <div class="counter">${imgs.length} images captured</div>
                    ${appState.warnAdvance ? renderWarningBanner(imgs.length === 0) : ''}
                    <div class="thumbs">
                        ${imgs.map((img) => `<div class="thumb"><img src="${img.url}" alt="${area}" style="width:100%;height:100%;object-fit:cover;border-radius: var(--r-2);"></div>`).join('') || '<div class="thumb">No images yet</div>'}
                    </div>
                    ${renderProgress(session)}
                </div>
            </div>
        </div>
    `;
};

const renderWarningBanner = (isEmpty) => {
    return `
        <div class="banner warn">
            <div class="icon"></div>
            <div>
                <div><strong>No images captured for this area.</strong></div>
                <div class="actions" style="margin-top: var(--s-3);">
                    <button class="btn secondary" data-action="continue-anyway">Continue anyway</button>
                    <button class="btn link" data-action="stay">Stay</button>
                </div>
            </div>
        </div>
    `;
};

const renderImagesGroup = (area, items) => {
    return `
        <div class="card">
            <div class="row">
                <h3 class="section-title">${capitalize(area)} (${items.length})</h3>
                <button class="btn secondary right" data-action="retake-${area}">Retake ${capitalize(area)}</button>
            </div>
            <div class="thumbs">
                ${items.length ? items.map((img) => `<div class="thumb"><img src="${img.url}" alt="${area}" style="width:100%;height:100%;object-fit:cover;border-radius: var(--r-2);"></div>`).join('') : '<div class="thumb">No images</div>'}
            </div>
        </div>
    `;
};

const renderReview = (session) => {
    const { profile, portraitUrl, images } = session;
    return `
        ${renderBackLink('Back to capture', 'back-capture')}
        <div class="card">
            <h2 class="page-title">Review before analysis</h2>
            <p class="page-subtitle">Confirm patient details and captured images. You can retake a specific area before submitting.</p>
            <div class="grid two">
                <div>
                    <h3 class="section-title">Patient summary</h3>
                    <p class="m0"><strong>Name:</strong> ${profile.name || '—'}</p>
                    <p class="m0"><strong>Age:</strong> ${profile.age || '—'}</p>
                    <p class="m0"><strong>Gender:</strong> ${profile.gender || '—'}</p>
                    <p class="m0"><strong>History:</strong> ${profile.history || '—'}</p>
                    <div class="actions">
                        <button class="btn secondary" data-action="edit-profile">Edit Patient Info</button>
                    </div>
                </div>
                <div class="preview" style="min-height:200px;">
                    ${portraitUrl ? `<img src="${portraitUrl}" alt="Portrait" style="max-width:100%;border-radius: var(--r-2);">` : 'Portrait missing'}
                </div>
            </div>
        </div>
        ${renderImagesGroup('face', images.face)}
        ${renderImagesGroup('arm', images.arm)}
        <div class="card">
            <div class="actions">
                <button class="btn primary" data-action="submit-analysis">Submit for Analysis</button>
            </div>
            <p class="help">Analysis locks further changes until complete.</p>
        </div>
    `;
};

const renderAnalysis = () => {
    const status = appState.analysisStatus || { status: 'queued', progress: 0, step: 'Detecting skin regions' };
    const steps = ['Detecting skin regions', 'Analyzing visual patterns', 'Aggregating results'];
    const progressValue = status.progress || 0;
    const progressPercent = Math.min(100, Math.round(progressValue <= 1 ? progressValue * 100 : progressValue));
    const activeStep = status.step || (progressPercent < 33 ? steps[0] : progressPercent < 66 ? steps[1] : steps[2]);
    const hasError = !!appState.analysisError;
    return `
        <div class="card">
            <h2 class="page-title">Analysis in progress</h2>
            <p class="page-subtitle">Hold steady while images are processed. This screen is non-interactive.</p>
            ${hasError ? `
                <div class="banner bad">
                    <div class="icon"></div>
                    <div>
                        <div><strong>${appState.analysisError}</strong></div>
                        <div class="actions" style="margin-top: var(--s-3);">
                            <button class="btn secondary" data-action="retry-analysis">Retry</button>
                            <button class="btn link" data-action="back-review">Return to Review</button>
                        </div>
                    </div>
                </div>
            ` : ''}
            <div class="grid">
                <div class="row">
                    <div class="spinner"></div>
                    <div>${progressPercent}%</div>
                    <div class="help">${status.status.toUpperCase()}</div>
                </div>
                <div class="progressbar"><div style="width:${progressPercent}%;"></div></div>
                <ul>
                    ${steps.map((s) => `<li style="color:${s === activeStep ? 'white' : 'var(--muted)'}">${s}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;
};

const renderModal = () => {
    if (!appState.modalImage) return '';
    return `
        <div class="modal-overlay" data-action="close-modal">
            <div class="modal-content" onclick="event.stopPropagation()">
                <button class="btn icon-close" data-action="close-modal">×</button>
                <img src="${appState.modalImage}" alt="Annotated Result" style="max-width:100%; max-height: 80vh; border-radius: var(--r-2);">
            </div>
        </div>
    `;
};

const renderResults = (session, options = {}) => {
    const readOnly = options.readOnly || false;
    const analysis = session.analysis;
    const summary = session.analysisSummary || (analysis ? buildAnalysisSummary(session) : null);

    if (!analysis || !summary) {
        const backAction = readOnly ? 'back-history' : 'back-review';
        const backLabel = readOnly ? 'Back to records' : 'Back to review';
        return `
            ${renderBackLink(backLabel, backAction)}
            <div class="card">
                <h2 class="page-title">Results unavailable</h2>
                <p class="page-subtitle">No analysis results found.</p>
                <div class="actions">
                    <button class="btn secondary" data-action="${backAction}">${backLabel}</button>
                </div>
            </div>
        `;
    }

    const totals = summary.summary;
    const perArea = summary.byArea || {};
    const predictions = summary.predictions || [];
    const filteredPredictions = sortPredictions(applyPredictionFilters(predictions));
    const level = analysis.overall?.level || 'green';
    const sessionTimestamp = summary.meta?.generatedAt || session.sessionEndedAt || session.sessionStartedAt;
    const areasCaptured = totals.capturedAreas.length ? totals.capturedAreas.map((a) => capitalize(a)).join(', ') : 'None';
    const guidance = summary.guidance;
    const primaryDetected = classLabels[totals.primaryDetectedClass] || '—';
    const confidenceHelper = 'Confidence represents the model’s certainty for the predicted class. This is not a medical diagnosis.';
    const backAction = readOnly ? 'back-history' : 'back-review';
    const backLabel = readOnly ? 'Back to records' : 'Back to review';

    const renderClassStat = (cls) => `
        <div class="stat-pill">
            <div class="label microcopy">${classLabels[cls]}</div>
            <div class="value">${totals.counts[cls]} images</div>
            <div class="microcopy subtle-text">${formatPercent(totals.percentages[cls] ?? 0, 1)}</div>
        </div>
    `;

    const renderAreaStats = (area) => {
        const data = perArea[area] || { counts: { normal: 0, rash: 0, skin_cancer: 0 }, percentages: { normal: 0, rash: 0, skin_cancer: 0 }, total: 0, meanConfidence: null };
        return `
            <div class="kpi">
                <div class="row">
                    <div>
                        <div class="label">${capitalize(area)}</div>
                        <div class="value">${data.total} images</div>
                    </div>
                    <div class="pill">${formatPercent(data.meanConfidence ?? null, 1)} mean confidence</div>
                </div>
                <div class="microcopy subtle-text">
                    Normal: ${data.counts.normal} (${formatPercent(data.percentages.normal ?? 0, 1)}) · Eczema: ${data.counts.rash} (${formatPercent(data.percentages.rash ?? 0, 1)}) · Skin cancer: ${data.counts.skin_cancer} (${formatPercent(data.percentages.skin_cancer ?? 0, 1)})
                </div>
            </div>
        `;
    };

    const renderImageRows = () => {
        if (!filteredPredictions.length) {
            return `<tr><td colspan="5"><div class="help">No images match the selected filters.</div></td></tr>`;
        }
        return filteredPredictions.map((p) => `
            <tr>
                <td><button class="thumb tiny btn-reset" data-action="view-annotated" data-image-id="${p.imageId}">${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.area}" style="width:100%;height:100%;object-fit:cover;border-radius: var(--r-1);">` : '—'}</button></td>
                <td>${capitalize(p.area)}</td>
                <td><span class="pill subtle">${classLabels[p.predictedClass] || p.predictedClass}</span></td>
                <td>${formatPercent((p.confidence ?? 0) * 100, 0)}</td>
                <td class="subtle-text">${formatDateTime(p.capturedAt)}</td>
            </tr>
        `).join('');
    };

    return `
        ${renderBackLink(backLabel, backAction)}
        <div class="card">
            <h2 class="page-title">Results Summary</h2>
            <p class="page-subtitle">Statistical overview of captured evidence. Screening results are informational only.</p>
            <div class="grid info-grid">
                <div class="kpi">
                    <div class="label">Session ID</div>
                    <div class="value">#${session.sessionId}</div>
                </div>
                <div class="kpi">
                    <div class="label">Timestamp</div>
                    <div class="value">${formatDateTime(sessionTimestamp)}</div>
                </div>
                <div class="kpi">
                    <div class="label">Model</div>
                    <div class="value">${summary.meta?.modelVersion || '—'}</div>
                </div>
                <div class="kpi">
                    <div class="label">Total images</div>
                    <div class="value">${totals.totalImages}</div>
                </div>
                <div class="kpi">
                    <div class="label">Areas captured</div>
                    <div class="value">${areasCaptured}</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="row">
                <h3 class="section-title">Overall statistical summary</h3>
                <span class="microcopy subtle-text">Primary detected class uses majority vote across images; ties are broken by average confidence.</span>
            </div>
            <div class="grid stat-grid">
                ${['normal', 'rash', 'skin_cancer'].map((cls) => renderClassStat(cls)).join('')}
            </div>
            <div class="grid two stats-metrics">
                <div class="kpi">
                    <div class="label">Primary detected class</div>
                    <div class="value">${primaryDetected}</div>
                    <div class="microcopy subtle-text">${totals.primaryMethod}</div>
                </div>
                <div class="kpi">
                    <div class="label">Confidence metrics</div>
                    <div class="value">${formatPercent(totals.meanConfidence ?? 0, 1)} mean · ${formatPercent(totals.medianConfidence ?? 0, 1)} median</div>
                    <div class="microcopy subtle-text">Low-confidence rate (confidence &lt; 0.6): ${totals.lowConfidenceRate !== null ? formatPercent(totals.lowConfidenceRate, 1) : '—'}</div>
                </div>
            </div>
            <div class="traffic ${level}">
                <div class="lamp"></div>
                <div class="text">
                    <strong>${statusLabels[level] || 'Assessment available'}</strong>
                    <span>${analysis.overall?.summary || 'Assessment synthesized from captured patterns.'}</span>
                </div>
            </div>
            <div class="microcopy consistency-note">${confidenceHelper}</div>
        </div>

        <div class="card">
            <div class="row">
                <h3 class="section-title">Evidence by area</h3>
                <span class="microcopy subtle-text">Face and Arm only; aggregated per captured set.</span>
            </div>
            <div class="grid two area-summary">
                ${areaOrder.map((area) => renderAreaStats(area)).join('')}
            </div>
        </div>

        <div class="card">
            <div class="row">
                <h3 class="section-title">All captured images</h3>
                <div class="row right">
                    <label class="microcopy">
                        Class
                        <select class="select" data-filter="class">
                            <option value="all">All</option>
                            <option value="normal" ${appState.resultsFilters.class === 'normal' ? 'selected' : ''}>Normal</option>
                            <option value="rash" ${appState.resultsFilters.class === 'rash' ? 'selected' : ''}>Eczema</option>
                            <option value="skin_cancer" ${appState.resultsFilters.class === 'skin_cancer' ? 'selected' : ''}>Skin cancer</option>
                        </select>
                    </label>
                    <label class="microcopy">
                        Area
                        <select class="select" data-filter="area">
                            <option value="all">All</option>
                            ${areaOrder.map((a) => `<option value="${a}" ${appState.resultsFilters.area === a ? 'selected' : ''}>${capitalize(a)}</option>`).join('')}
                        </select>
                    </label>
                    <button class="btn secondary" data-action="toggle-sort">Sort by confidence ${appState.resultsFilters.sort === 'desc' ? '↓' : '↑'}</button>
                </div>
            </div>
            <div class="table-wrapper">
                <table class="evidence-table">
                    <thead>
                        <tr>
                            <th>Image</th>
                            <th>Area</th>
                            <th>Predicted class</th>
                            <th>Confidence</th>
                            <th>Captured</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderImageRows()}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <h3 class="section-title">Guidance</h3>
            <p class="m0">${guidance.message}</p>
            <p class="microcopy subtle-text">This screening is informational only and does not provide a medical diagnosis.</p>
        </div>

        <div class="card">
            <div class="actions">
                ${readOnly ? '<button class="btn" data-action="back-history">Back to Session Records</button>' : '<button class="btn primary" data-action="continue-end">Continue</button>'}
            </div>
            <p class="help m0">Recorded outcome: ${guidance.outcomeLabel}. Capture set stored with patient profile and timestamps.</p>
        </div>
    `;
};

const renderSessionEnd = () => {
    return `
        ${renderBackLink('Back to results', 'back-results')}
        <div class="card">
            <h2 class="page-title">Session completed</h2>
            <p class="page-subtitle">Export optional summary or end session to return to Ready.</p>
            <div class="actions">
                <button class="btn secondary" data-action="export">Export Summary</button>
                <button class="btn primary" data-action="end-session">End Session</button>
            </div>
        </div>
    `;
};

const renderHistory = () => {
    // If loading, show loading
    if (appState.historyLoading) {
        return `
            ${renderBackLink('Back to Ready', 'back-ready')}
            <div class="card">
                <h2 class="page-title">Session Records</h2>
                <p class="page-subtitle">Loading records from database...</p>
                <div class="row"><div class="spinner"></div></div>
            </div>
        `;
    }

    const sessions = appState.historyRecords;
    const filter = appState.historyFilter;
    
    // Filtering handled by Repo if possible, but for now we filter in memory here 
    // since listSessionRecords allows filtering by primary class.
    // However, if we just fetched all (or filtered via DB), we display them.
    // If appState.historyFilter changed, we should re-fetch.
    
    // For simplicity, let's assume we re-fetched on filter change or we filter client side if list is small.
    // Given the previous code was client-side filtering, let's stick to client-side filtering of the fetched list 
    // unless listSessionRecords supports all our needs. 
    // recordsRepo.listSessionRecords supports filterPrimaryClass.
    
    const sorted = sessions; // sorted by DB query usually, but let's trust recordsRepo returns sorted by date desc/asc

    const renderRow = (record) => {
        const primary = record.analysisSummary?.summary?.primaryDetectedClass;
        const outcome = record.analysisSummary?.guidance?.outcomeLabel || 'Pending';
        const timestamp = record.analysisSummary?.meta?.generatedAt || record.sessionEndedAt || record.sessionStartedAt;
        return `
            <tr>
                <td>#${record.sessionId}</td>
                <td>${formatDateTime(timestamp)}</td>
                <td>${record.profile?.name || 'Unnamed patient'}</td>
                <td>${primary ? classLabels[primary] : 'Pending analysis'}</td>
                <td>${outcome}</td>
                <td><button class="btn secondary" data-action="open-session" data-session-id="${record.sessionId}">View</button></td>
            </tr>
        `;
    };

    return `
        ${renderBackLink('Back to Ready', 'back-ready')}
        <div class="card">
            <h2 class="page-title">Session Records</h2>
            <p class="page-subtitle">All stored sessions remain available across reloads. Selecting a record opens its Results Summary in read-only mode.</p>
            <div class="row">
                <label class="microcopy">
                    Filter by primary class
                    <select class="select" data-history-filter>
                        <option value="all" ${filter === 'all' ? 'selected' : ''}>All</option>
                        <option value="normal" ${filter === 'normal' ? 'selected' : ''}>Normal</option>
                        <option value="rash" ${filter === 'rash' ? 'selected' : ''}>Eczema</option>
                        <option value="skin_cancer" ${filter === 'skin_cancer' ? 'selected' : ''}>Skin cancer</option>
                    </select>
                </label>
                <button class="btn secondary" data-action="toggle-history-sort">Sort by date ${appState.historySort === 'desc' ? '↓' : '↑'}</button>
            </div>
            <div class="table-wrapper">
                <table class="evidence-table">
                    <thead>
                        <tr>
                            <th>Session ID</th>
                            <th>Date / time</th>
                            <th>Patient</th>
                            <th>Primary class</th>
                            <th>Outcome</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.length ? sorted.map((s) => renderRow(s)).join('') : '<tr><td colspan="6"><div class="help">No sessions stored yet.</div></td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

const renderDebugPanel = () => {
    return `
        <div class="card" style="margin-top: var(--s-4);">
            <div class="row">
                <strong>Hardware Debug</strong>
                <span class="help">Keyboard: 1 = Button 1, 2 = Button 2</span>
            </div>
            <div class="actions">
                <button class="btn secondary" data-action="simulate-1">Button 1</button>
                <button class="btn secondary" data-action="simulate-2">Button 2</button>
            </div>
            <p class="help">Last button: ${appState.lastButtonPress || '—'}</p>
        </div>
    `;
};

const render = () => {
    const activeSession = sessionStore.getState();
    const session = appState.view === Views.RESULTS && appState.resultMode === 'history'
        ? (appState.viewingSessionRecord || activeSession)
        : activeSession;
    let body = '';
    switch (appState.view) {
    case Views.READY:
        body = renderReady(session);
        break;
    case Views.HISTORY:
        body = renderHistory();
        break;
    case Views.PORTRAIT:
        body = renderPortraitConfirm(session);
        break;
    case Views.PROFILE:
        body = renderProfile(session);
        break;
    case Views.CAPTURE:
        body = renderCapture(session);
        break;
    case Views.REVIEW:
        body = renderReview(session);
        break;
    case Views.ANALYSIS:
        body = renderAnalysis(session);
        break;
    case Views.RESULTS:
        body = renderResults(session, { readOnly: appState.resultMode === 'history' });
        break;
    case Views.END:
        body = renderSessionEnd(session);
        break;
    default:
        body = renderReady(session);
    }

    app.innerHTML = `
        <div class="container">
            ${renderHeader(session)}
            ${body}
            ${renderDebugPanel()}
        </div>
        ${renderModal()}
    `;
    bindEvents();
    if (appState.view === Views.CAPTURE) {
        attachCameraPreview();
    }
};

const attachCameraPreview = async () => {
    const videoEl = document.getElementById('camera-preview');
    const placeholder = document.getElementById('preview-placeholder');
    if (!videoEl) return;
    const stream = await hardwareAdapter.getCameraPreviewStream();
    if (stream) {
        videoEl.srcObject = stream;
        videoEl.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        videoEl.style.display = 'none';
        placeholder.style.display = 'block';
    }
};

const confirmAndReset = () => {
    const ok = window.confirm('Return to Ready? Current session data will be cleared.');
    if (ok) {
        handleEndSession();
    }
};

const loadHistory = async () => {
    appState.historyLoading = true;
    render();
    try {
        const records = await recordsRepo.listSessionRecords({
            sort: appState.historySort,
            filterPrimaryClass: appState.historyFilter
        });
        appState.historyRecords = records;
    } catch (err) {
        console.error('Failed to load history', err);
        appState.historyRecords = [];
    } finally {
        appState.historyLoading = false;
        render();
    }
};

const bindEvents = () => {
    document.querySelectorAll('[data-action]').forEach((el) => {
        el.onclick = async (e) => {
            const action = el.getAttribute('data-action');
            switch (action) {
            case 'start':
                await startPortraitFlow();
                break;
            case 'view-history':
                appState.viewingSessionId = null;
                appState.resultMode = 'active';
                setView(Views.HISTORY);
                await loadHistory();
                break;
            case 'continue-profile':
                setView(Views.PROFILE);
                break;
            case 'recapture':
                await handleRecapture();
                break;
            case 'capture':
                await handleCaptureImage();
                break;
            case 'delete-last':
                await handleDeleteLast();
                break;
            case 'next-area':
                await handleNextArea();
                break;
            case 'continue-anyway':
                await handleNextArea(true);
                break;
            case 'stay':
                appState.warnAdvance = false;
                render();
                break;
            case 'submit-analysis':
                await handleSubmitAnalysis();
                break;
            case 'continue-end':
                setView(Views.END);
                break;
            case 'export':
                handleExport();
                break;
            case 'end-session':
                handleEndSession();
                break;
            case 'simulate-1':
                hardwareAdapter.simulateButtonPress(1);
                break;
            case 'simulate-2':
                hardwareAdapter.simulateButtonPress(2);
                break;
            case 'back-ready':
                if (appState.view === Views.HISTORY) {
                    appState.view = Views.READY;
                    appState.viewingSessionId = null;
                    appState.resultMode = 'active';
                    render();
                } else {
                    confirmAndReset();
                }
                break;
            case 'back-portrait':
                setView(Views.PORTRAIT);
                break;
            case 'back-profile':
                setView(Views.PROFILE);
                break;
            case 'back-capture':
                appState.currentArea = appState.lastCaptureArea || 'face';
                setView(Views.CAPTURE);
                break;
            case 'back-review':
                setView(Views.REVIEW);
                break;
            case 'retry-analysis':
                stopAnalysisPolling();
                appState.analysisJobId = null;
                appState.analysisError = null;
                appState.analysisStatus = null;
                await ensureAnalysisJob();
                break;
            case 'back-results':
                setView(Views.RESULTS);
                break;
            case 'back-history':
                appState.viewingSessionId = null;
                appState.viewingSessionRecord = null;
                appState.resultMode = 'active';
                setView(Views.HISTORY);
                // Reload history to ensure it's fresh
                await loadHistory();
                break;
            case 'open-session':
                const sid = el.getAttribute('data-session-id');
                appState.viewingSessionId = sid;
                appState.resultMode = 'history';
                resetResultFilters();
                // Load specific session record
                const rec = await recordsRepo.getSessionRecord(sid);
                appState.viewingSessionRecord = rec;
                setView(Views.RESULTS);
                break;
            case 'toggle-sort':
                appState.resultsFilters.sort = appState.resultsFilters.sort === 'desc' ? 'asc' : 'desc';
                render();
                break;
            case 'toggle-history-sort':
                appState.historySort = appState.historySort === 'desc' ? 'asc' : 'desc';
                await loadHistory();
                break;
            case 'view-annotated':
                const imgId = el.getAttribute('data-image-id');
                if (imgId) {
                    const url = analysisAdapter.getAnnotatedImageUrl(imgId);
                    appState.modalImage = url;
                    
                    // Update DB with this annotated URL
                    if (appState.viewingSessionId) {
                         // Only update if we are viewing a history record OR active session
                         // If active session, it's not yet in DB unless finished? 
                         // Actually if we are in results, it IS in DB now (saved at fetchAnalysisResult).
                         recordsRepo.updateSessionAnnotatedUrl(appState.viewingSessionId, imgId, url)
                            .catch(e => console.error('Failed to update annotated URL in DB', e));
                         
                         // Update local cache if viewing history
                         if (appState.viewingSessionRecord) {
                             const preds = appState.viewingSessionRecord.analysisSummary?.predictions;
                             if (preds) {
                                 const p = preds.find(x => x.imageId === imgId);
                                 if (p) p.annotatedUrl = url;
                             }
                         }
                    }
                    render();
                }
                break;
            case 'close-modal':
                appState.modalImage = null;
                render();
                break;
            default:
                if (action.startsWith('retake-')) {
                    const area = action.replace('retake-', '');
                    handleRetakeArea(area);
                }
            }
        };
    });

    const profileForm = document.querySelector('[data-form="profile"]');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileSubmit);
    }

    document.querySelectorAll('[data-filter]').forEach((el) => {
        el.onchange = () => {
            const key = el.getAttribute('data-filter');
            appState.resultsFilters = { ...appState.resultsFilters, [key]: el.value };
            render();
        };
    });

    const historyFilter = document.querySelector('[data-history-filter]');
    if (historyFilter) {
        historyFilter.onchange = async () => {
            appState.historyFilter = historyFilter.value;
            await loadHistory();
        };
    }
};

const initApp = async () => {
    try {
        await recordsRepo.init();
    } catch (err) {
        console.error('Failed to init DB', err);
        // Fallback or alert? 
        // For now just log, render will still work but history might fail.
    }
    render();
};

initApp();
