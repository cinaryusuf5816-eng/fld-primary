/* Shared calendar and dashboard calculations. Date-only values remain local dates. */
((root, factory) => {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FldPortalData = api;
})(typeof window === 'object' ? window : globalThis, () => {
    'use strict';
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    function schoolToday(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const value = type => parts.find(part => part.type === type).value;
        return `${value('year')}-${value('month')}-${value('day')}`;
    }
    function schoolTimestampDate(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        const timestamp = new Date(value);
        return Number.isFinite(timestamp.getTime()) ? schoolToday(timestamp) : '';
    }
    function localDate(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function dateOnly(value) {
        if (typeof value !== 'string') return '';
        const date = value.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
        const parsed = new Date(`${date}T12:00:00`);
        return Number.isFinite(parsed.getTime()) && localDate(parsed) === date ? date : '';
    }
    function addDays(value, count) {
        const date = dateOnly(value);
        if (!date) return '';
        const parsed = new Date(`${date}T12:00:00`);
        parsed.setDate(parsed.getDate() + count);
        return localDate(parsed);
    }
    function occursOn(event, value) {
        const date = dateOnly(value);
        const start = dateOnly(event.start_date);
        const end = dateOnly(event.end_date) || start;
        if (!date || !start || date < start || date > end) return false;
        if (start === end || !event.days) return true;
        return event.days[dayNames[new Date(`${date}T12:00:00`).getDay()]] === true;
    }
    function upcomingEvents(events, today, count = 7) {
        const result = [];
        for (let day = 0; day < count; day++) {
            const date = addDays(today, day);
            for (const event of events) if (occursOn(event, date)) result.push({ event, date });
        }
        return result.sort((a, b) => a.date.localeCompare(b.date) || String(a.event.start_time || '').localeCompare(String(b.event.start_time || '')));
    }
    function stableId(value) {
        let hash = 2166136261;
        for (const character of String(value)) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(36);
    }
    function homeworkUrl(homework) { return `homework-check.html?homework=${encodeURIComponent(homework.id)}`; }
    function eventUrl(event, date) { return `calendar.html?date=${encodeURIComponent(dateOnly(date) || dateOnly(event.start_date))}&event=${encodeURIComponent(event.id)}`; }
    function eventSearchDate(event, today) {
        const start = dateOnly(event.start_date);
        const end = dateOnly(event.end_date) || start;
        const from = today >= start && today <= end ? today : start;
        return upcomingEvents([event], from)[0]?.date || start;
    }
    function eventLinkDate(event, requestedDate, today) {
        if (occursOn(event, requestedDate)) return dateOnly(requestedDate);
        const start = dateOnly(event.start_date);
        const end = dateOnly(event.end_date) || start;
        if (!start || end < start) return '';
        const from = dateOnly(today) && today > start ? today : start;
        const next = upcomingEvents([event], from)[0]?.date;
        if (next) return next;
        // A weekly recurrence needs at most seven days of backward inspection.
        for (let offset = 0; offset < 7; offset++) {
            const candidate = addDays(end, -offset);
            if (occursOn(event, candidate)) return candidate;
        }
        return '';
    }
    function notifications(data, today) {
        const list = [];
        for (const homework of data.homeworks || []) {
            const due = dateOnly(homework.due_date);
            if (homework.is_archived || !due || due < addDays(today, -7) || due > addDays(today, 6)) continue;
            list.push({ id: `homework:${homework.id}:${due}`, title: homework.title, date: due,
                detail: due < today ? 'Homework · Due date passed' : due === today ? 'Homework · Due today' : 'Homework · Due soon', url: homeworkUrl(homework), kind: 'homework' });
        }
        for (const { event, date } of upcomingEvents(data.events || [], today)) {
            list.push({ id: `event:${event.id}:${date}:${event.start_time || ''}`, title: event.title, date,
                detail: `Calendar${event.start_time ? ` · ${String(event.start_time).slice(0, 5)}` : ' · All day'}`, url: eventUrl(event, date), kind: 'event' });
        }
        for (const item of data.announcements || []) {
            if (!item.date || item.date < today || item.date > addDays(today, 6)) continue;
            list.push({ ...item, id: `announcement:${item.id}:${item.updated_at || item.date}`, detail: 'Announcement', kind: 'announcement' });
        }
        return list.sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(String(b.title)));
    }
    function search(items, query, max = 12) {
        const terms = String(query).trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
        if (!terms.length) return items.filter(item => item.kind === 'page').slice(0, max);
        return items.filter(item => {
            const haystack = `${item.title} ${item.detail || ''} ${item.description || ''}`.toLocaleLowerCase('en');
            return terms.every(term => haystack.includes(term));
        }).sort((a, b) => Number(String(b.title).toLocaleLowerCase('en').startsWith(terms[0])) - Number(String(a.title).toLocaleLowerCase('en').startsWith(terms[0]))).slice(0, max);
    }
    return { schoolToday, schoolTimestampDate, localDate, dateOnly, addDays, occursOn, upcomingEvents, stableId, homeworkUrl, eventUrl, eventSearchDate, eventLinkDate, notifications, search };
});
