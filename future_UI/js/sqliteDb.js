const DB_NAME = 'guided_screening_db';
const STORE_NAME = 'sqlite_file';
const KEY = 'db_file';

let db = null;
let SQL = null;

// IndexedDB Helper
const openIdb = () => {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

const loadFromIdb = async () => {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

const saveToIdb = async (data) => {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(data, KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const sqliteDb = {
    async initDb() {
        try {
            if (!window.initSqlJs) {
                throw new Error('sql.js not loaded');
            }
            if (!SQL) {
                SQL = await window.initSqlJs({
                    locateFile: (file) => `vendor/${file}`
                });
            }
            
            const savedData = await loadFromIdb();
            if (savedData) {
                db = new SQL.Database(new Uint8Array(savedData));
            } else {
                db = new SQL.Database();
            }
            return db;
        } catch (err) {
            console.error('Failed to initialize SQLite DB:', err);
            throw err;
        }
    },

    getDb() {
        if (!db) throw new Error('DB not initialized');
        return db;
    },

    exec(sql, params) {
        if (!db) throw new Error('DB not initialized');
        return db.exec(sql, params);
    },

    run(sql, params) {
        if (!db) throw new Error('DB not initialized');
        return db.run(sql, params);
    },

    // Returns array of objects { col: val, ... }
    query(sql, params) {
        if (!db) throw new Error('DB not initialized');
        const stmt = db.prepare(sql, params);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    },

    async saveDb() {
        if (!db) return;
        const data = db.export();
        await saveToIdb(data);
    },

    async resetDb() {
        if (db) {
            db.close();
        }
        db = new SQL.Database();
        await this.saveDb();
    }
};


