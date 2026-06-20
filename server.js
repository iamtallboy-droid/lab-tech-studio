// server.js — Lab Tech Studio Hub Server (Phase 2)
// Production-grade: Redis overlay state, WebSocket heartbeat, PostgreSQL,
// transcoder retry queue, Community Hub API

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');

const { initDb, db } = require('./db');
const { addToQueue, getTranscoderStatus, setBroadcastCallback } = require('./transcoder');
const { runStorefrontScrape, startBackgroundScraper, stopAllScrapers } = require('./scraper');
const { initRedis, cacheGet, cacheSet, flushPrefix, getRedisStatus } = require('./redis-client');

const PORT = parseInt(process.env.PORT || '7335', 10);
const VMIX_HOST = process.env.VMIX_HOST || '127.0.0.1';
const VMIX_PORT = process.env.VMIX_PORT || '8088';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Multer setup for uploads
const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 300 * 1024 * 1024 } // 300 MB limit
});

// Serve frontend assets
app.use(express.static(__dirname));
app.use('/transcoded', express.static(path.join(__dirname, 'transcoded')));

// Active broadcast state in memory
let broadcastState = {
    activeShowId: 'lab_tech_show',
    activeAiredSegmentId: null,
    activeLiveCoords: {},
    lastAdminCoordTime: 0
};

const serverStartTime = Date.now();

// WebSocket client tracking
// ws -> { role, showId, isAlive, lastPingSent }
const clients = new Map();

// ================================================================
// WEBSOCKET HEARTBEAT ENGINE
// ================================================================
const HEARTBEAT_INTERVAL_MS = 20000; // ping every 20 seconds
const PONG_TIMEOUT_MS = 5000;        // disconnect if no pong in 5s

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        const info = clients.get(ws);
        if (!info) return;

        if (info.isAlive === false) {
            // Client did not respond to last ping — disconnect
            console.warn(`WS HEARTBEAT: Client [${info.role}/${info.showId}] timed out — terminating.`);
            clients.delete(ws);
            return ws.terminate();
        }

        // Mark as not alive until PONG is received
        info.isAlive = false;
        clients.set(ws, info);

        try {
            ws.send(JSON.stringify({ type: 'PING', payload: { ts: Date.now() } }));
        } catch (e) {
            clients.delete(ws);
            ws.terminate();
        }
    });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeatInterval));

