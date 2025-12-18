import { RDK_API_BASE } from './config.js';

// Simple adapter that does nothing but start session
// The real logic is now in app.js polling /api/state

export const hardwareAdapter = {
    async startSession() {
        return { sessionId: `SESSION-${crypto.randomUUID().slice(0, 8)}` };
    },
    // Stubs to keep app.js happy without breaking changes
    async capturePortrait() { return {}; },
    async captureImage() { return {}; },
    async deleteImage() {},
    onHardwareButtonPress() { return () => {}; },
    simulateButtonPress() {},
    async getCameraPreviewStream() { return null; }
};
