// Labtechshow Studio Overlays - App State Coordination Layer
// Handles API calls, WebSocket synchronization, BroadcastChannel local fallbacks, and role management.

let activeShowId = 'lab_tech_show';
let activeAiredSegmentId = null;
let currentRole = 'admin'; // 'admin' (Admin Host), 'producer' (Co-Host/Floor General), 'viewer' (Overlay)
let currentUser = {
    email: 'iamtallboy@gmail.com',
    handle: '@IamTallboy',
    name: 'Corey "Tall Boy" Sanders'
};

let showsList = [];
let productsList = [];
let currentCoords = { container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 };
let activeLiveCoords = {}; // In-memory coordinates sent from websocket or broadcast channel

// WebSocket connection state
let socket = null;
const SYNC_PORT = 7335;
let wsUrl = `ws://${window.location.hostname || 'localhost'}:${SYNC_PORT}/sync`;
let reconnectTimer = null;
let reconnectDelay = 1500;      // starts at 1.5s
const RECONNECT_MAX_MS = 30000; // caps at 30s

// Local Fallback Broadcast Channel (used if WebSockets are down)
const fallbackChannel = new BroadcastChannel('labtech-studio-overlay-fallback-sync');

let onStateUpdateCallback = null;
let onCoordsUpdateCallback = null;
let onTranscoderCallback = null;
let onWarningCallback = null;

// Default Presets for local replication fallback
const LOCAL_DEFAULT_SHOWS = [
    {
        show_id: 'lab_tech_show',
        brand_name: 'The Lab Tech Show',
        primary_hex: '#0F6FFF',
        secondary_hex: '#00A8FF',
        font_family: 'Inter',
        hosts: [
            { name: 'Corey "Tall Boy" Sanders', handle: '@IamTallboy', role: 'Host' },
            { name: 'Revis Brown', handle: '@IamRevisBrown', role: 'Co-Host' }
        ]
    },
    {
        show_id: 'tall_boy_experience',
        brand_name: 'The Tall Boy Experience',
        primary_hex: '#000000',
        secondary_hex: '#1D1D1D',
        font_family: 'Days One',
        hosts: [
            { name: 'Corey "Tall Boy" Sanders', handle: '@IamTallboy', role: 'Host' },
            { name: 'Revis Brown', handle: '@IamRevisBrown', role: 'Co-Host' }
        ]
    }
];

const LOCAL_DEFAULT_PRODUCTS = [
    { product_id: 'lt-evergreen-1', show_id: 'lab_tech_show', title: 'Lab Tech Studio Mug', price: '$19.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us/products/mug', is_evergreen: 1, slot_index: 5 },
    { product_id: 'lt-evergreen-2', show_id: 'lab_tech_show', title: 'Lab Tech Hoodie', price: '$54.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us/products/hoodie', is_evergreen: 1, slot_index: 6 },
    { product_id: 'tbe-evergreen-1', show_id: 'tall_boy_experience', title: 'TBE Cinematic Cap', price: '$24.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/cap', is_evergreen: 1, slot_index: 5 },
    { product_id: 'tbe-evergreen-2', show_id: 'tall_boy_experience', title: 'TBE Blackout Tee', price: '$29.99', image_url: 'logo.svg', checkout_url: 'https://shop.tallboy.us/products/tee', is_evergreen: 1, slot_index: 6 }
];

// Initialize state
function initAppState(role = 'admin') {
    // Load cached roles/auth if any
    const cachedRole = localStorage.getItem('labtech_current_role');
    const cachedUser = localStorage.getItem('labtech_current_user');
    const cachedShowId = localStorage.getItem('labtech_active_show_id');

    if (cachedRole) currentRole = cachedRole;
    if (cachedUser) currentUser = JSON.parse(cachedUser);
    if (cachedShowId) activeShowId = cachedShowId;

    // Connect WebSocket and local Broadcast fallback listeners
    connectWebSocket();
    setupLocalBroadcastFallback();
}

