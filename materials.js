(() => {
    'use strict';
    const $ = id => document.getElementById(id), auth = window.FldAuth;
    const allGrades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
    const configured = document.querySelector('meta[name="fld-api-base"]')?.content.trim();
    const apiBase = (configured || (location.protocol === 'http:' && location.port === '5500' ? `${location.protocol}//${location.hostname}:3000` : location.origin)).replace(/\/$/, '');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const extensions = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'mp3', 'mp4']);
    let user, items = [], editing = null, detail = null, loading = false, saving = false, sequence = 0, librarySequence = 0;
    const grades = () => user?.role === 'teacher' ? allGrades.filter(grade => user.grades?.includes(grade)) : allGrades;
    const canManage = () => user && user.role !== 'teacher';
    const canCreate = () => user && (canManage() || grades().length > 0);
    function message(id, text, error = false) { const target = $(id); target.textContent = text; target.hidden = !text; target.classList.toggle('error', error); }
    function bytes(value) { const size = Number(value) || 0; return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} bytes`; }
    function date(value) { try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(new Date(value)); } catch { return ''; } }
    function dateTime(value) { if (!value) return 'Not recorded'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? 'Not recorded' : `${new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Istanbul' }).format(parsed)} (Istanbul)`; }
    function authorship(record) {
        const editState = record.edit_history_status;
        const missingEdit = editState === 'not_edited' ? 'Not edited yet' : 'Not recorded';
        return [['Added by',record.creator_name || 'Not recorded'],['Added on',dateTime(record.created_at)],['Last edited by',editState === 'edited' ? record.last_editor_name || 'Not recorded' : missingEdit],['Last edited on',editState === 'edited' ? dateTime(record.last_edited_at) : missingEdit]];
    }
    function icon(item) { const ext = item.file_name?.split('.').pop()?.toLowerCase(); return item.kind === 'link' ? 'fa-link' : ext === 'pdf' ? 'fa-file-pdf' : ext === 'pptx' ? 'fa-file-powerpoint' : ext === 'docx' ? 'fa-file-word' : ext === 'xlsx' ? 'fa-file-excel' : ext === 'mp3' ? 'fa-file-audio' : ext === 'mp4' ? 'fa-file-video' : ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'fa-file-image' : 'fa-file-lines'; }
    function audience(item) { return item.visibility === 'management' ? 'Management only' : item.visibility === 'shared' ? 'Shared' : item.grades?.length ? item.grades.join(' · ') : 'Shared'; }
    function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
    function controls() { $('new-material').disabled = loading || saving || !canCreate(); $('materials-grade').disabled = loading || saving || !user; $('refresh-materials').disabled = loading || saving || !user; }
    function render() {
        const query = $('materials-search').value.trim().toLowerCase(), grade = $('materials-grade').value, category = $('materials-category').value;
        const records = items.filter(item => (grade === 'shared' ? !item.grades?.length : !grade || !item.grades?.length || item.grades.includes(grade)) && (!category || item.category === category) && ($('materials-archived').checked || !item.is_archived) && (!query || `${item.title} ${item.description} ${item.unit} ${item.file_name}`.toLowerCase().includes(query)));
        $('materials-count').textContent = `${records.length} resource${records.length === 1 ? '' : 's'}${grade === 'shared' ? ' · Shared with all staff' : grade ? ` · ${grade} and Shared` : ''}`;
        $('materials-empty').hidden = records.length > 0;
        $('materials-empty-title').textContent = 'No materials found';
        $('materials-empty-description').textContent = items.length ? 'Try another grade, category or search.' : canCreate() ? 'Add a file or resource link to start your shared teaching library.' : 'Available teaching resources will appear here when they are added.';
        $('materials-list').innerHTML = records.map(item => `<article class="mat-card"><div class="mat-card-top"><span class="mat-file-icon ${item.kind === 'link' ? 'link' : ''}"><i class="fa-solid ${icon(item)}" aria-hidden="true"></i></span><span class="mat-category">${escape(item.category || 'Other')}</span>${item.is_archived ? '<span class="mat-archived">Retired</span>' : ''}</div><h2><button type="button" data-material="${escape(item.id)}">${escape(item.title)}</button></h2><p class="mat-card-description">${escape(item.description || (item.kind === 'link' ? 'A resource link saved to the library.' : item.file_name || 'A file saved to the library.'))}</p><div class="mat-card-tags"><span>${escape(audience(item))}</span>${item.unit ? `<span>${escape(item.unit)}</span>` : ''}</div><footer><span>${item.kind === 'link' ? 'Resource link' : `${escape(item.file_name?.split('.').pop()?.toUpperCase() || 'FILE')} · ${bytes(item.file_size)}`}</span><button type="button" class="mat-text-button" data-material="${escape(item.id)}">View resource <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></footer></article>`).join('');
        $('materials-list').querySelectorAll('.mat-card').forEach((card,index) => {
            const addedBy = document.createElement('p'); addedBy.className = 'mat-added-by'; addedBy.textContent = `Added by ${records[index].creator_name || 'Not recorded'}`; card.insertBefore(addedBy,card.querySelector('footer'));
        });
    }
    async function load() {
        const requestId = ++librarySequence;
        loading = true; controls();
        try {
            const query = new URLSearchParams();
            if (/^Grade [1-4]$/.test($('materials-grade').value)) query.set('grade', $('materials-grade').value);
            if ($('materials-archived').checked) query.set('include_archived', 'true');
            const result = await auth.request(`/api/materials${query.size ? `?${query}` : ''}`);
            if (requestId !== librarySequence) return;
            if (!Array.isArray(result.materials)) throw new Error('Invalid library response.');
            items = result.materials; render();
        } finally { if (requestId === librarySequence) { loading = false; controls(); } }
    }
    async function reload() { message('materials-message', ''); try { await load(); } catch { message('materials-message', 'The library could not be loaded. Check your connection and select Refresh.', true); if (!items.length) { $('materials-empty-title').textContent = 'Library unavailable'; $('materials-empty-description').textContent = 'Select Refresh to try again.'; } } }
    function detailOpen(item) {
        const link = $('material-open');
        if (item.kind === 'file') { link.href = `${apiBase}/api/materials/${encodeURIComponent(item.id)}/download`; link.removeAttribute('target'); link.removeAttribute('rel'); link.textContent = 'Download file'; }
        else { const url = safeUrl(item.url); if (url) link.href = url; else link.removeAttribute('href'); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open resource'; }
    }
    async function openDetail(id) {
        if (saving) return;
        const requestId = ++sequence;
        detail = null; $('material-detail-content').hidden = true; $('edit-material').hidden = true; $('archive-material').hidden = true;
        $('material-detail-title').textContent = 'Material'; $('material-detail-meta').textContent = '';
        message('material-detail-message', 'Loading resource…');
        if (!$('material-detail-dialog').open) $('material-detail-dialog').showModal();
        try {
            const result = await auth.request(`/api/materials/${encodeURIComponent(id)}`);
            if (requestId !== sequence || !$('material-detail-dialog').open) return;
            detail = result.material;
            const used = result.used_in || detail.used_in || { events: [], homework: [] };
            $('material-detail-title').textContent = detail.title;
            $('material-detail-meta').textContent = `${detail.category || 'Other'}${detail.unit ? ` · ${detail.unit}` : ''}`;
            $('material-detail-tags').innerHTML = `<span>${escape(audience(detail))}</span>${detail.is_archived ? '<span class="archived">Retired · existing links still work</span>' : ''}`;
            if(detail.review_status === 'needs_review') $('material-detail-tags').insertAdjacentHTML('beforeend','<span class="needs-review">Needs review · visible to management</span>');
            $('material-record-metadata').innerHTML = [...authorship(detail),['School year',detail.academic_year || 'Not set'],['Term',detail.term || 'Not set'],['Area',detail.area || 'Other'],['Review',detail.review_status === 'needs_review' ? 'Needs review' : 'Approved']].map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
            $('material-view-archive').href = `archive.html?material=${encodeURIComponent(detail.id)}`;
            $('material-detail-description').textContent = detail.description || 'No description added.';
            $('material-detail-source').textContent = detail.kind === 'link' ? detail.url : detail.file_name;
            $('material-detail-size').textContent = detail.kind === 'link' ? 'HTTPS resource link' : bytes(detail.file_size);
            $('material-detail-icon').className = `fa-solid ${icon(detail)}`;
            detailOpen(detail);
            const links = [...(used.events || []).map(item => ({ href: `calendar.html?event=${encodeURIComponent(item.id)}&date=${encodeURIComponent(String(item.start_date).slice(0, 10))}`, title: item.title, meta: `Calendar · ${date(item.start_date)}`, icon: 'fa-calendar-days' })), ...(used.homework || []).map(item => ({ href: `homework-check.html?homework=${encodeURIComponent(item.id)}`, title: item.title, meta: `Homework · Due ${date(item.due_date)}`, icon: 'fa-book-open' }))];
            $('material-used-in').innerHTML = links.length ? links.map(link => `<a class="mat-use-link" href="${link.href}"><i class="fa-solid ${link.icon}" aria-hidden="true"></i><span><strong>${escape(link.title)}</strong><small>${escape(link.meta)}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`).join('') : '<p class="mat-not-used">Not attached to any homework or calendar events yet.</p>';
            $('material-detail-content').hidden = false; $('edit-material').hidden = !canManage(); $('archive-material').hidden = !canManage(); $('archive-material').textContent = detail.is_archived ? 'Restore material' : 'Retire material';
            message('material-detail-message', '');
            const url = new URL(location.href); url.searchParams.set('material', String(detail.id)); history.replaceState(null, '', url);
        } catch (error) { if (requestId === sequence) message('material-detail-message', error.status === 403 || error.status === 404 ? 'This resource is not available to your account.' : 'This resource could not be loaded. Close this window and try again.', true); }
    }
    function closeDetail() { if (!saving) $('material-detail-dialog').close(); }
    $('close-material-detail').addEventListener('click', closeDetail); $('done-material-detail').addEventListener('click', closeDetail);
    $('material-detail-dialog').addEventListener('close', () => { sequence++; const url = new URL(location.href); url.searchParams.delete('material'); history.replaceState(null, '', url); });
    $('material-detail-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    $('materials-list').addEventListener('click', event => { const button = event.target.closest('[data-material]'); if (button) openDetail(button.dataset.material); });
    function sourceFields() {
        const kind = document.querySelector('[name="material-kind"]:checked').value;
        $('material-file-field').hidden = Boolean(editing) || kind !== 'file'; $('material-url-field').hidden = Boolean(editing) || kind !== 'link';
        $('material-file').required = !editing && kind === 'file'; $('material-url').required = !editing && kind === 'link';
        const selected = document.querySelector('[name="material-audience"]:checked').value === 'grades';
        $('material-grade-choices').hidden = !selected;
        $('material-audience-hint').textContent = selected ? 'Choose every grade that should be able to use this resource.' : 'Shared resources are available to all staff and can be attached to any grade.';
    }
    function openForm(item = null) {
        if (saving || (item ? !canManage() : !canCreate())) return;
        editing = item; $('material-form').reset(); message('material-form-message', '');
        $('material-form-title').textContent = item ? 'Edit material details' : 'Add material'; $('save-material').textContent = item ? 'Save changes' : 'Add material';
        $('material-title').value = item?.title || ''; $('material-description').value = item?.description || ''; $('material-category').value = item?.category || 'Other'; $('material-unit').value = item?.unit || '';
        $('material-source-tabs').hidden = Boolean(item); $('material-existing-source').hidden = !item; $('material-existing-source').textContent = item ? `${item.kind === 'file' ? 'File' : 'Resource link'}: ${item.file_name || item.url}` : '';
        $('material-audience').hidden = Boolean(item); $('material-edit-hint').hidden = !item;
        $('material-shared-option').hidden = user.role === 'teacher';
        if (user.role === 'teacher') document.querySelector('[name="material-audience"][value="grades"]').checked = true;
        $('material-grade-choices').innerHTML = grades().map((grade, index) => `<label><input type="checkbox" value="${grade}" data-material-grade ${user.role === 'teacher' && index === 0 ? 'checked' : ''}>${grade}</label>`).join('');
        sourceFields(); $('material-form-dialog').showModal(); $('material-title').focus();
    }
    $('new-material').addEventListener('click', () => openForm());
    $('edit-material').addEventListener('click', () => { if (!detail) return; const item = detail; closeDetail(); openForm(item); });
    document.querySelectorAll('[name="material-kind"],[name="material-audience"]').forEach(input => input.addEventListener('change', sourceFields));
    $('material-file').addEventListener('change', () => { const file = $('material-file').files[0]; if (file && !$('material-title').value.trim()) $('material-title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 200); });
    document.querySelectorAll('[data-close-material-form]').forEach(button => button.addEventListener('click', () => { if (!saving) $('material-form-dialog').close(); }));
    $('material-form-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    $('material-form-dialog').addEventListener('close', () => { if (!saving) { $('material-form').reset(); editing = null; } });
    function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('File could not be read.')); reader.readAsDataURL(file); }); }
    $('material-form').addEventListener('submit', async event => {
        event.preventDefault(); if (saving || !$('material-form').reportValidity()) return;
        const original = editing, payload = { title: $('material-title').value.trim(), description: $('material-description').value.trim(), category: $('material-category').value, unit: $('material-unit').value.trim() };
        if (!payload.title) return message('material-form-message', 'Enter a title for this resource.', true);
        let file;
        if (!original) {
            payload.grades = user.role === 'teacher' || document.querySelector('[name="material-audience"]:checked').value === 'grades' ? [...document.querySelectorAll('[data-material-grade]:checked')].map(input => input.value) : [];
            if ((user.role === 'teacher' || document.querySelector('[name="material-audience"]:checked').value === 'grades') && !payload.grades.length) return message('material-form-message', 'Choose at least one grade, or use Shared if it is available to your account.', true);
            payload.kind = document.querySelector('[name="material-kind"]:checked').value;
            if (payload.kind === 'file') {
                file = $('material-file').files[0];
                if (!file || !file.size || file.size > 10 * 1024 * 1024) return message('material-form-message', 'Choose a non-empty file up to 10 MB.', true);
                if (!extensions.has(file.name.split('.').pop().toLowerCase())) return message('material-form-message', 'Use PDF, DOCX, PPTX, XLSX, PNG, JPG, WEBP, TXT, MP3 or MP4.', true);
                payload.file_name = file.name;
            } else {
                payload.url = safeUrl($('material-url').value.trim());
                if (!payload.url) return message('material-form-message', 'Enter a valid HTTPS URL without an embedded username or password.', true);
            }
        }
        saving = true; controls(); $('material-fields').disabled = true; $('save-material').disabled = true; $('save-material').textContent = file ? 'Uploading…' : 'Saving…';
        message('material-form-message', '');
        try {
            if (file) payload.content_base64 = await readFile(file);
            await auth.request(original ? `/api/materials/${encodeURIComponent(original.id)}` : '/api/materials', { method: original ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
            $('material-form-dialog').close(); message('materials-message', original ? 'Material details updated. Existing links use these details automatically.' : 'Material added to the library. It is ready to attach to homework or a calendar event.');
            window.dispatchEvent(new CustomEvent('fld:materialschange'));
            try { await load(); } catch { message('materials-message', 'The material was saved, but the list could not be refreshed. Select Refresh to see it.', true); }
        } catch (error) { message('material-form-message', error.status === 403 ? 'Your current permissions do not allow this resource to be saved.' : error.status === 400 || error.status === 413 ? 'Check the file, title, grades and resource URL. Files must be supported and no larger than 10 MB.' : 'The result could not be confirmed. Close this form and refresh the library before retrying to avoid a duplicate upload.', true); }
        finally { if ('content_base64' in payload) payload.content_base64 = ''; saving = false; $('material-fields').disabled = false; $('save-material').disabled = false; $('save-material').textContent = original ? 'Save changes' : 'Add material'; controls(); }
    });
    $('archive-material').addEventListener('click', async () => {
        if (!detail || saving || !canManage()) return;
        const archived = !detail.is_archived;
        const id = detail.id;
        if (!(await window.FldConfirm.ask({
            title: 'Are you sure?',
            message: archived ? `Retire “${detail.title}”? It will be hidden from the active library. The file and existing homework and calendar links will be kept.` : `Restore “${detail.title}”? It will appear in the active library again for staff who can access it.`,
            confirmLabel: archived ? 'Retire material' : 'Restore material', danger: archived
        }))) return;
        if (!detail || String(detail.id) !== String(id) || saving || !canManage()) return;
        saving = true; $('archive-material').disabled = true; $('edit-material').disabled = true;
        try { await auth.request(`/api/materials/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_archived: archived }) }); window.dispatchEvent(new CustomEvent('fld:materialschange')); message('materials-message', archived ? 'Material retired. Its existing links still work.' : 'Material restored to the library.'); saving = false; await openDetail(id); try { await load(); } catch { message('materials-message', 'The material was updated. Select Refresh to reload the library list.', true); } }
        catch { message('material-detail-message', 'The change could not be confirmed. Close this window and refresh the library before retrying.', true); }
        finally { saving = false; $('archive-material').disabled = false; $('edit-material').disabled = false; controls(); }
    });
    $('materials-grade').addEventListener('change', reload); $('materials-archived').addEventListener('change', reload); $('materials-category').addEventListener('change', render); $('materials-search').addEventListener('input', render); $('refresh-materials').addEventListener('click', reload);
    (async () => {
        user = await auth.ready; if (!user) return;
        $('materials-grade').innerHTML = '<option value="">All available grades</option><option value="shared">Shared resources</option>' + grades().map(grade => `<option>${grade}</option>`).join('');
        $('materials-permissions').textContent = user.role === 'teacher' ? grades().length ? 'Browse Shared resources and your assigned grades. You can add materials for your grades; an admin or coordinator manages edits and archives.' : 'Shared resources are available here. An admin can assign your grades before you add materials or access grade-specific resources.' : 'Add, organize and reuse resources across all grades. Shared materials are available to every staff account.';
        controls(); await reload();
        const id = new URLSearchParams(location.search).get('material'); if (id) await openDetail(id);
    })();
})();
