(() => {
    'use strict';
    const $ = id => document.getElementById(id), R = window.FldHomeworkReport, auth = window.FldAuth;
    const configuredApi = document.querySelector('meta[name="fld-api-base"]')?.content.trim();
    const apiBase = (configuredApi || (location.protocol === 'http:' && location.port === '5500' ? `${location.protocol}//${location.hostname}:3000` : location.origin)).replace(/\/$/, '');
    const allGrades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
    const allowedGrades = () => user?.role === 'teacher' ? allGrades.filter(grade => user.grades?.includes(grade)) : allGrades;
    let user, homeworks = [], students = [], homework = null, checks = new Map(), dirty = new Map();
    let loading = false, saving = false, selection = { grade: 'Grade 1', className: 'A', homeworkId: '' };
    let reportStudent = null, reportData = null, reportSequence = 0, reportAbort;
    const canManageRoster = () => user && user.role !== 'teacher';
    const canGradeHomework = item => item && allowedGrades().includes(item.grade) && !item.is_archived && item.assign_date <= R.schoolToday() && (user.role !== 'teacher' || String(item.created_by) === String(user.id));
    const canGrade = () => canGradeHomework(homework);
    const assignedAlternative = () => homeworks.filter(item => item.grade === homework?.grade && item.class_name === homework?.class_name && canGradeHomework(item)).sort((a, b) => b.assign_date.localeCompare(a.assign_date))[0] || null;
    function message(id, text, error = false) { const element = $(id); element.textContent = text; element.hidden = !text; element.classList.toggle('error', error); }
    async function write(path, method, body) { return auth.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    function savedValue(id) { const check = checks.get(String(id)); return { status: check?.status || 'unreviewed', note: check?.note || '' }; }
    function value(id) { return dirty.get(String(id)) || savedValue(id); }
    function saveStatus() {
        $('save-status').textContent = homework && !canGrade() ? 'View only · No changes can be made to this assignment right now' : dirty.size ? `${dirty.size} student${dirty.size === 1 ? '' : 's'} with unsaved changes` : homework ? 'All checks are saved' : 'Choose homework to record checks';
        $('save-checks').hidden = Boolean(homework && !canGrade());
        $('save-checks').disabled = saving || loading || !dirty.size || !canGrade();
        $('save-checks').textContent = saving ? 'Saving…' : 'Save checks';
    }
    function controls() {
        for (const id of ['check-grade', 'check-class', 'check-homework', 'refresh-checks', 'class-roster']) $(id).disabled = loading || saving || !user || !allowedGrades().length;
        $('choose-assigned-homework').disabled = loading || saving || !assignedAlternative();
        document.querySelectorAll('#check-students select').forEach(element => { element.disabled = loading || saving || !canGrade() || element.dataset.inactive === 'true'; });
        document.querySelectorAll('#check-students textarea').forEach(element => { element.disabled = loading || saving || !canGrade() || element.dataset.inactive === 'true' || value(element.dataset.studentNote).status === 'unreviewed'; });
        saveStatus();
    }
    function renderChecks() {
        const visible = students.filter(student => student.is_active || checks.has(String(student.id)));
        $('selected-homework').hidden = !homework;
        if (homework) {
            $('selected-title').textContent = homework.title;
            $('selected-dates').textContent = `${homework.grade} · Class ${homework.class_name} · ${homework.assign_date > R.schoolToday() ? 'Scheduled for' : 'Assigned'} ${R.formatDate(homework.assign_date)} · Due ${R.formatDate(homework.due_date)}${homework.pages ? ` · Pages / section: ${homework.pages}` : ''}`;
            $('selected-description').textContent = homework.description;
            let attachments = $('selected-materials');
            if (!attachments) { attachments = document.createElement('p'); attachments.id = 'selected-materials'; attachments.className = 'hw-hint'; $('selected-description').after(attachments); }
            attachments.hidden = !homework.materials?.length;
            attachments.innerHTML = (homework.materials || []).map(material => `<a class="hw-text-link" style="display:inline;overflow-wrap:anywhere" href="archive.html?material=${encodeURIComponent(material.id)}"><i class="fa-solid fa-paperclip" aria-hidden="true"></i> ${R.escape(material.title)}</a>`).join('<br>');
            $('selected-state').textContent = homework.is_archived ? 'Archived' : homework.assign_date > R.schoolToday() ? 'Not assigned yet' : 'Assigned';
            $('selected-state').classList.toggle('muted', homework.is_archived || homework.assign_date > R.schoolToday());
        }
        const locked = Boolean(homework && !canGrade()), future = Boolean(homework && !homework.is_archived && homework.assign_date > R.schoolToday());
        $('check-lock').hidden = !locked;
        $('check-lock-title').textContent = future ? `Checks open on ${R.formatDate(homework.assign_date)}` : homework?.is_archived ? 'Archived homework · View only' : 'Another teacher’s assignment · View only';
        const anotherTeacher = homework && user.role === 'teacher' && String(homework.created_by) !== String(user.id);
        $('check-lock-description').textContent = future ? `This homework has not been assigned yet. ${anotherTeacher ? 'Only its teacher, a coordinator or an admin can change checks once it is assigned.' : 'Status changes open on its assignment date.'} Student reports are available now.` : homework?.is_archived ? 'Saved checks and reports are available. Archived homework does not accept new checks.' : 'Only the teacher who created this assignment, a coordinator or an admin can change its checks.';
        $('choose-assigned-homework').hidden = !future || !assignedAlternative();
        $('check-permissions').textContent = !homework ? 'Choose homework to record checks. Student reports are available even when no homework is selected.' : locked ? 'Select a student’s name to view their report.' : 'Choose a status and add a note, then select Save checks. Setting a student to Unreviewed clears their saved status and note.';
        $('student-count').textContent = `${visible.length} student${visible.length === 1 ? '' : 's'}`;
        $('check-empty').hidden = Boolean(visible.length);
        $('check-empty').textContent = 'No students are in this class yet. An admin or coordinator can add students through Class roster.';
        $('check-table-wrap').hidden = !visible.length;
        $('check-students').innerHTML = visible.map(student => {
            const id = String(student.id), current = value(id), inactive = !student.is_active, modified = dirty.has(id);
            if (!canGrade() || inactive) {
                const status = R.status(current.status), reasonId = locked ? 'check-lock-title' : 'check-permissions';
                return `<tr><td><button type="button" class="hw-student-name" data-report-student="${R.escape(id)}">${R.escape(student.full_name)}<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></button>${inactive ? '<span class="hw-student-archived">Archived student</span>' : ''}</td><td><span class="hw-status-text ${R.escape(status.key)}" aria-describedby="${reasonId}">${R.escape(status.label)}</span><small class="hw-check-readonly">${inactive ? 'Archived student' : 'View only'}</small></td><td><div class="hw-note-display hw-check-note">${R.escape(current.note) || 'No note recorded'}</div></td><td class="hw-saved-state">${current.status === 'unreviewed' ? 'No check yet' : 'Saved'}</td></tr>`;
            }
            return `<tr class="${modified ? 'unsaved' : ''}"><td><button type="button" class="hw-student-name" data-report-student="${R.escape(id)}">${R.escape(student.full_name)}<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></button>${inactive ? '<span class="hw-student-archived">Archived student</span>' : ''}</td><td><select data-student-status="${R.escape(id)}" data-inactive="${inactive}" aria-label="Homework status for ${R.escape(student.full_name)}">${R.statuses.map(status => `<option value="${status.key}" ${status.key === current.status ? 'selected' : ''}>${status.label}</option>`).join('')}</select></td><td><textarea data-student-note="${R.escape(id)}" data-inactive="${inactive}" maxlength="2000" rows="2" aria-label="Teacher note for ${R.escape(student.full_name)}" placeholder="Optional note">${R.escape(current.note)}</textarea></td><td class="hw-saved-state" data-saved-state="${R.escape(id)}">${modified ? 'Unsaved' : current.status === 'unreviewed' ? 'No check yet' : 'Saved'}</td></tr>`;
        }).join('');
        controls();
    }
    function renderHomeworkOptions(preferred) {
        const matches = homeworks.filter(item => item.grade === $('check-grade').value && item.class_name === $('check-class').value).sort((a, b) => Number(a.is_archived) - Number(b.is_archived) || b.assign_date.localeCompare(a.assign_date));
        $('check-homework').innerHTML = '<option value="">Choose homework</option>' + matches.map(item => `<option value="${R.escape(item.id)}">${R.escape(item.title)} · Due ${R.formatDate(item.due_date)}${item.is_archived ? ' · Archived' : item.assign_date > R.schoolToday() ? ' · Scheduled' : ''}</option>`).join('');
        const selected = matches.find(item => String(item.id) === String(preferred));
        $('check-homework').value = selected ? String(selected.id) : '';
    }
    async function loadClass(preferred = $('check-homework').value, refreshHomeworks = false) {
        if (!allowedGrades().includes($('check-grade').value)) return;
        loading = true; controls();
        try {
            if (refreshHomeworks) homeworks = (await auth.request('/api/homework')).homeworks;
            renderHomeworkOptions(preferred);
            const selected = $('check-homework').value;
            const query = new URLSearchParams({ grade: $('check-grade').value, class_name: $('check-class').value, include_inactive: 'true' });
            const [roster, checked] = await Promise.all([auth.request(`/api/students?${query}`), selected ? auth.request(`/api/homework/${encodeURIComponent(selected)}/checks`) : Promise.resolve(null)]);
            students = roster.students;
            homework = checked?.homework || null;
            checks = new Map((checked?.checks || []).map(check => [String(check.student_id), check]));
            dirty.clear();
            selection = { grade: $('check-grade').value, className: $('check-class').value, homeworkId: selected };
            const url = new URL(location.href);
            if (selected) url.searchParams.set('homework', selected); else url.searchParams.delete('homework');
            history.replaceState(null, '', url);
            renderChecks();
            if ($('roster-dialog').open) renderRoster();
        } catch (error) {
            $('check-grade').value = selection.grade;
            $('check-class').value = selection.className;
            renderHomeworkOptions(selection.homeworkId);
            renderChecks();
            throw error;
        } finally { loading = false; controls(); }
    }
    async function discard() {
        if (!dirty.size) return true;
        if (await window.FldConfirm.ask({ title: 'Are you sure?', message: 'Discard your unsaved student checks? These changes will be lost. Previously saved checks will be kept.', confirmLabel: 'Discard changes', danger: true })) { dirty.clear(); return true; }
        $('check-grade').value = selection.grade; $('check-class').value = selection.className; $('check-homework').value = selection.homeworkId;
        return false;
    }
    for (const id of ['check-grade', 'check-class', 'check-homework']) $(id).addEventListener('change', async () => {
        if (!(await discard())) return;
        message('check-message', '');
        try { await loadClass(id === 'check-homework' ? $('check-homework').value : ''); }
        catch { message('check-message', 'This class could not be loaded. Select Refresh to try again.', true); }
    });
    $('choose-assigned-homework').addEventListener('click', async () => {
        if (loading || saving || !homework || homework.assign_date <= R.schoolToday()) return;
        const alternative = assignedAlternative(); if (!alternative || !(await discard())) return;
        message('check-message', '');
        try {
            await loadClass(alternative.id);
            message('check-message', `Ready to check: ${alternative.title}. Choose each student’s status, then save your checks.`);
            $('check-homework').focus({ preventScroll:true });
        } catch { message('check-message', 'The assigned homework could not be loaded. Select Refresh to try again.', true); }
    });
    $('refresh-checks').addEventListener('click', async () => {
        if (!(await discard())) return;
        try { await loadClass(selection.homeworkId, true); message('check-message', 'Student checks refreshed.'); }
        catch { message('check-message', 'Student checks could not be refreshed. Please try again.', true); }
    });
    function updateStudent(id) {
        if (!canGrade()) return;
        const student = students.find(item => String(item.id) === id);
        if (!student?.is_active) return;
        const statusElement = document.querySelector(`[data-student-status="${CSS.escape(id)}"]`), noteElement = document.querySelector(`[data-student-note="${CSS.escape(id)}"]`);
        const next = { status: statusElement.value, note: statusElement.value === 'unreviewed' ? '' : noteElement.value };
        if (next.status === 'unreviewed') noteElement.value = '';
        noteElement.disabled = next.status === 'unreviewed';
        const previous = savedValue(id);
        if (next.status === previous.status && next.note === previous.note) dirty.delete(id); else dirty.set(id, next);
        statusElement.closest('tr').classList.toggle('unsaved', dirty.has(id));
        document.querySelector(`[data-saved-state="${CSS.escape(id)}"]`).textContent = dirty.has(id) ? 'Unsaved' : previous.status === 'unreviewed' ? 'No check yet' : 'Saved';
        saveStatus();
    }
    $('check-students').addEventListener('change', event => { if (event.target.matches('[data-student-status]')) updateStudent(event.target.dataset.studentStatus); });
    $('check-students').addEventListener('input', event => { if (event.target.matches('[data-student-note]')) updateStudent(event.target.dataset.studentNote); });
    $('save-checks').addEventListener('click', async event => {
        if (!dirty.size || !canGrade() || saving || loading) return;
        const saveButton = event.currentTarget, homeworkId = homework.id, homeworkTitle = homework.title;
        saving = true; controls();
        let saved = 0, confirmationCancelled = false;
        try {
            const pending = [...dirty.entries()].map(([student_id, fields]) => ({ student_id, ...fields }));
            const clearing = pending.filter(row => row.status === 'unreviewed' && checks.has(String(row.student_id)));
            if (clearing.length && !(await window.FldConfirm.ask({
                title: 'Are you sure?',
                message: `Clear saved checks for ${clearing.length} student${clearing.length === 1 ? '' : 's'} in “${homeworkTitle}”? Their saved status and notes for this assignment will be removed. Other homework records will be kept.`,
                confirmLabel: clearing.length === 1 ? 'Clear saved check' : 'Clear saved checks', danger: true
            }))) { confirmationCancelled = true; return; }
            if (String(homework?.id) !== String(homeworkId) || !canGrade()) return;
            for (const batch of R.checkBatches(pending)) {
                const canonical = await write(`/api/homework/${encodeURIComponent(homeworkId)}/checks`, 'PUT', { checks: batch });
                checks = new Map(canonical.checks.map(check => [String(check.student_id), check]));
                homework = canonical.homework;
                for (const row of batch) {
                    dirty.delete(String(row.student_id));
                }
                saved += batch.length;
            }
            message('check-message', `${saved} student check${saved === 1 ? '' : 's'} saved. Reports now include these changes.`);
            window.dispatchEvent(new CustomEvent('fld:homeworkchange'));
        } catch (error) {
            message('check-message', error.status === 403 ? 'Your permission to edit this assignment has changed. Refresh to view its latest state.' : error.status === 409 ? 'This assignment or class has changed. Refresh after reviewing your unsaved checks.' : `${saved ? `${saved} checks saved. ` : ''}${dirty.size} checks could not be confirmed as saved. Retry to save them.`, true);
        } finally {
            saving = false; renderChecks();
            if (confirmationCancelled && saveButton.isConnected && !saveButton.disabled) saveButton.focus({ preventScroll: true });
        }
    });
    window.addEventListener('beforeunload', event => { if (dirty.size) { event.preventDefault(); event.returnValue = ''; } });
    function renderRoster() {
        $('roster-subtitle').textContent = `${selection.grade} · Class ${selection.className}`;
        $('add-student-form').hidden = !canManageRoster();
        $('roster-permissions').textContent = canManageRoster() ? 'Add students to this class or archive students who have left. Archiving preserves saved checks and reports.' : 'An admin or coordinator manages the class roster. Select a student to view their report.';
        $('roster-students').innerHTML = students.length ? students.map(student => `<tr><td><button type="button" class="hw-student-name" data-roster-report="${R.escape(student.id)}">${R.escape(student.full_name)}</button></td><td><span class="hw-tag ${student.is_active ? '' : 'muted'}">${student.is_active ? 'Active' : 'Archived'}</span></td><td>${canManageRoster() && student.is_active ? `<button type="button" class="hw-action muted" data-archive-student="${R.escape(student.id)}">Archive</button>` : '<span class="hw-hint">Report available</span>'}</td></tr>`).join('') : '<tr><td colspan="3" class="hw-empty">No students have been added to this class.</td></tr>';
    }
    $('class-roster').addEventListener('click', () => {
        if (dirty.size) return message('check-message', 'Save your student checks before opening the class roster.', true);
        renderRoster(); message('roster-message', ''); $('roster-dialog').showModal();
    });
    document.querySelectorAll('[data-close-roster]').forEach(button => button.addEventListener('click', () => { if (!saving) $('roster-dialog').close(); }));
    $('roster-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    $('add-student-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || !canManageRoster()) return;
        const full_name = $('student-full-name').value.trim();
        if (!full_name) return message('roster-message', 'Enter the student’s full name.', true);
        saving = true; $('add-student').disabled = true;
        try {
            await write('/api/students', 'POST', { full_name, grade: selection.grade, class_name: selection.className });
            $('student-full-name').value = '';
            await loadClass(selection.homeworkId);
            message('roster-message', 'Student added.');
        } catch { message('roster-message', 'The student could not be added or refreshed. Refresh the class roster before retrying to avoid a duplicate.', true); }
        finally { saving = false; $('add-student').disabled = false; controls(); }
    });
    $('roster-students').addEventListener('click', async event => {
        const report = event.target.closest('[data-roster-report]');
        if (report) return openReport(report.dataset.rosterReport);
        const button = event.target.closest('[data-archive-student]');
        if (!button || saving || !canManageRoster()) return;
        const student = students.find(item => String(item.id) === button.dataset.archiveStudent);
        if (!student) return;
        if (!(await window.FldConfirm.ask({ title: 'Are you sure?', message: `Archive ${student.full_name}? They will leave the active class roster and new checks will be disabled. Their saved checks and reports will be preserved.`, confirmLabel: 'Archive student', danger: true }))) return;
        if (saving || !canManageRoster()) return;
        saving = true; button.disabled = true;
        try {
            await write(`/api/students/${encodeURIComponent(student.id)}`, 'PATCH', { is_active: false });
            await loadClass(selection.homeworkId);
            message('roster-message', 'Student archived. Their reports remain available here.');
        } catch { message('roster-message', 'The student could not be archived or refreshed. Refresh the roster and try again.', true); }
        finally { saving = false; if (button.isConnected) button.disabled = false; controls(); }
    });
    $('check-students').addEventListener('click', event => {
        const button = event.target.closest('[data-report-student]');
        if (button) openReport(button.dataset.reportStudent);
    });
    function reportButtons(disabled) {
        $('print-report').disabled = disabled;
        for (const [id, format] of [['download-csv', 'csv'], ['download-report', 'html']]) {
            const link = $(id);
            link.setAttribute('aria-disabled', String(disabled));
            if (disabled || !reportData) {
                link.removeAttribute('href');
                link.tabIndex = -1;
            } else {
                const query = new URLSearchParams({ from: reportData.from, to: reportData.to, period: reportData.period, format });
                link.href = `${apiBase}/api/students/${encodeURIComponent(reportData.student.id)}/report/export?${query}`;
                link.tabIndex = 0;
            }
        }
    }
    async function openReport(studentId) {
        if (saving || loading) return;
        if (dirty.size) return message('check-message', 'Save your student checks before opening a report. Reports show saved information.', true);
        reportStudent = students.find(student => String(student.id) === String(studentId));
        if (!reportStudent) return;
        $('report-title').textContent = reportStudent.full_name;
        $('report-subtitle').textContent = `${reportStudent.grade} · Class ${reportStudent.class_name}${reportStudent.is_active ? '' : ' · Archived student'}`;
        $('report-period').value = 'weekly';
        $('report-date').value = homework?.due_date || R.schoolToday();
        $('report-dialog').showModal();
        await loadReport();
    }
    async function loadReport() {
        if (!reportStudent) return;
        const sequence = ++reportSequence;
        reportAbort?.abort(); reportAbort = new AbortController();
        reportData = null; reportButtons(true); $('report-content').hidden = true;
        let dates;
        $('report-date-label').textContent = $('report-period').value === 'weekly' ? 'Week containing' : $('report-period').value === 'monthly' ? 'Month containing' : 'Date';
        try { dates = R.range($('report-date').value, $('report-period').value); }
        catch { return message('report-message', 'Choose a valid date for your report.', true); }
        $('report-range').textContent = `${R.periodLabel({ ...dates, period: $('report-period').value })} · ${R.formatDate(dates.from)}${dates.from === dates.to ? '' : ` – ${R.formatDate(dates.to)}`} · Based on assignment due dates; archived homework is included.`;
        message('report-message', 'Loading saved student report…');
        try {
            const data = await auth.request(`/api/students/${encodeURIComponent(reportStudent.id)}/report?${new URLSearchParams(dates)}`, { signal: AbortSignal.any([reportAbort.signal, AbortSignal.timeout(15000)]) });
            if (sequence !== reportSequence || !$('report-dialog').open) return;
            reportData = { ...data, period: $('report-period').value };
            const summary = R.summarize(data);
            $('report-counts').innerHTML = `<div class="hw-report-count"><strong>${summary.total}</strong><span>Total assignments</span></div><div class="hw-report-count"><strong style="color:#23835b">${summary.counts.completed}</strong><span>Completed</span></div>`;
            $('report-chart').innerHTML = `<div class="hw-chart-svg">${R.chart(data)}</div>${R.mobileChart(data)}`;
            $('report-empty').hidden = summary.total > 0;
            $('report-table-wrap').hidden = summary.total === 0;
            $('report-assignments').innerHTML = data.assignments.map(item => `<tr><td><strong>${R.escape(item.title)}</strong>${item.description ? `<p class="hw-report-description">${R.escape(item.description)}</p>` : ''}</td><td>${R.formatDate(item.assign_date)}</td><td>${R.formatDate(item.due_date)}</td><td><span class="hw-status-text ${R.status(item.status).key}">${R.status(item.status).label}</span></td><td class="hw-note-display">${R.escape(item.note) || '—'}</td></tr>`).join('');
            $('report-content').hidden = false; reportButtons(false);
            message('report-message', `${summary.total} assignment${summary.total === 1 ? '' : 's'} due in this period. Unreviewed assignments have no saved check.`);
        } catch (error) {
            if (sequence !== reportSequence || error.name === 'AbortError') return;
            message('report-message', 'The report could not be loaded. Select Update report to try again.', true);
        }
    }
    $('close-report').addEventListener('click', () => $('report-dialog').close());
    $('report-dialog').addEventListener('close', () => { reportSequence++; reportAbort?.abort(); reportData = null; });
    $('report-period').addEventListener('change', loadReport);
    $('report-date').addEventListener('change', loadReport);
    $('refresh-report').addEventListener('click', loadReport);
    for (const id of ['download-csv', 'download-report']) $(id).addEventListener('click', event => {
        if (!reportData || $(id).getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    $('print-report').addEventListener('click', () => {
        if (!reportData) return;
        document.body.classList.add('hw-print-report');
        window.addEventListener('afterprint', () => document.body.classList.remove('hw-print-report'), { once: true });
        window.print();
    });
    (async () => {
        user = await auth.ready;
        if (!user) return;
        const grades = allowedGrades();
        $('check-grade').innerHTML = grades.length ? grades.map(grade => `<option>${grade}</option>`).join('') : '<option value="">No grades assigned</option>';
        if (!grades.length) {
            $('check-empty').textContent = 'No grades have been assigned to your account yet. Ask an admin to assign your teaching grades.';
            $('check-permissions').textContent = 'Your assigned grades will appear here when an admin sets up your access.';
            controls(); return;
        }
        selection.grade = grades[0];
        try {
            homeworks = (await auth.request('/api/homework')).homeworks;
            const params = new URLSearchParams(location.search), requested = homeworks.find(item => String(item.id) === params.get('homework'));
            if (requested) { $('check-grade').value = requested.grade; $('check-class').value = requested.class_name; }
            await loadClass(requested?.id || '');
            if (params.get('student')) await openReport(params.get('student'));
        } catch { message('check-message', 'Homework checks could not be loaded. Select Refresh to try again.', true); $('check-empty').textContent = 'Class information is currently unavailable.'; }
        finally { controls(); }
    })();
})();
