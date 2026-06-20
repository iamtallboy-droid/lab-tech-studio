/* Module: overlays — extracted from app.js */
/* Overlay manager tab logic: subtabs, ticker source, sliders, directional pad, canvas ratio, preview/launch, lower third, VMix URL, cam slots */

        function switchSubTab(subId) {
            document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));

            document.getElementById(subId).classList.add('active');
            
            const btnId = 'sub-btn-' + subId.replace('sub-', '');
            const subBtn = document.getElementById(btnId);
            if (subBtn) subBtn.classList.add('active');
            
            selectedSubTab = subId;
        }

        function syncRatioButtons() {
            const ratioHoriz = document.getElementById('canvas-ratio-horiz');
            const ratioVert = document.getElementById('canvas-ratio-vert');
            const previewViewport = document.getElementById('preview-frame-container');

            ratioHoriz.classList.remove('active');
            ratioVert.classList.remove('active');

            if (activeCanvasRatio === 'vertical') {
                ratioVert.classList.add('active');
                previewViewport.style.width = '320px';
                previewViewport.style.aspectRatio = '9/16';
            } else {
                ratioHoriz.classList.add('active');
                previewViewport.style.width = '100%';
                previewViewport.style.aspectRatio = '16/9';
            }
            localStorage.setItem('labtech_canvas_mode', activeCanvasRatio);
        }

        // -------------------------------------------------------------
        // POSITION ALIGNMENT & GRANULAR / TURBO CONTROLS
        // -------------------------------------------------------------
        
        function handleSliderChange(type, value) {
            let topVal = parseInt(document.getElementById('slider-top').value);
            let leftVal = parseInt(document.getElementById('slider-left').value);
            let imgVal = parseInt(document.getElementById('slider-scale-img').value);
            let textVal = parseInt(document.getElementById('slider-scale-text').value);

            if (type === 'top') topVal = parseInt(value);
            if (type === 'left') leftVal = parseInt(value);
            if (type === 'image_scale') imgVal = parseInt(value);
            if (type === 'text_scale') textVal = parseInt(value);

            // Apply constraints
            imgVal = Math.max(10, Math.min(200, imgVal));
            textVal = Math.max(10, Math.min(200, textVal));

            // Synchronize state
            updatePositionCoordinates(topVal, leftVal, imgVal, textVal);
        }

        function stepSlider(type, direction, event) {
            event.stopPropagation();
            
            // Check shift modifier for 5% step vs 1% default step
            const step = event.shiftKey ? 5 : 1;
            
            const sliderId = type === 'top' ? 'slider-top' :
                             type === 'left' ? 'slider-left' :
                             type === 'image_scale' ? 'slider-scale-img' : 'slider-scale-text';
                             
            const slider = document.getElementById(sliderId);
            let currentVal = parseInt(slider.value);
            let newVal = currentVal + (direction * step);

            // Apply constraints
            if (type === 'image_scale' || type === 'text_scale') {
                newVal = Math.max(10, Math.min(200, newVal));
            } else {
                newVal = Math.max(0, Math.min(100, newVal));
            }

            slider.value = newVal;
            handleSliderChange(type, newVal);
        }

        function adjustDirection(direction, event) {
            // Arrow click moving canvas container
            const step = event.shiftKey ? 5 : 1;
            
            let topVal = parseInt(document.getElementById('slider-top').value);
            let leftVal = parseInt(document.getElementById('slider-left').value);
            
            if (direction === 'up') topVal = Math.max(0, topVal - step);
            if (direction === 'down') topVal = Math.min(100, topVal + step);
            if (direction === 'left') leftVal = Math.max(0, leftVal - step);
            if (direction === 'right') leftVal = Math.min(100, leftVal + step);

            document.getElementById('slider-top').value = topVal;
            document.getElementById('slider-left').value = leftVal;
            
            handleSliderChange('top', topVal);
        }

        function resetAlignment() {
            document.getElementById('slider-top').value = 85;
            document.getElementById('slider-left').value = 5;
            document.getElementById('slider-scale-img').value = 100;
            document.getElementById('slider-scale-text').value = 100;

            updatePositionCoordinates(85, 5, 100, 100);
        }

        function setCanvasRatio(ratio) {
            activeCanvasRatio = ratio;
            syncRatioButtons();
            
            // Trigger full reload configuration sync
            refreshState();
        }

        // -------------------------------------------------------------
        // VMIX GRAPHICAL UTILITIES
        // -------------------------------------------------------------
        
        function toggleOverlayGuides() {
            const check = document.getElementById('cam-guides-check');
            check.checked = !check.checked;
            updateShowSettings();
        }

        function handleCamSlotsChange(val) {
            updateShowSettings();
        }

        function launchOverlayTarget() {
            const targetUrl = document.getElementById('vmix-url-text').textContent;
            window.open(targetUrl, 'StreamOverlayTarget', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        }

        function copyVmixUrl() {
            const text = document.getElementById('vmix-url-text').textContent;
            navigator.clipboard.writeText(text).then(() => {
                showToast('✓ vMix URL copied to clipboard', 'success');
            });
        }

        function setTickerSource(source) {
            const manualBtn = document.getElementById('ticker-src-manual');
            const rssBtn = document.getElementById('ticker-src-rss');
            const manualText = document.getElementById('ticker-manual-entries');
            const rssSelect = document.getElementById('ticker-rss-entries');

            manualBtn.classList.remove('active');
            rssBtn.classList.remove('active');

            if (source === 'rss') {
                rssBtn.classList.add('active');
                manualText.classList.add('hidden');
                rssSelect.classList.remove('hidden');
            } else {
                manualBtn.classList.add('active');
                manualText.classList.remove('hidden');
                rssSelect.classList.add('hidden');
            }
        }

        // ================================================================
        // LOWER THIRD LIVE PUSH FUNCTIONS
        // ================================================================
        function pushLowerThirdLive() {
            const impactHeadline = document.getElementById('lt-impact-input')?.value || '';
            const contextSubline = document.getElementById('lt-context-input')?.value || '';
            const kicker = document.getElementById('lt-kicker-input')?.value || 'ON AIR';
            const guestName = document.getElementById('lt-name-input')?.value || '';
            const guestTitle = document.getElementById('lt-role-input')?.value || '';
            const guestHandle = document.getElementById('lt-handle-input')?.value || '';

            if (!impactHeadline && !guestName) {
                alert('Enter an Impact Headline or Guest Name to push live.');
                return;
            }

            const style = document.getElementById('lt-style-select')?.value || 'standard';

            sendWSMessage('LOWER_THIRD_UPDATE', {
                impact_headline: impactHeadline,
                context_subline: contextSubline,
                kicker,
                guest_name: guestName,
                guest_title: guestTitle,
                guest_handle: guestHandle,
                style
            });

            // Flash the button to confirm push
            const btn = document.getElementById('lt-push-live-btn');
            if (btn) {
                btn.textContent = '✓ PUSHED LIVE';
                btn.style.background = '#2DD36F';
                setTimeout(() => {
                    btn.textContent = '▶ PUSH LIVE NOW';
                    btn.style.background = '';
                }, 2000);
            }

            showToast('✓ Lower Third PUSHED LIVE', 'success');
        }

        function clearLowerThirdLive() {
            sendWSMessage('LOWER_THIRD_UPDATE', {
                impact_headline: '',
                context_subline: '',
                kicker: '',
                guest_name: '',
                guest_title: '',
                guest_handle: ''
            });

            showToast('Lower Third cleared', 'warning');
        }

        // =============================================================
        // OVERLAY LOCK TOGGLE
        // =============================================================
        let overlayLocked = false;

        function toggleOverlayLock() {
            overlayLocked = !overlayLocked;
            const btn = document.getElementById('overlay-lock-btn');
            const contentArea = document.querySelector('.subtabs-content-area');
            
            if (overlayLocked) {
                btn.textContent = '🔒 Locked';
                btn.classList.add('locked');
                contentArea.classList.add('overlay-locked');
                showToast('🔒 Overlay controls LOCKED', 'warning');
            } else {
                btn.textContent = '🔓 Unlocked';
                btn.classList.remove('locked');
                contentArea.classList.remove('overlay-locked');
                showToast('🔓 Overlay controls unlocked', 'success');
            }
        }
