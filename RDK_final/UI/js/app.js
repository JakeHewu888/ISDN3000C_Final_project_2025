import { RDK_API_BASE } from './config.js';

const app = document.getElementById('app');

let uiState = {
    view: 'form',
    profile: { name: '', age: '', notes: '' },
    serverMode: 1,
    lastImageTs: 0,
    currentImage: null,
    analysisResult: null,
    processing: false
};

async function resetSession() {
    await fetch(`${RDK_API_BASE}/api/session/reset`, { method: 'POST' });
}

async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch(`${RDK_API_BASE}/api/upload`, {
            method: 'POST',
            body: fd
        });
        if (!res.ok) alert('Upload failed');
    } catch (e) {
        console.error(e);
        alert('Network error');
    }
}

async function pollState() {
    try {
        const res = await fetch(`${RDK_API_BASE}/api/state`);
        if (res.ok) {
            handleServerUpdate(await res.json());
        }
    } catch (e) { console.error(e); }
    setTimeout(pollState, 1000);
}

function handleServerUpdate(server) {
    let needsRender = false;

    if (server.mode !== uiState.serverMode) {
        uiState.serverMode = server.mode;
        needsRender = true;
    }

    if (server.last_image_ts > uiState.lastImageTs) {
        uiState.lastImageTs = server.last_image_ts;
        const url = server.last_image_url.startsWith('http') ? server.last_image_url : `${RDK_API_BASE}/${server.last_image_url}`;
        uiState.currentImage = `${url}?t=${server.last_image_ts}`;
        if (uiState.serverMode === 2) uiState.analysisResult = null;
        needsRender = true;
    }

    if (server.is_processing !== uiState.processing) {
        uiState.processing = server.is_processing;
        needsRender = true;
    }

    if (server.analysis_result) {
        const newResStr = JSON.stringify(server.analysis_result);
        const oldResStr = JSON.stringify(uiState.analysisResult);
        if (newResStr !== oldResStr) {
            uiState.analysisResult = server.analysis_result;
            needsRender = true;
        }
    }

    if (uiState.view === 'monitor' && needsRender) {
        renderMonitor();
    }
}

function handleFormSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    uiState.profile = { name: fd.get('name'), age: fd.get('age'), notes: fd.get('notes') };
    resetSession().then(() => {
        uiState.view = 'monitor';
        uiState.currentImage = null;
        uiState.analysisResult = null;
        renderMonitor();
    });
}

function renderForm() {
    app.innerHTML = `
        <header class="header"><div class="title"><h1>New Screening Session</h1></div></header>
        <div class="container">
            <div class="card">
                <h2 class="page-title">Patient Profile</h2>
                <form id="profile-form">
                    <div style="margin-bottom:15px;"><label class="label">Name</label><input class="input" name="name" required></div>
                    <div style="margin-bottom:15px;"><label class="label">Age</label><input class="input" name="age" type="number" required></div>
                    <div style="margin-bottom:15px;"><label class="label">Notes</label><textarea class="textarea" name="notes"></textarea></div>
                    <button class="btn primary" type="submit">Start Session</button>
                </form>
            </div>
        </div>
    `;
    document.getElementById('profile-form').onsubmit = handleFormSubmit;
}

function renderMonitor() {
    const isMode1 = uiState.serverMode === 1;
    const modeTitle = isMode1 ? "Step 1: Personal Photo" : "Step 2: Skin Analysis";
    const statusColor = isMode1 ? "var(--primary)" : "#a855f7";

    let html = `
        <header class="header">
            <div class="title">
                <h1>Screening: ${uiState.profile.name} (${uiState.profile.age})</h1>
                <p>Status: <strong style="color: ${statusColor}">${isMode1 ? "Mode 1 (Portrait)" : "Mode 2 (Analysis)"}</strong></p>
            </div>
            <button class="btn secondary" onclick="location.reload()">End Session</button>
        </header>
        <div class="container">
        <div class="card">
            <div class="row">
                <div>
                    <h3>${modeTitle}</h3>
                    <p>${isMode1 ? "Press Button 1 to capture portrait." : "Press Button 1 or upload a photo to analyze."}</p>
                    <p class="help">Press Button 2 to switch modes.</p>
                </div>
                ${!isMode1 ? `
                <div>
                    <input type="file" id="file-upload" accept="image/*" style="display:none">
                    <button class="btn secondary" onclick="document.getElementById('file-upload').click()">Upload Photo</button>
                </div>` : ''}
            </div>
        </div>
    `;

    if (uiState.processing) {
        html += `<div class="card"><div class="row"><div class="spinner"></div><h3>Processing Analysis...</h3></div></div>`;
    } else if (uiState.currentImage) {
        html += `<div class="card">`;
        
        // Result Banner
        if (!isMode1 && uiState.analysisResult) {
            const res = uiState.analysisResult;
            if (res.status === 'normal') {
                html += `<div class="banner good"><strong>Result: Normal</strong><p>No lesions detected.</p></div>`;
            } else {
                html += `<div class="banner warn"><strong>Abnormality Detected</strong></div>`;
                html += `<ul class="list">`;
                (res.predictions || []).forEach(p => {
                     html += `<li><strong>${p.class}</strong> (${(p.confidence*100).toFixed(1)}%)</li>`;
                });
                html += `</ul>`;
            }
        }
        
        // Images Grid
        html += `<div class="grid two">`;
        html += `<div><h4>Original Capture</h4><img src="${uiState.currentImage}" style="width:100%; border-radius:8px;"></div>`;
        
        if (!isMode1 && uiState.analysisResult && uiState.analysisResult.annotatedUrl) {
            const annoUrl = uiState.analysisResult.annotatedUrl.startsWith('http') ? uiState.analysisResult.annotatedUrl : `${RDK_API_BASE}/${uiState.analysisResult.annotatedUrl}`;
            html += `<div><h4>Analysis Result</h4><img src="${annoUrl}?t=${Date.now()}" style="width:100%; border-radius:8px;"></div>`;
        }
        
        html += `</div></div>`;
    }

    html += `</div>`;
    app.innerHTML = html;

    // Bind upload
    const fileInput = document.getElementById('file-upload');
    if (fileInput) {
        fileInput.onchange = (e) => {
            if (e.target.files.length) uploadFile(e.target.files[0]);
        };
    }
}

pollState();
renderForm();
