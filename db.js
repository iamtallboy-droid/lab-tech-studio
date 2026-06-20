require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'broadcast_hub.db');
const FALLBACK_FILE = path.join(__dirname, 'db.json');

let dbType = 'json'; // 'postgres', 'sqlite' or 'json'
let sqliteDb = null;
let pgPool = null;

// ----------------------------------------------------------------
// POSTGRESQL HELPERS
// ----------------------------------------------------------------
async function pgQuery(text, params = []) {
    const client = await pgPool.connect();
    try {
        const result = await client.query(text, params);
        return result.rows;
    } finally {
        client.release();
    }
}

async function pgRun(text, params = []) {
    const client = await pgPool.connect();
    try {
        await client.query(text, params);
    } finally {
        client.release();
    }
}

async function initPostgres() {
    const POSTGRES_URL = process.env.POSTGRES_URL;
    if (!POSTGRES_URL) return false;

    try {
        const { Pool } = require('pg');
        pgPool = new Pool({ connectionString: POSTGRES_URL, connectionTimeoutMillis: 5000 });
        // Test connection
        await pgPool.query('SELECT 1');
        console.log('POSTGRES: Connected to PostgreSQL database.');
        await createPostgresTables();
        await seedPostgresDb();
        return true;
    } catch (err) {
        console.warn(`POSTGRES: Could not connect — falling back to SQLite/JSON. (${err.message})`);
        pgPool = null;
        return false;
    }
}

async function createPostgresTables() {
    await pgRun(`CREATE TABLE IF NOT EXISTS shows (
        show_id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL,
        primary_hex TEXT NOT NULL,
        secondary_hex TEXT NOT NULL,
        accent_hex TEXT,
        logo_url TEXT,
        overlay_settings TEXT,
        font_family TEXT NOT NULL,
        hosts TEXT NOT NULL
    )`);
    await pgRun(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS accent_hex TEXT`).catch(() => {});
    await pgRun(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS logo_url TEXT`).catch(() => {});
    await pgRun(`ALTER TABLE shows ADD COLUMN IF NOT EXISTS overlay_settings TEXT`).catch(() => {});
    await pgRun(`CREATE TABLE IF NOT EXISTS products (
        product_id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        title TEXT NOT NULL,
        price TEXT NOT NULL,
        image_url TEXT NOT NULL,
        checkout_url TEXT NOT NULL,
        is_evergreen INTEGER DEFAULT 0,
        slot_index INTEGER NOT NULL
    )`);
    await pgRun(`CREATE TABLE IF NOT EXISTS coordinates (
        show_id TEXT NOT NULL,
        canvas_mode TEXT NOT NULL,
        container_top REAL NOT NULL DEFAULT 50,
        container_left REAL NOT NULL DEFAULT 50,
        image_scale REAL NOT NULL DEFAULT 100,
        text_scale REAL NOT NULL DEFAULT 100,
        PRIMARY KEY (show_id, canvas_mode)
    )`);
    await pgRun(`CREATE TABLE IF NOT EXISTS rundown_segments (
        segment_id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        title TEXT NOT NULL,
        guest_name TEXT,
        guest_title TEXT,
        guest_handle TEXT,
        guest_website TEXT,
        impact_headline TEXT,
        context_subline TEXT,
        ticker_headlines TEXT,
        cta_headline TEXT,
        cta_subline TEXT,
        producer_notes TEXT,
        sort_order INTEGER NOT NULL
    )`);
    await pgRun(`CREATE TABLE IF NOT EXISTS calendar_events (
        event_id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT
    )`);
    await pgRun(`CREATE TABLE IF NOT EXISTS show_briefs (
        brief_id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        brief_date TEXT NOT NULL,
        objective TEXT,
        talking_points TEXT
    )`);
    console.log('POSTGRES: Tables verified/created.');
}

