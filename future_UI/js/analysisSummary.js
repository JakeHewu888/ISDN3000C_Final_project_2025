const CLASS_NAMES = ['normal', 'rash', 'skin_cancer'];

const CLASS_LABELS = {
    normal: 'Normal',
    rash: 'Eczema',
    skin_cancer: 'Skin cancer'
};

const normalizeConfidence = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const normalized = num > 1 ? num / 100 : num;
    return Math.max(0, Math.min(1, normalized));
};

const pickFallbackClass = (analysis) => {
    const level = analysis?.overall?.level;
    if (level === 'red') return 'skin_cancer';
    if (level === 'yellow') return 'rash';
    return 'normal';
};

const normalizePredictions = (session) => {
    const analysis = session.analysis || {};
    const imageLookup = new Map();
    Object.entries(session.images || {}).forEach(([area, items]) => {
        items.forEach((img) => imageLookup.set(img.id, { ...img, area }));
    });

    const rawPreds = Array.isArray(analysis.predictions) ? analysis.predictions : [];
    const normalized = rawPreds.map((pred) => {
        const img = imageLookup.get(pred.imageId) || {};
        const predictedClass = CLASS_NAMES.includes(pred.predictedClass)
            ? pred.predictedClass
            : CLASS_NAMES.includes(pred.label)
                ? pred.label
                : pickFallbackClass(analysis);
        const confidence = normalizeConfidence(pred.confidence ?? pred.score ?? pred.probability ?? img.confidence ?? analysis.overall?.consistency);
        return {
            imageId: pred.imageId || img.id || crypto.randomUUID(),
            area: pred.area || img.area || 'face',
            predictedClass,
            confidence: confidence ?? 0.5,
            capturedAt: pred.capturedAt || img.createdAt || analysis.meta?.timestamp || new Date().toISOString(),
            imageUrl: pred.imageUrl || img.url || analysis.meta?.fallbackImageUrl || ''
        };
    }).filter(Boolean);

    if (normalized.length) return normalized;

    const fallbackClass = pickFallbackClass(analysis);
    imageLookup.forEach((img) => {
        normalized.push({
            imageId: img.id,
            area: img.area,
            predictedClass: fallbackClass,
            confidence: normalizeConfidence(analysis.overall?.consistency) ?? 0.5,
            capturedAt: img.createdAt,
            imageUrl: img.url
        });
    });

    return normalized;
};

const computePercentages = (counts, total) => {
    const pct = {};
    CLASS_NAMES.forEach((cls) => {
        const val = total ? (counts[cls] / total) * 100 : 0;
        pct[cls] = Math.round(val * 10) / 10;
    });
    return pct;
};

const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
};

const findPrimaryClass = (counts, predictions) => {
    const classMeans = {};
    CLASS_NAMES.forEach((cls) => {
        const clsPreds = predictions.filter((p) => p.predictedClass === cls);
        classMeans[cls] = clsPreds.length
            ? clsPreds.reduce((acc, p) => acc + (p.confidence ?? 0), 0) / clsPreds.length
            : 0;
    });
    const ranked = CLASS_NAMES.map((cls) => ({
        cls,
        count: counts[cls],
        mean: classMeans[cls]
    })).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return (b.mean || 0) - (a.mean || 0);
    });
    return ranked[0]?.cls || 'normal';
};

const buildGuidance = (counts, predictions) => {
    const hasHighRisk = predictions.some((p) => p.predictedClass === 'skin_cancer' && (p.confidence ?? 0) >= 0.8);
    const rashDominates = counts.rash > counts.normal && counts.rash >= counts.skin_cancer && counts.rash > 0;

    if (hasHighRisk) {
        return {
            message: 'Priority follow-up with a qualified healthcare professional is recommended.',
            outcomeLabel: 'Priority follow-up recommended'
        };
    }
    if (rashDominates) {
        return {
            message: 'Review recommended if symptoms persist.',
            outcomeLabel: 'Review recommended'
        };
    }
    return {
        message: 'No concerning patterns identified.',
        outcomeLabel: 'No concerning patterns identified'
    };
};

export const buildAnalysisSummary = (session) => {
    const predictions = normalizePredictions(session);
    const totalImages = predictions.length;
    const counts = {
        normal: 0,
        rash: 0,
        skin_cancer: 0
    };
    predictions.forEach((p) => {
        counts[p.predictedClass] += 1;
    });
    const percentages = computePercentages(counts, totalImages);

    const confidences = predictions.map((p) => p.confidence ?? 0);
    const meanConfidence = confidences.length
        ? (confidences.reduce((acc, val) => acc + val, 0) / confidences.length) * 100
        : null;
    const medianConfidence = confidences.length ? median(confidences) * 100 : null;
    const lowConfidenceRate = totalImages
        ? (predictions.filter((p) => (p.confidence ?? 0) < 0.6).length / totalImages) * 100
        : null;

    const byArea = {};
    ['face', 'arm'].forEach((area) => {
        const areaPreds = predictions.filter((p) => p.area === area);
        const areaCounts = {
            normal: 0,
            rash: 0,
            skin_cancer: 0
        };
        areaPreds.forEach((p) => { areaCounts[p.predictedClass] += 1; });
        const areaConfidences = areaPreds.map((p) => p.confidence ?? 0);
        byArea[area] = {
            total: areaPreds.length,
            counts: areaCounts,
            percentages: computePercentages(areaCounts, areaPreds.length),
            meanConfidence: areaConfidences.length
                ? (areaConfidences.reduce((acc, val) => acc + val, 0) / areaConfidences.length) * 100
                : null
        };
    });

    const primaryDetectedClass = findPrimaryClass(counts, predictions);
    const guidance = buildGuidance(counts, predictions);

    const capturedAreas = ['face', 'arm'].filter((area) => byArea[area].total > 0);

    return {
        predictions,
        summary: {
            totalImages,
            counts,
            percentages,
            meanConfidence,
            medianConfidence,
            lowConfidenceRate,
            primaryDetectedClass,
            primaryMethod: 'Primary detected class uses majority vote across images; ties are broken by average confidence.',
            capturedAreas
        },
        byArea,
        guidance,
        meta: {
            modelVersion: session.analysis?.meta?.modelVersion || 'mock-1.0',
            generatedAt: session.analysis?.meta?.timestamp || session.sessionEndedAt || session.sessionStartedAt || new Date().toISOString()
        },
        labels: CLASS_LABELS
    };
};
