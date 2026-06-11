/* Module: toasts — non-blocking notification system for Lab Tech Studio */

(function() {
    'use strict';

    const MAX_VISIBLE = 3;
    const DEFAULT_DURATION = 2500;

    // Create container on load
    let container = null;
    function ensureContainer() {
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    // Icon map
    const icons = {
        success: '✓',
        warning: '⚠️',
        error: '✕'
    };

    /**
     * Show a toast notification
     * @param {string} message - The message text
     * @param {string} type - 'success' | 'warning' | 'error'
     * @param {number} duration - Auto-dismiss time in ms (default 2500)
     */
    window.showToast = function(message, type = 'success', duration = DEFAULT_DURATION) {
        const c = ensureContainer();

        // Enforce max visible
        while (c.children.length >= MAX_VISIBLE) {
            const oldest = c.firstElementChild;
            if (oldest) dismissToast(oldest, 0);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || '●'}</span>
            <span class="toast-msg">${message}</span>
        `;

        c.appendChild(toast);

        // Auto-dismiss
        const timer = setTimeout(() => dismissToast(toast), duration);
        toast._timer = timer;

        // Click to dismiss early
        toast.addEventListener('click', () => {
            clearTimeout(timer);
            dismissToast(toast);
        });
    };

    function dismissToast(toast, delay = 250) {
        if (toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._timer);

        toast.classList.add('dismissing');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, delay);
    }
})();