async function seedPostgresDb() {
    const existing = await pgQuery('SELECT show_id FROM shows');
    if (existing.length > 0) return;

    for (const show of DEFAULT_SHOWS) {
        await pgRun(
            `INSERT INTO shows (show_id, brand_name, primary_hex, secondary_hex, accent_hex, logo_url, overlay_settings, font_family, hosts)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (show_id) DO NOTHING`,
            [show.show_id, show.brand_name, show.primary_hex, show.secondary_hex, show.accent_hex, show.logo_url, show.overlay_settings, show.font_family, show.hosts]
        );
    }
    for (const c of DEFAULT_COORDINATES) {
        await pgRun(
            `INSERT INTO coordinates (show_id, canvas_mode, container_top, container_left, image_scale, text_scale)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (show_id, canvas_mode) DO NOTHING`,
            [c.show_id, c.canvas_mode, c.container_top, c.container_left, c.image_scale, c.text_scale]
        );
    }
    for (const p of DEFAULT_PRODUCTS) {
        await pgRun(
            `INSERT INTO products (product_id, show_id, title, price, image_url, checkout_url, is_evergreen, slot_index)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (product_id) DO NOTHING`,
            [p.product_id, p.show_id, p.title, p.price, p.image_url, p.checkout_url, p.is_evergreen, p.slot_index]
        );
    }
    console.log('POSTGRES: Seed data inserted.');
}
let jsonDbState = {
    shows: [],
    products: [],
    coordinates: [],
    rundown_segments: [],
    calendar_events: [],
    show_briefs: []
};

// Default Shows seed data
const DEFAULT_SHOWS = [
    {
        show_id: 'lab_tech_show',
        brand_name: 'The Lab Tech Show',
        primary_hex: '#00AEEF',
        secondary_hex: '#00E5FF',
        accent_hex: '#0066CC',
        logo_url: 'logo.png',
        overlay_settings: JSON.stringify({
            ticker: {
                manualText: 'Understand the tech, leverage the tech, win with the tech\nNew episode every week — subscribe to keep up\nThe Lab Tech Show — where technology meets opportunity',
                source: 'manual', speed: 60, fontSize: 24, barHeight: 55, barOpacity: 0.92,
                uppercase: false, separator: 'dot', badgeText: 'LIVE', badgeOn: true, accentHex: '#00E5FF'
            },
            cta: {
                active: false, badge: 'SUBSCRIBE', title: 'Subscribe to The Lab Tech Show',
                subline: 'New episodes every week — never miss a drop.', url: 'youtube.com/thelabtechshow',
                style: 'glow', autoHideSec: 12
            },
            lt: { style: 'standard', kicker: 'ON AIR GUEST', active: false }
        }),
        font_family: 'Inter',
        hosts: JSON.stringify([
            { name: 'Corey "Tall Boy" Sanders', handle: '@IamTallboy', role: 'Host' },
            { name: 'Revis Brown', handle: '@IamRevisBrown', role: 'Co-Host' }
        ])
    },
    {
        show_id: 'tall_boy_experience',
        brand_name: 'The Tall Boy Experience',
        primary_hex: '#056004',
        secondary_hex: '#4ADE80',
        accent_hex: '#4ADE80',
        logo_url: 'tbe-logo.svg',
        overlay_settings: JSON.stringify({
            ticker: {
                manualText: 'The Tall Boy Experience — real talk, real culture\nGrab the merch at shop.tallboy.us\nNew drops every week — honk da horn!',
                source: 'manual', speed: 60, fontSize: 24, barHeight: 55, barOpacity: 0.92,
                uppercase: false, separator: 'dot', badgeText: 'LIVE', badgeOn: true, accentHex: '#4ADE80'
            },
            cta: {
                active: false, badge: 'SUBSCRIBE', title: 'Join The Tall Boy Experience',
                subline: 'Real talk, real culture — hit subscribe & grab the merch.', url: 'tallboy.us',
                style: 'glow', autoHideSec: 12
            },
            lt: { style: 'standard', kicker: 'ON AIR', active: false }
        }),
        font_family: 'Days One',
        hosts: JSON.stringify([
            { name: 'Corey "Tall Boy" Sanders', handle: '@IamTallboy', role: 'Host' },
            { name: 'Revis Brown', handle: '@IamRevisBrown', role: 'Co-Host' }
        ])
    }
];

