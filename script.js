/* Shared portal navigation, search, reminders and dashboard. */
(() => {
    'use strict';
    if (window.FldPortal) return;
    const portal = { refresh: () => Promise.resolve() };
    window.FldPortal = portal;
    const page = location.pathname.split('/').pop() || 'index.html';
    const pageNames = { 'index.html': 'Dashboard', 'materials.html': 'Materials', 'archive.html': 'Archive', 'calendar.html': 'Calendar', 'announcements.html': 'Announcements', 'homework.html': 'Homework', 'homework-check.html': 'Homework Check', 'users.html': 'Users', 'settings.html': 'Settings' };
    if (!document.querySelector('link[href="dashboard.css"]')) {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet'; stylesheet.href = 'dashboard.css'; document.head.appendChild(stylesheet);
    }
    const element = (tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = String(value);
        return node;
    };
    const byId = id => document.getElementById(id);
    async function loadHelpers() {
        if (window.FldPortalData) return window.FldPortalData;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = 'portal-data.js';
            script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
        });
        return window.FldPortalData;
    }
    async function loadTopbar() {
        const container = byId('topbar-container');
        if (!container) return;
        const response = await fetch('topbar.html', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
        if (!response.ok || response.redirected) throw new Error('Navigation unavailable');
        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        const topbar = parsed.querySelector('.topbar');
        if (!topbar) throw new Error('Navigation unavailable');
        container.replaceChildren(document.importNode(topbar, true));
        byId('portal-page-title').textContent = pageNames[page] || 'FLD Portal';
    }
    async function start() {
        portal.helpersReady = loadHelpers();
        const [D, user] = await Promise.all([portal.helpersReady, window.FldAuth.ready, loadTopbar()]);
        if (!user) return;
        const auth = window.FldAuth;
        const data = { homeworks: [], events: [], materials: [], announcements: [], failures: [], loading: true };
        const sourceLabels = { homeworks: 'homework', events: 'calendar', materials: 'materials', announcements: 'announcements' };
        let refreshPending = null;
        let loadedAt = 0;
        let notificationItems = [];
        let readIds = new Set();
        let readPersistenceFailed = false;
        const readKey = `fld-notifications-read:${user.id}`;
        try {
            const stored = JSON.parse(localStorage.getItem(readKey) || '[]');
            if (Array.isArray(stored)) readIds = new Set(stored.filter(value => typeof value === 'string').slice(-2000));
        } catch { /* An unread reminder is safer than losing one when storage is unavailable. */ }
        const dateLabel = value => {
            const date = D.dateOnly(value);
            return date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
        };
        function linkToItem(link, item) {
            link.href = item.url;
        }
        function updateGreeting(account) {
            const greeting = byId('greeting');
            if (!greeting) return;
            const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
            const salutation = hour < 6 || hour >= 22 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
            const name = String(account.full_name || '').trim().split(/\s+/)[0];
            greeting.textContent = `${salutation}${name ? `, ${name}` : ''} 👋`;
            byId('current-date').textContent = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
        updateGreeting(user);
        window.addEventListener('fld:userchange', event => updateGreeting(event.detail));

        async function readPageItems(kind) {
            if (kind === 'materials') {
                const response = await auth.request('/api/materials');
                if (!Array.isArray(response.materials)) throw new Error('Content unavailable');
                return response.materials.filter(item => !item.is_archived).map(item => ({ ...item, kind: 'material', date: D.schoolTimestampDate(item.created_at),
                    detail: `${(item.grades || []).join(', ') || 'Shared'} · ${item.category || (item.kind === 'link' ? 'Link' : 'File')}${item.unit ? ` · ${item.unit}` : ''}`,
                    url: `materials.html?material=${encodeURIComponent(item.id)}` }));
            }
            const response = await auth.request('/api/announcements');
            if (!Array.isArray(response.announcements)) throw new Error('Content unavailable');
            return response.announcements.filter(item => !item.is_archived).map(item => ({ ...item, kind: 'announcement', date: D.dateOnly(item.date), detail: item.category,
                url: `announcements.html?announcement=${encodeURIComponent(item.id)}` }));
        }

        function unavailableText(sources) {
            const failed = data.failures.filter(source => sources.includes(source));
            return failed.length ? `Could not load ${failed.map(source => sourceLabels[source]).join(', ')}. Reload to try again.` : '';
        }
        function renderRows(id, items, emptyText, failure = '') {
            const list = byId(id);
            if (!list) return;
            list.replaceChildren();
            if (failure) list.append(element('p', 'portal-notice portal-error', failure));
            for (const item of items) {
                const row = element('a', 'portal-dashboard-row'); linkToItem(row, item);
                const copy = element('div', 'portal-row-copy');
                copy.append(element('h3', '', item.title), element('p', '', item.detail || item.description || ''));
                row.append(copy);
                if (item.badge) row.append(element('span', `portal-row-badge${item.overdue ? ' overdue' : ''}`, item.badge));
                if (item.materials?.length) {
                    const entry = element('div','portal-plan-entry'); entry.append(row);
                    const links = element('div','portal-plan-materials'); links.append(element('span','','Materials'));
                    for (const material of item.materials) {
                        const link = element('a','',`${material.title}${material.is_archived ? ' (Archived)' : ''}`);
                        link.href = `archive.html?material=${encodeURIComponent(material.id)}`;
                        links.append(link);
                    }
                    entry.append(links); list.append(entry);
                } else list.append(row);
            }
            if (!items.length && !failure) list.append(element('p', 'portal-empty', emptyText));
        }
        function renderDashboard() {
            if (!document.querySelector('.dashboard-content')) return;
            const today = D.schoolToday();
            const active = data.homeworks.filter(item => !item.is_archived && D.dateOnly(item.assign_date) <= today);
            const plan = data.events.filter(item => D.occursOn(item, today)).map(item => ({ title: item.title,
                detail: item.description || item.category || 'Calendar event', badge: item.start_time ? String(item.start_time).slice(0, 5) : 'All day', url: D.eventUrl(item, today), materials: item.materials || [] }));
            plan.push(...active.filter(item => D.dateOnly(item.due_date) === today).map(item => ({ title: item.title,
                detail: `${item.grade} · ${item.class_name}`, badge: 'Due today', url: D.homeworkUrl(item), materials: item.materials || [] })));
            const upcoming = D.upcomingEvents(data.events, today);
            byId('today-task-count').textContent = unavailableText(['homeworks', 'events']) ? '—' : String(plan.length);
            byId('homework-count').textContent = data.failures.includes('homeworks') ? '—' : String(active.length);
            byId('event-count').textContent = data.failures.includes('events') ? '—' : String(new Set(upcoming.map(item => String(item.event.id))).size);
            byId('material-count').textContent = data.failures.includes('materials') ? '—' : String(data.materials.length);
            const status = byId('dashboard-status'); status.replaceChildren();
            status.hidden = !data.failures.length;
            if (data.failures.length) {
                status.append(element('span', '', 'Some dashboard sections could not be loaded. '));
                const retry = element('button', 'portal-retry', 'Try again'); retry.type = 'button';
                retry.addEventListener('click', () => { retry.disabled = true; refresh(); }); status.append(retry);
            }
            renderRows('today-plan-list', plan, 'No events or homework due today.', unavailableText(['events', 'homeworks']));
            renderRows('homework-list', active.slice().sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 5).map(item => ({
                title: item.title, detail: `${item.grade} · ${item.class_name}`, badge: `Due ${dateLabel(item.due_date)}`, overdue: D.dateOnly(item.due_date) < today, url: D.homeworkUrl(item)
            })), 'No homework has been assigned yet.', unavailableText(['homeworks']));
            renderRows('announcement-list', data.announcements.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(item => ({ ...item, detail: item.description, badge: dateLabel(item.date) })), 'No announcements yet.', unavailableText(['announcements']));
            renderRows('material-list', data.materials.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map(item => ({ ...item, badge: dateLabel(item.date) })), 'No materials yet.', unavailableText(['materials']));
        }
        const searchInput = byId('portal-search-input');
        const searchPanel = byId('portal-search-results');
        const bell = byId('portal-notifications-button');
        const notificationPanel = byId('portal-notifications');
        function closeSearch() { if (searchPanel) { searchPanel.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); } }
        function closeNotifications() { if (notificationPanel) { notificationPanel.hidden = true; bell.setAttribute('aria-expanded', 'false'); } }
        function searchItems() {
            const pages = Object.entries(pageNames).filter(([name]) => name !== 'users.html' || user.role === 'admin').map(([url, title]) => ({ title, url, kind: 'page', detail: 'Page' }));
            return pages.concat(
                data.homeworks.filter(item => !item.is_archived).map(item => ({ title: item.title, kind: 'homework', detail: `Homework · ${item.grade} · ${item.class_name}`, description: item.description, url: D.homeworkUrl(item) })),
                data.events.map(item => ({ title: item.title, kind: 'event', detail: `Calendar · ${dateLabel(D.eventSearchDate(item, D.schoolToday()))}`, description: item.description, url: D.eventUrl(item, D.eventSearchDate(item, D.schoolToday())) })),
                data.materials, data.announcements);
        }
        function renderSearch() {
            if (!searchInput) return;
            const items = D.search(searchItems(), searchInput.value);
            const list = byId('portal-search-list'); list.replaceChildren();
            for (const item of items) {
                const link = element('a', 'portal-result'); linkToItem(link, item);
                link.append(element('strong', '', item.title), element('span', '', item.detail)); list.append(link);
            }
            if (searchInput.value.trim()) {
                const archiveLink=element('a','portal-result'); archiveLink.href=`archive.html?q=${encodeURIComponent(searchInput.value.trim())}`;
                archiveLink.append(element('strong','','Search school records in Archive'),element('span','','Find records by school year, term and area.')); list.append(archiveLink);
            }
            const partial = data.failures.length ? ` ${unavailableText(Object.keys(sourceLabels))}` : '';
            byId('portal-search-status').textContent = data.loading ? 'Loading portal content. Pages are available below.' : !searchInput.value.trim() ? `Quick navigation. Type to search portal content.${partial}` : items.length ? `${items.length}${items.length === 12 ? '+' : ''} results.${partial}` : partial ? `No matches in the content that loaded.${partial}` : 'No results. Try a different title or class.';
        }
        function markRead(ids) {
            for (const id of ids) readIds.add(id);
            readIds = new Set(Array.from(readIds).slice(-2000));
            try { localStorage.setItem(readKey, JSON.stringify(Array.from(readIds))); readPersistenceFailed = false; }
            catch { readPersistenceFailed = true; }
            renderNotifications();
        }
        function renderNotifications() {
            if (!bell) return;
            notificationItems = D.notifications(data, D.schoolToday());
            const unread = notificationItems.filter(item => !readIds.has(item.id)).length;
            const badge = byId('portal-notification-count'); badge.hidden = unread === 0;
            badge.textContent = unread > 99 ? '99+' : String(unread);
            bell.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
            byId('portal-mark-read').disabled = !unread;
            const list = byId('portal-notification-list'); list.replaceChildren();
            for (const item of notificationItems) {
                const link = element('a', `portal-result portal-reminder${readIds.has(item.id) ? '' : ' unread'}`); linkToItem(link, item);
                link.append(element('strong', '', item.title), element('span', '', `${item.detail} · ${dateLabel(item.date)}`));
                if (!readIds.has(item.id)) link.append(element('span', 'portal-sr-only', 'Unread'));
                link.addEventListener('click', () => markRead([item.id])); list.append(link);
            }
            const failure = unavailableText(['events', 'homeworks', 'announcements']);
            byId('portal-notification-status').textContent = data.loading ? 'Loading reminders…' : `${failure || (notificationItems.length ? 'Upcoming 7 days and homework due in the past 7 days.' : 'No reminders for the next 7 days or homework due in the past 7 days.')}${readPersistenceFailed ? ' Read status applies to this page only because browser storage is unavailable.' : ''}`;
        }
        if (searchInput) {
            const openSearch = () => { closeNotifications(); renderSearch(); searchPanel.hidden = false; searchInput.setAttribute('aria-expanded', 'true'); };
            searchInput.addEventListener('focus', openSearch);
            searchInput.addEventListener('input', openSearch);
            searchInput.addEventListener('keydown', event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); openSearch(); byId('portal-search-list').querySelector('a')?.focus(); }
                if (event.key === 'Enter') { const first = byId('portal-search-list').querySelector('a'); if (first && !searchPanel.hidden) { event.preventDefault(); first.click(); } }
            });
            searchPanel.addEventListener('keydown', event => {
                const links = Array.from(searchPanel.querySelectorAll('a')); const index = links.indexOf(document.activeElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = index + (event.key === 'ArrowDown' ? 1 : -1); if (next < 0) searchInput.focus(); else links[Math.min(next, links.length - 1)]?.focus(); }
            });
            bell.addEventListener('click', () => {
                const open = notificationPanel.hidden; closeSearch(); notificationPanel.hidden = !open; bell.setAttribute('aria-expanded', String(open));
                if (open && Date.now() - loadedAt > 60000) refresh();
            });
            byId('portal-mark-read').addEventListener('click', () => markRead(notificationItems.map(item => item.id)));
            document.addEventListener('pointerdown', event => {
                if (!event.target.closest('.portal-search')) closeSearch();
                if (!event.target.closest('.portal-notification-area')) closeNotifications();
            });
            document.addEventListener('focusin', event => {
                if (!event.target.closest('.portal-search')) closeSearch();
                if (!event.target.closest('.portal-notification-area')) closeNotifications();
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    if (!notificationPanel.hidden) { closeNotifications(); bell.focus(); event.preventDefault(); }
                    if (!searchPanel.hidden) { searchInput.focus(); closeSearch(); event.preventDefault(); }
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
            });
            window.addEventListener('storage', event => {
                if (event.key !== readKey && event.key !== null) return;
                try { const stored = JSON.parse(event.newValue || '[]'); readIds = new Set(Array.isArray(stored) ? stored.filter(value => typeof value === 'string').slice(-2000) : []); } catch { readIds = new Set(); }
                renderNotifications();
            });
        }
        async function refresh() {
            if (refreshPending) return refreshPending;
            refreshPending = (async () => {
                const sources = ['homeworks', 'events', 'materials', 'announcements'];
                const results = await Promise.allSettled([
                    auth.request('/api/homework').then(result => { if (!Array.isArray(result.homeworks)) throw new Error('Invalid homework'); return result.homeworks; }),
                    auth.request('/api/events').then(result => { if (!Array.isArray(result)) throw new Error('Invalid events'); return result; }),
                    readPageItems('materials'), readPageItems('announcements')
                ]);
                data.failures = [];
                results.forEach((result, index) => { const source = sources[index]; if (result.status === 'fulfilled') data[source] = result.value; else { data[source] = []; data.failures.push(source); } });
                data.loading = false; loadedAt = Date.now();
                renderDashboard(); renderSearch(); renderNotifications();
            })().finally(() => { refreshPending = null; });
            return refreshPending;
        }
        portal.refresh = refresh;
        renderSearch(); renderNotifications();
        await refresh();
        window.addEventListener('fld:homeworkchange', refresh);
        window.addEventListener('fld:materialschange', refresh);
        window.addEventListener('fld:archivechange', refresh);
        window.addEventListener('fld:announcementschange', refresh);
        window.addEventListener('fld:calendarchange', refresh);
        window.addEventListener('focus', () => { if (Date.now() - loadedAt > 60000) refresh(); });
    }
    start().catch(() => {
        const container = byId('topbar-container');
        if (container && !container.querySelector('.topbar')) container.append(element('p', 'portal-notice portal-error', 'Navigation could not be loaded. Reload this page to try again.'));
        const status = byId('dashboard-status');
        if (status) { status.hidden = false; status.textContent = 'The dashboard could not be loaded. Reload this page to try again.'; }
    });
})();
