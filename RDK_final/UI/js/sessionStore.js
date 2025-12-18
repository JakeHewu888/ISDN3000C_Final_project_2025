import { buildAnalysisSummary } from './analysisSummary.js';

const defaultState = () => ({
    sessionId: null,
    sessionStartedAt: null,
    sessionEndedAt: null,
    portraitUrl: '',
    profile: {
        name: '',
        age: '',
        gender: '',
        history: ''
    },
    images: {
        face: [],
        arm: []
    },
    analysis: null,
    analysisSummary: null
});

let state = defaultState();

const clone = (obj) => JSON.parse(JSON.stringify(obj));

const hydrateSummary = (record) => {
    const copy = clone(record);
    if (copy.analysis && !copy.analysisSummary) {
        copy.analysisSummary = buildAnalysisSummary(copy);
    }
    return copy;
};

// In-memory update only
const saveSnapshot = () => {
    // No-op for persistence in this version.
    // State is already updated in memory.
};

const setSession = (sessionId) => {
    state.sessionId = sessionId;
    state.sessionStartedAt = new Date().toISOString();
    state.sessionEndedAt = null;
    state.analysis = null;
    state.analysisSummary = null;
    saveSnapshot();
};

const setPortrait = (portraitUrl) => {
    state.portraitUrl = portraitUrl;
    saveSnapshot();
};

const updateProfile = (profile) => {
    state.profile = { ...state.profile, ...profile };
    saveSnapshot();
};

const addImage = (area, url) => {
    const entry = {
        id: crypto.randomUUID(),
        url,
        createdAt: new Date().toISOString()
    };
    state.images[area] = [...state.images[area], entry];
    saveSnapshot();
    return entry;
};

const deleteLastImage = (area) => {
    const imgs = state.images[area];
    if (imgs.length === 0) return null;
    const removed = imgs[imgs.length - 1];
    state.images[area] = imgs.slice(0, -1);
    saveSnapshot();
    return removed;
};

const deleteImageById = (area, imageId) => {
    state.images[area] = state.images[area].filter((img) => img.id !== imageId);
    saveSnapshot();
};

const setAnalysis = (analysis) => {
    state.analysis = analysis;
    state.analysisSummary = analysis ? buildAnalysisSummary({ ...state, analysis }) : null;
    saveSnapshot();
};

const markSessionEnded = () => {
    state.sessionEndedAt = new Date().toISOString();
    saveSnapshot();
};

const reset = () => {
    state = defaultState();
};

export const sessionStore = {
    getState: () => clone(state),
    // Removed getAllSessions as history is now handled by recordsRepo
    getSessionById: (sessionId) => {
       // This was used for history lookup. Now consumers should use recordsRepo.
       // However, to avoid breaking app.js immediately before I fix it, I'll return null or throw.
       return null; 
    },
    setSession,
    setPortrait,
    updateProfile,
    addImage,
    deleteLastImage,
    deleteImageById,
    setAnalysis,
    markSessionEnded,
    saveSnapshot,
    reset
};