const DEFAULT_COORDINATES = [
    { show_id: 'lab_tech_show', canvas_mode: 'horizontal', container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 },
    { show_id: 'lab_tech_show', canvas_mode: 'vertical', container_top: 50, container_left: 50, image_scale: 100, text_scale: 100 },
    { show_id: 'tall_boy_experience', canvas_mode: 'horizontal', container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 },
    { show_id: 'tall_boy_experience', canvas_mode: 'vertical', container_top: 50, container_left: 50, image_scale: 100, text_scale: 100 }
];

const DEFAULT_PRODUCTS = [
    // Lab Tech Show Defaults (Slot 5-9 overrides)
    { product_id: 'lt-evergreen-1', show_id: 'lab_tech_show', title: 'Lab Tech Studio Mug', price: '$19.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us/products/mug', is_evergreen: 1, slot_index: 5 },
    { product_id: 'lt-evergreen-2', show_id: 'lab_tech_show', title: 'Lab Tech Hoodie', price: '$54.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us/products/hoodie', is_evergreen: 1, slot_index: 6 },
    // Tall Boy Experience Defaults
    { product_id: 'tbe-evergreen-1', show_id: 'tall_boy_experience', title: 'TBE Cinematic Cap', price: '$24.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/cap', is_evergreen: 1, slot_index: 5 },
    { product_id: 'tbe-evergreen-2', show_id: 'tall_boy_experience', title: 'TBE Blackout Tee', price: '$29.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/tee', is_evergreen: 1, slot_index: 6 }
];

// Seed fallback database files
function seedJsonDb() {
    jsonDbState.shows = [...DEFAULT_SHOWS];
    jsonDbState.coordinates = [...DEFAULT_COORDINATES];
    jsonDbState.products = [...DEFAULT_PRODUCTS];
    saveJsonDb();
}

