/* Module: rundown — extracted from app.js */
/* Rundown tab logic: segment rendering, add/delete/air toggle, field updates, audio gates, TIMING ENGINE */

        // -------------------------------------------------------------
        // TIMING ENGINE STATE
        // -------------------------------------------------------------
        let segmentTimerInterval = null;
        let segmentTimerStartTime = null;
        let segmentTimerDurationSec = 0;
        let showStartTime = localStorage.getItem('labtech_show_start_time') || '';

        // Parse "mm:ss" string to seconds
        function parseDuration(str) {
            if (!str) return 0;
            const parts = str.split(':');
            if (parts.length === 2) return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
            return parseInt(str) || 0;
        }

        // Format seconds to "mm:ss"
        function formatDuration(sec) {
            const absSec = Math.abs(Math.floor(sec));
            const m = Math.floor(absSec / 60);
            const s = absSec % 60;
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        // Calculate front-times for all segments based on show start time
        function calculateFrontTimes(segments, startTimeStr) {
            if (!startTimeStr) return segments.map(() => '');
            const parts = startTimeStr.split(':');
            let baseMinutes = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
            
            return segments.map(seg => {
                const ft = `${String(Math.floor(baseMinutes / 60) % 24).padStart(2, '0')}:${String(baseMinutes % 60).padStart(2, '0')}`;
                baseMinutes += Math.ceil(parseDuration(seg.estimated_duration || '5:00') / 60);
                return ft;
            });
        }

        // Start countdown timer for a segment
        function startSegmentTimer(segmentId, durationSec) {
            stopSegmentTimer();
            if (!durationSec || durationSec <= 0) return;
            
            segmentTimerStartTime = Date.now();
            segmentTimerDurationSec = durationSec;
            
            segmentTimerInterval = setInterval(() => {
                const elapsed = (Date.now() - segmentTimerStartTime) / 1000;
                const remaining = segmentTimerDurationSec - elapsed;
                
                updateTimerDisplay(segmentId, remaining);
                updateStatusBarTimer(remaining);
            }, 250); // 4x per second for smooth display
        }

        function stopSegmentTimer() {
            if (segmentTimerInterval) {
                clearInterval(segmentTimerInterval);
                segmentTimerInterval = null;
            }
            segmentTimerStartTime = null;
            segmentTimerDurationSec = 0;
        }

        function updateTimerDisplay(segmentId, remainingSec) {
            const el = document.getElementById(`seg-timer-${segmentId}`);
            if (!el) return;
            
            el.textContent = formatDuration(Math.abs(remainingSec));
            
            // Remove all timer classes
            el.classList.remove('timer-green', 'timer-yellow', 'timer-red', 'timer-overtime');
            
            if (remainingSec < 0) {
                el.classList.add('timer-overtime');
            } else if (remainingSec < 30) {
                el.classList.add('timer-red');
            } else if (remainingSec < 120) {
                el.classList.add('timer-yellow');
            } else {
                el.classList.add('timer-green');
            }
        }

        function updateStatusBarTimer(remainingSec) {
            // Update status bar if it exists (Phase 2)
            const sbTimer = document.getElementById('sb-segment-timer');
            if (sbTimer) {
                sbTimer.textContent = formatDuration(Math.abs(remainingSec));
                sbTimer.className = 'status-segment-timer';
                if (remainingSec < 0) sbTimer.classList.add('timer-red');
                else if (remainingSec < 30) sbTimer.classList.add('timer-red');
                else if (remainingSec < 120) sbTimer.classList.add('timer-yellow');
                else sbTimer.classList.add('timer-green');
            }
        }

        // Advance to next rundown segment
        async function advanceRundownSegment() {
            const segments = await api.fetchRundowns(activeShowId);
            if (segments.length === 0) return;
            
            if (!activeAiredSegmentId) {
                // No segment airing — start the first one
                toggleSegmentAir(segments[0].segment_id);
                return;
            }
            
            const currentIdx = segments.findIndex(s => s.segment_id === activeAiredSegmentId);
            if (currentIdx >= 0 && currentIdx < segments.length - 1) {
                // Advance to next segment
                toggleSegmentAir(segments[currentIdx + 1].segment_id);
            } else {
                // Last segment — clear airing
                toggleSegmentAir(activeAiredSegmentId);
            }
            
            if (typeof showToast === 'function') showToast('⏭ Advanced to next segment', 'success');
        }

        // -------------------------------------------------------------
        // NOTION REPLACEMENTS: RUNDOWNS
        // -------------------------------------------------------------
        
        async function renderRundownList() {
            const container = document.getElementById('rundown-list-container');
            container.innerHTML = '';
            
            const segments = await api.fetchRundowns(activeShowId);
            
            // Cam monitoring gate UI build helper
            buildAudioGatesList(segments);

            // Calculate front times
            const frontTimes = calculateFrontTimes(segments, showStartTime);

            if (segments.length === 0) {
                container.innerHTML = '<div class="no-selection-message">No rundown segments configured. Add one below to start production sequence.</div>';
                return;
            }

            // Calculate total show duration
            let totalSec = 0;
            segments.forEach(seg => { totalSec += parseDuration(seg.estimated_duration || '5:00'); });
            const totalDurationEl = document.getElementById('total-show-duration');
            if (totalDurationEl) totalDurationEl.textContent = `Total: ${formatDuration(totalSec)}`;

            segments.forEach((seg, idx) => {
                const isActive = (seg.segment_id === activeAiredSegmentId);
                const estDuration = seg.estimated_duration || '5:00';
                const card = document.createElement('div');
                card.className = `rundown-segment-card ${isActive ? 'airing' : ''}`;
                
                card.innerHTML = `
                    <div class="seg-header">
                        <span class="idx">${idx + 1}</span>
                        <input type="text" class="title-edit" value="${escapeHtml(seg.title)}" onchange="updateSegmentField('${seg.segment_id}', 'title', this.value)">
                        
                        <div class="seg-timing">
                            <span class="front-time">${frontTimes[idx] ? '⏱ ' + frontTimes[idx] : ''}</span>
                            <input type="text" class="duration-input" value="${escapeHtml(estDuration)}" 
                                   placeholder="mm:ss" title="Estimated duration (mm:ss)"
                                   onchange="updateSegmentField('${seg.segment_id}', 'estimated_duration', this.value); renderRundownList();">
                            <span class="seg-countdown" id="seg-timer-${seg.segment_id}">${isActive ? formatDuration(parseDuration(estDuration)) : '--:--'}</span>
                        </div>
                        
                        <div class="actions">
                            <button class="btn btn-sm ${isActive ? 'btn-danger' : 'btn-primary'}" onclick="toggleSegmentAir('${seg.segment_id}')">
                                ${isActive ? '● AIRING LIVE' : 'AIR SEGMENT'}
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRundownSegment('${seg.segment_id}')">Delete</button>
                        </div>
                    </div>
                    
                    <div class="seg-body">
                        <div class="col">
                            <div class="form-group-sm">
                                <label>Guest / Presenter Name</label>
                                <input type="text" value="${escapeHtml(seg.guest_name || '')}" onchange="updateSegmentField('${seg.segment_id}', 'guest_name', this.value)">
                            </div>
                            <div class="form-group-sm">
                                <label>Guest Title / Role</label>
                                <input type="text" value="${escapeHtml(seg.guest_title || '')}" onchange="updateSegmentField('${seg.segment_id}', 'guest_title', this.value)">
                            </div>
                            <div class="form-group-sm">
                                <label>Social Handle @</label>
                                <input type="text" value="${escapeHtml(seg.guest_handle || '')}" onchange="updateSegmentField('${seg.segment_id}', 'guest_handle', this.value)">
                            </div>
                        </div>
                        <div class="col">
                            <div class="form-group-sm">
                                <label>Scrolling Ticker Headlines (One per line)</label>
                                <textarea rows="2" onchange="updateSegmentField('${seg.segment_id}', 'ticker_headlines', this.value)">${escapeHtml(seg.ticker_headlines || '')}</textarea>
                            </div>
                            <div class="form-group-sm">
                                <label>CTA Sponsor Text</label>
                                <input type="text" value="${escapeHtml(seg.cta_headline || '')}" onchange="updateSegmentField('${seg.segment_id}', 'cta_headline', this.value)">
                            </div>
                        </div>
                        <div class="col flex-notes">
                            <div class="form-group-sm">
                                <label>Producer Cue Notes (Internal)</label>
                                <textarea rows="4" class="p-notes" onchange="updateSegmentField('${seg.segment_id}', 'producer_notes', this.value)">${escapeHtml(seg.producer_notes || '')}</textarea>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(card);

                // If this segment is actively airing, start its timer
                if (isActive) {
                    const durSec = parseDuration(estDuration);
                    startSegmentTimer(seg.segment_id, durSec);
                    
                    // Update status bar segment name
                    const sbSegName = document.getElementById('sb-segment-name');
                    if (sbSegName) sbSegName.textContent = seg.title;
                }
            });
        }

        async function updateSegmentField(segmentId, field, value) {
            const segments = await api.fetchRundowns(activeShowId);
            const seg = segments.find(s => s.segment_id === segmentId);
            if (seg) {
                seg[field] = value;
                await api.saveRundownSegment(activeShowId, seg);
                
                // If segment currently airing, trigger coordinates sync updates hot!
                if (activeAiredSegmentId === segmentId) {
                    refreshState();
                }
            }
        }

        async function toggleSegmentAir(segmentId) {
            const nextAired = (activeAiredSegmentId === segmentId) ? null : segmentId;
            activeAiredSegmentId = nextAired;
            
            // Send WebSocket toggle
            sendWSMessage('AIR_SEGMENT_TOGGLE', { segmentId: nextAired });
            
            // Audio Gating Automated networking check:
            const segments = await api.fetchRundowns(activeShowId);
            const currentAirSeg = segments.find(s => s.segment_id === segmentId);
            
            if (currentAirSeg && currentAirSeg.guest_handle) {
                const guestName = currentAirSeg.guest_handle.replace('@', '');
                
                if (nextAired === segmentId) {
                    // Airing, unmute
                    await api.triggerAudioMute(guestName, false);
                } else {
                    // Dropped, mute
                    await api.triggerAudioMute(guestName, true);
                }
            }

            // Manage timer
            if (nextAired && currentAirSeg) {
                const durSec = parseDuration(currentAirSeg.estimated_duration || '5:00');
                startSegmentTimer(segmentId, durSec);
                if (typeof showToast === 'function') showToast(`▶ "${currentAirSeg.title}" is LIVE`, 'success');
            } else {
                stopSegmentTimer();
                if (typeof showToast === 'function') showToast('Segment taken off air', 'warning');
            }
            
            renderRundownList();
        }

        async function addNewRundownSegment() {
            const segments = await api.fetchRundowns(activeShowId);
            const newSeg = {
                segment_id: `seg-${Date.now()}`,
                title: `Segment Title #${segments.length + 1}`,
                guest_name: 'Presenter Name',
                guest_title: 'Title',
                guest_handle: '@PresenterSocial',
                guest_website: '',
                ticker_headlines: 'Ticker headline item 1...\nTicker headline item 2...',
                cta_headline: 'CTA Title',
                cta_subline: '',
                producer_notes: 'Cues, graphics transitions, ear monitor notes...',
                estimated_duration: '5:00',
                sort_order: segments.length
            };
            
            await api.saveRundownSegment(activeShowId, newSeg);
            await renderRundownList();
            if (typeof showToast === 'function') showToast('✓ New segment added', 'success');
        }

        async function deleteRundownSegment(segId) {
            if (activeAiredSegmentId === segId) {
                activeAiredSegmentId = null;
                stopSegmentTimer();
                sendWSMessage('AIR_SEGMENT_TOGGLE', { segmentId: null });
            }
            await api.deleteRundownSegment(activeShowId, segId);
            await renderRundownList();
            if (typeof showToast === 'function') showToast('Segment removed', 'warning');
        }

        // Show start time handler
        function updateShowStartTime(value) {
            showStartTime = value;
            localStorage.setItem('labtech_show_start_time', value);
            renderRundownList();
        }

        // Draggable audio bus mutes list
        function buildAudioGatesList(segments) {
            const container = document.getElementById('audio-gates-cams-container');
            container.innerHTML = '';
            
            if (segments.length === 0) {
                container.innerHTML = '<div class="no-selection-message">No guest inputs found in rundown.</div>';
                return;
            }

            segments.forEach(seg => {
                if (!seg.guest_handle) return;
                const inputName = seg.guest_handle.replace('@','');
                
                const card = document.createElement('div');
                card.className = 'audio-gate-card';
                card.innerHTML = `
                    <div class="card-info">
                        <span class="h-name">${seg.guest_name}</span>
                        <span class="h-id">Input ID: ${inputName}</span>
                    </div>
                    <div class="card-switches">
                        <button class="btn-toggle-mute active" onclick="toggleLocalBusMute('${inputName}', this)">Master Bus Mute: ON</button>
                    </div>
                `;
                container.appendChild(card);
            });
        }

        async function toggleLocalBusMute(guestName, btn) {
            const isMuted = btn.classList.contains('active');
            
            if (isMuted) {
                btn.classList.remove('active');
                btn.textContent = 'Master Bus Mute: OFF';
                await api.triggerAudioMute(guestName, false);
            } else {
                btn.classList.add('active');
                btn.textContent = 'Master Bus Mute: ON';
                await api.triggerAudioMute(guestName, true);
            }
        }
