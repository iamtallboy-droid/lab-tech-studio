/* Module: app — extracted from app.js */
/* Core initialization: DOMContentLoaded, state handlers, tab switching, sidebar rendering, show/auth management, settings sync, utilities */

        // DOM Loaded Handler
        document.addEventListener('DOMContentLoaded', () => {
            // Load app state coordination WebSockets
            initAppState();

            // Set up state listeners
            setupBroadcastReceiver(
                handleStateUpdate,
                handleCoordsUpdate,
                handleTranscoderUpdate,
                handleWarningMessage
            );

            // Fetch directories
            let locationUrl = window.location.href;
            let targetUrl = locationUrl.substring(0, locationUrl.lastIndexOf('/')) + '/overlay.html';
            document.getElementById('vmix-url-text').textContent = targetUrl;
            
            // Wire Drag Drop
            setupDragAndDrop();
        });

        // Current UI Local Cache
        let localState = null;
        let selectedMainTab = 'tab-overlays';
        let selectedSubTab = 'sub-ticker';
        let selectedBriefId = null;
        let activeCanvasRatio = 'horizontal';

        // -------------------------------------------------------------
        // BROADCAST STATE HANDLERS (FROM WEBSOCKET)
        // -------------------------------------------------------------
        
        async function handleStateUpdate(payload) {
            localState = payload;
            
            // Re-render preset elements
            await renderSidebarList();
            renderTenantOptions();

            // Resolve the ACTIVE show's config. payload.showConfig reflects the
            // client's registered show, which can lag behind activeShowId — so
            // look the active show up in showsList. All editor inputs read from
            // (and updateShowSettings writes to) this active config.
            const config =
                (typeof showsList !== 'undefined'
                    ? showsList.find(s => s.show_id === payload.activeShowId)
                    : null) || payload.showConfig;
            if (config) {
                document.getElementById('brand-title-input').value = config.brand_name || '';
                document.getElementById('font-family-select').value = config.font_family || 'Inter';
                document.getElementById('primary-color-input').value = config.primary_hex || '#0F6FFF';
                document.getElementById('secondary-color-input').value = config.secondary_hex || '#00A8FF';

                // Populate ticker + CTA + lower-third + scene controls.
                populateTickerInputs(config);
                populateCtaInputs(config);
                populateLtInputs(config);
                populateSceneInputs(config);

                // Adjust body theme selector
                document.body.className = `show-theme-${payload.activeShowId}`;
                document.getElementById('current-show-badge').textContent = `ACTIVE PRESET: ${payload.activeShowId.toUpperCase()}`;

                const activeConfig = config;

                // Set logo and title from the active show's own branding.
                const logoEl = document.getElementById('header-logo');
                if (activeConfig.logo_url) {
                    logoEl.innerHTML = `<img src="${activeConfig.logo_url}" alt="${activeConfig.brand_name || 'Show'} logo"
                        onerror="this.onerror=null; this.src='logo.svg';"
                        style="height: 28px; width: auto; object-fit: contain; vertical-align: middle;">`;
                    logoEl.style.background = 'transparent';
                    logoEl.style.boxShadow = 'none';
                } else {
                    logoEl.textContent = (activeConfig.brand_name || 'LT').substring(0,2).toUpperCase();
                    logoEl.style.background = 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))';
                    logoEl.style.boxShadow = '0 0 12px var(--primary-glow)';
                }
                // Short header labels keep the title from wrapping/clipping in the
                // fixed-height header. Falls back to the full brand name.
                const HEADER_LABELS = {
                    lab_tech_show: 'The Lab Tech Show',
                    tall_boy_experience: 'TBE Experience'
                };
                document.getElementById('header-show-title').textContent =
                    HEADER_LABELS[payload.activeShowId] || activeConfig.brand_name || 'Labtechshow';
            }

            // Sync Coordinates UI Inputs
            const ratio = getCanvasMode();
            activeCanvasRatio = ratio;
            syncRatioButtons();
            
            // Render other dynamic UI panels
            await renderRundownList();
            await renderCalendarView();
            await renderBriefsView();
            renderMerchCards();

            // Reload preview iframe
            const iframe = document.getElementById('preview-iframe');
            if (iframe) {
                iframe.contentWindow.postMessage({
                    type: 'SYNC',
                    payload: payload
                }, '*');
            }
        }

        function handleCoordsUpdate(payload) {
            if (payload.showId !== activeShowId) return;
            
            // Sync slider inputs
            document.getElementById('slider-top').value = payload.containerTop;
            document.getElementById('slider-left').value = payload.containerLeft;
            document.getElementById('slider-scale-img').value = payload.imageScale;
            document.getElementById('slider-scale-text').value = payload.textScale;

            document.getElementById('val-top').textContent = `${payload.containerTop}%`;
            document.getElementById('val-left').textContent = `${payload.containerLeft}%`;
            document.getElementById('val-scale-img').textContent = `${payload.imageScale}%`;
            document.getElementById('val-scale-text').textContent = `${payload.textScale}%`;

            // Update preview frame if loaded
            const iframe = document.getElementById('preview-iframe');
            if (iframe) {
                iframe.contentWindow.postMessage({
                    type: 'COORDINATES_SYNC',
                    payload: payload
                }, '*');
            }
        }

        function handleTranscoderUpdate(jobs) {
            const container = document.getElementById('transcode-queue-list');
            if (jobs.length === 0) {
                container.innerHTML = '<div class="empty-list-message">No active encoding jobs currently running.</div>';
                return;
            }

            container.innerHTML = '';
            jobs.forEach(job => {
                const row = document.createElement('div');
                row.className = `queue-row ${job.status}`;
                
                row.innerHTML = `
                    <div class="job-meta">
                        <span class="j-name">${job.filename}</span>
                        <span class="j-status-tag">${job.status.toUpperCase()}</span>
                    </div>
                    <div class="job-progress-container">
                        <div class="job-progress-bar" style="width: ${job.progress}%"></div>
                        <span class="j-pct">${job.progress}%</span>
                    </div>
                    ${job.status === 'completed' ? `<div class="job-url"><a href="${job.url}" target="_blank">Download Transcoded WebM</a></div>` : ''}
                `;
                container.appendChild(row);
            });
        }

        function handleWarningMessage(msg) {
            const banner = document.getElementById('bench-override-banner');
            document.getElementById('warning-msg').textContent = msg;
            banner.classList.add('show');
            setTimeout(() => {
                banner.classList.remove('show');
            }, 4000);
        }

        // -------------------------------------------------------------
        // TABS & INTERACTION LOGIC
        // -------------------------------------------------------------

        function switchMainTab(tabId) {
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

            document.getElementById(tabId).classList.add('active');
            
            // Map button IDs
            const btnId = 'tab-btn-' + tabId.replace('tab-', '');
            const tabBtn = document.getElementById(btnId);
            if (tabBtn) tabBtn.classList.add('active');
            
            selectedMainTab = tabId;
            
            // Trigger load coordinates when overlays tab loads
            if (tabId === 'tab-overlays') {
                refreshState();
            }
        }

        // -------------------------------------------------------------
        // DYNAMIC RENDERING (SIDEBAR)
        // -------------------------------------------------------------

        async function renderSidebarList() {
            const container = document.getElementById('preset-list-container');

            // Fetch FIRST, then clear+rebuild synchronously. Clearing before the
            // await opened a race: two overlapping calls (this runs on every WS
            // state update) both cleared, then both appended → duplicate presets.
            const shows = await api.fetchShows();

            // De-dupe by show_id as a safeguard against any duplicate source.
            const seen = new Set();
            const uniqueShows = shows.filter(s => {
                if (seen.has(s.show_id)) return false;
                seen.add(s.show_id);
                return true;
            });
            showsList = uniqueShows;

            const frag = document.createDocumentFragment();
            uniqueShows.forEach(show => {
                const row = document.createElement('div');
                row.className = `preset-item ${show.show_id === activeShowId ? 'active' : ''}`;
                row.onclick = () => handleShowChange(show.show_id);

                row.innerHTML = `
                    <div class="preset-name">${show.brand_name}</div>
                    <div class="preset-meta">
                        <span class="color-dot" style="background-color: ${show.primary_hex}"></span>
                        <span>Font: ${show.font_family}</span>
                    </div>
                `;
                frag.appendChild(row);
            });

            container.innerHTML = '';
            container.appendChild(frag);
        }

        function renderTenantOptions() {
            const selector = document.getElementById('tenant-selector');
            selector.innerHTML = '';
            showsList.forEach(show => {
                const opt = document.createElement('option');
                opt.value = show.show_id;
                opt.textContent = show.brand_name;
                opt.selected = show.show_id === activeShowId;
                selector.appendChild(opt);
            });
        }

        async function handleShowChange(showId) {
            activeShowId = showId;
            localStorage.setItem('labtech_active_show_id', activeShowId);
            
            // Call API backend setter
            await api.setActiveShow(showId);
            refreshState();
        }

        function handleAuthChange(value) {
            loginUser(value);
            
            // Adjust sidebar view rules
            const sidebar = document.getElementById('presets-sidebar');
            if (currentRole === 'producer') {
                sidebar.style.display = 'none';
                switchMainTab('tab-rundown');
            } else {
                sidebar.style.display = 'flex';
                switchMainTab('tab-overlays');
            }
        }

        // -------------------------------------------------------------
        // NEW SHOW PRESET WIZARD
        // -------------------------------------------------------------
        function openNewShowWizard() {
            document.getElementById('new-show-modal').classList.add('show');
        }

        function closeNewShowWizard() {
            document.getElementById('new-show-modal').classList.remove('show');
        }

        function addWizardHostRow() {
            const container = document.getElementById('wizard-hosts-container');
            const row = document.createElement('div');
            row.className = 'wizard-host-row';
            row.innerHTML = `
                <input type="text" placeholder="Name" class="w-h-name">
                <input type="text" placeholder="Social" class="w-h-social">
                <button class="btn-del-block" onclick="deleteWizardHostRow(this)">&times;</button>
            `;
            container.appendChild(row);
        }

        function deleteWizardHostRow(btn) {
            btn.parentElement.remove();
        }

        async function submitNewShowWizard() {
            const name = document.getElementById('wizard-name-input').value.trim();
            const primary = document.getElementById('wizard-primary-color').value;
            const secondary = document.getElementById('wizard-secondary-color').value;
            
            if (!name) {
                alert('Please enter a Show Name!');
                return;
            }

            // Read modular host inputs
            const hosts = [];
            const rows = document.querySelectorAll('.wizard-host-row');
            rows.forEach(row => {
                const hName = row.querySelector('.w-h-name').value.trim();
                const hSocial = row.querySelector('.w-h-social').value.trim();
                if (hName) {
                    hosts.push({ name: hName, handle: hSocial, role: 'Presenter' });
                }
            });

            const showId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const showData = {
                show_id: showId,
                brand_name: name,
                primary_hex: primary,
                secondary_hex: secondary,
                font_family: 'Days One', // baseline inherits typography parameters of The Tall Boy Experience
                hosts: hosts
            };

            await api.createShow(showData);
            closeNewShowWizard();
            
            // switch to new show
            handleShowChange(showId);
        }

        // ================================================================
        // WEBSOCKET STATUS PILL UPDATER
        // ================================================================
        function updateWsPill(connected) {
            const pill = document.getElementById('ws-status-pill');
            const text = document.getElementById('ws-status-text');
            if (!pill || !text) return;
            if (connected) {
                pill.className = 'ws-status-pill online';
                text.textContent = '🟢 Live';
            } else {
                pill.className = 'ws-status-pill offline';
                text.textContent = '🔴 Offline';
            }
        }

        // Poll WS status every 2 seconds to update the pill
        setInterval(() => {
            const isConnected = typeof socket !== 'undefined' && socket && socket.readyState === WebSocket.OPEN;
            updateWsPill(isConnected);
        }, 2000);

        // Small helper used by the +/- step buttons on ticker range sliders.
        function stepTickerRange(id, delta) {
            const el = document.getElementById(id);
            if (!el) return;
            const min = parseFloat(el.min), max = parseFloat(el.max);
            el.value = Math.min(max, Math.max(min, parseFloat(el.value) + delta));
            el.dispatchEvent(new Event('input'));
            updateShowSettings();
        }

        // Populate the ticker editor inputs from a show's saved overlay settings.
        function populateTickerInputs(config) {
            const t = (config && config.overlay_settings && config.overlay_settings.ticker) || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
            const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
            const txt = document.getElementById('ticker-manual-text');
            if (txt && typeof t.manualText === 'string') txt.value = t.manualText;
            set('ticker-speed', t.speed ?? 60);
            set('ticker-fontsize', t.fontSize ?? 24);
            set('ticker-barheight', t.barHeight ?? 55);
            set('ticker-opacity', Math.round(((t.barOpacity ?? 0.92)) * 100));
            set('ticker-separator', t.separator || 'dot');
            set('ticker-badge-text', t.badgeText || 'LIVE');
            set('ticker-accent-color', t.accentHex || config.secondary_hex || '#00E5FF');
            check('ticker-uppercase', t.uppercase);
            check('ticker-badge-on', t.badgeOn !== false);
            // Sync the slider value readouts.
            const sync = (id, sel) => { const el = document.getElementById(id), o = document.getElementById(sel); if (el && o) o.textContent = el.value; };
            sync('ticker-speed', 'val-ticker-speed');
            sync('ticker-fontsize', 'val-ticker-font');
            sync('ticker-barheight', 'val-ticker-height');
            sync('ticker-opacity', 'val-ticker-opacity');
        }

        function readTickerSettings() {
            const val = (id) => document.getElementById(id);
            return {
                manualText: val('ticker-manual-text') ? val('ticker-manual-text').value : '',
                source: (val('ticker-src-rss') && val('ticker-src-rss').classList.contains('active')) ? 'rss' : 'manual',
                speed: parseInt(val('ticker-speed') ? val('ticker-speed').value : 60, 10),
                fontSize: parseInt(val('ticker-fontsize') ? val('ticker-fontsize').value : 24, 10),
                barHeight: parseInt(val('ticker-barheight') ? val('ticker-barheight').value : 55, 10),
                barOpacity: (parseInt(val('ticker-opacity') ? val('ticker-opacity').value : 92, 10)) / 100,
                uppercase: !!(val('ticker-uppercase') && val('ticker-uppercase').checked),
                separator: val('ticker-separator') ? val('ticker-separator').value : 'dot',
                badgeText: val('ticker-badge-text') ? (val('ticker-badge-text').value || 'LIVE') : 'LIVE',
                badgeOn: val('ticker-badge-on') ? val('ticker-badge-on').checked : true,
                accentHex: val('ticker-accent-color') ? val('ticker-accent-color').value : '#00E5FF'
            };
        }

        async function updateShowSettings() {
            // Write to the ACTIVE show's config (resolved from showsList), not the
            // registered show in localState — those can differ.
            const conf =
                (typeof showsList !== 'undefined' ? showsList.find(s => s.show_id === activeShowId) : null)
                || (localState && localState.showConfig);
            if (!conf) return;

            conf.brand_name = document.getElementById('brand-title-input').value;
            conf.font_family = document.getElementById('font-family-select').value;
            conf.primary_hex = document.getElementById('primary-color-input').value;
            conf.secondary_hex = document.getElementById('secondary-color-input').value;

            // Merge overlay settings (ticker + CTA + lower-third + scene).
            conf.overlay_settings = conf.overlay_settings || {};
            conf.overlay_settings.ticker = readTickerSettings();
            conf.overlay_settings.cta = readCtaSettings();
            conf.overlay_settings.lt = readLtSettings();
            conf.overlay_settings.scene = readSceneSettings();

            await api.createShow(conf);
            refreshState();
        }

        function readCtaSettings() {
            const v = (id) => document.getElementById(id);
            return {
                active: !!(v('cta-active-check') && v('cta-active-check').checked),
                badge: v('cta-badge-input') ? v('cta-badge-input').value : 'SUBSCRIBE',
                title: v('cta-title-input') ? v('cta-title-input').value : '',
                subline: v('cta-subline-input') ? v('cta-subline-input').value : '',
                url: v('cta-url-input') ? v('cta-url-input').value : '',
                style: v('cta-style-select') ? v('cta-style-select').value : 'standard',
                autoHideSec: v('cta-autohide-input') ? parseInt(v('cta-autohide-input').value || '0', 10) : 12
            };
        }

        function populateCtaInputs(config) {
            const c = (config && config.overlay_settings && config.overlay_settings.cta) || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
            const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
            check('cta-active-check', c.active);
            set('cta-badge-input', c.badge || 'SUBSCRIBE');
            set('cta-title-input', c.title || '');
            set('cta-subline-input', c.subline || '');
            set('cta-url-input', c.url || '');
            set('cta-style-select', c.style || 'standard');
            set('cta-autohide-input', c.autoHideSec != null ? c.autoHideSec : 12);
        }

        // Lower-third per-show defaults (style + kicker). The headline/context/
        // guest fields stay transient live-push inputs.
        function readLtSettings() {
            const v = (id) => document.getElementById(id);
            return {
                style: v('lt-style-select') ? v('lt-style-select').value : 'standard',
                kicker: v('lt-kicker-input') ? v('lt-kicker-input').value : 'ON AIR GUEST',
                active: !!(v('lt-active-check') && v('lt-active-check').checked)
            };
        }
        function populateLtInputs(config) {
            const lt = (config && config.overlay_settings && config.overlay_settings.lt) || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
            set('lt-style-select', lt.style || 'standard');
            if (lt.kicker) set('lt-kicker-input', lt.kicker);
            const chk = document.getElementById('lt-active-check'); if (chk) chk.checked = !!lt.active;
        }

        // Scene / Camera per-show settings (cam-slot guides + shared URL).
        function readSceneSettings() {
            const v = (id) => document.getElementById(id);
            return {
                camSlots: v('cam-slots-select') ? parseInt(v('cam-slots-select').value, 10) : 2,
                guides: !!(v('cam-guides-check') && v('cam-guides-check').checked),
                sharedUrl: v('scene-shared-url') ? v('scene-shared-url').value.trim() : ''
            };
        }
        function populateSceneInputs(config) {
            const sc = (config && config.overlay_settings && config.overlay_settings.scene) || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
            set('cam-slots-select', sc.camSlots || 2);
            set('scene-shared-url', sc.sharedUrl || '');
            const chk = document.getElementById('cam-guides-check'); if (chk) chk.checked = !!sc.guides;
        }

        // Push the active show's CTA to the overlay immediately (fly in / hide).
        function triggerCtaFlyIn() {
            const cta = readCtaSettings();
            sendWSMessage('CTA_FLYIN', { showId: activeShowId, cta, autoHideSec: cta.autoHideSec });
            showToast('▶ CTA flying in on overlay', 'success');
        }
        function triggerCtaHide() {
            sendWSMessage('CTA_FLYIN', { showId: activeShowId, action: 'hide' });
            showToast('CTA hidden', 'success');
        }

        // HTML escape helper
        function escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        async function handleRssChange(feed) {
            alert(`Fetching RSS feed elements for ${feed}...`);
            // Mock scraper logic in app.js or query server endpoint
            // Usually server will run RSS parsing. We trigger update on server
        }

        function duplicateShow() {
            // Stub — referenced from HTML onclick
        }

        function deleteShow() {
            // Stub — referenced from HTML onclick
        }

        // =============================================================
        // LIVE MODE TOGGLE
        // =============================================================
        function toggleLiveMode() {
            const body = document.body;
            const btn = document.getElementById('live-mode-btn');
            const isLive = body.classList.toggle('live-mode');

            btn.classList.toggle('active', isLive);
            localStorage.setItem('labtech_live_mode', isLive);

            if (isLive) {
                // Auto-switch to Overlays tab in live mode
                switchMainTab('tab-overlays');
                if (typeof showToast === 'function') showToast('🔴 LIVE MODE ACTIVATED', 'warning');
            } else {
                if (typeof showToast === 'function') showToast('Live Mode deactivated', 'success');
            }
        }

        // Restore live mode state on load
        (function restoreLiveMode() {
            if (localStorage.getItem('labtech_live_mode') === 'true') {
                document.body.classList.add('live-mode');
                const btn = document.getElementById('live-mode-btn');
                if (btn) btn.classList.add('active');
            }
        })();

        // =============================================================
        // SIDEBAR COLLAPSE TOGGLE
        // =============================================================
        function toggleSidebar() {
            const sidebar = document.getElementById('presets-sidebar');
            const btn = document.getElementById('sidebar-toggle-btn');
            const isCollapsed = sidebar.classList.toggle('collapsed');

            btn.textContent = isCollapsed ? '▶' : '◀';
            localStorage.setItem('labtech_sidebar_collapsed', isCollapsed);
        }

        // Restore sidebar state on load
        (function restoreSidebar() {
            if (localStorage.getItem('labtech_sidebar_collapsed') === 'true') {
                const sidebar = document.getElementById('presets-sidebar');
                const btn = document.getElementById('sidebar-toggle-btn');
                if (sidebar) sidebar.classList.add('collapsed');
                if (btn) btn.textContent = '▶';
            }
        })();

        // =============================================================
        // EMERGENCY CLEAR ALL OVERLAYS
        // =============================================================
        function clearAllOverlays() {
            if (typeof socket !== 'undefined' && socket && socket.readyState === WebSocket.OPEN) {
                // Send clear commands for all overlay types
                socket.send(JSON.stringify({ type: 'CLEAR_ALL_OVERLAYS', showId: activeShowId }));
            }

            // Also clear via preview iframe
            const iframe = document.getElementById('preview-iframe');
            if (iframe) {
                iframe.contentWindow.postMessage({ type: 'CLEAR_ALL' }, '*');
            }

            if (typeof showToast === 'function') showToast('⚠️ ALL OVERLAYS CLEARED', 'warning');
        }

        // =============================================================
        // BRB (Be Right Back) QUICK SWITCH
        // =============================================================
        function triggerBRB() {
            if (typeof socket !== 'undefined' && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'TRIGGER_BRB', showId: activeShowId }));
            }

            if (typeof showToast === 'function') showToast('🔄 BRB CARD ACTIVATED', 'warning');
        }