function saveJsonDb() {
    try {
        fs.writeFileSync(FALLBACK_FILE, JSON.stringify(jsonDbState, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to write JSON DB fallback file:", err);
    }
}

function loadJsonDb() {
    if (fs.existsSync(FALLBACK_FILE)) {
        try {
            const data = fs.readFileSync(FALLBACK_FILE, 'utf8');
            jsonDbState = JSON.parse(data);
        } catch (err) {
            console.error("Failed to parse JSON DB file, seeding fresh:", err);
            seedJsonDb();
        }
    } else {
        seedJsonDb();
    }
}

async function initDb() {
    // 1. Try PostgreSQL first
    const pgOk = await initPostgres();
    if (pgOk) {
        dbType = 'postgres';
        return;
    }

    // 2. Try SQLite
    await new Promise((resolve) => {
        try {
            const sqlite3 = require('sqlite3').verbose();
            sqliteDb = new sqlite3.Database(DB_FILE, (err) => {
                if (err) {
                    console.warn('SQLITE: Failed to open database file, falling back to JSON storage:', err.message);
                    dbType = 'json';
                    loadJsonDb();
                    resolve();
                } else {
                    dbType = 'sqlite';
                    console.log('SQLITE: Connected to broadcast_hub.db');
                    createTables()
                        .then(() => seedSqliteDb())
                        .then(resolve)
                        .catch(err => {
                            console.error('SQLITE: Error building tables, falling back to JSON:', err);
                            dbType = 'json';
                            loadJsonDb();
                            resolve();
                        });
                }
            });
        } catch (err) {
            console.warn('SQLITE: Module not available. Falling back to JSON database storage.');
            dbType = 'json';
            loadJsonDb();
            resolve();
        }
    });
}

function createTables() {
    return new Promise((resolve, reject) => {
        sqliteDb.serialize(() => {
            sqliteDb.run(`CREATE TABLE IF NOT EXISTS shows (
                show_id TEXT PRIMARY KEY,
                brand_name TEXT NOT NULL,
                primary_hex TEXT NOT NULL,
                secondary_hex TEXT NOT NULL,
                accent_hex TEXT,
                logo_url TEXT,
                overlay_settings TEXT,
                font_family TEXT NOT NULL,
                hosts TEXT NOT NULL
            )`, (err) => { if (err) return reject(err); });

            // Migration: add per-show branding columns to pre-existing DBs.
            // (CREATE TABLE IF NOT EXISTS won't add columns to an existing table.)
            // Duplicate-column errors are expected on already-migrated DBs and ignored.
            sqliteDb.run(`ALTER TABLE shows ADD COLUMN accent_hex TEXT`, () => {});
            sqliteDb.run(`ALTER TABLE shows ADD COLUMN logo_url TEXT`, () => {});
            sqliteDb.run(`ALTER TABLE shows ADD COLUMN overlay_settings TEXT`, () => {});

            sqliteDb.run(`CREATE TABLE IF NOT EXISTS products (
                product_id TEXT PRIMARY KEY,
                show_id TEXT NOT NULL,
                title TEXT NOT NULL,
                price TEXT NOT NULL,
                image_url TEXT NOT NULL,
                checkout_url TEXT NOT NULL,
                is_evergreen INTEGER DEFAULT 0,
                slot_index INTEGER NOT NULL,
                FOREIGN KEY(show_id) REFERENCES shows(show_id) ON DELETE CASCADE
            )`, (err) => { if (err) return reject(err); });

            sqliteDb.run(`CREATE TABLE IF NOT EXISTS coordinates (
                show_id TEXT NOT NULL,
                canvas_mode TEXT NOT NULL,
                container_top REAL NOT NULL DEFAULT 50,
                container_left REAL NOT NULL DEFAULT 50,
                image_scale REAL NOT NULL DEFAULT 100,
                text_scale REAL NOT NULL DEFAULT 100,
                PRIMARY KEY (show_id, canvas_mode),
                FOREIGN KEY(show_id) REFERENCES shows(show_id) ON DELETE CASCADE
            )`, (err) => { if (err) return reject(err); });

            sqliteDb.run(`CREATE TABLE IF NOT EXISTS rundown_segments (
                segment_id TEXT PRIMARY KEY,
                show_id TEXT NOT NULL,
                title TEXT NOT NULL,
                guest_name TEXT,
                guest_title TEXT,
                guest_handle TEXT,
                guest_website TEXT,
                impact_headline TEXT,
                context_subline TEXT,
                ticker_headlines TEXT,
                cta_headline TEXT,
                cta_subline TEXT,
                producer_notes TEXT,
                sort_order INTEGER NOT NULL,
                FOREIGN KEY(show_id) REFERENCES shows(show_id) ON DELETE CASCADE
            )`, (err) => { if (err) return reject(err); });

            sqliteDb.run(`CREATE TABLE IF NOT EXISTS calendar_events (
                event_id TEXT PRIMARY KEY,
                show_id TEXT NOT NULL,
                event_date TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                FOREIGN KEY(show_id) REFERENCES shows(show_id) ON DELETE CASCADE
            )`, (err) => { if (err) return reject(err); });

            sqliteDb.run(`CREATE TABLE IF NOT EXISTS show_briefs (
                brief_id TEXT PRIMARY KEY,
                show_id TEXT NOT NULL,
                brief_date TEXT NOT NULL,
                objective TEXT,
                talking_points TEXT,
                FOREIGN KEY(show_id) REFERENCES shows(show_id) ON DELETE CASCADE
            )`, (err) => { 
                if (err) return reject(err); 
                resolve();
            });
        });
    });
}

function seedSqliteDb() {
    return new Promise((resolve, reject) => {
        sqliteDb.serialize(() => {
            // Seed Shows
            DEFAULT_SHOWS.forEach((show) => {
                sqliteDb.run(`INSERT OR IGNORE INTO shows (show_id, brand_name, primary_hex, secondary_hex, accent_hex, logo_url, overlay_settings, font_family, hosts)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [show.show_id, show.brand_name, show.primary_hex, show.secondary_hex, show.accent_hex, show.logo_url, show.overlay_settings, show.font_family, show.hosts]);
                // One-time brand sync: bring pre-existing rows up to the correct
                // palette/logo, but only where not yet branded (logo_url empty),
                // so user customizations are preserved.
                sqliteDb.run(`UPDATE shows SET primary_hex=?, secondary_hex=?, accent_hex=?, logo_url=?
                              WHERE show_id=? AND (logo_url IS NULL OR logo_url='')`,
                              [show.primary_hex, show.secondary_hex, show.accent_hex, show.logo_url, show.show_id]);
                // Seed default overlay settings only where none exist yet.
                sqliteDb.run(`UPDATE shows SET overlay_settings=?
                              WHERE show_id=? AND (overlay_settings IS NULL OR overlay_settings='')`,
                              [show.overlay_settings, show.show_id]);
            });

            // Seed Coordinates
            DEFAULT_COORDINATES.forEach((c) => {
                sqliteDb.run(`INSERT OR IGNORE INTO coordinates (show_id, canvas_mode, container_top, container_left, image_scale, text_scale)
                              VALUES (?, ?, ?, ?, ?, ?)`,
                              [c.show_id, c.canvas_mode, c.container_top, c.container_left, c.image_scale, c.text_scale]);
            });

            // Seed Products
            DEFAULT_PRODUCTS.forEach((p) => {
                sqliteDb.run(`INSERT OR IGNORE INTO products (product_id, show_id, title, price, image_url, checkout_url, is_evergreen, slot_index)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                              [p.product_id, p.show_id, p.title, p.price, p.image_url, p.checkout_url, p.is_evergreen, p.slot_index]);
            });
            // Sentinel: runs last in the serialized queue, so we only resolve
            // once every seed INSERT above has actually completed. This prevents
            // getShows() from racing ahead and missing a freshly-seeded show.
            sqliteDb.get('SELECT 1', (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

// Helper Query functions wrapping both SQLITE and JSON file backends
const db = {
    // SHOWS
    getShows: () => {
        if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.all("SELECT * FROM shows", [], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows.map(r => ({
                        ...r,
                        hosts: JSON.parse(r.hosts),
                        overlay_settings: r.overlay_settings ? JSON.parse(r.overlay_settings) : {}
                    })));
                });
            });
        } else {
            return Promise.resolve(jsonDbState.shows.map(s => ({
                ...s,
                hosts: JSON.parse(s.hosts),
                overlay_settings: typeof s.overlay_settings === 'string'
                    ? (s.overlay_settings ? JSON.parse(s.overlay_settings) : {})
                    : (s.overlay_settings || {})
            })));
        }
    },
    saveShow: (show) => {
        const hostsStr = JSON.stringify(show.hosts || []);
        // overlay_settings may arrive as an object (from the API) or a string.
        const overlayStr = typeof show.overlay_settings === 'string'
            ? show.overlay_settings
            : JSON.stringify(show.overlay_settings || {});
        if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(`INSERT OR REPLACE INTO shows (show_id, brand_name, primary_hex, secondary_hex, accent_hex, logo_url, overlay_settings, font_family, hosts)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                              [show.show_id, show.brand_name, show.primary_hex, show.secondary_hex, show.accent_hex || null, show.logo_url || null, overlayStr, show.font_family, hostsStr],
                              (err) => {
                                  if (err) return reject(err);
                                  resolve();
                              });
            });
        } else {
            const idx = jsonDbState.shows.findIndex(s => s.show_id === show.show_id);
            const rawShow = { ...show, hosts: hostsStr, overlay_settings: overlayStr };
            if (idx !== -1) {
                jsonDbState.shows[idx] = rawShow;
            } else {
                jsonDbState.shows.push(rawShow);
            }
            saveJsonDb();
            return Promise.resolve();
        }
    },
    deleteShow: (showId) => {
        if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run("DELETE FROM shows WHERE show_id = ?", [showId], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        } else {
            jsonDbState.shows = jsonDbState.shows.filter(s => s.show_id !== showId);
            jsonDbState.products = jsonDbState.products.filter(p => p.show_id !== showId);
            jsonDbState.coordinates = jsonDbState.coordinates.filter(c => c.show_id !== showId);
            jsonDbState.rundown_segments = jsonDbState.rundown_segments.filter(r => r.show_id !== showId);
            jsonDbState.calendar_events = jsonDbState.calendar_events.filter(c => c.show_id !== showId);
            jsonDbState.show_briefs = jsonDbState.show_briefs.filter(b => b.show_id !== showId);
            saveJsonDb();
            return Promise.resolve();
        }
    },

    // PRODUCTS
    getProducts: (showId) => {
        if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.all("SELECT * FROM products WHERE show_id = ? ORDER BY slot_index ASC", [showId], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        } else {
            const filtered = jsonDbState.products.filter(p => p.show_id === showId);
            filtered.sort((a, b) => a.slot_index - b.slot_index);
            return Promise.resolve(filtered);
        }
    },
    saveProduct: (product) => {
        if (dbType === 'postgres') {
            return pgRun(
                `INSERT INTO products (product_id, show_id, title, price, image_url, checkout_url, is_evergreen, slot_index)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (product_id) DO UPDATE SET
                   title=EXCLUDED.title, price=EXCLUDED.price, image_url=EXCLUDED.image_url,
                   checkout_url=EXCLUDED.checkout_url, is_evergreen=EXCLUDED.is_evergreen, slot_index=EXCLUDED.slot_index`,
                [product.product_id, product.show_id, product.title, product.price,
                 product.image_url, product.checkout_url, product.is_evergreen || 0, product.slot_index]
            );
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(`INSERT OR REPLACE INTO products (product_id, show_id, title, price, image_url, checkout_url, is_evergreen, slot_index)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                              [product.product_id, product.show_id, product.title, product.price, product.image_url, product.checkout_url, product.is_evergreen, product.slot_index],
                              (err) => { if (err) return reject(err); resolve(); });
            });
        } else {
            const idx = jsonDbState.products.findIndex(p => p.product_id === product.product_id);
            if (idx !== -1) jsonDbState.products[idx] = { ...product };
            else jsonDbState.products.push({ ...product });
            saveJsonDb();
            return Promise.resolve();
        }
    },
    // Remove all products for a show (used before a full catalog refresh so
    // stale items / slot collisions do not linger).
    clearProducts: (showId) => {
        if (dbType === 'postgres') {
            return pgRun('DELETE FROM products WHERE show_id=$1', [showId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run('DELETE FROM products WHERE show_id = ?', [showId],
                    (err) => { if (err) return reject(err); resolve(); });
            });
        } else {
            jsonDbState.products = jsonDbState.products.filter(p => p.show_id !== showId);
            saveJsonDb();
            return Promise.resolve();
        }
    },

    // COORDINATES
    getCoordinates: (showId, canvasMode) => {
        const def = { show_id: showId, canvas_mode: canvasMode, container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 };
        if (dbType === 'postgres') {
            return pgQuery('SELECT * FROM coordinates WHERE show_id=$1 AND canvas_mode=$2', [showId, canvasMode])
                .then(rows => rows[0] || def);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.get("SELECT * FROM coordinates WHERE show_id = ? AND canvas_mode = ?", [showId, canvasMode], (err, row) => {
                    if (err) return reject(err);
                    resolve(row || def);
                });
            });
        } else {
            let row = jsonDbState.coordinates.find(c => c.show_id === showId && c.canvas_mode === canvasMode);
            return Promise.resolve(row || def);
        }
    },
    saveCoordinates: (coords) => {
        if (dbType === 'postgres') {
            return pgRun(
                `INSERT INTO coordinates (show_id, canvas_mode, container_top, container_left, image_scale, text_scale)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (show_id, canvas_mode) DO UPDATE SET
                   container_top=EXCLUDED.container_top, container_left=EXCLUDED.container_left,
                   image_scale=EXCLUDED.image_scale, text_scale=EXCLUDED.text_scale`,
                [coords.show_id, coords.canvas_mode, coords.container_top, coords.container_left, coords.image_scale, coords.text_scale]
            );
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(`INSERT OR REPLACE INTO coordinates (show_id, canvas_mode, container_top, container_left, image_scale, text_scale)
                              VALUES (?, ?, ?, ?, ?, ?)`,
                              [coords.show_id, coords.canvas_mode, coords.container_top, coords.container_left, coords.image_scale, coords.text_scale],
                              (err) => { if (err) return reject(err); resolve(); });
            });
        } else {
            const idx = jsonDbState.coordinates.findIndex(c => c.show_id === coords.show_id && c.canvas_mode === coords.canvas_mode);
            if (idx !== -1) jsonDbState.coordinates[idx] = { ...coords };
            else jsonDbState.coordinates.push({ ...coords });
            saveJsonDb();
            return Promise.resolve();
        }
    },

    // RUNDOWN SEGMENTS
    getRundowns: (showId) => {
        if (dbType === 'postgres') {
            return pgQuery('SELECT * FROM rundown_segments WHERE show_id=$1 ORDER BY sort_order ASC', [showId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.all("SELECT * FROM rundown_segments WHERE show_id = ? ORDER BY sort_order ASC", [showId], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        } else {
            const filtered = jsonDbState.rundown_segments.filter(r => r.show_id === showId);
            filtered.sort((a, b) => a.sort_order - b.sort_order);
            return Promise.resolve(filtered);
        }
    },
    saveRundownSegment: (seg) => {
        if (dbType === 'postgres') {
            return pgRun(
                `INSERT INTO rundown_segments
                   (segment_id, show_id, title, guest_name, guest_title, guest_handle, guest_website,
                    impact_headline, context_subline, ticker_headlines, cta_headline, cta_subline, producer_notes, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 ON CONFLICT (segment_id) DO UPDATE SET
                   title=EXCLUDED.title, guest_name=EXCLUDED.guest_name, guest_title=EXCLUDED.guest_title,
                   guest_handle=EXCLUDED.guest_handle, guest_website=EXCLUDED.guest_website,
                   impact_headline=EXCLUDED.impact_headline, context_subline=EXCLUDED.context_subline,
                   ticker_headlines=EXCLUDED.ticker_headlines, cta_headline=EXCLUDED.cta_headline,
                   cta_subline=EXCLUDED.cta_subline, producer_notes=EXCLUDED.producer_notes, sort_order=EXCLUDED.sort_order`,
                [seg.segment_id, seg.show_id, seg.title, seg.guest_name, seg.guest_title,
                 seg.guest_handle, seg.guest_website, seg.impact_headline || '', seg.context_subline || '',
                 seg.ticker_headlines, seg.cta_headline, seg.cta_subline, seg.producer_notes, seg.sort_order]
            );
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(
                    `INSERT OR REPLACE INTO rundown_segments
                       (segment_id, show_id, title, guest_name, guest_title, guest_handle, guest_website,
                        impact_headline, context_subline, ticker_headlines, cta_headline, cta_subline, producer_notes, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [seg.segment_id, seg.show_id, seg.title, seg.guest_name, seg.guest_title,
                     seg.guest_handle, seg.guest_website, seg.impact_headline || '', seg.context_subline || '',
                     seg.ticker_headlines, seg.cta_headline, seg.cta_subline, seg.producer_notes, seg.sort_order],
                    (err) => { if (err) return reject(err); resolve(); }
                );
            });
        } else {
            const idx = jsonDbState.rundown_segments.findIndex(r => r.segment_id === seg.segment_id);
            if (idx !== -1) jsonDbState.rundown_segments[idx] = { ...seg };
            else jsonDbState.rundown_segments.push({ ...seg });
            saveJsonDb();
            return Promise.resolve();
        }
    },
    deleteRundownSegment: (segmentId) => {
        if (dbType === 'postgres') {
            return pgRun('DELETE FROM rundown_segments WHERE segment_id=$1', [segmentId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run("DELETE FROM rundown_segments WHERE segment_id = ?", [segmentId], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        } else {
            jsonDbState.rundown_segments = jsonDbState.rundown_segments.filter(r => r.segment_id !== segmentId);
            saveJsonDb();
            return Promise.resolve();
        }
    },

    // CALENDAR EVENTS
    getCalendar: (showId) => {
        if (dbType === 'postgres') {
            return pgQuery('SELECT * FROM calendar_events WHERE show_id=$1 ORDER BY event_date ASC', [showId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.all("SELECT * FROM calendar_events WHERE show_id = ? ORDER BY event_date ASC", [showId], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        } else {
            const filtered = jsonDbState.calendar_events.filter(c => c.show_id === showId);
            filtered.sort((a, b) => a.event_date.localeCompare(b.event_date));
            return Promise.resolve(filtered);
        }
    },
    saveCalendarEvent: (event) => {
        if (dbType === 'postgres') {
            return pgRun(
                `INSERT INTO calendar_events (event_id, show_id, event_date, title, description)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (event_id) DO UPDATE SET event_date=EXCLUDED.event_date, title=EXCLUDED.title, description=EXCLUDED.description`,
                [event.event_id, event.show_id, event.event_date, event.title, event.description]
            );
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(`INSERT OR REPLACE INTO calendar_events (event_id, show_id, event_date, title, description)
                              VALUES (?, ?, ?, ?, ?)`,
                              [event.event_id, event.show_id, event.event_date, event.title, event.description],
                              (err) => { if (err) return reject(err); resolve(); });
            });
        } else {
            const idx = jsonDbState.calendar_events.findIndex(c => c.event_id === event.event_id);
            if (idx !== -1) jsonDbState.calendar_events[idx] = { ...event };
            else jsonDbState.calendar_events.push({ ...event });
            saveJsonDb();
            return Promise.resolve();
        }
    },
    deleteCalendarEvent: (eventId) => {
        if (dbType === 'postgres') {
            return pgRun('DELETE FROM calendar_events WHERE event_id=$1', [eventId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run("DELETE FROM calendar_events WHERE event_id = ?", [eventId], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        } else {
            jsonDbState.calendar_events = jsonDbState.calendar_events.filter(c => c.event_id !== eventId);
            saveJsonDb();
            return Promise.resolve();
        }
    },

    // SHOW BRIEFS
    getBriefs: (showId) => {
        if (dbType === 'postgres') {
            return pgQuery('SELECT * FROM show_briefs WHERE show_id=$1 ORDER BY brief_date DESC', [showId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.all("SELECT * FROM show_briefs WHERE show_id = ? ORDER BY brief_date DESC", [showId], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        } else {
            const filtered = jsonDbState.show_briefs.filter(b => b.show_id === showId);
            filtered.sort((a, b) => b.brief_date.localeCompare(a.brief_date));
            return Promise.resolve(filtered);
        }
    },
    saveBrief: (brief) => {
        if (dbType === 'postgres') {
            return pgRun(
                `INSERT INTO show_briefs (brief_id, show_id, brief_date, objective, talking_points)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (brief_id) DO UPDATE SET brief_date=EXCLUDED.brief_date, objective=EXCLUDED.objective, talking_points=EXCLUDED.talking_points`,
                [brief.brief_id, brief.show_id, brief.brief_date, brief.objective, brief.talking_points]
            );
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run(`INSERT OR REPLACE INTO show_briefs (brief_id, show_id, brief_date, objective, talking_points)
                              VALUES (?, ?, ?, ?, ?)`,
                              [brief.brief_id, brief.show_id, brief.brief_date, brief.objective, brief.talking_points],
                              (err) => { if (err) return reject(err); resolve(); });
            });
        } else {
            const idx = jsonDbState.show_briefs.findIndex(b => b.brief_id === brief.brief_id);
            if (idx !== -1) jsonDbState.show_briefs[idx] = { ...brief };
            else jsonDbState.show_briefs.push({ ...brief });
            saveJsonDb();
            return Promise.resolve();
        }
    },
    deleteBrief: (briefId) => {
        if (dbType === 'postgres') {
            return pgRun('DELETE FROM show_briefs WHERE brief_id=$1', [briefId]);
        } else if (dbType === 'sqlite') {
            return new Promise((resolve, reject) => {
                sqliteDb.run("DELETE FROM show_briefs WHERE brief_id = ?", [briefId], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        } else {
            jsonDbState.show_briefs = jsonDbState.show_briefs.filter(b => b.brief_id !== briefId);
            saveJsonDb();
            return Promise.resolve();
        }
    }
};

module.exports = {
    initDb,
    db
};