// -------------------------------------------------------------
// WEBSOCKET & BROADCAST FALLBACK SYNC ENGINE
// -------------------------------------------------------------
function connectWebSocket() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        return;
    }

    console.log(`WS: Connecting to sync server at ${wsUrl}...`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("WS: Connection established. Reconnect delay reset.");
        reconnectDelay = 1500; // reset backoff on successful connect
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // Register client details
        sendWSMessage('REGISTER', {
            role: currentRole,
            showId: activeShowId
        });
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleIncomingMessage(msg);
        } catch (err) {
            console.error("WS: Client parsing error:", err);
        }
    };

    socket.onclose = () => {
        console.warn(`WS: Connection closed. Reconnecting in ${reconnectDelay}ms...`);
        socket = null;
        triggerReconnect();
        triggerLocalFallbackState();
    };

    socket.onerror = (err) => {
        console.error("WS: Socket error:", err);
        socket.close();
    };
}

function setupLocalBroadcastFallback() {
    fallbackChannel.onmessage = (event) => {
        // Only process fallback channel messages if the WebSocket is disconnected
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            try {
                handleIncomingMessage(event.data);
            } catch (err) {
                console.error("Local Sync: Parse error:", err);
            }
        }
    };
}

function triggerLocalFallbackState() {
    console.log("Local Sync: Performing local state fallback extraction...");
    
    // Simulate FULL_STATE event from local storage cache
    api.fetchShows().then(shows => {
        showsList = shows;
        const show = shows.find(s => s.show_id === activeShowId) || { show_id: activeShowId };
        
        api.fetchProducts(activeShowId).then(products => {
            productsList = products;
            
            const mode = getCanvasMode();
            const liveKey = `${activeShowId}_${mode}`;
            
            // Get local coordinates cache
            const cachedCoords = localStorage.getItem(`labtech_coords_${liveKey}`);
            if (cachedCoords) {
                currentCoords = JSON.parse(cachedCoords);
            } else {
                currentCoords = { container_top: 85, container_left: 5, image_scale: 100, text_scale: 100 };
            }

            const statePayload = {
                activeShowId: activeShowId,
                activeAiredSegmentId: activeAiredSegmentId,
                showConfig: show,
                productsList: productsList,
                liveCoords: { [liveKey]: currentCoords }
            };

            if (onStateUpdateCallback) {
                onStateUpdateCallback(statePayload);
            }
        });
    });
}

function handleIncomingMessage(msg) {
    switch (msg.type) {
        case 'PONG':
            // Server acknowledged our ping — connection is healthy
            // (No action needed; server manages the isAlive flag)
            break;

        case 'PING':
            // Server sent heartbeat ping — respond immediately with PONG
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PONG', payload: { ts: Date.now() } }));
            }
            break;

        case 'FULL_STATE':
            activeShowId = msg.payload.activeShowId;
            activeAiredSegmentId = msg.payload.activeAiredSegmentId;
            activeLiveCoords = msg.payload.liveCoords || {};
            productsList = msg.payload.productsList || [];
            
            const mode = getCanvasMode();
            const liveKey = `${activeShowId}_${mode}`;
            if (activeLiveCoords[liveKey]) {
                currentCoords = activeLiveCoords[liveKey];
            } else if (msg.payload.showConfig) {
                currentCoords = {
                    container_top: 85,
                    container_left: 5,
                    image_scale: 100,
                    text_scale: 100
                };
            }

            if (onStateUpdateCallback) {
                onStateUpdateCallback(msg.payload);
            }
            break;

        case 'COORDINATES_CHANGE':
            const payload = msg.payload;
            const activeMode = getCanvasMode();
            const key = `${payload.showId}_${payload.canvasMode}`;
            
            activeLiveCoords[key] = {
                container_top: payload.containerTop,
                container_left: payload.containerLeft,
                image_scale: payload.imageScale,
                text_scale: payload.textScale
            };

            // Cache coordinates locally
            localStorage.setItem(`labtech_coords_${key}`, JSON.stringify(activeLiveCoords[key]));

            if (payload.showId === activeShowId && payload.canvasMode === activeMode) {
                currentCoords = activeLiveCoords[key];
                if (onCoordsUpdateCallback) {
                    onCoordsUpdateCallback(payload);
                }
            }
            break;

        case 'STATE_CHANGE':
            if (msg.payload.activeShowId) {
                activeShowId = msg.payload.activeShowId;
                localStorage.setItem('labtech_active_show_id', activeShowId);
            }
            activeAiredSegmentId = msg.payload.activeAiredSegmentId;
            refreshState();
            break;

        case 'LOWER_THIRD_LIVE':
            // Live lower third update from server — propagate to registered callback
            if (onWarningCallback) {
                // Reuse warning callback channel with a special type prefix
                onWarningCallback({ type: 'LOWER_THIRD_LIVE', payload: msg.payload });
            }
            // Fire dedicated lower third handler if registered
            if (typeof window.onLowerThirdLive === 'function') {
                window.onLowerThirdLive(msg.payload);
            }
            break;

        case 'FORCE_RECONNECT':
            console.warn('WS: Server requested force reconnect.');
            if (socket) { socket.close(); }
            break;

        case 'BENCH_OVERRIDE_WARNING':
            if (onWarningCallback) {
                onWarningCallback(msg.payload.message);
            }
            break;

        case 'TRANSCODER_UPDATE':
            if (onTranscoderCallback) {
                onTranscoderCallback(msg.payload);
            }
            break;
    }
}

