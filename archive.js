(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AREAS = ['Teaching & Learning', 'Planning & Curriculum', 'School Events', 'Meetings', 'Reports', 'Administration', 'Other'];
  const AREA_NAMES = ['Teaching', 'Planning', 'Events', 'Meetings', 'Reports', 'Administration', 'Other'];
  const AREA_ICONS = ['book-open', 'list-check', 'calendar-days', 'users', 'chart-column', 'briefcase', 'folder'];
  const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
  const EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'mp3', 'mp4']);
  const PAGE_SIZE = 20;
  const configured = document.querySelector('meta[name="fld-api-base"]')?.content.trim();
  const apiBase = (configured || (location.protocol === 'http:' && location.port === '5500' ? `${location.protocol}//${location.hostname}:3000` : location.origin)).replace(/\/$/, '');
  let user, manager = false, admin = false, availableGrades = [], items = [], total = 0, offset = 0, loading = false;
  let listSequence = 0, listController, detailSequence = 0, detail = null, detailBusy = false;
  let editBusy = false, bulkBusy = false, uploadBusy = false, uploadStarted = false, uploadEntries = [], uploadMetadata = null;
  let folderId = 'root', folders = [], breadcrumbs = [], currentFolder = null, folderBusy = false, folderEditing = null;
  let moveBusy = false, moveLoading = false, moveSequence = 0, moveFolderId = 'root', moveFolder = null;
  let moveBreadcrumbs = [], moveRecords = [], locationReady = false, folderDeleteBusy = false;
  const selected = new Set();
  const mobileFilters = window.matchMedia('(max-width:600px)');
  const filterIds = ['arc-year', 'arc-area', 'arc-grade', 'arc-status', 'arc-term', 'arc-visibility', 'arc-archived'];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const numericId = (value) => /^[1-9]\d{0,18}$/.test(String(value ?? '')) && BigInt(value) <= 9223372036854775807n;
  function message(id, text = '', type = '') { const el = $(id); el.textContent = text; el.className = `arc-message${type ? ` ${type}` : ''}`; el.hidden = !text; }
  function notifyChanged() { window.dispatchEvent(new CustomEvent('fld:archivechange')); window.dispatchEvent(new CustomEvent('fld:materialschange')); }
  function humanError(error, fallback) { return error?.status && error.message ? error.message : fallback; }
  function api(path, body, method = 'POST', options = {}) { return window.FldAuth.request(path, {method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body), ...options}); }
  async function askRemoval(options) {
    if (typeof window.FldConfirm?.ask !== 'function') throw Object.assign(new Error('The confirmation window is unavailable. Refresh the page and try again.'),{status:503});
    return window.FldConfirm.ask({title:'Are you sure?',danger:true,...options});
  }
  function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
  function date(value) { if (!value) return 'Not recorded'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? 'Not recorded' : new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'Europe/Istanbul'}).format(parsed); }
  function dateTime(value) { if (!value) return 'Not recorded'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? 'Not recorded' : `${new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Istanbul'}).format(parsed)} (Istanbul)`; }
  function authorship(record) {
    const editState = record.edit_history_status;
    const missingEdit = editState === 'not_edited' ? 'Not edited yet' : 'Not recorded';
    return [['Added by',record.creator_name || 'Not recorded'],['Added on',dateTime(record.created_at)],['Last edited by',editState === 'edited' ? record.last_editor_name || 'Not recorded' : missingEdit],['Last edited on',editState === 'edited' ? dateTime(record.last_edited_at) : missingEdit]];
  }
  function size(value) { const bytes = Number(value) || 0; return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
  function audience(record) { return record.visibility === 'management' ? 'Management only' : record.visibility === 'grades' ? (record.grades || []).join(', ') : 'All staff'; }
  function badges(record) { return `<span class="arc-badge${record.visibility === 'management' ? ' management' : ''}">${escape(audience(record))}</span>${record.review_status === 'needs_review' ? '<span class="arc-badge review">Needs review</span>' : ''}${record.is_archived ? '<span class="arc-badge retired">Retired</span>' : ''}${record.in_materials ? '<span class="arc-badge materials">In Materials</span>' : ''}`; }
  function year(value) { const clean = value.trim(); if (clean && (!/^\d{4}-\d{4}$/.test(clean) || Number(clean.slice(0,4)) < 1 || Number(clean.slice(5)) !== Number(clean.slice(0,4)) + 1)) throw new Error('Enter a consecutive academic year, such as 2025-2026.'); return clean; }
  function gradeChoices(id, values = [], choices = availableGrades) { $(`${id}`).querySelector('div').innerHTML = choices.map((grade) => `<label><input type="checkbox" value="${grade}"${values.includes(grade) ? ' checked' : ''}> ${grade}</label>`).join(''); }
  function chosenGrades(id) { return [...$(id).querySelectorAll('input:checked')].map((input) => input.value); }
  function readAudience(prefix) { const visibility = $(`arc-${prefix}-visibility`).value; const grades = visibility === 'grades' ? chosenGrades(`arc-${prefix}-grades`) : []; if (visibility === 'grades' && !grades.length) throw new Error('Choose at least one grade for this audience.'); return {visibility, grades}; }
  function showAudience(prefix) { const visibility = $(`arc-${prefix}-visibility`).value; $(`arc-${prefix}-grades`).hidden = visibility !== 'grades'; if (prefix === 'edit') { const checkbox = $('arc-edit-materials'); checkbox.disabled = visibility === 'management' || $('arc-edit-status').value !== 'approved'; if (checkbox.disabled) checkbox.checked = false; } }
  function closeDialog(id) { if ((id === 'arc-upload-dialog' && uploadBusy) || (id === 'arc-edit-dialog' && editBusy) || (id === 'arc-bulk-dialog' && bulkBusy) || (id === 'arc-detail-dialog' && detailBusy) || (id === 'arc-folder-dialog' && folderBusy) || (id === 'arc-move-dialog' && moveBusy)) return; $(id).close(); }
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  ['upload', 'edit', 'bulk', 'detail'].forEach((kind) => $(`arc-${kind}-dialog`).addEventListener('cancel', (event) => { if ((kind === 'upload' && uploadBusy) || (kind === 'edit' && editBusy) || (kind === 'bulk' && bulkBusy) || (kind === 'detail' && detailBusy)) event.preventDefault(); }));
  $('arc-detail-dialog').addEventListener('close', () => { detailSequence++; detail = null; });
  $('arc-folder-dialog').addEventListener('cancel', (event) => { if (folderBusy) event.preventDefault(); });
  $('arc-move-dialog').addEventListener('cancel', (event) => { if (moveBusy) event.preventDefault(); });
  $('arc-move-dialog').addEventListener('close', () => { moveSequence++; });

  function setYears(years) {
    const current = $('arc-year').value;
    const values = [...new Set([...(Array.isArray(years) ? years : []), ...(current ? [current] : [])])].filter((value) => /^\d{4}-\d{4}$/.test(value)).sort().reverse();
    $('arc-year').innerHTML = '<option value="">All years</option>' + values.map((value) => `<option>${value}</option>`).join(''); $('arc-year').value = current;
    $('arc-known-years').innerHTML = values.map((value) => `<option value="${value}"></option>`).join('');
  }
  function isSearching() { return Boolean($('arc-query').value.trim()); }
  function folderPath(path = breadcrumbs) { return ['Archive', ...path.map((part) => part.name)].join(' / '); }
  function breadcrumbMarkup(path, attribute = 'data-folder') {
    const all = [{id:'root',name:'Archive'}, ...path];
    return all.map((part,index) => `${index ? '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>' : ''}${index === all.length - 1 ? `<span aria-current="location">${escape(part.name)}</span>` : `<button type="button" ${attribute}="${escape(part.id)}">${escape(part.name)}</button>`}`).join('');
  }
  function writeLocation({replace = false} = {}) {
    const url = new URL(location.href); url.searchParams.delete('material');
    folderId === 'root' ? url.searchParams.delete('folder') : url.searchParams.set('folder',folderId);
    const query = $('arc-query').value.trim(); query ? url.searchParams.set('q',query) : url.searchParams.delete('q');
    history[replace ? 'replaceState' : 'pushState']({},'',url);
  }
  function navigateFolder(id) {
    if (id !== 'root' && !numericId(id)) return;
    folderId = String(id); $('arc-query').value = ''; offset = 0; writeLocation(); void loadList();
  }
  function renderFolders() {
    const searching = isSearching();
    $('arc-breadcrumbs').innerHTML = breadcrumbMarkup(breadcrumbs);
    $('arc-folder-section').hidden = searching;
    $('arc-folder-count').textContent = `${folders.length} folder${folders.length === 1 ? '' : 's'}`;
    $('arc-folders').innerHTML = folders.map((folder) => {
      const nonempty = Number(folder.file_count) > 0 || Number(folder.folder_count) > 0;
      const remove = admin ? `<button type="button" class="arc-folder-delete" data-delete-folder="${escape(folder.id)}" aria-label="Delete empty folder ${escape(folder.name)}" title="${nonempty ? 'Move or delete the contents first. Only empty folders can be deleted.' : 'Delete empty folder'}"${nonempty ? ' disabled' : ''}><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : '';
      return `<article class="arc-folder-card"><button type="button" class="arc-folder-open" data-folder="${escape(folder.id)}"><span class="arc-folder-icon"><i class="fa-solid fa-folder" aria-hidden="true"></i></span><span class="arc-folder-body"><strong>${escape(folder.name)}</strong><span>${Number(folder.file_count) || 0} file${Number(folder.file_count) === 1 ? '' : 's'} · ${Number(folder.folder_count) || 0} folder${Number(folder.folder_count) === 1 ? '' : 's'}</span><small class="arc-folder-audience${folder.visibility === 'shared' ? ' shared' : ''}">${escape(audience(folder))}</small></span><i class="fa-solid fa-chevron-right arc-folder-arrow" aria-hidden="true"></i></button>${manager ? `<button type="button" class="arc-folder-rename" data-rename-folder="${escape(folder.id)}" aria-label="Rename ${escape(folder.name)}" title="Rename folder"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>` : ''}${remove}</article>`;
    }).join('');
    if (folderDeleteBusy) $('arc-folders').querySelectorAll('button').forEach((button) => button.disabled = true);
    $('arc-folder-empty').hidden = folders.length > 0;
    $('arc-folder-empty').textContent = manager ? 'No subfolders here yet. Use New folder to group related files.' : 'No subfolders in this location.';
    $('arc-folder-caption').textContent = admin ? 'Open a folder to browse inside. Only empty folders can be deleted.' : 'Open a folder to browse inside. Use filters to narrow down files.';
    $('arc-files-title').textContent = searching ? 'Search results' : currentFolder ? `Files in ${currentFolder.name}` : 'Files in Archive';
    $('arc-files-caption').textContent = searching ? 'Matching files across all folders you can access.' : 'Files and resource links in this location.';
    $('arc-new-folder').disabled = folderDeleteBusy || loading || !locationReady || searching || breadcrumbs.length >= 8;
    $('arc-new-folder').title = breadcrumbs.length >= 8 ? 'Folders can be nested up to eight levels.' : searching ? 'Open a folder location to create a folder.' : '';
    $('arc-add').disabled = loading || !locationReady || (!manager && (!availableGrades.length || currentFolder?.upload_allowed === false));
  }
  $('arc-breadcrumbs').addEventListener('click', (event) => { const button = event.target.closest('[data-folder]'); if (button) navigateFolder(button.dataset.folder); });
  $('arc-folders').addEventListener('click', (event) => {
    const open = event.target.closest('[data-folder]'); if (open) navigateFolder(open.dataset.folder);
    const rename = event.target.closest('[data-rename-folder]'); if (rename && manager) openFolderEditor(folders.find((folder) => String(folder.id) === rename.dataset.renameFolder));
    const remove = event.target.closest('[data-delete-folder]'); if (remove && admin && !remove.disabled) void deleteFolder(folders.find((folder) => String(folder.id) === remove.dataset.deleteFolder));
  });
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search); folderId = numericId(params.get('folder')) ? params.get('folder') : 'root';
    $('arc-query').value = (params.get('q') || '').slice(0,200); offset = 0; void loadList();
  });
  function updateViews() {
    const review = $('arc-status').value === 'needs_review';
    $('arc-all-tab').classList.toggle('active', !review); $('arc-all-tab').setAttribute('aria-pressed', String(!review));
    $('arc-review-tab').classList.toggle('active', review); $('arc-review-tab').setAttribute('aria-pressed', String(review));
    $('arc-areas').querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.area === $('arc-area').value)));
    const active = filterIds.filter((id) => $(id).value && !['all','false'].includes($(id).value)).length;
    $('arc-filter-toggle-label').textContent = active ? `Filters (${active} active)` : 'Filters';
    $('arc-mobile-clear').hidden = active === 0;
    $('arc-filter-toggle').setAttribute('aria-expanded', String($('arc-filter-panel').dataset.mobileCollapsed !== 'true'));
  }
  function selectionUI() {
    $('arc-selected-count').textContent = `${selected.size} selected`;
    $('arc-classify').disabled = !selected.size || loading; $('arc-move').disabled = !selected.size || loading; $('arc-unselect').disabled = !selected.size || loading;
    $('arc-select-page').disabled = !items.length || loading;
    $('arc-select-page').checked = items.length > 0 && items.every((item) => selected.has(String(item.id)));
    $('arc-select-page').indeterminate = selected.size > 0 && !$('arc-select-page').checked;
  }
  function renderList() {
    $('arc-list').innerHTML = items.map((record) => `<article class="arc-record${selected.has(String(record.id)) ? ' selected' : ''}">${manager ? `<input class="arc-row-select" type="checkbox" data-select="${escape(record.id)}" aria-label="Select ${escape(record.title)}"${selected.has(String(record.id)) ? ' checked' : ''}>` : ''}<span class="arc-record-icon${record.kind === 'link' ? ' link' : ''}"><i class="fa-solid ${record.kind === 'link' ? 'fa-link' : 'fa-file-lines'}" aria-hidden="true"></i></span><div class="arc-record-body"><button class="arc-record-title" data-detail="${escape(record.id)}">${escape(record.title)}</button><div class="arc-record-meta"><span>${escape(record.area || 'Other')}</span><span>${escape(record.academic_year || 'Year not specified')}${record.term ? ` · ${escape(record.term)}` : ''}</span><span>${record.kind === 'link' ? 'Resource link' : escape(String(record.file_name || '').split('.').pop().toUpperCase() || 'File')}</span></div>${record.description ? `<p class="arc-record-description">${escape(record.description)}</p>` : ''}</div><aside class="arc-record-aside"><div class="arc-badges">${badges(record)}</div><small>Added ${date(record.created_at)}</small></aside></article>`).join('');
    $('arc-list').querySelectorAll('.arc-record-aside').forEach((aside,index) => {
      const addedBy = document.createElement('small'); addedBy.className = 'arc-added-by'; addedBy.textContent = `Added by ${items[index].creator_name || 'Not recorded'}`; aside.insertBefore(addedBy,aside.querySelector('small'));
    });
    $('arc-list').querySelectorAll('.arc-record-icon').forEach((icon,index) => {
      const record = items[index], extension = String(record.file_name || '').split('.').pop().toLowerCase();
      const style = record.kind === 'link' ? ['link','link'] : extension === 'pdf' ? ['pdf','file-pdf'] : ['xlsx'].includes(extension) ? ['sheet','file-excel'] : ['png','jpg','jpeg','webp'].includes(extension) ? ['image','file-image'] : ['mp3','mp4'].includes(extension) ? ['media',extension === 'mp3' ? 'file-audio' : 'file-video'] : ['document','file-lines'];
      icon.className = `arc-record-icon ${style[0]}`; icon.innerHTML = `<i class="fa-solid fa-${style[1]}" aria-hidden="true"></i>`;
    });
    if (isSearching()) $('arc-list').querySelectorAll('.arc-record-body').forEach((body,index) => {
      const path = Array.isArray(items[index].folder_path) ? items[index].folder_path : [];
      body.insertAdjacentHTML('beforeend',`<button type="button" class="arc-file-location" data-file-folder="${escape(path.at(-1)?.id || 'root')}"><i class="fa-solid fa-folder-open" aria-hidden="true"></i>${escape(folderPath(path))}</button>`);
    });
    $('arc-empty').hidden = items.length > 0;
    $('arc-empty-title').textContent = isSearching() ? 'No matching files' : 'No files in this location';
    $('arc-empty-text').textContent = $('arc-query').value.trim() || filterIds.some((id) => $(id).value && !['all','false'].includes($(id).value)) ? 'Try a different search or clear the filters to see more files.' : folders.length ? 'Your files are organised in the folders above. Open a folder to continue, or add files to this location.' : 'Add files here, or create a subfolder to keep related documents together.';
    $('arc-empty').classList.toggle('arc-empty-contained', !items.length && folders.length > 0);
    $('arc-count').textContent = total ? `${offset + 1}–${offset + items.length} of ${total} record${total === 1 ? '' : 's'}` : '0 records';
    $('arc-page-label').textContent = total ? `Page ${Math.floor(offset / PAGE_SIZE) + 1} of ${Math.ceil(total / PAGE_SIZE)}` : '';
    $('arc-prev').disabled = offset === 0 || loading; $('arc-next').disabled = offset + items.length >= total || loading;
    selectionUI(); renderFolders();
  }
  async function loadList({quiet = false} = {}) {
    if (!user) return false;
    const sequence = ++listSequence;
    listController?.abort(); listController = new AbortController();
    const controller = listController, timeout = setTimeout(() => controller.abort(), 15000);
    loading = true; locationReady = false; selected.clear(); items = []; folders = []; $('arc-folders').innerHTML = ''; $('arc-list').innerHTML = ''; $('arc-list').setAttribute('aria-busy', 'true');
    $('arc-new-folder').disabled = true; $('arc-add').disabled = true;
    $('arc-empty').hidden = false; $('arc-empty-title').textContent = 'Loading records…'; $('arc-empty-text').textContent = 'Searching the records available to you.';
    $('arc-count').textContent = ''; $('arc-page-label').textContent = ''; $('arc-prev').disabled = true; $('arc-next').disabled = true; $('arc-refresh').disabled = true; selectionUI(); updateViews();
    if (!quiet) message('arc-message');
    const query = new URLSearchParams({limit:String(PAGE_SIZE), offset:String(offset), status:manager ? $('arc-status').value : 'all', archived:$('arc-archived').value});
    if (!isSearching()) query.set('folder',folderId); else folderId = 'root';
    const mapping = {'arc-query':'q', 'arc-year':'academic_year', 'arc-area':'area', 'arc-grade':'grade', 'arc-term':'term', 'arc-visibility':'visibility'};
    Object.entries(mapping).forEach(([id,key]) => { if ($(id).value.trim()) query.set(key,$(id).value.trim()); });
    try {
      const data = await window.FldAuth.request(`/api/archive?${query}`, {signal:controller.signal});
      if (sequence !== listSequence) return false;
      if (!Array.isArray(data.items) || !Number.isFinite(Number(data.total))) throw new Error('Invalid archive response.');
      total = Number(data.total); items = data.items; folders = Array.isArray(data.folders) ? data.folders : [];
      currentFolder = data.current_folder || null; breadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : []; locationReady = true;
      if (total && offset >= total) { offset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE; return loadList({quiet}); }
      setYears(data.facets?.years); loading = false; renderList(); return true;
    } catch (error) {
      if (sequence !== listSequence) return false;
      items = []; total = 0; loading = false;
      $('arc-empty').hidden = false; $('arc-empty-title').textContent = 'Records could not be loaded'; $('arc-empty-text').textContent = 'Your files are safe. Use Refresh to try again.';
      message('arc-message', humanError(error, 'The Archive could not be reached. Check your connection and try again.'), 'error'); return false;
    } finally { clearTimeout(timeout); if (sequence === listSequence) { loading = false; $('arc-list').setAttribute('aria-busy','false'); $('arc-refresh').disabled = false; selectionUI(); renderFolders(); } }
  }
  function changedFilter() { if (isSearching()) folderId = 'root'; writeLocation({replace:true}); offset = 0; void loadList(); }
  filterIds.forEach((id) => $(id).addEventListener('change', changedFilter));
  $('arc-search-form').addEventListener('submit', (event) => { event.preventDefault(); if (isSearching()) folderId = 'root'; writeLocation(); changedFilter(); });
  $('arc-query').addEventListener('search', () => { if (!$('arc-query').value) { writeLocation(); changedFilter(); } });
  $('arc-clear').addEventListener('click', () => { $('arc-query').value = ''; ['arc-year','arc-area','arc-grade','arc-term','arc-visibility'].forEach((id) => $(id).value = ''); $('arc-status').value = 'all'; $('arc-archived').value = 'false'; writeLocation(); changedFilter(); });
  $('arc-refresh').addEventListener('click', () => void loadList());
  $('arc-filter-toggle').addEventListener('click', () => { const panel = $('arc-filter-panel'); panel.dataset.mobileCollapsed = String(panel.dataset.mobileCollapsed !== 'true'); updateViews(); });
  $('arc-mobile-clear').addEventListener('click', () => $('arc-clear').click());
  mobileFilters.addEventListener('change', updateViews);
  $('arc-all-tab').addEventListener('click', () => { $('arc-status').value = 'all'; changedFilter(); });
  $('arc-review-tab').addEventListener('click', () => { if (manager) { $('arc-status').value = 'needs_review'; changedFilter(); } });
  $('arc-prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); void loadList(); });
  $('arc-next').addEventListener('click', () => { if (offset + PAGE_SIZE < total) { offset += PAGE_SIZE; void loadList(); } });
  $('arc-areas').addEventListener('click', (event) => { const button = event.target.closest('[data-area]'); if (button) { $('arc-area').value = button.dataset.area; changedFilter(); } });
  $('arc-list').addEventListener('click', (event) => { const button = event.target.closest('[data-detail]'); if (button) void openDetail(button.dataset.detail); const path = event.target.closest('[data-file-folder]'); if (path) navigateFolder(path.dataset.fileFolder); });
  $('arc-list').addEventListener('change', (event) => { const input = event.target.closest('[data-select]'); if (input && manager && !loading) { const id = input.dataset.select; input.checked ? selected.add(id) : selected.delete(id); input.closest('article').classList.toggle('selected',input.checked); selectionUI(); } });
  $('arc-select-page').addEventListener('change', () => { if (!manager || loading) return; selected.clear(); if ($('arc-select-page').checked) items.forEach((item) => selected.add(String(item.id))); renderList(); });
  $('arc-unselect').addEventListener('click', () => { selected.clear(); renderList(); });

  async function deleteFolder(folder) {
    if (!admin || !folder || folderDeleteBusy || loading || Number(folder.file_count) > 0 || Number(folder.folder_count) > 0) return;
    folderDeleteBusy = true; renderFolders();
    try {
      if (!await askRemoval({message:`Permanently delete the empty folder “${folder.name}”? This cannot be undone.`,confirmLabel:'Delete folder'})) return;
      await api(`/api/archive/folders/${folder.id}`,{},'DELETE'); notifyChanged();
      const loaded = await loadList({quiet:true}); message('arc-message',`Folder deleted.${loaded ? '' : ' Refresh the Archive to see the latest folders.'}`,loaded ? '' : 'warning');
    } catch (error) { message('arc-message',humanError(error,'The deletion could not be confirmed. Refresh the Archive before trying again.'),'error'); }
    finally { folderDeleteBusy = false; renderFolders(); ([...$('arc-folders').querySelectorAll('[data-delete-folder]')].find((button) => button.dataset.deleteFolder === String(folder.id)) || $('arc-refresh')).focus(); }
  }

  function openFolderEditor(folder = null) {
    if (!manager || folderBusy || folderDeleteBusy || loading || !locationReady) return;
    folderEditing = folder; $('arc-folder-form').reset(); message('arc-folder-error');
    $('arc-folder-dialog-title').textContent = folder ? 'Rename folder' : 'New folder';
    $('arc-folder-save').textContent = folder ? 'Save name' : 'Create folder';
    $('arc-folder-name').value = folder?.name || ''; $('arc-folder-parent').textContent = folderPath();
    $('arc-folder-dialog-description').textContent = folder ? 'A clear name helps everyone find the right files.' : 'Give related files one easy-to-find home.';
    $('arc-folder-scope').hidden = Boolean(folder || currentFolder);
    $('arc-folder-inheritance').hidden = !currentFolder && !folder;
    $('arc-folder-inheritance').textContent = folder ? `Folder audience: ${audience(folder)}. Renaming keeps its files, access and links unchanged.` : currentFolder ? `This subfolder will use the same audience as its parent: ${audience(currentFolder)}.` : '';
    gradeChoices('arc-folder-grades'); showAudience('folder'); $('arc-folder-dialog').showModal(); $('arc-folder-name').focus();
  }
  $('arc-new-folder').addEventListener('click', () => openFolderEditor());
  $('arc-folder-visibility').addEventListener('change', () => showAudience('folder'));
  $('arc-folder-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!manager || folderBusy) return; message('arc-folder-error');
    const name = $('arc-folder-name').value.trim(); if (!name) { message('arc-folder-error','Enter a folder name.','error'); return; }
    let payload; try { payload = folderEditing ? {name} : {name,parent_id:folderId === 'root' ? null : folderId,...(currentFolder ? {} : readAudience('folder'))}; } catch (error) { message('arc-folder-error',error.message,'error'); return; }
    folderBusy = true; $('arc-folder-fields').disabled = true; $('arc-folder-save').disabled = true;
    try {
      await api(folderEditing ? `/api/archive/folders/${folderEditing.id}` : '/api/archive/folders',payload,folderEditing ? 'PATCH' : 'POST');
      const text = folderEditing ? 'Folder renamed.' : 'Folder created. Open it to add files or subfolders.';
      folderBusy = false; $('arc-folder-dialog').close(); const loaded = await loadList({quiet:true});
      message('arc-message',`${text}${loaded ? '' : ' Refresh the Archive to see it.'}`,loaded ? '' : 'warning'); notifyChanged();
    } catch (error) { message('arc-folder-error',humanError(error,'The folder change could not be confirmed. Refresh the Archive before trying again.'),'error'); }
    finally { folderBusy = false; $('arc-folder-fields').disabled = false; $('arc-folder-save').disabled = false; }
  });
  function canMoveHere(folder) {
    if (!folder || folder.visibility === 'shared') return true;
    return moveRecords.every((record) => record.visibility === 'management' || (folder.visibility === 'grades' && record.visibility === 'grades' && (record.grades || []).every((grade) => (folder.grades || []).includes(grade))));
  }
  async function loadMoveFolders(id) {
    if (moveBusy || (id !== 'root' && !numericId(id))) return;
    const sequence = ++moveSequence; moveLoading = true; moveFolderId = String(id); message('arc-move-error');
    $('arc-move-save').disabled = true; $('arc-move-folders').setAttribute('aria-busy','true'); $('arc-move-folders').innerHTML = '<p class="arc-hint">Loading folders…</p>';
    try {
      const data = await window.FldAuth.request(`/api/archive/folders?parent=${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(15000)});
      if (sequence !== moveSequence || !$('arc-move-dialog').open) return;
      moveFolder = data.current_folder || null; moveBreadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
      const choices = Array.isArray(data.folders) ? data.folders : [];
      $('arc-move-breadcrumbs').innerHTML = breadcrumbMarkup(moveBreadcrumbs,'data-move-folder');
      $('arc-move-destination').textContent = folderPath(moveBreadcrumbs);
      $('arc-move-folders').innerHTML = choices.length ? choices.map((folder) => `<button type="button" data-move-folder="${escape(folder.id)}"><span class="arc-folder-icon"><i class="fa-solid fa-folder" aria-hidden="true"></i></span><span><strong>${escape(folder.name)}</strong><small>${escape(audience(folder))}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`).join('') : '<p class="arc-hint">No subfolders here. Choose this location or use the path above to go back.</p>';
      const compatible = canMoveHere(moveFolder), sameLocation = moveRecords.every((record) => String(record.folder_id || 'root') === moveFolderId);
      $('arc-move-save').disabled = !compatible || sameLocation;
      if (!compatible) message('arc-move-error','This folder has a more restricted audience than one or more selected files. Choose a compatible folder.','warning');
      else if (sameLocation) message('arc-move-error','These files are already in this location.','warning');
    } catch (error) {
      if (sequence === moveSequence) { $('arc-move-folders').innerHTML = '<button type="button" id="arc-move-retry" class="arc-button secondary">Try again</button>'; message('arc-move-error',humanError(error,'Folders could not be loaded. Try again.'),'error'); }
    } finally { if (sequence === moveSequence) { moveLoading = false; $('arc-move-folders').setAttribute('aria-busy','false'); } }
  }
  $('arc-move').addEventListener('click', () => {
    if (!manager || !selected.size || loading) return;
    moveRecords = items.filter((record) => selected.has(String(record.id))); $('arc-move-description').textContent = `${moveRecords.length} file${moveRecords.length === 1 ? '' : 's'} selected. Open a folder, then choose Move here.`;
    $('arc-move-dialog').showModal(); void loadMoveFolders('root');
  });
  ['arc-move-breadcrumbs','arc-move-folders'].forEach((id) => $(id).addEventListener('click', (event) => { const button = event.target.closest('[data-move-folder]'); if (button) void loadMoveFolders(button.dataset.moveFolder); if (event.target.closest('#arc-move-retry')) void loadMoveFolders(moveFolderId); }));
  $('arc-move-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!manager || moveBusy || moveLoading || !moveRecords.length || $('arc-move-save').disabled) return;
    moveBusy = true; $('arc-move-fields').disabled = true; $('arc-move-save').disabled = true; message('arc-move-error');
    try {
      await api('/api/archive/move',{ids:moveRecords.map((record) => String(record.id)),folder_id:moveFolderId === 'root' ? null : moveFolderId});
      const count = moveRecords.length, destination = folderPath(moveBreadcrumbs); moveBusy = false; $('arc-move-dialog').close(); const loaded = await loadList({quiet:true});
      message('arc-message',`${count} file${count === 1 ? '' : 's'} moved to ${destination}.${loaded ? '' : ' Refresh the Archive to see the latest files.'}`,loaded ? '' : 'warning'); notifyChanged();
    } catch (error) { message('arc-move-error',humanError(error,'The move could not be confirmed. Refresh the Archive before trying again.'),'error'); }
    finally { moveBusy = false; $('arc-move-fields').disabled = false; $('arc-move-save').disabled = !canMoveHere(moveFolder); }
  });

  async function openDetail(id) {
    if (!numericId(id) || detailBusy) return;
    const sequence = ++detailSequence; detail = null;
    $('arc-detail-content').hidden = true; $('arc-detail-title').textContent = 'Record details'; $('arc-detail-subtitle').textContent = '';
    ['arc-delete','arc-edit','arc-retire','arc-to-materials'].forEach((button) => $(button).hidden = true);
    message('arc-detail-message','Loading record…');
    if (!$('arc-detail-dialog').open) $('arc-detail-dialog').showModal();
    try {
      const data = await window.FldAuth.request(`/api/archive/${id}`);
      if (sequence !== detailSequence || !$('arc-detail-dialog').open) return;
      if (!data.material) throw new Error('Record not available.');
      detail = data.material; renderDetail(data); message('arc-detail-message');
    } catch (error) { if (sequence === detailSequence) message('arc-detail-message',humanError(error,'This record could not be loaded. Close this window and try again.'),'error'); }
  }
  function renderDetail(data) {
    const record = data.material;
    $('arc-detail-title').textContent = record.title; $('arc-detail-subtitle').textContent = `${record.area || 'Other'} · ${record.academic_year || 'Year not specified'}`;
    $('arc-detail-badges').innerHTML = badges(record); $('arc-detail-description').textContent = record.description || 'No description added.';
    const rows = [...authorship(record),['Academic year',record.academic_year || 'Not specified'],['Term',record.term || 'Not specified'],['Area',record.area || 'Other'],['Audience',audience(record)],['Review status',record.review_status === 'needs_review' ? 'Needs review' : 'Approved'],['Category',record.category || 'Other'],['Unit',record.unit || 'Not specified']];
    $('arc-detail-metadata').innerHTML = rows.map(([label,value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
    $('arc-detail-source').textContent = record.kind === 'link' ? record.url : record.file_name;
    $('arc-detail-size').textContent = record.kind === 'link' ? 'External resource link' : `${size(record.file_size)}${record.mime_type ? ` · ${record.mime_type}` : ''}`;
    const link = $('arc-detail-open'); link.removeAttribute('target'); link.removeAttribute('rel'); link.removeAttribute('href');
    if (record.kind === 'file') { link.href = `${apiBase}/api/materials/${encodeURIComponent(record.id)}/download`; link.textContent = 'Download file'; link.hidden = false; }
    else { const url = safeUrl(record.url); link.hidden = !url; if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open resource'; } }
    const uses = [];
    (data.used_in?.events || []).forEach((item) => uses.push(`<a class="arc-use-link" href="calendar.html?event=${encodeURIComponent(item.id)}&amp;date=${encodeURIComponent(String(item.start_date).slice(0,10))}"><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>${escape(item.title)}<small>Calendar · ${date(item.start_date)}</small></span></a>`));
    (data.used_in?.homework || []).forEach((item) => uses.push(`<a class="arc-use-link" href="homework-check.html?homework=${encodeURIComponent(item.id)}"><i class="fa-regular fa-file-lines" aria-hidden="true"></i><span>${escape(item.title)}<small>Homework · due ${date(item.due_date)}</small></span></a>`));
    $('arc-used-list').innerHTML = uses.length ? uses.join('') : '<p class="arc-used-empty">No linked calendar events or homework.</p>';
    const duplicates = manager && Array.isArray(data.possible_duplicates) ? data.possible_duplicates : [];
    $('arc-duplicates').hidden = !duplicates.length; $('arc-duplicates-list').innerHTML = duplicates.map((item) => `<li><button type="button" data-duplicate="${escape(item.id)}">${escape(item.title)}</button></li>`).join('');
    $('arc-edit').hidden = !manager; $('arc-retire').hidden = !manager; $('arc-retire').textContent = record.is_archived ? 'Restore record' : 'Retire record';
    $('arc-delete').hidden = !admin; $('arc-delete').innerHTML = `<i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete ${record.kind === 'link' ? 'link' : 'file'}`;
    const promote = $('arc-to-materials'); promote.hidden = !manager || record.in_materials; promote.disabled = record.visibility === 'management' || record.is_archived;
    promote.title = record.visibility === 'management' ? 'Edit the audience to All staff or Selected grades before adding to Materials.' : record.is_archived ? 'Restore this record before adding it to Materials.' : '';
    $('arc-detail-content').hidden = false;
    let hint = $('arc-promotion-hint'); if (!hint) { hint = document.createElement('p'); hint.id = 'arc-promotion-hint'; hint.className = 'arc-hint'; $('arc-detail-content').append(hint); }
    hint.textContent = manager && !record.in_materials && record.visibility === 'management' ? 'To use this record in Materials, edit its audience to All staff or Selected grades first. Management access is never changed automatically.' : '';
    hint.hidden = !hint.textContent;
  }
  $('arc-duplicates-list').addEventListener('click', (event) => { const button = event.target.closest('[data-duplicate]'); if (button) void openDetail(button.dataset.duplicate); });
  function detailControlsBusy(busy) {
    detailBusy = busy; ['arc-delete','arc-edit','arc-retire','arc-to-materials'].forEach((button) => $(button).disabled = busy);
    if (!busy && detail) $('arc-to-materials').disabled = detail.visibility === 'management' || detail.is_archived;
  }
  async function detailMutation(changes, success) {
    if (!manager || !detail || detailBusy) return;
    const id = detail.id, title = detail.title; detailControlsBusy(true); message('arc-detail-message');
    try {
      if (changes.is_archived === true && !await askRemoval({message:`Retire “${title}”? It will move out of current records. The file and existing calendar or homework links will be kept.`,confirmLabel:'Retire record'})) return;
      await api(`/api/archive/${id}`,changes,'PATCH'); notifyChanged(); detailBusy = false; await openDetail(id); if (detail?.id === id) message('arc-detail-message',success); const loaded = await loadList({quiet:true}); if (!loaded) message('arc-message',`${success} Refresh the list to see the latest records.`,'warning');
    }
    catch (error) { message('arc-detail-message',humanError(error,'The change could not be confirmed. Refresh this record before trying again.'),'error'); }
    finally { detailControlsBusy(false); if ($('arc-detail-dialog').open) $(changes.is_archived === undefined ? 'arc-to-materials' : 'arc-retire').focus(); }
  }
  $('arc-retire').addEventListener('click', () => { if (detail) void detailMutation({is_archived:!detail.is_archived}, detail.is_archived ? 'Record restored.' : 'Record retired.'); });
  $('arc-to-materials').addEventListener('click', () => { if (detail && detail.visibility !== 'management' && !detail.is_archived) void detailMutation({review_status:'approved',in_materials:true},'Record approved and added to Materials.'); });
  $('arc-delete').addEventListener('click', async () => {
    if (!admin || !detail || detailBusy) return;
    const record = detail, noun = record.kind === 'link' ? 'link' : 'file'; detailControlsBusy(true); message('arc-detail-message');
    try {
      const explanation = record.kind === 'link' ? 'The saved link will be removed. The original online resource is kept.' : 'The record and uploaded file will be permanently removed.';
      if (!await askRemoval({message:`Delete “${record.title}”? ${explanation}${record.in_materials ? ' It will also be removed from Materials.' : ''} This cannot be undone.`,confirmLabel:`Delete ${noun}`})) return;
      const data = await api(`/api/archive/${record.id}`,{},'DELETE'); notifyChanged(); detailBusy = false; $('arc-detail-dialog').close();
      const loaded = await loadList({quiet:true}), cleanupPending = data.storage_cleanup === 'pending';
      message('arc-message',`${cleanupPending ? 'The record is removed. The uploaded file is queued for removal.' : `${noun === 'link' ? 'Link' : 'File'} deleted.`}${loaded ? '' : ' Refresh the Archive to see the latest files.'}`,!loaded || cleanupPending ? 'warning' : '');
    } catch (error) { message('arc-detail-message',humanError(error,'The deletion could not be confirmed. Refresh the Archive before trying again.'),'error'); }
    finally { detailControlsBusy(false); if ($('arc-detail-dialog').open) $('arc-delete').focus(); }
  });

  function openEdit() {
    if (!manager || !detail || detailBusy) return;
    $('arc-edit-form').reset(); message('arc-edit-error');
    [['name','title'],['description','description'],['year','academic_year'],['term','term'],['area','area'],['visibility','visibility'],['status','review_status'],['category','category'],['unit','unit']].forEach(([input,field]) => $(`arc-edit-${input}`).value = detail[field] || '');
    $('arc-edit-materials').checked = Boolean(detail.in_materials); gradeChoices('arc-edit-grades',detail.grades || []); showAudience('edit'); $('arc-edit-dialog').showModal();
  }
  $('arc-edit').addEventListener('click',openEdit);
  ['upload','edit','bulk'].forEach((prefix) => $(`arc-${prefix}-visibility`).addEventListener('change', () => showAudience(prefix)));
  $('arc-edit-status').addEventListener('change', () => showAudience('edit'));
  $('arc-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!manager || !detail || editBusy) return; message('arc-edit-error'); let changes;
    try { changes = {title:$('arc-edit-name').value.trim(), description:$('arc-edit-description').value.trim(), academic_year:year($('arc-edit-year').value), term:$('arc-edit-term').value, area:$('arc-edit-area').value, ...readAudience('edit'), review_status:$('arc-edit-status').value, in_materials:$('arc-edit-materials').checked, category:$('arc-edit-category').value, unit:$('arc-edit-unit').value.trim()}; if (!changes.title) throw new Error('Enter a title.'); } catch (error) { message('arc-edit-error',error.message,'error'); return; }
    const id = detail.id; editBusy = true; $('arc-edit-fields').disabled = true; $('arc-edit-save').disabled = true;
    try {
      if (detail.in_materials && !changes.in_materials && !await askRemoval({message:`Remove “${detail.title}” from Materials and save these changes? Its Archive record and existing links will be kept.`,confirmLabel:'Remove from Materials'})) return;
      await api(`/api/archive/${id}`,changes,'PATCH'); notifyChanged(); editBusy = false; $('arc-edit-dialog').close(); await openDetail(id); if (detail?.id === id) message('arc-detail-message','Record updated.'); const loaded = await loadList({quiet:true}); if (!loaded) message('arc-message','Record updated. Refresh the list to see the latest records.','warning');
    }
    catch (error) { message('arc-edit-error',humanError(error,'The update could not be confirmed. Check the record before trying again.'),'error'); }
    finally { editBusy = false; $('arc-edit-fields').disabled = false; $('arc-edit-save').disabled = false; showAudience('edit'); if ($('arc-edit-dialog').open) $('arc-edit-save').focus(); }
  });

  $('arc-classify').addEventListener('click', () => { if (!manager || !selected.size || loading) return; $('arc-bulk-form').reset(); $('arc-bulk-year').disabled = true; $('arc-bulk-status').disabled = false; gradeChoices('arc-bulk-grades'); showAudience('bulk'); message('arc-bulk-error'); $('arc-bulk-description').textContent = `${selected.size} selected record${selected.size === 1 ? '' : 's'}. Only the fields you choose will change.`; $('arc-bulk-dialog').showModal(); });
  $('arc-bulk-year-apply').addEventListener('change', () => $('arc-bulk-year').disabled = !$('arc-bulk-year-apply').checked);
  $('arc-bulk-materials').addEventListener('change', () => { const promote = $('arc-bulk-materials').value === 'true'; if (promote) $('arc-bulk-status').value = 'approved'; $('arc-bulk-status').disabled = promote; });
  $('arc-bulk-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!manager || !selected.size || bulkBusy) return; message('arc-bulk-error'); const changes = {};
    try {
      if ($('arc-bulk-year-apply').checked) changes.academic_year = year($('arc-bulk-year').value);
      [['term','term'],['area','area'],['status','review_status']].forEach(([input,key]) => { if ($(`arc-bulk-${input}`).value !== '__keep') changes[key] = $(`arc-bulk-${input}`).value; });
      if ($('arc-bulk-visibility').value !== '__keep') Object.assign(changes,readAudience('bulk'));
      [['materials','in_materials'],['archived','is_archived']].forEach(([input,key]) => { if ($(`arc-bulk-${input}`).value !== '__keep') changes[key] = $(`arc-bulk-${input}`).value === 'true'; });
      if (changes.in_materials) { changes.review_status = 'approved'; if (changes.visibility === 'management' || (!changes.visibility && items.some((item) => selected.has(String(item.id)) && item.visibility === 'management'))) throw new Error('Management records cannot appear in Materials. Choose All staff or Selected grades as the audience, or keep them outside Materials.'); }
      if (!Object.keys(changes).length) throw new Error('Choose at least one field to change.');
    } catch (error) { message('arc-bulk-error',error.message,'error'); return; }
    const ids = [...selected]; bulkBusy = true; $('arc-bulk-fields').disabled = true; $('arc-bulk-save').disabled = true;
    try {
      if (changes.is_archived === true || changes.in_materials === false) {
        const actions = [changes.is_archived === true ? 'retire the selected records' : '',changes.in_materials === false ? 'remove them from Materials' : ''].filter(Boolean).join(' and ');
        if (!await askRemoval({message:`Apply changes to ${ids.length} selected record${ids.length === 1 ? '' : 's'} and ${actions}? Files will remain in the Archive and existing links will be kept.`,confirmLabel:changes.is_archived === true ? 'Retire records' : 'Remove from Materials'})) return;
      }
      const data = await api('/api/archive/bulk',{ids,changes}); notifyChanged(); const count = data.updated ?? ids.length; bulkBusy = false; $('arc-bulk-dialog').close(); const loaded = await loadList({quiet:true}); message('arc-message',`${count} record${count === 1 ? '' : 's'} updated.${loaded ? '' : ' Refresh the list to see the latest records.'}`,loaded ? '' : 'warning');
    }
    catch (error) { message('arc-bulk-error',humanError(error,'The changes could not be confirmed. Refresh the Archive before trying again.'),'error'); }
    finally { bulkBusy = false; $('arc-bulk-fields').disabled = false; $('arc-bulk-save').disabled = false; $('arc-bulk-year').disabled = !$('arc-bulk-year-apply').checked; $('arc-bulk-status').disabled = $('arc-bulk-materials').value === 'true'; if ($('arc-bulk-dialog').open) $('arc-bulk-save').focus(); }
  });

  function sourceKind() { return document.querySelector('input[name="arc-source"]:checked').value; }
  function sourceUI() {
    const isFile = sourceKind() === 'file'; $('arc-file-field').hidden = !isFile; $('arc-link-fields').hidden = isFile;
    $('arc-url').required = !isFile; $('arc-url').disabled = isFile; $('arc-upload-name').required = !isFile;
    $('arc-title-field').hidden = isFile && uploadEntries.length > 1;
    $('arc-title-hint').textContent = isFile ? 'Optional for one file. Otherwise, each file keeps its own name.' : 'Use a clear name so colleagues can find this link.';
    $('arc-upload-save').textContent = isFile ? 'Upload files' : 'Save link';
  }
  function renderUploadResults() {
    $('arc-file-selection').textContent = uploadEntries.length && sourceKind() === 'file' ? `${uploadEntries.length} file${uploadEntries.length === 1 ? '' : 's'} ${uploadStarted ? 'in this upload' : 'selected for review'}` : 'No files selected';
    $('arc-upload-progress').hidden = !uploadEntries.length;
    const complete = uploadEntries.filter((entry) => entry.status === 'success').length;
    const failed = uploadEntries.filter((entry) => entry.status === 'failed').length;
    const uncertain = uploadEntries.filter((entry) => entry.status === 'uncertain').length;
    const running = uploadEntries.findIndex((entry) => entry.status === 'uploading');
    $('arc-upload-meter').max = uploadEntries.length || 1; $('arc-upload-meter').value = uploadEntries.filter((entry) => ['success','failed','uncertain'].includes(entry.status)).length;
    $('arc-upload-progress-label').textContent = running >= 0 ? `Uploading ${running + 1} of ${uploadEntries.length}… Keep this window open.` : uploadStarted ? `${complete} saved${failed ? ` · ${failed} failed` : ''}${uncertain ? ` · ${uncertain} need checking` : ''}. Successful files will not be uploaded again.` : `${uploadEntries.length} file${uploadEntries.length === 1 ? '' : 's'} selected.`;
    $('arc-upload-results').innerHTML = uploadEntries.map((entry,index) => `<li class="${entry.status}"><strong>${escape(entry.name)}</strong><span>${escape(entry.message || ({pending:'Ready to upload',uploading:'Uploading…',success:'Saved',failed:'Could not upload',uncertain:'Check the Archive before retrying'}[entry.status]))}</span>${entry.status === 'success' && entry.id ? ` <a href="archive.html?material=${encodeURIComponent(entry.id)}" target="_blank" rel="noopener">View record</a>` : ''}${entry.status === 'uncertain' ? ` <a href="archive.html?q=${encodeURIComponent(entry.title || entry.name)}" target="_blank" rel="noopener">Check Archive</a><button class="arc-text-button" type="button" data-retry-uncertain="${index}"${uploadBusy ? ' disabled' : ''}>Retry after checking</button>` : ''}</li>`).join('');
  }
  function openUpload() {
    if (!user || !locationReady || loading || (!manager && (!availableGrades.length || currentFolder?.upload_allowed === false))) return;
    uploadEntries = []; uploadMetadata = null; uploadStarted = false; $('arc-upload-form').reset(); $('arc-upload-fields').disabled = false; $('arc-upload-save').disabled = false; $('arc-upload-cancel').textContent = 'Cancel';
    const scope = currentFolder?.visibility || 'shared';
    const permittedGrades = scope === 'grades' ? availableGrades.filter((grade) => (currentFolder.grades || []).includes(grade)) : availableGrades;
    [...$('arc-upload-visibility').options].forEach((option) => { option.disabled = scope === 'management' ? option.value !== 'management' : scope === 'grades' ? option.value === 'shared' : false; });
    $('arc-upload-visibility').value = scope === 'grades' ? 'grades' : manager ? 'management' : 'grades';
    $('arc-upload-destination').textContent = folderPath();
    $('arc-upload-folder-hint').textContent = currentFolder ? `Folder audience: ${audience(currentFolder)}. Files stay together here and keep their own access rules.` : 'Files will be added to the Archive root. Open a folder first to add files inside it.';
    $('arc-upload-area').value = 'Other'; gradeChoices('arc-upload-grades',scope === 'grades' ? permittedGrades : [],permittedGrades); showAudience('upload'); sourceUI(); renderUploadResults(); message('arc-upload-error'); $('arc-upload-dialog').showModal();
  }
  $('arc-add').addEventListener('click',openUpload);
  function validateFileSelection(files) {
    const chosen = Array.from(files);
    if (!chosen.length) throw new Error('Choose at least one file.');
    if (chosen.length > 20) throw new Error('Choose up to 20 files at a time.');
    for (const file of chosen) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!EXTENSIONS.has(ext)) throw new Error(`${file.name}: choose a supported file type.`);
      if (file.name.length > 180) throw new Error(`${file.name.slice(0,60)}…: shorten the file name to 180 characters or fewer.`);
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: files must be nonempty and no larger than 10 MB.`);
    }
    return chosen;
  }
  function filesFromDrop(transfer) {
    const fileItems = Array.from(transfer?.items || []).filter((item) => item.kind === 'file');
    for (const item of fileItems) {
      let entry; try { entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null; } catch { entry = null; }
      if (entry?.isDirectory) throw new Error('Choose individual files, not folders. Open the folder on your computer, then select the files inside.');
    }
    const files = fileItems.length ? fileItems.map((item) => item.getAsFile()) : Array.from(transfer?.files || []);
    if (!files.length || files.some((file) => !file)) throw new Error('These files could not be read. Choose individual files using Choose files.');
    return files;
  }
  function selectUploadFiles(files) {
    if (uploadBusy || uploadStarted || sourceKind() !== 'file') return false;
    try {
      const chosen = validateFileSelection(files);
      uploadEntries = chosen.map((file) => ({file,name:file.name,status:'pending',message:''}));
      sourceUI(); renderUploadResults(); message('arc-upload-error'); return true;
    } catch (error) { message('arc-upload-error',error.message,'error'); return false; }
  }
  const fileDropZone = $('arc-file-field'); let fileDragDepth = 0;
  const fileTransfer = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const clearFileDrag = () => { fileDragDepth = 0; fileDropZone.classList.remove('drag-over'); };
  const acceptsFileSelection = () => !uploadBusy && !uploadStarted && sourceKind() === 'file';
  document.querySelectorAll('input[name="arc-source"]').forEach((input) => input.addEventListener('change', () => { if (uploadBusy || uploadStarted) return; uploadEntries = []; $('arc-files').value = ''; clearFileDrag(); sourceUI(); renderUploadResults(); message('arc-upload-error'); }));
  $('arc-choose-files').addEventListener('click', () => { if (acceptsFileSelection()) $('arc-files').click(); });
  $('arc-files').addEventListener('change', () => { if ($('arc-files').files.length) selectUploadFiles($('arc-files').files); clearFileDrag(); });
  fileDropZone.addEventListener('dragenter', (event) => { if (!fileTransfer(event)) return; event.preventDefault(); if (acceptsFileSelection()) { fileDragDepth++; fileDropZone.classList.add('drag-over'); } });
  fileDropZone.addEventListener('dragover', (event) => { if (!fileTransfer(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = acceptsFileSelection() ? 'copy' : 'none'; });
  fileDropZone.addEventListener('dragleave', () => { fileDragDepth = Math.max(0,fileDragDepth - 1); if (!fileDragDepth) clearFileDrag(); });
  fileDropZone.addEventListener('drop', (event) => {
    if (!fileTransfer(event)) return;
    event.preventDefault(); event.stopPropagation(); clearFileDrag(); if (!acceptsFileSelection()) return;
    try { if (selectUploadFiles(filesFromDrop(event.dataTransfer))) { $('arc-files').value = ''; $('arc-choose-files').focus({preventScroll:true}); } }
    catch (error) { message('arc-upload-error',error.message,'error'); }
  });
  $('arc-upload-dialog').addEventListener('dragover', (event) => { if (!fileTransfer(event)) return; event.preventDefault(); if (!fileDropZone.contains(event.target)) event.dataTransfer.dropEffect = 'none'; });
  $('arc-upload-dialog').addEventListener('drop', (event) => { if (!fileTransfer(event)) return; event.preventDefault(); clearFileDrag(); if (acceptsFileSelection()) message('arc-upload-error','Drop files inside the upload box, or select Choose files.','error'); });
  $('arc-upload-dialog').addEventListener('close', clearFileDrag);
  function fileBase64(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('This file could not be read. Choose it again.')); reader.readAsDataURL(file); }); }
  function validateUpload() {
    const kind = sourceKind(); const classification = {folder_id:folderId === 'root' ? null : folderId,description:$('arc-upload-description').value.trim(),academic_year:year($('arc-upload-year').value),term:$('arc-upload-term').value,area:$('arc-upload-area').value,...readAudience('upload'),category:$('arc-upload-category').value,unit:$('arc-upload-unit').value.trim(),kind,review_status:manager ? 'needs_review' : 'approved',in_materials:false};
    if (kind === 'link') { const url = safeUrl($('arc-url').value.trim()), title = $('arc-upload-name').value.trim(); if (!url) throw new Error('Enter a secure HTTPS link without a username or password.'); if (!title) throw new Error('Enter a title for this link.'); uploadEntries = [{name:title,title,url,status:'pending'}]; }
    else {
      validateFileSelection(uploadEntries.map((entry) => entry.file));
      for (const entry of uploadEntries) {
        entry.title = uploadEntries.length === 1 && $('arc-upload-name').value.trim() ? $('arc-upload-name').value.trim() : entry.name.replace(/\.[^.]+$/,'').slice(0,200).trim() || entry.name.slice(0,200);
      }
    }
    return classification;
  }
  async function runUploads() {
    if (uploadBusy) return;
    message('arc-upload-error');
    if (!uploadStarted) { try { uploadMetadata = validateUpload(); } catch (error) { message('arc-upload-error',error.message,'error'); return; } uploadStarted = true; }
    uploadBusy = true; $('arc-upload-fields').disabled = true; $('arc-upload-save').disabled = true; $('arc-upload-cancel').disabled = true;
    let newlySaved = 0;
    for (const entry of uploadEntries) {
      if (!['pending','failed'].includes(entry.status)) continue;
      entry.status = 'uploading'; entry.message = ''; renderUploadResults(); let sending = false;
      try {
        const payload = {...uploadMetadata,title:entry.title};
        if (uploadMetadata.kind === 'file') { payload.file_name = entry.name; payload.content_base64 = await fileBase64(entry.file); } else payload.url = entry.url;
        sending = true;
        const data = await api('/api/archive',payload,'POST',{signal:AbortSignal.timeout(90000)});
        entry.status = 'success'; entry.id = data.material?.id; entry.message = manager ? 'Saved · Needs review' : 'Saved · Approved'; newlySaved++;
      } catch (error) {
        entry.status = sending && (!error.status || error.status >= 500) ? 'uncertain' : 'failed';
        entry.message = entry.status === 'uncertain' ? 'Upload not confirmed. Check the Archive before retrying to avoid another copy.' : humanError(error,error.message || 'This file could not be uploaded.');
      }
      renderUploadResults();
      // Preserve unsent files when the connection is uncertain; one failed
      // request should not hold the entire batch through repeated timeouts.
      if (entry.status === 'uncertain') break;
    }
    uploadBusy = false; renderUploadResults(); $('arc-upload-cancel').disabled = false; $('arc-upload-cancel').textContent = 'Done';
    const failed = uploadEntries.some((entry) => ['failed','pending'].includes(entry.status)); $('arc-upload-save').disabled = !failed; $('arc-upload-save').textContent = 'Retry failed uploads';
    if (newlySaved) { notifyChanged(); const loaded = await loadList({quiet:true}); message('arc-message',`${newlySaved} record${newlySaved === 1 ? '' : 's'} added to the Archive.${manager ? ' Open Needs review to finish classification.' : ''}${loaded ? '' : ' Refresh the list to see the latest records.'}`,loaded ? '' : 'warning'); }
  }
  $('arc-upload-form').addEventListener('submit', (event) => { event.preventDefault(); void runUploads(); });
  $('arc-upload-results').addEventListener('click', (event) => { const button = event.target.closest('[data-retry-uncertain]'); if (!button || uploadBusy) return; const entry = uploadEntries[Number(button.dataset.retryUncertain)]; if (entry?.status === 'uncertain' && confirm('Retry this upload only if you checked the Archive and the record is missing. Upload it again?')) { entry.status = 'pending'; entry.message = 'Ready to retry'; renderUploadResults(); $('arc-upload-save').disabled = false; $('arc-upload-save').textContent = 'Retry pending uploads'; } });

  async function initialize() {
    $('arc-areas').innerHTML = '<button type="button" data-area="" aria-pressed="true"><i class="fa-regular fa-folder-open" aria-hidden="true"></i> All areas</button>' + AREAS.map((area,index) => `<button type="button" data-area="${escape(area)}" aria-pressed="false"><i class="fa-solid fa-${AREA_ICONS[index]}" aria-hidden="true"></i> ${AREA_NAMES[index]}</button>`).join('');
    ['arc-area','arc-upload-area','arc-edit-area','arc-bulk-area'].forEach((id) => $(id).insertAdjacentHTML('beforeend',AREAS.map((area) => `<option>${escape(area)}</option>`).join('')));
    $('arc-upload-area').value = 'Other';
    const params = new URLSearchParams(location.search); $('arc-query').value = (params.get('q') || '').slice(0,200); folderId = numericId(params.get('folder')) ? params.get('folder') : 'root';
    try {
      await window.FldAuth.ready; user = window.FldAuth.user; if (!user) return;
      manager = ['admin','coordinator'].includes(user.role); admin = user.role === 'admin'; availableGrades = manager ? GRADES : GRADES.filter((grade) => (user.grades || []).includes(grade));
      $('arc-grade').insertAdjacentHTML('beforeend',availableGrades.map((grade) => `<option>${grade}</option>`).join('')); $('arc-grade').disabled = !availableGrades.length;
      $('arc-selection').hidden = !manager; $('arc-new-folder').hidden = !manager; $('arc-review-tab').hidden = !manager; $('arc-status-label').hidden = !manager; $('arc-management-filter').hidden = !manager;
      if (!manager) { $('arc-upload-visibility').innerHTML = '<option value="grades">Selected grades</option>'; $('arc-upload-policy').textContent = 'Your uploads are approved for your assigned grades. A coordinator or administrator can add them to Materials.'; }
      $('arc-add').disabled = !manager && !availableGrades.length;
      $('arc-permissions').textContent = manager ? 'Manage school records here. Materials is the teaching library; adding a record here does not publish it there.' : availableGrades.length ? `Showing approved records for ${availableGrades.join(', ')} and all staff. You can add files for your assigned grades.` : 'Shared records are available. Ask an administrator to assign your grades before adding files.';
      await loadList(); if (numericId(params.get('material'))) void openDetail(params.get('material'));
    } catch { message('arc-message','Your Archive access could not be loaded. Refresh the page to try again.','error'); $('arc-empty-title').textContent = 'Archive unavailable'; $('arc-empty-text').textContent = 'Refresh the page to reconnect.'; }
  }
  void initialize();
})();