// ================================================================
// WEBSOCKET CONNECTION HANDLER
// ================================================================
wss.on('connection', (ws) => {
    clients.set(ws, { role: 'viewer', showId: 'lab_tech_show', isAlive: true });
    console.log(`WS: Client connected. Total clients: ${clients.size}`);

    // Send initial state (check Redis first)
    sendStateUpdate(ws);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const clientInfo = clients.get(ws);

            switch (data.type) {
                case 'PONG':
                    // Mark client as alive after receiving pong
                    if (clientInfo) {
                        clientInfo.isAlive = true;
                        clients.set(ws, clientInfo);
                    }
                    break;

                case 'REGISTER':
                    if (clientInfo) {
                        clientInfo.role = data.payload?.role || data.role || 'viewer';
                        clientInfo.showId = data.payload?.showId || data.showId || 'lab_tech_show';
                        clientInfo.isAlive = true;
                        clients.set(ws, clientInfo);
                        console.log(`WS: Client registered as [${clientInfo.role}] for show [${clientInfo.showId}]`);
                    }
                    sendStateUpdate(ws);
                    break;

                case 'COORDINATES_UPDATE':
                    await handleCoordinatesUpdate(ws, data.payload);
                    break;

                case 'AIR_SEGMENT_TOGGLE':
                    broadcastState.activeAiredSegmentId = data.payload.segmentId;
                    broadcastToAll({
                        type: 'STATE_CHANGE',
                        payload: { activeAiredSegmentId: broadcastState.activeAiredSegmentId }
                    });
                    break;

                case 'LOWER_THIRD_UPDATE':
                    // Push live lower third headline update to all overlays
                    broadcastState.activeLowerThird = data.payload;
                    broadcastToAll({ type: 'LOWER_THIRD_LIVE', payload: data.payload });
                    break;

                case 'FEATURE_PRODUCT':
                    // Spotlight a specific merch product on all overlays
                    broadcastState.activeFeaturedProduct = data.payload;
                    broadcastToAll({ type: 'FEATURE_PRODUCT', payload: data.payload });
                    break;

                case 'CTA_FLYIN':
                    // Fly a CTA card in (or hide it) on all overlays
                    broadcastToAll({ type: 'CTA_FLYIN', payload: data.payload });
                    break;

                case 'FORCE_STATE_REFRESH':
                    sendStateUpdate(ws);
                    break;
            }
        } catch (err) {
            console.error('WS: Message processing error:', err);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`WS: Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
        console.warn('WS: Socket error:', err.message);
        clients.delete(ws);
    });
});

// ================================================================
// COORDINATES UPDATE HANDLER (with Redis state persistence)
// ================================================================
async function handleCoordinatesUpdate(ws, payload) {
    const { showId, canvasMode, containerTop, containerLeft, imageScale, textScale, role, timestamp } = payload;
    const key = `${showId}_${canvasMode}`;
    const redisKey = `overlay_state:${showId}:${canvasMode}`;
    const now = Date.now();

    if (role === 'admin') {
        broadcastState.lastAdminCoordTime = now;

        const coordData = {
            container_top: containerTop,
            container_left: containerLeft,
            image_scale: imageScale,
            text_scale: textScale
        };

        // 1. In-memory live state
        broadcastState.activeLiveCoords[key] = coordData;

        // 2. Redis cache (24-hour TTL)
        await cacheSet(redisKey, coordData, 86400);

        // 3. Persistent DB
        await db.saveCoordinates({
            show_id: showId,
            canvas_mode: canvasMode,
            container_top: containerTop,
            container_left: containerLeft,
            image_scale: imageScale,
            text_scale: textScale
        });

        broadcastToAll({
            type: 'COORDINATES_CHANGE',
            payload: { showId, canvasMode, containerTop, containerLeft, imageScale, textScale, isLiveOnly: false }
        });

    } else if (role === 'producer') {
        // Conflict check: Admin has priority within 500ms window
        if (now - broadcastState.lastAdminCoordTime < 500) {
            console.warn(`WS: Conflict! Discarding Co-Host packet — Admin priority win.`);
            ws.send(JSON.stringify({
                type: 'BENCH_OVERRIDE_WARNING',
                payload: { message: 'Bench Override: Primary Admin Host has priority control.' }
            }));

            const dbCoords = await db.getCoordinates(showId, canvasMode);
            ws.send(JSON.stringify({
                type: 'COORDINATES_CHANGE',
                payload: {
                    showId, canvasMode,
                    containerTop: dbCoords.container_top,
                    containerLeft: dbCoords.container_left,
                    imageScale: dbCoords.image_scale,
                    textScale: dbCoords.text_scale,
                    isLiveOnly: false
                }
            }));
            return;
        }

        // Live-only update (does not write DB preset)
        broadcastState.activeLiveCoords[key] = {
            container_top: containerTop,
            container_left: containerLeft,
            image_scale: imageScale,
            text_scale: textScale
        };

        broadcastToAll({
            type: 'COORDINATES_CHANGE',
            payload: { showId, canvasMode, containerTop, containerLeft, imageScale, textScale, isLiveOnly: true }
        });
    }
}

// ================================================================
// SEND FULL STATE TO CLIENT (Redis-first, DB fallback)
// ================================================================
async function sendStateUpdate(ws) {
    // Every client (overlay viewers especially) should reflect the ACTIVE show,
    // so the broadcast follows whatever the admin has on air.
    const showId = broadcastState.activeShowId || 'lab_tech_show';

    try {
        const show = (await db.getShows()).find(s => s.show_id === showId) || { show_id: showId };
        const products = await db.getProducts(showId);

        // Attempt to load latest overlay coords from Redis
        for (const mode of ['horizontal', 'vertical']) {
            const redisKey = `overlay_state:${showId}:${mode}`;
            const cached = await cacheGet(redisKey);
            if (cached && !broadcastState.activeLiveCoords[`${showId}_${mode}`]) {
                broadcastState.activeLiveCoords[`${showId}_${mode}`] = cached;
            }
        }

        ws.send(JSON.stringify({
            type: 'FULL_STATE',
            payload: {
                activeShowId: broadcastState.activeShowId,
                activeAiredSegmentId: broadcastState.activeAiredSegmentId,
                showConfig: show,
                productsList: products,
                liveCoords: broadcastState.activeLiveCoords,
                activeLowerThird: broadcastState.activeLowerThird || null
            }
        }));
    } catch (err) {
        console.error('WS: Failed to send full state update:', err);
    }
}

// ================================================================
// BROADCAST TO ALL CONNECTED CLIENTS
// ================================================================
function broadcastToAll(message) {
    const payloadStr = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(payloadStr); } catch {}
        }
    });
}

// Connect transcoder status broadcast
setBroadcastCallback((message) => broadcastToAll(message));

// HTTP → WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/sync') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// ================================================================
// REST API: SHOWS
// ================================================================
app.get('/api/shows', async (req, res) => {
    try { res.json(await db.getShows()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows', async (req, res) => {
    try {
        const show = req.body;
        await db.saveShow(show);
        await db.saveCoordinates({ show_id: show.show_id, canvas_mode: 'horizontal', container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 });
        await db.saveCoordinates({ show_id: show.show_id, canvas_mode: 'vertical', container_top: 50, container_left: 50, image_scale: 100, text_scale: 100 });
        await db.saveProduct({ product_id: `override-${show.show_id}-1`, show_id: show.show_id, title: `${show.brand_name} Mug`, price: '$19.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us', is_evergreen: 1, slot_index: 5 });
        await db.saveProduct({ product_id: `override-${show.show_id}-2`, show_id: show.show_id, title: `${show.brand_name} Tee`, price: '$29.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us', is_evergreen: 1, slot_index: 6 });
        await runStorefrontScrape(show.show_id);
        broadcastToAll({ type: 'SHOWS_UPDATED' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shows/:id', async (req, res) => {
    try {
        await db.deleteShow(req.params.id);
        broadcastToAll({ type: 'SHOWS_UPDATED' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows/active', async (req, res) => {
    const { showId } = req.body;
    broadcastState.activeShowId = showId;
    broadcastState.activeAiredSegmentId = null;
    broadcastToAll({ type: 'STATE_CHANGE', payload: { activeShowId: showId, activeAiredSegmentId: null } });
    res.json({ success: true });
});

// ================================================================
// REST API: PRODUCTS
// ================================================================
app.get('/api/shows/:id/products', async (req, res) => {
    try { res.json(await db.getProducts(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows/:id/products', async (req, res) => {
    try {
        const product = { ...req.body, show_id: req.params.id };
        await db.saveProduct(product);
        broadcastToAll({ type: 'PRODUCTS_UPDATED', showId: req.params.id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: COORDINATES
// ================================================================
app.get('/api/shows/:id/coordinates/:mode', async (req, res) => {
    try { res.json(await db.getCoordinates(req.params.id, req.params.mode)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: RUNDOWNS
// ================================================================
app.get('/api/shows/:id/rundowns', async (req, res) => {
    try { res.json(await db.getRundowns(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows/:id/rundowns', async (req, res) => {
    try {
        const seg = { ...req.body, show_id: req.params.id };
        await db.saveRundownSegment(seg);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shows/:id/rundowns/:segId', async (req, res) => {
    try {
        await db.deleteRundownSegment(req.params.segId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: CALENDAR
// ================================================================
app.get('/api/shows/:id/calendar', async (req, res) => {
    try { res.json(await db.getCalendar(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows/:id/calendar', async (req, res) => {
    try {
        const event = { ...req.body, show_id: req.params.id };
        await db.saveCalendarEvent(event);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shows/:id/calendar/:eventId', async (req, res) => {
    try {
        await db.deleteCalendarEvent(req.params.eventId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: BRIEFS
// ================================================================
app.get('/api/shows/:id/briefs', async (req, res) => {
    try { res.json(await db.getBriefs(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shows/:id/briefs', async (req, res) => {
    try {
        const brief = { ...req.body, show_id: req.params.id };
        await db.saveBrief(brief);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shows/:id/briefs/:briefId', async (req, res) => {
    try {
        await db.deleteBrief(req.params.briefId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: SCRAPER
// ================================================================
app.post('/api/shows/:id/scrape', async (req, res) => {
    const { username, password } = req.body;
    try {
        const products = await runStorefrontScrape(req.params.id, username, password);
        broadcastToAll({ type: 'PRODUCTS_UPDATED', showId: req.params.id });
        res.json({ success: true, products });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// REST API: TRANSCODER
// ================================================================
app.post('/api/transcode', upload.single('mediaFile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No media file uploaded.' });

    const fileId = Date.now().toString();
    const job = addToQueue(fileId, req.file.originalname, req.file.path);

    res.json({
        success: true,
        message: 'File uploaded and transcoding task initialized.',
        job: { id: job.id, filename: job.filename, status: job.status, progress: job.progress }
    });
});

app.get('/api/transcoder-status', (req, res) => {
    res.json(getTranscoderStatus());
});

// ================================================================
// REST API: vMIX PROXY
// ================================================================
app.post('/api/vmix/audio-gate', async (req, res) => {
    const { guestId, mute } = req.body;
    const muteVal = mute ? 'On' : 'Off';
    const vmixUrl = `http://${VMIX_HOST}:${VMIX_PORT}/API/?Function=AudioBusMute&Input=${guestId}&Mute=${muteVal}`;

    try {
        await axios.get(vmixUrl, { timeout: 2000 });
        res.json({ success: true, message: 'vMix audio bus mute command fired.' });
    } catch (err) {
        console.warn(`VMIX PROXY: Could not connect (${err.message})`);
        res.json({ success: false, error: 'vMix connection failed.' });
    }
});

