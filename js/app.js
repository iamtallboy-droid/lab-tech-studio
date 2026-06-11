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

            // Populate current values in inputs
            const config = payload.showConfig;
            if (config) {
                document.getElementById('brand-title-input').value = config.brand_name || '';
                document.getElementById('font-family-select').value = config.font_family || 'Inter';
                document.getElementById('primary-color-input').value = config.primary_hex || '#0F6FFF';
                document.getElementById('secondary-color-input').value = config.secondary_hex || '#00A8FF';
                
                // Adjust body theme selector
                document.body.className = `show-theme-${payload.activeShowId}`;
                document.getElementById('current-show-badge').textContent = `ACTIVE PRESET: ${payload.activeShowId.toUpperCase()}`;
                
                // Set logo and titles
                const logoEl = document.getElementById('header-logo');
                if (payload.activeShowId === 'lab_tech_show') {
                    logoEl.innerHTML = `<img src="logo.png" alt="Logo" style="height: 28px; width: auto; object-fit: contain; vertical-align: middle;">`;
                    logoEl.style.background = 'transparent';
                    logoEl.style.boxShadow = 'none';
                } else {
                    logoEl.textContent = (config.brand_name || 'LT').substring(0,2).toUpperCase();
                    logoEl.style.background = 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))';
                    logoEl.style.boxShadow = '0 0 12px var(--primary-glow)';
                }
                document.getElementById('header-show-title').textContent = config.brand_name || 'Labtechshow';
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
            container.innerHTML = '';
            
            const shows = await api.fetchShows();
            showsList = shows;
            
            shows.forEach(show => {
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
                container.appendChild(row);
            });
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

        async function updateShowSettings() {
            if (!localState || !localState.showConfig) return;
            
            const conf = localState.showConfig;
            conf.brand_name = document.getElementById('brand-title-input').value;
            conf.font_family = document.getElementById('font-family-select').value;
            conf.primary_hex = document.getElementById('primary-color-input').value;
            conf.secondary_hex = document.getElementById('secondary-color-input').value;
            
            // Build segment settings
            const textVal = document.getElementById('ticker-manual-text').value;
            
            // Read active cam slots
            const slots = parseInt(document.getElementById('cam-slots-select').value);
            const guides = document.getElementById('cam-guides-check').checked;
            const ctaActive = document.getElementById('cta-active-check').checked;
            const ltActive = document.getElementById('lt-active-check').checked;

            // Trigger updates via WebSocket or save directly
            // In a real database we will save, for sync we dispatch websocket payload
            await api.createShow(conf);
            refreshState();
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
