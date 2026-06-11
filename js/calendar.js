/* Module: calendar — extracted from app.js */
/* Calendar tab logic: grid rendering, event modal open/close, event CRUD, date navigation */

        // -------------------------------------------------------------
        // CALENDAR PLANNER
        // -------------------------------------------------------------
        
        async function renderCalendarView() {
            const grid = document.getElementById('calendar-grid-cells');
            grid.innerHTML = '';

            const events = await api.fetchCalendar(activeShowId);
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth(); // 0-indexed
            
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            // Populate empty cells for preceding days
            for (let i = 0; i < firstDay; i++) {
                const cell = document.createElement('div');
                cell.className = 'cal-cell empty';
                grid.appendChild(cell);
            }

            // Populate days
            for (let day = 1; day <= daysInMonth; day++) {
                const cell = document.createElement('div');
                cell.className = 'cal-cell';
                
                const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                
                cell.innerHTML = `
                    <span class="day-num">${day}</span>
                    <div class="events-list" id="events-${dateStr}"></div>
                `;
                grid.appendChild(cell);
            }

            // Bind events
            events.forEach(evt => {
                const list = document.getElementById(`events-${evt.event_date}`);
                if (list) {
                    const block = document.createElement('div');
                    block.className = 'event-block';
                    block.title = evt.description || '';
                    block.innerHTML = `
                        <span class="e-title">${escapeHtml(evt.title)}</span>
                        <button class="e-del" onclick="deleteCalendarEvent('${evt.event_id}', event)">&times;</button>
                    `;
                    list.appendChild(block);
                }
            });
        }

        function openAddEventModal() {
            document.getElementById('calendar-modal').classList.add('show');
        }

        function closeCalendarModal() {
            document.getElementById('calendar-modal').classList.remove('show');
        }

        async function submitCalendarEvent() {
            const date = document.getElementById('cal-event-date').value;
            const title = document.getElementById('cal-event-title').value.trim();
            const desc = document.getElementById('cal-event-desc').value.trim();

            if (!date || !title) {
                alert('Date and Title are required!');
                return;
            }

            const eventData = {
                event_id: `evt-${Date.now()}`,
                event_date: date,
                title: title,
                description: desc
            };

            await api.saveCalendarEvent(activeShowId, eventData);
            closeCalendarModal();
            renderCalendarView();
        }

        async function deleteCalendarEvent(id, event) {
            event.stopPropagation();
            await api.deleteCalendarEvent(activeShowId, id);
            renderCalendarView();
        }
