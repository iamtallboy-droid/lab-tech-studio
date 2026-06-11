/* Module: shortcuts — keyboard shortcut handler for Lab Tech Studio */

(function() {
    'use strict';

    // Shortcut registry — map key combos to actions
    const shortcuts = {
        // Alt+1-7: Switch main tabs
        'alt+1': () => switchMainTab('tab-overlays'),
        'alt+2': () => switchMainTab('tab-rundown'),
        'alt+3': () => switchMainTab('tab-calendar'),
        'alt+4': () => switchMainTab('tab-brief'),
        'alt+5': () => switchMainTab('tab-merch'),
        'alt+6': () => switchMainTab('tab-media'),
        'alt+7': () => { switchMainTab('tab-community'); loadCommunityStatus(); },

        // Ctrl+1-5: Switch overlay subtabs
        'ctrl+1': () => switchSubTab('sub-ticker'),
        'ctrl+2': () => switchSubTab('sub-cta'),
        'ctrl+3': () => switchSubTab('sub-lt'),
        'ctrl+4': () => switchSubTab('sub-cams'),
        'ctrl+5': () => switchSubTab('sub-rotator'),

        // Production actions
        'ctrl+l': () => { if (typeof pushLowerThirdLive === 'function') pushLowerThirdLive(); },
        'ctrl+k': () => { if (typeof clearLowerThirdLive === 'function') clearLowerThirdLive(); },
        'ctrl+m': () => { if (typeof toggleLiveMode === 'function') toggleLiveMode(); },
        'ctrl+arrowright': () => { if (typeof advanceRundownSegment === 'function') advanceRundownSegment(); },
        
        // Emergency
        'escape': () => { if (typeof clearAllOverlays === 'function') clearAllOverlays(); },
    };

    // Check if user is typing in an input field
    function isTyping() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    // Build key combo string from event
    function getKeyCombo(e) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        
        let key = e.key.toLowerCase();
        // Normalize arrow keys
        if (key === 'arrowright') key = 'arrowright';
        if (key === 'arrowleft') key = 'arrowleft';
        if (key === 'arrowup') key = 'arrowup';
        if (key === 'arrowdown') key = 'arrowdown';
        
        // Don't add modifier keys as the main key
        if (['control', 'alt', 'shift', 'meta'].includes(key)) return '';
        
        parts.push(key);
        return parts.join('+');
    }

    // Main keydown handler
    document.addEventListener('keydown', function(e) {
        // Allow Escape even when typing (it's the panic button)
        if (e.key === 'Escape') {
            e.preventDefault();
            if (shortcuts['escape']) shortcuts['escape']();
            return;
        }
        
        // Don't intercept when typing in form fields
        if (isTyping()) return;
        
        const combo = getKeyCombo(e);
        if (combo && shortcuts[combo]) {
            e.preventDefault();
            shortcuts[combo]();
        }
    });

    // =============================================================
    // EXTERNAL CONTROLLER API
    // =============================================================
    // Expose API for Stream Deck, MIDI, X-keys integration via WebSocket
    window.labTechShortcuts = {
        // Execute a registered shortcut by name
        execute: function(comboName) {
            if (shortcuts[comboName]) {
                shortcuts[comboName]();
                return true;
            }
            return false;
        },
        
        // Register a custom shortcut
        register: function(comboName, handler) {
            shortcuts[comboName] = handler;
        },
        
        // List all registered shortcuts
        list: function() {
            return Object.keys(shortcuts);
        },

        // Execute an action by function name (for Stream Deck / MIDI mapping)
        action: function(actionName, ...args) {
            const fn = window[actionName];
            if (typeof fn === 'function') {
                fn(...args);
                return true;
            }
            return false;
        }
    };
})();