function triggerReconnect() {
    if (reconnectTimer) return; // already scheduled

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();

        // Exponential back-off: double delay, cap at max
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }, reconnectDelay);

    console.log(`WS: Reconnect scheduled in ${reconnectDelay}ms`);
}

function sendWSMessage(type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
    } else {
        // WebSocket disconnected: Broadcast locally to other tabs
        const localMsg = { type, payload };
        fallbackChannel.postMessage(localMsg);
        
        // Handle coordinates update locally
        if (type === 'COORDINATES_UPDATE') {
            handleIncomingMessage({
                type: 'COORDINATES_CHANGE',
                payload: {
                    showId: payload.showId,
                    canvasMode: payload.canvasMode,
                    containerTop: payload.containerTop,
                    containerLeft: payload.containerLeft,
                    imageScale: payload.imageScale,
                    textScale: payload.textScale,
                    role: payload.role,
                    isLiveOnly: false
                }
            });
        }
        if (type === 'AIR_SEGMENT_TOGGLE') {
            activeAiredSegmentId = payload.segmentId;
            handleIncomingMessage({
                type: 'STATE_CHANGE',
                payload: {
                    activeAiredSegmentId: payload.segmentId
                }
            });
        }
    }
}

function getCanvasMode() {
    const viewport = document.getElementById('preview-viewport') || document.getElementById('overlay-canvas');
    if (viewport) {
        if (viewport.classList.contains('vertical') || viewport.style.aspectRatio === '9/16') {
            return 'vertical';
        }
    }
    return localStorage.getItem('labtech_canvas_mode') || 'horizontal';
}

function refreshState() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendWSMessage('FORCE_STATE_REFRESH', {});
    } else {
        triggerLocalFallbackState();
    }
}

// -------------------------------------------------------------
// USER SIGN IN & ROLE SELECTION
// -------------------------------------------------------------
function loginUser(email) {
    if (email === 'iamtallboy@gmail.com' || email === '@IamTallboy') {
        currentRole = 'admin';
        currentUser = { email: 'iamtallboy@gmail.com', handle: '@IamTallboy', name: 'Corey "Tall Boy" Sanders' };
    } else if (email === 'iamrevisbrown@gmail.com' || email === '@IamRevisBrown') {
        currentRole = 'producer';
        currentUser = { email: 'iamrevisbrown@gmail.com', handle: '@IamRevisBrown', name: 'Revis Brown' };
    } else {
        currentRole = 'producer';
        currentUser = { email: email, handle: '@GuestProducer', name: email.split('@')[0] };
    }

    localStorage.setItem('labtech_current_role', currentRole);
    localStorage.setItem('labtech_current_user', JSON.stringify(currentUser));

    sendWSMessage('REGISTER', {
        role: currentRole,
        showId: activeShowId
    });
}

