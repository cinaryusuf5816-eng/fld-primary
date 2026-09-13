/* Personal account settings. Passwords are sent only to the session API. */
(() => {
    'use strict';
    const element = id => document.getElementById(id);
    const auth = window.FldAuth;
    const preferences = window.FldPreferences;
    const roles = { admin: 'Admin', coordinator: 'Coordinator', teacher: 'Teacher' };
    let profileBusy = false;
    let passwordBusy = false;
    let savedName = '';

    function message(id, text, error = false) {
        const node = element(id);
        node.textContent = text;
        node.hidden = !text;
        node.classList.toggle('error', error);
    }
    function profileControls() {
        element('save-profile').disabled = profileBusy || !auth?.user || element('profile-name').value.trim() === savedName;
        element('profile-name').disabled = profileBusy;
        element('save-profile').textContent = profileBusy ? 'Saving…' : 'Save profile';
    }
    function renderProfile(user, resetName = false) {
        const dirty = element('profile-name').value.trim() !== savedName;
        savedName = user.full_name;
        if (resetName || !dirty) element('profile-name').value = savedName;
        element('profile-email').value = user.email;
        element('profile-role').value = roles[user.role];
        element('account-name').textContent = user.full_name;
        element('account-role').textContent = roles[user.role];
        const parts = user.full_name.trim().split(/\s+/).filter(Boolean);
        element('account-initials').textContent = (parts.length > 1 ? [parts[0], parts.at(-1)] : parts)
            .map(part => Array.from(part)[0]).join('').toLocaleUpperCase('en');
        profileControls();
    }
    function renderPreferences() {
        const values = preferences.read();
        element('preference-sidebar').value = values.sidebarCollapsed ? 'collapsed' : 'expanded';
        element('preference-motion').checked = values.reduceMotion;
    }
    function navigateSection(focus = false) {
        const section = ['#profile', '#security', '#preferences'].includes(location.hash) ? location.hash : '#profile';
        document.querySelectorAll('.settings-navigation > a').forEach(link => {
            if (link.hash === section) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
        if (focus && !element('settings-content').hidden) {
            document.querySelector(section).scrollIntoView({ block: 'start' });
            element(`${section.slice(1)}-heading`).focus({ preventScroll: true });
        }
    }

    element('profile-name').addEventListener('input', () => { message('profile-message', ''); profileControls(); });
    element('profile-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (profileBusy || !auth?.user || !event.currentTarget.reportValidity()) return;
        const fullName = element('profile-name').value.trim();
        if (!fullName || fullName.length > 120) return message('profile-message', 'Enter a full name with 1–120 characters.', true);
        if (fullName === savedName) return;
        profileBusy = true;
        profileControls();
        message('profile-message', '');
        try {
            const result = await auth.request('/api/auth/profile', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: fullName })
            });
            auth.setUser(result.user);
            renderProfile(result.user, true);
            message('profile-message', 'Profile saved.');
        } catch (error) {
            if (error.status !== 401) message('profile-message', error.status === 400
                ? 'Check your name and try again.' : 'Your changes could not be confirmed. Reload the page to check your profile before trying again.', true);
        } finally {
            profileBusy = false;
            profileControls();
        }
    });

    function clearPasswords() {
        for (const id of ['current-password', 'new-password', 'confirm-password']) element(id).value = '';
    }
    element('password-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (passwordBusy || !auth?.user || !event.currentTarget.reportValidity()) return;
        message('password-message', '');
        const payload = { current_password: element('current-password').value, new_password: element('new-password').value };
        if (payload.new_password !== element('confirm-password').value) return message('password-message', 'The new passwords do not match. Check both fields.', true);
        if (payload.current_password === payload.new_password) return message('password-message', 'Choose a different new password.', true);
        if (payload.new_password.length < 12 || payload.new_password.length > 128 || new TextEncoder().encode(payload.new_password).length > 512) {
            return message('password-message', 'Use a new password with 12–128 characters.', true);
        }
        passwordBusy = true;
        element('password-fields').disabled = true;
        element('change-password').disabled = true;
        element('change-password').textContent = 'Changing password…';
        clearPasswords();
        try {
            await auth.request('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            message('password-message', 'Password changed. Redirecting to sign in…');
            location.replace('login.html?password=changed');
        } catch (error) {
            if (error.status !== 401) message('password-message', error.status === 400
                ? 'Check your current password and try again with a different new password.'
                : error.status === 429 ? 'Too many attempts. Wait 15 minutes before trying again.'
                : 'The password change could not be confirmed. Try signing in with your new password before changing it again.', true);
        } finally {
            payload.current_password = '';
            payload.new_password = '';
            clearPasswords();
            passwordBusy = false;
            element('password-fields').disabled = false;
            element('change-password').disabled = false;
            element('change-password').textContent = 'Change password';
        }
    });
    window.addEventListener('pagehide', clearPasswords);

    element('preferences-form').addEventListener('submit', event => {
        event.preventDefault();
        const persisted = preferences.save({ sidebarCollapsed: element('preference-sidebar').value === 'collapsed', reduceMotion: element('preference-motion').checked });
        message('preferences-message', persisted ? 'Preferences saved.' : 'Applied for this page. Your browser prevented saving preferences.', !persisted);
    });
    element('reset-preferences').addEventListener('click', () => {
        const persisted = preferences.reset();
        renderPreferences();
        message('preferences-message', persisted ? 'Default preferences restored.' : 'Defaults applied for this page. Your browser prevented saving preferences.', !persisted);
    });
    window.addEventListener('fld:preferenceschange', renderPreferences);
    window.addEventListener('fld:userchange', event => renderProfile(event.detail));
    window.addEventListener('hashchange', () => navigateSection(true));
    auth?.ready.then(user => {
        if (!user) {
            element('settings-loading').textContent = 'Your account could not be loaded. Reload the page to try again.';
            return;
        }
        renderProfile(user, true);
        renderPreferences();
        element('settings-loading').hidden = true;
        element('settings-content').hidden = false;
        requestAnimationFrame(() => navigateSection(Boolean(location.hash)));
    });
})();
