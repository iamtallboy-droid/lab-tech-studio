/* Module: community — extracted from app.js */
/* Community Hub tab logic: server status loading, quick actions, stats rendering, client breakdown */

        // ================================================================
        // COMMUNITY HUB FUNCTIONS
        // ================================================================

        // Apply the active show's logo + brand color to the Community Hub banner.
        function renderCommunityBranding() {
            const show = (typeof showsList !== 'undefined' ? showsList : [])
                .find(s => s.show_id === activeShowId);
            if (!show) return;
            const logoEl = document.getElementById('community-show-logo');
            const nameEl = document.getElementById('community-brand-name');
            const banner = document.getElementById('community-brand-banner');
            if (logoEl) logoEl.src = show.logo_url || 'logo.png';
            if (nameEl) nameEl.textContent = show.brand_name || '';
            if (banner) {
                banner.style.setProperty('--brand-primary', show.primary_hex || '#00AEEF');
                banner.style.setProperty('--brand-secondary', show.secondary_hex || show.primary_hex || '#00E5FF');
            }
        }

        async function loadCommunityStatus() {
            renderCommunityBranding();
            const statusData = await api.fetchCommunityStatus();

            // Server status card
            const statusEl = document.getElementById('hub-server-status');
            const statusCard = document.getElementById('hub-status-card');
            if (statusData.status === 'online') {
                if (statusEl) statusEl.innerHTML = '<span style="color:#2DD36F">● ONLINE</span>';
                if (statusCard) statusCard.style.borderColor = 'rgba(45,211,111,0.35)';
            } else {
                if (statusEl) statusEl.innerHTML = '<span style="color:#FF3B30">● OFFLINE</span>';
                if (statusCard) statusCard.style.borderColor = 'rgba(255,59,48,0.35)';
            }

            // Uptime
            const uptimeEl = document.getElementById('hub-uptime');
            if (uptimeEl) uptimeEl.textContent = statusData.uptime || '—';

            // Client count
            const clientEl = document.getElementById('hub-client-count');
            if (clientEl) clientEl.textContent = statusData.totalClients ?? '—';

            // Redis status
            const redisEl = document.getElementById('hub-redis-status');
            if (redisEl && statusData.redis) {
                redisEl.innerHTML = statusData.redis.mode === 'redis'
                    ? '<span style="color:#2DD36F">● Redis Connected</span>'
                    : '<span style="color:#F5C242">● In-Memory</span>';
            }

            // Active show
            const showEl = document.getElementById('hub-active-show');
            if (showEl) showEl.textContent = statusData.activeShowId || '—';

            // Transcoder queue
            const queueEl = document.getElementById('hub-queue-count');
            if (queueEl) queueEl.textContent = statusData.transcoderQueue ?? '—';

            // Client breakdown
            if (statusData.clientBreakdown) {
                const { admin = 0, producer = 0, viewer = 0 } = statusData.clientBreakdown;
                document.getElementById('hub-admin-count').textContent = admin;
                document.getElementById('hub-producer-count').textContent = producer;
                document.getElementById('hub-viewer-count').textContent = viewer;
            }

            // Last updated
            const lastEl = document.getElementById('hub-last-updated');
            if (lastEl) lastEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        }

        async function communityAction(action) {
            let result;
            switch(action) {
                case 'reconnect':
                    result = await api.reconnectAll();
                    alert(result.message || 'Reconnect signal sent.');
                    break;
                case 'flush-cache':
                    if (!confirm('Flush all Redis overlay state cache? This will reset position memory for all overlays.')) return;
                    result = await api.flushCache();
                    alert(result.message || 'Cache flushed.');
                    break;
                case 'restart-scraper':
                    result = await api.restartScraper(activeShowId);
                    alert(result.message || 'Scraper restarted.');
                    break;
            }
            setTimeout(loadCommunityStatus, 500);
        }