app.post('/api/vmix/push-url', async (req, res) => {
    const { browserInputId, valueUrl } = req.body;
    const vmixUrl = `http://${VMIX_HOST}:${VMIX_PORT}/API/?Function=SetUrl&Input=${browserInputId}&Value=${encodeURIComponent(valueUrl)}`;

    try {
        await axios.get(vmixUrl, { timeout: 2000 });
        res.json({ success: true, message: 'vMix SetUrl command fired.' });
    } catch (err) {
        console.warn(`VMIX PROXY: SetUrl failed (${err.message})`);
        res.json({ success: false, error: 'vMix connection failed.' });
    }
});

// ================================================================
// REST API: COMMUNITY HUB STATUS
// ================================================================
app.get('/api/community/status', (req, res) => {
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSecs = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSecs / 3600);
    const mins = Math.floor((uptimeSecs % 3600) / 60);
    const secs = uptimeSecs % 60;

    const clientCounts = { admin: 0, producer: 0, viewer: 0 };
    clients.forEach((info) => {
        if (info.role in clientCounts) clientCounts[info.role]++;
        else clientCounts.viewer++;
    });

    res.json({
        status: 'online',
        activeShowId: broadcastState.activeShowId,
        activeAiredSegmentId: broadcastState.activeAiredSegmentId,
        totalClients: clients.size,
        clientBreakdown: clientCounts,
        uptime: `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`,
        uptimeMs,
        redis: getRedisStatus(),
        transcoderQueue: getTranscoderStatus().queueLength,
        serverTime: new Date().toISOString()
    });
});

