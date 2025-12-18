const listeners = new Set();

const randomColor = () => {
    const colors = ['#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#a78bfa'];
    return colors[Math.floor(Math.random() * colors.length)];
};

const makePlaceholder = (label) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = randomColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, 50);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    ctx.font = '16px system-ui';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 30);
    return canvas.toDataURL('image/png');
};

const notify = (btn) => {
    listeners.forEach((handler) => {
        try {
            handler(btn);
        } catch (e) {
            console.error('hardware handler error', e);
        }
    });
};

document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTypingIntoFormField = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (isTypingIntoFormField) return; // Don't hijack keystrokes when user is typing in a form (e.g., Age field).

    if (e.key === '1') {
        notify(1);
    }
    if (e.key === '2') {
        notify(2);
    }
});

export const hardwareAdapter = {
    async startSession() {
        const sessionId = `SESSION-${crypto.randomUUID().slice(0, 8)}`;
        return { sessionId };
    },
    async capturePortrait(sessionId) {
        const portraitUrl = makePlaceholder(`Portrait (${sessionId})`);
        return { portraitUrl };
    },
    async captureImage(sessionId, area) {
        const imageUrl = makePlaceholder(`${area.toUpperCase()} ${Math.floor(Math.random() * 100)}`);
        return { imageUrl };
    },
    async deleteImage(sessionId, area, imageId) {
        console.info('deleteImage stub', { sessionId, area, imageId });
    },
    onHardwareButtonPress(handler) {
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    },
    simulateButtonPress(btn) {
        notify(btn);
    },
    async getCameraPreviewStream() {
        // Stub: return null for now; replace with real camera feed when available.
        return null;
    }
};
