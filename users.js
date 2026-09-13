(() => {
    'use strict';
    const auth = window.FldAuth;
    const element = id => document.getElementById(id);
    const pageSize = 20;
    const roles = { admin: 'Admin', coordinator: 'Coordinator', teacher: 'Teacher' };
    const hints = {
        admin: 'Admins manage accounts, grade access, resources and school content.',
        coordinator: 'Coordinators manage calendars, homework and resources across all grades. Only admins manage user accounts.',
        teacher: 'Teachers access assigned grades and Shared resources. They can add materials and manage their own homework.'
    };
    let users = [], offset = 0, hasNext = false, loading = false, saving = false, editing = null;
    const dialog = element('user-dialog');
    const form = element('user-form');

    function message(text, error = false) {
        const target = element('page-message');
        target.textContent = text;
        target.classList.toggle('error', error);
        target.hidden = !text;
    }
    function formMessage(text) {
        element('form-message').textContent = text;
        element('form-message').hidden = !text;
    }
    function clearPasswords() {
        element('user-password').value = '';
        element('user-confirmation').value = '';
    }
    function controls() {
        element('new-user').disabled = loading || saving || auth?.user?.role !== 'admin';
        element('refresh-users').disabled = loading || saving;
        element('previous-page').disabled = loading || saving || offset === 0;
        element('next-page').disabled = loading || saving || !hasNext;
        element('users-list').querySelectorAll('button').forEach(button => { button.disabled = loading || saving; });
    }
    function denied() {
        element('users-content').hidden = true;
        element('access-denied').hidden = false;
        element('new-user').hidden = true;
    }
    function cell(row, value, className = '') {
        const td = document.createElement('td');
        td.className = className;
        if (value instanceof Node) td.append(value); else td.textContent = value;
        row.append(td);
        return td;
    }
    function badge(label, className) {
        const span = document.createElement('span');
        span.className = `users-badge ${className}`;
        span.textContent = label;
        return span;
    }
    function renderUsers() {
        const rows = document.createDocumentFragment();
        for (const user of users) {
            const row = document.createElement('tr');
            const person = document.createElement('div');
            person.className = 'users-person';
            const avatar = document.createElement('span');
            avatar.className = 'users-avatar';
            avatar.setAttribute('aria-hidden', 'true');
            const name = user.full_name || user.email;
            avatar.textContent = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toLocaleUpperCase('en');
            const identity = document.createElement('div');
            identity.textContent = name;
            if (String(user.id) === String(auth.user.id)) {
                const self = document.createElement('span');
                self.className = 'users-self'; self.textContent = 'Your account'; identity.append(self);
            }
            person.append(avatar, identity);
            cell(row, person);
            cell(row, user.email, 'users-email');
            cell(row, badge(roles[user.role] || user.role, Object.hasOwn(roles, user.role) ? user.role : ''));
            cell(row, user.role === 'teacher' ? user.grades?.length ? user.grades.join(' · ') : 'Not assigned' : 'All grades', 'users-grade-cell');
            const state = badge(user.is_active ? 'Active' : 'Inactive', user.is_active ? 'active' : 'inactive');
            const dot = document.createElement('span'); dot.className = 'users-status-dot'; dot.setAttribute('aria-hidden', 'true'); state.prepend(dot);
            cell(row, state);
            const edit = document.createElement('button');
            edit.type = 'button'; edit.className = 'users-button secondary'; edit.textContent = 'Edit';
            edit.dataset.userId = String(user.id);
            edit.setAttribute('aria-label', `Edit account for ${name}`);
            edit.addEventListener('click', () => openForm(user));
            const actions = document.createElement('div'); actions.className = 'users-row-actions'; actions.append(edit);
            const remove = document.createElement('button');
            remove.type = 'button'; remove.className = 'users-button users-remove'; remove.textContent = 'Remove';
            remove.setAttribute('aria-label', `Remove account for ${name}`);
            remove.addEventListener('click', () => removeUser(user));
            actions.append(remove); cell(row, actions);
            rows.append(row);
        }
        element('users-list').replaceChildren(rows);
        element('users-table-wrap').hidden = !users.length;
        element('users-empty').hidden = users.length > 0;
        element('page-info').textContent = users.length ? `${offset + 1}–${offset + users.length} accounts · Page ${Math.floor(offset / pageSize) + 1}` : '0 accounts';
    }
    async function removeUser(user) {
        if (saving || loading || auth.user?.role !== 'admin') return;
        if (!(await window.FldConfirm.ask({
            title: 'Are you sure?',
            message: `Remove the account for ${user.full_name || user.email}? They will lose access and disappear from the user list. Their teaching history will be kept.`,
            confirmLabel: 'Remove user', danger: true
        }))) return;
        if (saving || loading || auth.user?.role !== 'admin') return;
        saving = true; controls();
        try {
            await auth.request(`/api/users/${encodeURIComponent(user.id)}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (String(user.id) === String(auth.user.id)) { location.replace('login.html'); return; }
            message('User removed. Their teaching history has been kept.');
            await loadUsers(offset);
            if (!users.length && offset > 0) await loadUsers(Math.max(0, offset - pageSize));
        } catch (error) {
            if (error.status !== 401) message(error.status === 409 ? 'The last active admin cannot be removed. Keep at least one active admin account.' : error.status === 403 ? 'Only an admin can remove users.' : 'The removal could not be confirmed. Refresh the list before trying again.', true);
        } finally { saving = false; controls(); }
    }
    function gradeFields() {
        const teacher = element('user-role').value === 'teacher';
        element('user-grade-fields').hidden = !teacher;
        element('role-hint').textContent = hints[element('user-role').value];
    }
    async function loadUsers(nextOffset = offset) {
        if (loading) return;
        loading = true; controls();
        element('users-loading').hidden = false;
        try {
            const result = await auth.request(`/api/users?limit=${pageSize + 1}&offset=${nextOffset}`);
            if (!Array.isArray(result.users)) throw new Error('INVALID_RESPONSE');
            offset = nextOffset;
            hasNext = result.users.length > pageSize;
            users = result.users.slice(0, pageSize);
            renderUsers();
        } catch (error) {
            if (error.status === 403) denied();
            else if (error.status !== 401) message('Accounts could not be loaded. Check the connection and select Refresh.', true);
        } finally {
            loading = false; element('users-loading').hidden = true; controls();
        }
    }
    function openForm(user = null) {
        if (saving || auth.user?.role !== 'admin') return;
        editing = user;
        form.reset(); clearPasswords(); formMessage('');
        element('dialog-title').textContent = user ? 'Edit account' : 'New user';
        element('dialog-description').textContent = user ? 'Update account details, role and access.' : 'Create an individual sign-in account.';
        element('save-user').textContent = user ? 'Save changes' : 'Create account';
        element('user-name').value = user?.full_name || '';
        element('user-email').value = user?.email || '';
        element('user-role').value = user?.role || 'teacher';
        element('user-active').value = String(user?.is_active ?? true);
        document.querySelectorAll('[data-user-grade]').forEach(input => { input.checked = Boolean(user?.grades?.includes(input.value)); });
        element('password-label').textContent = user ? 'New password (optional)' : 'Initial password';
        element('password-hint').textContent = user ? 'Leave both fields empty to keep the current password. A new password needs at least 12 characters and ends existing sessions.' : 'At least 12 characters. Share the email and password privately with the account owner.';
        element('user-password').required = !user;
        element('user-confirmation').required = !user;
        gradeFields();
        dialog.showModal();
        element('user-name').focus();
    }
    function closeForm() {
        if (saving) return;
        clearPasswords(); form.reset(); editing = null; dialog.close();
    }
    function savingState(value) {
        saving = value;
        element('user-fields').disabled = value;
        for (const id of ['save-user', 'close-dialog', 'cancel-dialog']) element(id).disabled = value;
        element('save-user').textContent = value ? 'Saving…' : editing ? 'Save changes' : 'Create account';
        controls();
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || !form.reportValidity()) return;
        formMessage('');
        let password = element('user-password').value;
        let confirmation = element('user-confirmation').value;
        if (password !== confirmation) return formMessage('The passwords do not match. Check both fields.');
        if ((!editing || password) && (password.length < 12 || password.length > 128 || new TextEncoder().encode(password).length > 512)) {
            return formMessage('Use a password with 12–128 characters.');
        }
        const values = { full_name: element('user-name').value.trim(), email: element('user-email').value.trim().toLowerCase(), role: element('user-role').value, is_active: element('user-active').value === 'true', grades: element('user-role').value === 'teacher' ? [...document.querySelectorAll('[data-user-grade]:checked')].map(input => input.value) : [] };
        if (!values.full_name) return formMessage('Enter a full name.');
        const payload = {};
        for (const [key, value] of Object.entries(values)) if (!editing || (key === 'grades' ? JSON.stringify(value) !== JSON.stringify(editing.grades || []) : value !== editing[key])) payload[key] = value;
        if (password) payload.password = password;
        if (!Object.keys(payload).length) { closeForm(); return; }
        const original = editing;
        savingState(true);
        clearPasswords(); password = ''; confirmation = '';
        try {
            const result = await auth.request(original ? `/api/users/${encodeURIComponent(original.id)}` : '/api/users', {
                method: original ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (original && String(original.id) === String(auth.user.id)) {
                auth.setUser(result.user);
            }
            message(original ? 'Account updated.' : `Account created for ${values.full_name}. Sign-in email: ${values.email}`);
            savingState(false); closeForm();
            await loadUsers(original ? offset : 0);
            if (original) Array.from(element('users-list').querySelectorAll('button')).find(button => button.dataset.userId === String(original.id))?.focus();
        } catch (error) {
            const text = error.status === 409 ? (original ? 'This email may already be in use, or this change would remove the last active admin.' : 'This email is already associated with an account. Use a different email.')
                : error.status === 403 ? 'Admin access is required. Your account permissions may have changed.'
                : error.status === 400 ? 'Check the details. Use a valid email, full name and a password with at least 12 characters.'
                : 'The result could not be confirmed. Refresh the list and check the account before trying again.';
            if (error.status !== 401) formMessage(text);
        } finally {
            if ('password' in payload) payload.password = '';
            clearPasswords(); savingState(false);
        }
    });
    element('new-user').addEventListener('click', () => openForm());
    element('refresh-users').addEventListener('click', () => { message(''); loadUsers(); });
    element('previous-page').addEventListener('click', () => loadUsers(Math.max(0, offset - pageSize)));
    element('next-page').addEventListener('click', () => loadUsers(offset + pageSize));
    element('close-dialog').addEventListener('click', closeForm);
    element('cancel-dialog').addEventListener('click', closeForm);
    element('user-role').addEventListener('change', gradeFields);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else clearPasswords(); });
    dialog.addEventListener('close', () => { clearPasswords(); if (!saving) { form.reset(); editing = null; } });
    auth?.ready.then(async user => {
        if (!user) return;
        if (user.role !== 'admin') { denied(); return; }
        element('users-content').hidden = false;
        await loadUsers(0);
    });
})();