// Redis cache flush (admin action)
app.post('/api/community/flush-cache', async (req, res) => {
    try {
        await flushPrefix('overlay_state:');
        res.json({ success: true, message: 'Overlay state cache cleared.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Force reconnect all clients
app.post('/api/community/reconnect-all', (req, res) => {
    broadcastToAll({ type: 'FORCE_RECONNECT', payload: { message: 'Server initiated reconnect.' } });
    res.json({ success: true, message: `Reconnect signal sent to ${clients.size} clients.` });
});

// Restart scraper for a show
app.post('/api/community/restart-scraper', async (req, res) => {
    const { showId } = req.body;
    try {
        await runStorefrontScrape(showId);
        broadcastToAll({ type: 'PRODUCTS_UPDATED', showId });
        res.json({ success: true, message: `Scraper restarted for [${showId}].` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================================================================
// SERVER INITIALIZATION
// ================================================================
async function startServer() {
    // 1. Connect to Redis (with in-memory fallback)
    await initRedis();

    // 2. Initialize Database (PostgreSQL or SQLite fallback)
    await initDb();

    // 3. Start Fourthwall background scrapers (sequential initial seed so we
    //    don't fire 90+ concurrent storefront requests on boot).
    const shows = await db.getShows();
    for (const show of shows) {
        try { await runStorefrontScrape(show.show_id); }
        catch (err) { console.error(`SCRAPER: initial seed failed for ${show.show_id}:`, err.message); }
    }
    shows.forEach(show => startBackgroundScraper(show.show_id, null, null, false));

    // 4. Listen
    server.listen(PORT, '127.0.0.1', () => {
        console.log('\n  =====================================================');
        console.log('   Lab Tech Studio Hub — Production Server v2.0       ');
        console.log('  =====================================================');
        console.log(`\n  Listening on  http://localhost:${PORT}`);
        console.log('\n  Control Dashboard:');
        console.log(`    http://localhost:${PORT}/dashboard.html`);
        console.log('\n  vMix Browser Overlay Input:');
        console.log(`    http://localhost:${PORT}/overlay.html`);
        console.log('\n  Community Status API:');
        console.log(`    http://localhost:${PORT}/api/community/status`);
        console.log('\n  WebSocket Heartbeat: 20s ping/pong enabled');
        console.log(`  Redis: ${getRedisStatus().mode}`);
        console.log('  Transcoder: 3-retry queue with exponential back-off\n');
    });
}

startServer().catch(err => {
    console.error('SERVER INIT ERROR:', err);
    process.exit(1);
});