function logoutUser() {
    currentRole = 'viewer';
    currentUser = { email: '', handle: '@Viewer', name: 'Guest Viewer' };
    localStorage.setItem('labtech_current_role', currentRole);
    localStorage.setItem('labtech_current_user', JSON.stringify(currentUser));
    
    sendWSMessage('REGISTER', {
        role: currentRole,
        showId: activeShowId
    });
}

function updatePositionCoordinates(containerTop, containerLeft, imageScale, textScale) {
    currentCoords = {
        container_top: containerTop,
        container_left: containerLeft,
        image_scale: imageScale,
        text_scale: textScale
    };

    const mode = getCanvasMode();
    const key = `${activeShowId}_${mode}`;
    activeLiveCoords[key] = currentCoords;

    sendWSMessage('COORDINATES_UPDATE', {
        showId: activeShowId,
        canvasMode: mode,
        containerTop,
        containerLeft,
        imageScale,
        textScale,
        role: currentRole,
        timestamp: Date.now()
    });
}

// -------------------------------------------------------------
// RESILIENT CLIENT LOCAL STORAGE FALLBACK API WRAPPERS
// -------------------------------------------------------------

// Local storage helper
function getLocalItem(key, defaultValue) {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
}

function setLocalItem(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

const api = {
    // Shows CRUD
    fetchShows: async () => {
        try {
            const res = await fetch('/api/shows');
            if (res.status === 200) {
                const data = await res.json();
                setLocalItem('local_shows_db', data);
                return data;
            }
        } catch (e) {
            console.warn("API: fetchShows failed. Loading from localStorage fallback...");
        }
        return getLocalItem('local_shows_db', LOCAL_DEFAULT_SHOWS);
    },
    createShow: async (showData) => {
        try {
            const res = await fetch('/api/shows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(showData)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: createShow failed. Saving to localStorage fallback...");
        }
        const shows = getLocalItem('local_shows_db', LOCAL_DEFAULT_SHOWS);
        const idx = shows.findIndex(s => s.show_id === showData.show_id);
        if (idx !== -1) shows[idx] = showData;
        else shows.push(showData);
        setLocalItem('local_shows_db', shows);
        return { success: true };
    },
    deleteShow: async (showId) => {
        try {
            const res = await fetch(`/api/shows/${showId}`, { method: 'DELETE' });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: deleteShow failed. Deleting in localStorage fallback...");
        }
        let shows = getLocalItem('local_shows_db', LOCAL_DEFAULT_SHOWS);
        shows = shows.filter(s => s.show_id !== showId);
        setLocalItem('local_shows_db', shows);
        return { success: true };
    },
    setActiveShow: async (showId) => {
        try {
            const res = await fetch('/api/shows/active', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showId })
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: setActiveShow failed. Switching active ID locally...");
        }
        activeShowId = showId;
        localStorage.setItem('labtech_active_show_id', showId);
        return { success: true };
    },

    // Products CRUD
    fetchProducts: async (showId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/products`);
            if (res.status === 200) {
                const data = await res.json();
                setLocalItem(`local_products_db_${showId}`, data);
                return data;
            }
        } catch (e) {
            console.warn("API: fetchProducts failed. Loading from localStorage...");
        }
        return getLocalItem(`local_products_db_${showId}`, LOCAL_DEFAULT_PRODUCTS.filter(p => p.show_id === showId));
    },
    saveProduct: async (showId, product) => {
        try {
            const res = await fetch(`/api/shows/${showId}/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(product)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: saveProduct failed. Saving locally...");
        }
        const products = getLocalItem(`local_products_db_${showId}`, LOCAL_DEFAULT_PRODUCTS.filter(p => p.show_id === showId));
        const idx = products.findIndex(p => p.product_id === product.product_id);
        if (idx !== -1) products[idx] = product;
        else products.push(product);
        setLocalItem(`local_products_db_${showId}`, products);
        return { success: true };
    },
    triggerScrape: async (showId, credentials = {}) => {
        try {
            const res = await fetch(`/api/shows/${showId}/scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: Scraper connection failed. Mocking storefront response...");
        }
        // Mock scrape products locally
        const mockCatalog = [
            { product_id: 'fw-prod-1', show_id: showId, title: 'Tall Boy Premium Hoodie', price: '$59.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us', slot_index: 0 },
            { product_id: 'fw-prod-2', show_id: showId, title: 'Lab Tech Glow Mousepad', price: '$29.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us', slot_index: 1 },
            { product_id: 'fw-prod-3', show_id: showId, title: 'Studio Neon Desk Light', price: '$39.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us', slot_index: 2 },
            { product_id: 'fw-prod-4', show_id: showId, title: 'Broadcast Tech Tee', price: '$24.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us', slot_index: 3 },
            { product_id: 'fw-prod-5', show_id: showId, title: 'Evergreen Premium Mug', price: '$14.99', image_url: 'logo.png', checkout_url: 'https://shop.tallboy.us', slot_index: 4 }
        ];
        setLocalItem(`local_products_db_${showId}`, mockCatalog);
        return { success: true, products: mockCatalog };
    },

    // Rundowns API
    fetchRundowns: async (showId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/rundowns`);
            if (res.status === 200) {
                const data = await res.json();
                setLocalItem(`local_rundowns_${showId}`, data);
                return data;
            }
        } catch (e) {
            console.warn("API: fetchRundowns failed. Using local storage...");
        }
        return getLocalItem(`local_rundowns_${showId}`, [
            {
                segment_id: 'seg-1',
                show_id: showId,
                title: 'Episode Kickoff & Technical Intros',
                guest_name: 'Corey Sanders',
                guest_title: 'Producer Host',
                guest_handle: '@IamTallboy',
                guest_website: '',
                ticker_headlines: 'Welcome to the Labtechshow live stream review!\nCOP active merch drops at shop.tallboy.us',
                cta_headline: 'Subscribe to channels',
                cta_subline: 'Support the creators crew',
                producer_notes: 'Queue dynamic graphic logo on start.',
                sort_order: 0
            }
        ]);
    },
    saveRundownSegment: async (showId, segment) => {
        try {
            const res = await fetch(`/api/shows/${showId}/rundowns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(segment)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: saveRundownSegment failed. Saving locally...");
        }
        const segs = getLocalItem(`local_rundowns_${showId}`, []);
        const idx = segs.findIndex(s => s.segment_id === segment.segment_id);
        if (idx !== -1) segs[idx] = segment;
        else segs.push(segment);
        setLocalItem(`local_rundowns_${showId}`, segs);
        return { success: true };
    },
    deleteRundownSegment: async (showId, segmentId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/rundowns/${segmentId}`, { method: 'DELETE' });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: deleteRundownSegment failed. Deleting locally...");
        }
        let segs = getLocalItem(`local_rundowns_${showId}`, []);
        segs = segs.filter(s => s.segment_id !== segmentId);
        setLocalItem(`local_rundowns_${showId}`, segs);
        return { success: true };
    },

    // Calendar API
    fetchCalendar: async (showId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/calendar`);
            if (res.status === 200) {
                const data = await res.json();
                setLocalItem(`local_calendar_${showId}`, data);
                return data;
            }
        } catch (e) {
            console.warn("API: fetchCalendar failed. Using local storage...");
        }
        return getLocalItem(`local_calendar_${showId}`, []);
    },
    saveCalendarEvent: async (showId, event) => {
        try {
            const res = await fetch(`/api/shows/${showId}/calendar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: saveCalendarEvent failed. Saving locally...");
        }
        const evts = getLocalItem(`local_calendar_${showId}`, []);
        evts.push(event);
        setLocalItem(`local_calendar_${showId}`, evts);
        return { success: true };
    },
    deleteCalendarEvent: async (showId, eventId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/calendar/${eventId}`, { method: 'DELETE' });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: deleteCalendarEvent failed. Deleting locally...");
        }
        let evts = getLocalItem(`local_calendar_${showId}`, []);
        evts = evts.filter(e => e.event_id !== eventId);
        setLocalItem(`local_calendar_${showId}`, evts);
        return { success: true };
    },

    // Show Briefs API
    fetchBriefs: async (showId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/briefs`);
            if (res.status === 200) {
                const data = await res.json();
                setLocalItem(`local_briefs_${showId}`, data);
                return data;
            }
        } catch (e) {
            console.warn("API: fetchBriefs failed. Using local storage...");
        }
        return getLocalItem(`local_briefs_${showId}`, []);
    },
    saveBrief: async (showId, brief) => {
        try {
            const res = await fetch(`/api/shows/${showId}/briefs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(brief)
            });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: saveBrief failed. Saving locally...");
        }
        const briefs = getLocalItem(`local_briefs_${showId}`, []);
        const idx = briefs.findIndex(b => b.brief_id === brief.brief_id);
        if (idx !== -1) briefs[idx] = brief;
        else briefs.push(brief);
        setLocalItem(`local_briefs_${showId}`, briefs);
        return { success: true };
    },
    deleteBrief: async (showId, briefId) => {
        try {
            const res = await fetch(`/api/shows/${showId}/briefs/${briefId}`, { method: 'DELETE' });
            if (res.status === 200) return res.json();
        } catch (e) {
            console.warn("API: deleteBrief failed. Deleting locally...");
        }
        let briefs = getLocalItem(`local_briefs_${showId}`, []);
        briefs = briefs.filter(b => b.brief_id !== briefId);
        setLocalItem(`local_briefs_${showId}`, briefs);
        return { success: true };
    },

    // Community Hub API
    fetchCommunityStatus: async () => {
        try {
            const res = await fetch('/api/community/status');
            if (res.ok) return res.json();
        } catch (e) {
            console.warn('API: fetchCommunityStatus failed.');
        }
        return { status: 'offline', totalClients: 0, uptime: '00:00:00' };
    },
    flushCache: async () => {
        try {
            const res = await fetch('/api/community/flush-cache', { method: 'POST' });
            if (res.ok) return res.json();
        } catch (e) {}
        return { success: false };
    },
    reconnectAll: async () => {
        try {
            const res = await fetch('/api/community/reconnect-all', { method: 'POST' });
            if (res.ok) return res.json();
        } catch (e) {}
        return { success: false };
    },
    restartScraper: async (showId) => {
        try {
            const res = await fetch('/api/community/restart-scraper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showId })
            });
            if (res.ok) return res.json();
        } catch (e) {}
        return { success: false };
    },

    // vMix HTTP triggers
    triggerAudioMute: async (guestId, mute) => {
        try {
            const res = await fetch('/api/vmix/audio-gate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestId, mute })
            });
            return res.json();
        } catch (e) {
            console.warn("API: triggerAudioMute failed. vMix is offline.");
        }
        return { success: false };
    },
    triggerPushUrl: async (browserInputId, valueUrl) => {
        try {
            const res = await fetch('/api/vmix/push-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ browserInputId, valueUrl })
            });
            return res.json();
        } catch (e) {
            console.warn("API: triggerPushUrl failed. vMix is offline.");
        }
        return { success: false };
    }
};

// Registered listeners helper for dashboard binding
function setupBroadcastReceiver(onUpdate, onCoords, onTranscode, onWarning) {
    onStateUpdateCallback = onUpdate;
    onCoordsUpdateCallback = onCoords;
    onTranscoderCallback = onTranscode;
    onWarningCallback = onWarning;
}
