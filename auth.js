/* Shared cookie-session integration; roles always come from the backend. */
(() => {
    'use strict';
    // These preferences are local to this browser; account permissions never are.
    const preferenceKeys = { sidebarCollapsed: 'fld-sidebar-collapsed', reduceMotion: 'fld-reduce-motion' };
    const temporaryPreferences = {};
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    function preferenceValue(name) {
        if (Object.hasOwn(temporaryPreferences, name)) return temporaryPreferences[name];
        try { return localStorage.getItem(preferenceKeys[name]); } catch { return null; }
    }
    function readPreferences() {
        const motion = preferenceValue('reduceMotion');
        return {
            sidebarCollapsed: preferenceValue('sidebarCollapsed') === 'true',
            reduceMotion: motion === null ? motionQuery.matches : motion === 'true'
        };
    }
    function applyPreferences() {
        const preferences = readPreferences();
        document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
        window.dispatchEvent(new CustomEvent('fld:preferenceschange', { detail: preferences }));
    }
    window.FldPreferences = {
        read: readPreferences,
        save(values) {
            let persisted = true;
            for (const name of Object.keys(preferenceKeys)) {
                if (typeof values?.[name] !== 'boolean') continue;
                const value = String(values[name]);
                try {
                    localStorage.setItem(preferenceKeys[name], value);
                    delete temporaryPreferences[name];
                } catch {
                    temporaryPreferences[name] = value;
                    persisted = false;
                }
            }
            applyPreferences();
            return persisted;
        },
        reset() {
            let persisted = true;
            for (const name of Object.keys(preferenceKeys)) {
                try {
                    localStorage.removeItem(preferenceKeys[name]);
                    delete temporaryPreferences[name];
                } catch {
                    temporaryPreferences[name] = null;
                    persisted = false;
                }
            }
            applyPreferences();
            return persisted;
        }
    };
    motionQuery.addEventListener('change', applyPreferences);
    window.addEventListener('storage', event => {
        if (event.key === null || Object.values(preferenceKeys).includes(event.key)) {
            for (const name of Object.keys(preferenceKeys)) delete temporaryPreferences[name];
            applyPreferences();
        }
    });
    applyPreferences();

    const configured = document.querySelector('meta[name="fld-api-base"]')?.content.trim();
    const apiBase = (configured || (location.protocol === 'http:' && location.port === '5500'
        ? `${location.protocol}//${location.hostname}:3000` : location.origin)).replace(/\/$/, '');
    const auth = { user: null, ready: null, request, setUser };
    window.FldAuth = auth;
    const roleLabels = { admin: 'Admin', coordinator: 'Coordinator', teacher: 'Teacher' };
    const visibility = document.createElement('style');
    visibility.textContent = '.profile-name:not([data-fld-profile-ready]),.profile-role:not([data-fld-profile-ready]){visibility:hidden}[data-admin-only][hidden]{display:none!important}';
    document.head.appendChild(visibility);

    function syncUserInterface() {
        const user = auth.user;
        const parts = String(user?.full_name || '').trim().split(/\s+/).filter(Boolean);
        const initials = (parts.length > 1 ? [parts[0], parts.at(-1)] : parts)
            .map(part => Array.from(part)[0]).join('').toLocaleUpperCase('en');
        document.querySelectorAll('[data-admin-only]').forEach(element => {
            element.hidden = user?.role !== 'admin';
        });
        for (const [selector, value] of [
            ['.profile-name', user?.full_name || ''],
            ['.profile-role', user ? roleLabels[user.role] : ''],
            ['[data-profile-initials]', initials]
        ]) {
            document.querySelectorAll(selector).forEach(element => {
                if (element.textContent !== value) element.textContent = value;
                if (user) element.dataset.fldProfileReady = 'true';
                else delete element.dataset.fldProfileReady;
            });
        }
        document.querySelectorAll('.sidebar-account-button').forEach(button => {
            button.disabled = !user;
            button.setAttribute('aria-label', user ? `Open account menu for ${user.full_name}` : 'Open account menu');
            button.title = user ? `${user.full_name} · ${roleLabels[user.role]}` : 'Account';
        });
    }
    function setUser(user) {
        if (!user?.id || !Object.hasOwn(roleLabels, user.role)) throw new Error('Session could not be verified.');
        auth.user = user;
        document.documentElement.dataset.role = user.role;
        syncUserInterface();
        window.dispatchEvent(new CustomEvent('fld:userchange', { detail: user }));
        return user;
    }
    // Sidebar and topbar arrive asynchronously. Attribute updates do not retrigger
    // this observer, and unchanged text is never rewritten.
    new MutationObserver(syncUserInterface).observe(document.documentElement, { childList: true, subtree: true });
    syncUserInterface();

    async function request(path, options = {}) {
        const response = await fetch(`${apiBase}${path}`, {
            ...options, credentials: 'include', cache: 'no-store',
            headers: { Accept: 'application/json', ...options.headers },
            signal: options.signal || AbortSignal.timeout(15000)
        });
        if (response.status === 401) {
            auth.user = null;
            delete document.documentElement.dataset.role;
            syncUserInterface();
            location.replace('login.html');
        }
        if (!response.ok) {
            let message;
            try { const result = await response.json(); if (typeof result.error === 'string') message = result.error; } catch { /* Keep the fallback for non-JSON errors. */ }
            const error = new Error(message || (response.status === 403 ? 'You do not have permission for this action.' : 'The request could not be completed.'));
            error.status = response.status;
            throw error;
        }
        return response.json();
    }

    auth.ready = request('/api/auth/me').then(session => {
        if (session.authenticated !== true || !session.user?.id || !Object.hasOwn(roleLabels, session.user.role)) throw new Error('Session could not be verified.');
        return setUser(session.user);
    }).catch(error => {
        if (error.status !== 401) {
            document.addEventListener('DOMContentLoaded', showUnavailable, { once: true });
            if (document.readyState !== 'loading') showUnavailable();
        }
        return null;
    });

    function showUnavailable() {
        if (document.getElementById('fld-auth-error')) return;
        const message = document.createElement('p');
        message.id = 'fld-auth-error';
        message.setAttribute('role', 'alert');
        message.textContent = 'Your session could not be verified. Check the backend connection and reload this page.';
        document.body.prepend(message);
    }

    document.addEventListener('click', async event => {
        const signout = event.target.closest('.sidebar-signout');
        if (!signout) return;
        event.preventDefault();
        try {
            await request('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            location.replace('login.html');
        } catch { alert('Sign out failed. Please try again.'); }
    });
})();
