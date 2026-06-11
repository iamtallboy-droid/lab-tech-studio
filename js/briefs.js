/* Module: briefs — extracted from app.js */
/* Briefs tab logic: brief list rendering, brief editor, brief CRUD, field updates */

        // -------------------------------------------------------------
        // EPISODE BRIEFS PLANNER
        // -------------------------------------------------------------
        
        async function renderBriefsView() {
            const container = document.getElementById('brief-list-container');
            container.innerHTML = '';

            const briefs = await api.fetchBriefs(activeShowId);
            
            if (briefs.length === 0) {
                container.innerHTML = '<div class="no-selection-message">No briefs compiled. Add one above.</div>';
                return;
            }

            briefs.forEach(brief => {
                const card = document.createElement('div');
                card.className = `brief-list-card ${selectedBriefId === brief.brief_id ? 'active' : ''}`;
                card.onclick = () => selectBrief(brief.brief_id);
                
                card.innerHTML = `
                    <div class="b-date">${brief.brief_date}</div>
                    <div class="b-obj">${escapeHtml(brief.objective || 'General show planning')}</div>
                `;
                container.appendChild(card);
            });

            if (selectedBriefId) {
                renderBriefEditor();
            }
        }

        async function selectBrief(id) {
            selectedBriefId = id;
            renderBriefsView();
        }

        async function openNewBriefModal() {
            const today = new Date().toISOString().split('T')[0];
            const briefData = {
                brief_id: `brief-${Date.now()}`,
                brief_date: today,
                objective: 'Episode Planning & Sponsor goals',
                talking_points: 'Talking point 1...\nTalking point 2...'
            };

            await api.saveBrief(activeShowId, briefData);
            selectedBriefId = briefData.brief_id;
            renderBriefsView();
        }

        async function renderBriefEditor() {
            const container = document.getElementById('brief-editor-container');
            const briefs = await api.fetchBriefs(activeShowId);
            const brief = briefs.find(b => b.brief_id === selectedBriefId);
            
            if (!brief) {
                container.innerHTML = '<div class="no-selection-message">Select an episode brief from the left side to edit.</div>';
                return;
            }

            container.innerHTML = `
                <div class="brief-editor-header">
                    <h4>Episode Brief: ${brief.brief_date}</h4>
                    <button class="btn btn-sm btn-danger" onclick="deleteBrief('${brief.brief_id}')">Delete Brief</button>
                </div>
                <div class="form-group">
                    <label>Episode Objective</label>
                    <input type="text" value="${escapeHtml(brief.objective)}" onchange="updateBriefField('objective', this.value)">
                </div>
                <div class="form-group">
                    <label>Key Talking Points (One per line)</label>
                    <textarea rows="8" onchange="updateBriefField('talking_points', this.value)">${escapeHtml(brief.talking_points)}</textarea>
                </div>
            `;
        }

        async function updateBriefField(field, value) {
            const briefs = await api.fetchBriefs(activeShowId);
            const brief = briefs.find(b => b.brief_id === selectedBriefId);
            if (brief) {
                brief[field] = value;
                await api.saveBrief(activeShowId, brief);
                renderBriefsView();
            }
        }

        async function deleteBrief(id) {
            await api.deleteBrief(activeShowId, id);
            selectedBriefId = null;
            renderBriefsView();
        }
