(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const R = window.FldHomeworkReport;
    const auth = window.FldAuth;
    let items = [], legacy = [], editing = null, busy = false, user = null;
    let materialIds = new Set(), pickerSequence = 0, pickerLoading = false, pickerFailed = false;
    let duplicateAcknowledgement = '', duplicateCandidate = '';
    const allGrades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
    const allowedGrades = () => user?.role === 'teacher' ? allGrades.filter(grade => user.grades?.includes(grade)) : allGrades;
    const writable = homework => user && (user.role !== 'teacher' || allowedGrades().includes(homework.grade) && String(homework.created_by) === String(user.id));
    function message(element, text, error = false) {
        element.textContent = text;
        element.classList.toggle('error', error);
        element.hidden = !text;
    }
    function fail(error) {
        if (error.status === 403) return 'You do not have permission to change this homework.';
        if (error.status === 409) return 'This change conflicts with saved student checks. Keep the original class and try again.';
        if (error.status === 400) return 'Check the title, class and dates. The due date cannot be before the assignment date.';
        return 'Homework could not be saved. Check your connection and try again.';
    }
    async function request(path, method, body) {
        return auth.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    function card(homework) {
        const today = R.schoolToday();
        const state = homework.is_archived ? 'Archived' : homework.assign_date > today ? 'Scheduled' : homework.due_date < today ? 'Past due' : homework.due_date === today ? 'Due today' : 'Assigned';
        const permission = writable(homework);
        return `<article class="hw-assignment"><div class="hw-assignment-top"><span class="hw-tag">${R.escape(homework.grade)} · ${R.escape(homework.class_name)}</span><span class="hw-assignment-state ${homework.is_archived ? 'archived' : ''}">${state}</span></div><h3>${R.escape(homework.title)}</h3>${homework.pages ? `<p class="hw-hint">Pages / section: ${R.escape(homework.pages)}</p>` : ''}${homework.description ? `<p class="hw-assignment-description">${R.escape(homework.description)}</p>` : ''}${homework.materials?.length ? `<div class="mat-homework-links">${homework.materials.map(material => `<a href="archive.html?material=${encodeURIComponent(material.id)}"><i class="fa-solid fa-paperclip" aria-hidden="true"></i> ${R.escape(material.title)}</a>`).join('')}</div>` : ''}<div class="hw-assignment-dates"><span>Assigned <strong>${R.formatDate(homework.assign_date)}</strong></span><span>Due <strong>${R.formatDate(homework.due_date)}</strong></span></div><footer><a class="hw-text-link" href="homework-check.html?homework=${encodeURIComponent(homework.id)}">View checks <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a><div>${permission && !homework.is_archived ? `<button type="button" class="hw-action" data-edit="${R.escape(homework.id)}">Edit</button><button type="button" class="hw-action muted" data-archive="${R.escape(homework.id)}">Archive</button>` : `<span class="hw-hint">${homework.is_archived ? 'History preserved' : 'View only'}</span>`}</div></footer></article>`;
    }
    function render() {
        const grade = $('filter-grade').value, className = $('filter-class').value, query = $('filter-search').value.trim().toLowerCase();
        const visible = items.filter(item => (!grade || item.grade === grade) && (!className || item.class_name === className) && ($('filter-archived').checked || !item.is_archived) && (!query || `${item.title} ${item.description}`.toLowerCase().includes(query)));
        const today = R.schoolToday();
        const assigned = visible.filter(item => item.assign_date <= today).sort((a, b) => b.assign_date.localeCompare(a.assign_date) || b.due_date.localeCompare(a.due_date));
        const upcoming = visible.filter(item => item.assign_date > today).sort((a, b) => a.assign_date.localeCompare(b.assign_date) || a.due_date.localeCompare(b.due_date));
        for (const [group, records] of [['assigned', assigned], ['upcoming', upcoming]]) {
            $(`${group}-count`).textContent = records.length;
            $(`${group}-list`).innerHTML = records.length ? records.map(card).join('') : `<p class="hw-empty">No ${group} homework matches these filters.</p>`;
        }
    }
    async function load() {
        const result = await auth.request('/api/homework');
        items = result.homeworks;
        render();
    }
    function changed() {
        window.dispatchEvent(new CustomEvent('fld:homeworkchange'));
    }
    function invalidateDuplicateWarning() {
        duplicateAcknowledgement = ''; duplicateCandidate = '';
        $('homework-duplicate-warning').hidden = true;
    }
    async function loadMaterialChoices() {
        const sequence = ++pickerSequence, grade = $('homework-grade').value;
        if (!allowedGrades().includes(grade)) return;
        pickerLoading = true; pickerFailed = false; $('save-homework').disabled = true;
        $('homework-materials-list').innerHTML = '<p class="mat-picker-empty">Loading available materials…</p>';
        try {
            const result = await auth.request(`/api/materials?${new URLSearchParams({ grade, include_archived: 'true' })}`);
            if (sequence !== pickerSequence) return;
            const originalIds = new Set((editing?.material_ids || editing?.materials?.map(material => material.id) || []).map(String));
            const options = result.materials.filter(material => (!material.grades?.length || material.grades.includes(grade)) && (!material.is_archived || originalIds.has(String(material.id))));
            const ids = new Set(options.map(material => String(material.id)));
            const removed = [...materialIds].filter(id => !ids.has(id)).length;
            materialIds = new Set([...materialIds].filter(id => ids.has(id)));
            $('homework-materials-list').innerHTML = options.length ? options.map(material => `<label><input type="checkbox" data-homework-material="${R.escape(material.id)}" ${materialIds.has(String(material.id)) ? 'checked' : ''}><span>${R.escape(material.title)}<small>${material.grades?.length ? R.escape(material.grades.join(' · ')) : 'Shared'} · ${R.escape(material.category || 'Other')}${material.is_archived ? ' · Archived, currently attached' : ''}</small></span></label>`).join('') : '<p class="mat-picker-empty">No materials are available for this grade yet. Add resources in the Materials library to use them here.</p>';
            $('homework-materials-hint').textContent = removed ? `${removed} resource${removed === 1 ? ' was' : 's were'} removed from this selection because they are unavailable for the selected grade.` : 'Select up to 30 resources. The same library files can also be used in calendar events.';
        } catch {
            if (sequence !== pickerSequence) return;
            pickerFailed = true;
            $('homework-materials-list').innerHTML = '<p class="mat-picker-empty">The library could not be loaded. Existing attachments are kept.</p><button type="button" class="hw-button secondary" id="retry-homework-materials">Retry library</button>';
        } finally { if (sequence === pickerSequence) { pickerLoading = false; $('save-homework').disabled = busy; } }
    }
    function openForm(homework = null) {
        if (busy || !allowedGrades().length) return;
        editing = homework;
        $('homework-form').reset();
        $('homework-dialog-title').textContent = homework ? 'Edit homework' : 'New homework';
        $('save-homework').textContent = homework ? 'Save changes' : 'Create homework';
        $('homework-title').value = homework?.title || '';
        $('homework-pages').value = homework?.pages || '';
        $('homework-description').value = homework?.description || '';
        $('homework-grade').value = homework?.grade || $('filter-grade').value || allowedGrades()[0];
        $('homework-class').value = homework?.class_name || $('filter-class').value || 'A';
        $('homework-assign-date').value = homework?.assign_date || R.schoolToday();
        $('homework-due-date').value = homework?.due_date || R.schoolToday();
        $('homework-due-date').min = $('homework-assign-date').value;
        message($('homework-form-message'), '');
        materialIds = new Set((homework?.material_ids || homework?.materials?.map(material => material.id) || []).map(String));
        invalidateDuplicateWarning();
        $('homework-dialog').showModal();
        $('homework-title').focus();
        loadMaterialChoices();
    }
    $('add-homework-button').addEventListener('click', () => openForm());
    for (const id of ['filter-grade', 'filter-class', 'filter-search', 'filter-archived']) $(id).addEventListener(id === 'filter-search' ? 'input' : 'change', render);
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => { if (!busy) $('homework-dialog').close(); }));
    $('homework-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('homework-dialog').addEventListener('close', () => { pickerSequence++; pickerLoading = false; });
    $('homework-assign-date').addEventListener('change', () => { $('homework-due-date').min = $('homework-assign-date').value; });
    $('homework-grade').addEventListener('change', loadMaterialChoices);
    $('homework-form').addEventListener('input', invalidateDuplicateWarning);
    $('homework-form').addEventListener('change', invalidateDuplicateWarning);
    $('homework-materials-list').addEventListener('click', event => { if (event.target.closest('#retry-homework-materials')) loadMaterialChoices(); });
    $('homework-materials-list').addEventListener('change', event => {
        const input = event.target.closest('[data-homework-material]'); if (!input) return;
        if (input.checked && materialIds.size >= 30) { input.checked = false; message($('homework-form-message'), 'Choose no more than 30 library materials.', true); return; }
        if (input.checked) materialIds.add(input.dataset.homeworkMaterial); else materialIds.delete(input.dataset.homeworkMaterial);
    });
    $('homework-save-anyway').addEventListener('click', () => { if (!busy && duplicateCandidate) { duplicateAcknowledgement = duplicateCandidate; $('homework-form').requestSubmit(); } });
    $('homework-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || pickerLoading || !$('homework-form').reportValidity()) return;
        const body = { title: $('homework-title').value.trim(), pages: $('homework-pages').value.trim(), description: $('homework-description').value.trim(), grade: $('homework-grade').value, class_name: $('homework-class').value, assign_date: $('homework-assign-date').value, due_date: $('homework-due-date').value, material_ids: [...materialIds] };
        if (!allowedGrades().includes(body.grade)) return message($('homework-form-message'), 'Choose one of your assigned grades.', true);
        if (pickerFailed && materialIds.size && body.grade !== editing?.grade) return message($('homework-form-message'), 'Reload the library before saving attachments for a different grade.', true);
        if (!body.title || body.due_date < body.assign_date) return message($('homework-form-message'), 'Enter a title and set the due date on or after the assignment date.', true);
        message($('homework-form-message'), '');
        busy = true;
        $('homework-fields').disabled = true;
        $('save-homework').disabled = true;
        try {
            const duplicateQuery = { title: body.title, pages: body.pages, grade: body.grade, class_name: body.class_name, ...(editing ? { exclude_id: editing.id } : {}) };
            const signature = JSON.stringify(duplicateQuery);
            if (duplicateAcknowledgement !== signature) {
                const result = await request('/api/homework/check-duplicates', 'POST', duplicateQuery);
                if (result.duplicates.length) {
                    duplicateCandidate = signature;
                    $('homework-duplicates').innerHTML = result.duplicates.map(item => `<li><a href="homework-check.html?homework=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">${R.escape(item.title)}${item.pages ? ` · ${R.escape(item.pages)}` : ''}</a><small>${item.is_archived ? 'Archived' : item.assign_date > R.schoolToday() ? 'Scheduled' : 'Assigned'} · Assignment date ${R.formatDate(item.assign_date)} · Due ${R.formatDate(item.due_date)}</small></li>`).join('');
                    $('homework-duplicate-warning').hidden = false;
                    $('homework-duplicate-warning').scrollIntoView({ block: 'nearest' });
                    return;
                }
            }
            await request(editing ? `/api/homework/${encodeURIComponent(editing.id)}` : '/api/homework', editing ? 'PATCH' : 'POST', body);
            $('homework-dialog').close();
            changed();
            message($('hw-message'), editing ? 'Homework updated.' : 'Homework created. Open Homework Check to record student progress.');
            try { await load(); }
            catch { message($('hw-message'), 'Homework was saved, but the list could not be refreshed. Reload this page to see the saved assignment.', true); }
        } catch (error) { message($('homework-form-message'), !editing && (!error.status || error.status >= 500) ? 'The result could not be confirmed. Close this form and reload the page before retrying to avoid a duplicate assignment.' : fail(error), true); }
        finally { busy = false; $('homework-fields').disabled = false; $('save-homework').disabled = pickerLoading; }
    });
    document.querySelector('.hw-overview').addEventListener('click', async event => {
        const edit = event.target.closest('[data-edit]'), archive = event.target.closest('[data-archive]');
        if (busy || (!edit && !archive)) return;
        const homework = items.find(item => String(item.id) === String((edit || archive).dataset[edit ? 'edit' : 'archive']));
        if (!homework || !writable(homework)) return;
        if (edit) return openForm(homework);
        if (!(await window.FldConfirm.ask({
            title: 'Are you sure?',
            message: `Archive “${homework.title}”? It will leave the active homework list and new checks will be disabled. Saved student checks and reports will be preserved.`,
            confirmLabel: 'Archive homework', danger: true
        }))) return;
        if (busy || !writable(homework)) return;
        busy = true;
        archive.disabled = true;
        try {
            await request(`/api/homework/${encodeURIComponent(homework.id)}`, 'PATCH', { is_archived: true });
            changed();
            message($('hw-message'), 'Homework archived. Its saved checks remain available in student reports.');
            try { await load(); }
            catch { message($('hw-message'), 'Homework was archived, but the list could not be refreshed. Reload this page to see its latest state.', true); }
        } catch (error) { message($('hw-message'), fail(error), true); }
        finally { busy = false; archive.disabled = false; }
    });
    const fingerprint = item => JSON.stringify([item.title.trim(), (item.description || '').trim(), item.grade, item.class_name, item.assign_date, item.due_date]);
    function readLegacy() {
        try {
            const data = JSON.parse(localStorage.getItem('fld-homework-overview-v1') || '[]');
            if (!Array.isArray(data)) return;
            const seen = new Set();
            legacy = data.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => ({ title: item.title, description: item.description || '', grade: item.grade, class_name: item.className, assign_date: item.assignDate, due_date: item.dueDate })).filter(item => {
                try {
                    R.range(item.assign_date); R.range(item.due_date);
                    if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 500 || typeof item.description !== 'string' || item.description.length > 10000 || !allowedGrades().includes(item.grade) || !/^[A-G]$/.test(item.class_name) || item.due_date < item.assign_date) return false;
                    const key = fingerprint(item);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                } catch { return false; }
            });
            $('legacy-notice').hidden = !legacy.length;
        } catch { /* Original browser data stays untouched, including invalid data. */ }
    }
    $('review-import').addEventListener('click', () => {
        const existing = new Set(items.map(fingerprint));
        $('import-list').innerHTML = legacy.map((item, index) => `<tr><td><input type="checkbox" data-import-index="${index}" aria-label="Import ${R.escape(item.title)}" ${existing.has(fingerprint(item)) ? 'disabled' : ''}></td><td><strong>${R.escape(item.title)}</strong>${existing.has(fingerprint(item)) ? '<p class="hw-hint">Already in the database</p>' : ''}</td><td>${R.escape(item.grade)} · ${R.escape(item.class_name)}</td><td>${R.formatDate(item.assign_date)}<br>${R.formatDate(item.due_date)}</td></tr>`).join('');
        $('import-selected').disabled = true;
        message($('import-message'), '');
        $('import-dialog').showModal();
    });
    $('import-list').addEventListener('change', () => { $('import-selected').disabled = !document.querySelector('[data-import-index]:checked'); });
    document.querySelectorAll('[data-close-import]').forEach(button => button.addEventListener('click', () => { if (!busy) $('import-dialog').close(); }));
    $('import-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('import-selected').addEventListener('click', async () => {
        if (busy) return;
        const selected = [...document.querySelectorAll('[data-import-index]:checked')].map(input => legacy[Number(input.dataset.importIndex)]);
        if (!selected.length) return;
        busy = true;
        $('import-selected').disabled = true;
        let imported = 0;
        try {
            await load();
            const existing = new Set(items.map(fingerprint));
            for (const item of selected) {
                const key = fingerprint(item);
                if (existing.has(key)) continue;
                await request('/api/homework', 'POST', item);
                existing.add(key);
                imported++;
            }
            await load();
            changed();
            $('import-dialog').close();
            message($('hw-message'), `${imported} homework record${imported === 1 ? '' : 's'} imported. Matching records were skipped; your original browser records are unchanged.`);
        } catch {
            message($('import-message'), `${imported} records imported before the connection failed. Retry to import the remaining selected records; matching records will be skipped.`, true);
        } finally { busy = false; $('import-selected').disabled = false; }
    });
    (async () => {
        user = await auth.ready;
        if (!user) return;
        const grades = allowedGrades();
        $('filter-grade').innerHTML = `<option value="">${user.role === 'teacher' ? 'All assigned grades' : 'All grades'}</option>` + grades.map(grade => `<option>${grade}</option>`).join('');
        $('homework-grade').innerHTML = grades.map(grade => `<option>${grade}</option>`).join('');
        $('add-homework-button').disabled = !grades.length;
        if (!grades.length) {
            $('filter-grade').disabled = true; $('filter-class').disabled = true;
            $('hw-permissions').textContent = 'No grades have been assigned to your account yet. Ask an admin to assign your teaching grades.';
            render(); return;
        }
        $('hw-permissions').textContent = user.role === 'teacher' ? 'You can create homework and edit or check assignments you created. Other teachers’ assignments are available to view.' : 'You can manage homework and student checks for every class. Dates follow the school calendar.';
        try { await load(); readLegacy(); }
        catch { message($('hw-message'), 'Homework could not be loaded. Reload this page to try again.', true); $('assigned-list').innerHTML = '<p class="hw-empty">Homework is currently unavailable.</p>'; $('upcoming-list').innerHTML = ''; }
    })();
})();
