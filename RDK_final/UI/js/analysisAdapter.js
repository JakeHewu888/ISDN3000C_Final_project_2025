import { APP_MODE, RDK_API_BASE } from './config.js';

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const mockJobs = new Map();

const randomClass = () => {
    const roll = Math.random();
    if (roll < 0.65) return 'normal';
    if (roll < 0.88) return 'rash';
    return 'skin_cancer';
};

const buildMockResult = (payload) => {
    const predictions = [];
    Object.entries(payload.images || {}).forEach(([area, imgs]) => {
        imgs.forEach((img) => {
            const predictedClass = randomClass();
            const confidence = +(0.55 + Math.random() * 0.4).toFixed(2);
            predictions.push({
                imageId: img.id,
                area,
                predictedClass,
                confidence,
                capturedAt: img.capturedAt,
                imageUrl: img.url
            });
        });
    });

    const counts = { normal: 0, rash: 0, skin_cancer: 0 };
    predictions.forEach((p) => { counts[p.predictedClass] += 1; });
    const primary = ['normal', 'rash', 'skin_cancer'].sort((a, b) => counts[b] - counts[a])[0] || 'normal';
    const level = primary === 'skin_cancer' ? 'red' : primary === 'rash' ? 'yellow' : 'green';
    const summary = level === 'green'
        ? 'No concerning patterns identified.'
        : level === 'yellow'
            ? 'Review recommended; patterns observed.'
            : 'Priority follow-up suggested based on captured patterns.';

    const makeArea = () => {
        const consistency = +(70 + Math.random() * 25).toFixed(1);
        return {
            consistency,
            confidence: consistency,
            features: [
                'Example output: diffuse texture variation noted',
                'Example output: mild contrast shifts across capture'
            ],
            guidance: 'Consider professional review if concerns persist or changes are observed.',
            text: 'Patterns observed; consider professional review if concerns persist.',
            thumbnailUrl: null
        };
    };
    const areas = {
        face: makeArea(),
        arm: makeArea()
    };
    const averageConsistency = Math.round((areas.face.consistency + areas.arm.consistency) / 2);
    return {
        overall: { level, summary, consistency: averageConsistency, primaryDetectedClass: primary },
        byArea: areas,
        predictions,
        meta: {
            modelVersion: 'mock-1.0',
            timestamp: new Date().toISOString()
        }
    };
};

const http = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Request failed');
    }
    return res.json();
};

const submitMock = async (sessionId, payload) => {
    const jobId = `MOCK-${crypto.randomUUID().slice(0, 8)}`;
    const job = {
        status: 'queued',
        progress: 0,
        step: 'Detecting skin regions',
        result: null
    };
    mockJobs.set(jobId, job);

    setTimeout(() => {
        if (!mockJobs.has(jobId)) return;
        mockJobs.set(jobId, { ...job, status: 'running', progress: 0.25, step: 'Detecting skin regions' });
    }, 300);
    setTimeout(() => {
        if (!mockJobs.has(jobId)) return;
        const latest = mockJobs.get(jobId);
        mockJobs.set(jobId, { ...latest, progress: 0.6, step: 'Analyzing visual patterns' });
    }, 1000);
    setTimeout(() => {
        if (!mockJobs.has(jobId)) return;
        const latest = mockJobs.get(jobId);
        mockJobs.set(jobId, { ...latest, progress: 0.9, step: 'Aggregating results' });
    }, 1800);
    setTimeout(() => {
        if (!mockJobs.has(jobId)) return;
        const result = buildMockResult(payload);
        mockJobs.set(jobId, { status: 'done', progress: 1, step: 'Aggregating results', result });
    }, 2400);

    return { jobId };
};

const getMockStatus = async (jobId) => {
    const job = mockJobs.get(jobId);
    if (!job) throw new Error('Job not found');
    return {
        status: job.status,
        progress: job.progress,
        step: job.step
    };
};

const getMockResult = async (jobId) => {
    const job = mockJobs.get(jobId);
    if (!job || job.status !== 'done' || !job.result) throw new Error('Result not ready');
    return job.result;
};

export const buildAnalysisPayload = (session) => {
    return {
        sessionId: session.sessionId,
        profile: { ...session.profile },
        portrait: session.portraitUrl,
        images: {
            face: session.images.face.map((img) => ({ id: img.id, url: img.url, capturedAt: img.createdAt })),
            arm: session.images.arm.map((img) => ({ id: img.id, url: img.url, capturedAt: img.createdAt }))
        }
    };
};

export const analysisAdapter = {
    async submitForAnalysis(sessionId, payload) {
        if (APP_MODE === 'mock') {
            return submitMock(sessionId, payload);
        }
        try {
            const data = await http(`${RDK_API_BASE}/api/analysis/submit/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return data;
        } catch (err) {
            err.isNetwork = true;
            throw err;
        }
    },
    async getAnalysisStatus(jobId) {
        if (APP_MODE === 'mock') {
            return getMockStatus(jobId);
        }
        try {
            return await http(`${RDK_API_BASE}/api/analysis/status/${jobId}`, { method: 'GET' });
        } catch (err) {
            err.isNetwork = true;
            throw err;
        }
    },
    async getAnalysisResult(jobId) {
        if (APP_MODE === 'mock') {
            return getMockResult(jobId);
        }
        try {
            return await http(`${RDK_API_BASE}/api/analysis/result/${jobId}`, { method: 'GET' });
        } catch (err) {
            err.isNetwork = true;
            throw err;
        }
    },
    getAnnotatedImageUrl(imageId) {
        if (APP_MODE === 'mock') {
            // Return a placeholder SVG with a red circle to simulate annotation
            const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <rect width="100%" height="100%" fill="#e5e7eb"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui" font-size="24" fill="#374151">Annotated ${imageId}</text>
    <circle cx="240" cy="160" r="60" fill="none" stroke="#ef4444" stroke-width="4"/>
</svg>`;
            return `data:image/svg+xml;base64,${btoa(svg)}`;
        }
        return `${RDK_API_BASE}/api/images/${imageId}/annotated`;
    }
};
