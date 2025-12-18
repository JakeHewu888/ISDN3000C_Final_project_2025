import { sqliteDb } from './sqliteDb.js';

const SCHEMA_VERSION = 1;

const MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        ended_at TEXT,
        patient_name TEXT,
        patient_age INTEGER,
        patient_gender TEXT,
        patient_history TEXT,
        overall_label TEXT,
        overall_level TEXT,
        primary_class TEXT,
        mean_confidence REAL,
        median_confidence REAL,
        low_conf_rate REAL,
        session_json TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_primary_class ON sessions(primary_class);`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_overall_level ON sessions(overall_level);`,
    `CREATE TABLE IF NOT EXISTS images (
        image_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        area TEXT NOT NULL,
        original_url TEXT,
        annotated_url TEXT,
        predicted_class TEXT,
        confidence REAL,
        captured_at TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_images_session_id ON images(session_id);`,
    `CREATE INDEX IF NOT EXISTS idx_images_pred_conf ON images(predicted_class, confidence);`
];

export const recordsRepo = {
    async init() {
        await sqliteDb.initDb();
        await this.migrateIfNeeded();
    },

    async migrateIfNeeded() {
        // Check version
        let version = 0;
        try {
            const rows = sqliteDb.query("SELECT value FROM meta WHERE key = 'schema_version'");
            if (rows.length > 0) {
                version = parseInt(rows[0].value, 10);
            }
        } catch (e) {
            // Table doesn't exist yet, version 0
        }

        if (version < SCHEMA_VERSION) {
            console.info(`Migrating DB from version ${version} to ${SCHEMA_VERSION}`);
            // Run all migrations (idempotent setup here mostly)
            for (const sql of MIGRATIONS) {
                sqliteDb.run(sql);
            }
            // Update version
            sqliteDb.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION.toString()]);
            await sqliteDb.saveDb();
        }
    },

    async addSessionRecord(session) {
        const summary = session.analysisSummary?.summary || {};
        const meta = session.analysisSummary?.meta || {};
        const profile = session.profile || {};
        const analysis = session.analysis || {};
        
        // Prepare session row
        const sessionRow = [
            session.sessionId,
            meta.generatedAt || session.sessionEndedAt || new Date().toISOString(),
            session.sessionEndedAt,
            profile.name,
            profile.age || null,
            profile.gender,
            profile.history,
            session.analysisSummary?.guidance?.outcomeLabel,
            analysis.overall?.level,
            summary.primaryDetectedClass,
            summary.meanConfidence,
            summary.medianConfidence,
            summary.lowConfidenceRate,
            JSON.stringify(session)
        ];

        const sessionSql = `
            INSERT OR REPLACE INTO sessions (
                session_id, created_at, ended_at, patient_name, patient_age, patient_gender, 
                patient_history, overall_label, overall_level, primary_class, 
                mean_confidence, median_confidence, low_conf_rate, session_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Prepare image rows
        const predictions = session.analysisSummary?.predictions || [];
        const imageSql = `
            INSERT OR REPLACE INTO images (
                image_id, session_id, area, original_url, annotated_url, 
                predicted_class, confidence, captured_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Execute transaction-like sequence
        try {
            sqliteDb.run('BEGIN TRANSACTION');
            
            sqliteDb.run(sessionSql, sessionRow);
            
            for (const p of predictions) {
                sqliteDb.run(imageSql, [
                    p.imageId,
                    session.sessionId,
                    p.area,
                    p.imageUrl, // original_url
                    null, // annotated_url (initially null)
                    p.predictedClass,
                    p.confidence,
                    p.capturedAt
                ]);
            }
            
            sqliteDb.run('COMMIT');
            await sqliteDb.saveDb();
        } catch (err) {
            sqliteDb.run('ROLLBACK');
            throw err;
        }
    },

    async listSessionRecords({ limit = 50, offset = 0, sort = 'desc', filterPrimaryClass = 'all' } = {}) {
        let sql = `
            SELECT session_id as sessionId, created_at as createdAt, patient_name as patientName, 
                   primary_class as primaryClass, overall_label as outcomeLabel, session_json as sessionJson
            FROM sessions
        `;
        const params = [];
        
        if (filterPrimaryClass !== 'all') {
            sql += ` WHERE primary_class = ?`;
            params.push(filterPrimaryClass);
        }
        
        sql += ` ORDER BY created_at ${sort === 'asc' ? 'ASC' : 'DESC'}`;
        sql += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const rows = sqliteDb.query(sql, params);
        
        // Hydrate result to match expected format for UI (partial session object)
        return rows.map(row => {
            // We can return a lightweight object or parse the full JSON.
            // For the table, we just need basic fields. 
            // The existing code expects a session object structure with analysisSummary.
            // Let's reconstruct a minimal version or parse the JSON if needed.
            // Actually, parsing JSON is safest to ensure compatibility with renderHistory
            try {
                return JSON.parse(row.sessionJson);
            } catch (e) {
                console.warn('Failed to parse session JSON for', row.sessionId);
                return {
                    sessionId: row.sessionId,
                    sessionEndedAt: row.createdAt,
                    profile: { name: row.patientName },
                    analysisSummary: {
                        summary: { primaryDetectedClass: row.primaryClass },
                        guidance: { outcomeLabel: row.outcomeLabel }
                    }
                };
            }
        });
    },

    async getSessionRecord(sessionId) {
        const rows = sqliteDb.query(`SELECT session_json FROM sessions WHERE session_id = ?`, [sessionId]);
        if (rows.length === 0) return null;
        try {
            return JSON.parse(rows[0].session_json);
        } catch (e) {
            console.error('Error parsing session JSON', e);
            return null;
        }
    },

    async updateSessionAnnotatedUrl(sessionId, imageId, annotatedUrl) {
        // Update images table
        sqliteDb.run(`UPDATE images SET annotated_url = ? WHERE session_id = ? AND image_id = ?`, [annotatedUrl, sessionId, imageId]);
        
        // Update JSON blob in sessions table
        // This is tricky without JSON support in older SQLite or complex logic.
        // We will read, update, write.
        const session = await this.getSessionRecord(sessionId);
        if (session) {
            // Find image in session and update
            let updated = false;
            // Update in predictions list
            if (session.analysisSummary?.predictions) {
                const pred = session.analysisSummary.predictions.find(p => p.imageId === imageId);
                if (pred) {
                    pred.annotatedUrl = annotatedUrl;
                    updated = true;
                }
            }
            
            if (updated) {
                sqliteDb.run(`UPDATE sessions SET session_json = ? WHERE session_id = ?`, [JSON.stringify(session), sessionId]);
            }
        }
        
        await sqliteDb.saveDb();
    }
};


