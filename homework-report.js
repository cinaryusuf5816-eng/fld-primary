/* Pure report formatting. No student data is stored in the browser. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FldHomeworkReport = api;
})(typeof window === 'object' ? window : globalThis, () => {
    'use strict';
    const statuses = [
        { key: 'completed', label: 'Completed', color: '#23835b' },
        { key: 'partially-done', label: 'Partially done', color: '#b77916' },
        { key: 'not-done', label: 'Not done', color: '#cf4c5c' },
        { key: 'late', label: 'Late', color: '#397ac0' },
        { key: 'absent', label: 'Absent', color: '#718096' },
        { key: 'unreviewed', label: 'Unreviewed', color: '#8f74c7' }
    ];
    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    function schoolToday(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const part = type => parts.find(item => item.type === type).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    }
    function parseDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('Choose a valid date.');
        const date = new Date(`${value}T12:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid date.');
        return date;
    }
    function formatDate(value) {
        try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parseDate(value)); }
        catch { return '—'; }
    }
    function range(dateValue, mode = 'daily') {
        const date = parseDate(dateValue);
        if (mode === 'monthly') {
            date.setUTCDate(1);
            const from = date.toISOString().slice(0, 10);
            date.setUTCMonth(date.getUTCMonth() + 1, 0);
            return { from, to: date.toISOString().slice(0, 10) };
        }
        if (mode === 'weekly') {
            date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
            const from = date.toISOString().slice(0, 10);
            date.setUTCDate(date.getUTCDate() + 6);
            return { from, to: date.toISOString().slice(0, 10) };
        }
        return { from: dateValue, to: dateValue };
    }
    const status = key => statuses.find(item => item.key === key) || statuses[5];
    function periodLabel(report) {
        if (['daily', 'weekly', 'monthly'].includes(report.period)) return report.period[0].toUpperCase() + report.period.slice(1);
        if (report.from === report.to) return 'Daily';
        const month = range(report.from, 'monthly');
        return month.from === report.from && month.to === report.to ? 'Monthly' : 'Weekly';
    }
    function summarize(report) {
        const counts = Object.fromEntries(statuses.map(item => [item.key, 0]));
        for (const assignment of report.assignments || []) counts[status(assignment.status).key]++;
        return { counts, total: (report.assignments || []).length };
    }
    function chart(report) {
        const { counts, total } = summarize(report);
        const maximum = Math.max(1, ...Object.values(counts));
        const bars = statuses.map((item, index) => {
            const y = 30 + index * 40;
            const width = counts[item.key] / maximum * 390;
            return `<g><text x="0" y="${y + 16}" fill="#475569" font-size="13">${item.label}</text><rect x="133" y="${y}" width="390" height="24" rx="5" fill="#f1f3f8"/><rect x="133" y="${y}" width="${width}" height="24" rx="5" fill="${item.color}"/><text x="539" y="${y + 17}" fill="#334155" font-size="14" font-weight="700">${counts[item.key]}</text></g>`;
        }).join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 575 286" role="img" aria-labelledby="homework-chart-title homework-chart-description" style="width:100%;height:auto;font-family:Arial,sans-serif"><title id="homework-chart-title">Homework status counts</title><desc id="homework-chart-description">${total} assignments. ${statuses.map(item => `${item.label}: ${counts[item.key]}`).join('. ')}. Unreviewed assignments are not counted as not done.</desc><text x="0" y="14" font-size="10" fill="#7b718e" letter-spacing="1">NUMBER OF ASSIGNMENTS</text>${bars}</svg>`;
    }
    function csvCell(value) {
        let safe = String(value ?? '');
        if (/^[\s\uFEFF]*[=+\-@]/.test(safe) || /^[\t\r\n]/.test(safe)) safe = `'${safe}`;
        return `"${safe.replace(/"/g, '""')}"`;
    }
    function mobileChart(report) {
        const { counts } = summarize(report);
        const maximum = Math.max(1, ...Object.values(counts));
        return `<div class="hw-chart-mobile" role="list" aria-label="Homework status counts">${statuses.map(item => `<div class="hw-mobile-status" role="listitem"><div><span>${item.label}</span><strong>${counts[item.key]}</strong></div><div class="hw-mobile-track" aria-hidden="true"><span style="width:${counts[item.key] / maximum * 100}%;background:${item.color}"></span></div></div>`).join('')}</div>`;
    }
    function checkBatches(checks, maxBytes = 200 * 1024, maxRows = 100) {
        const encoder = new TextEncoder(), batches = [];
        let batch = [];
        const size = rows => encoder.encode(JSON.stringify({ checks: rows })).byteLength;
        for (const check of checks) {
            if (size([check]) > maxBytes) throw new Error('A student check is too large to save. Shorten the note.');
            if (batch.length && (batch.length >= maxRows || size([...batch, check]) > maxBytes)) {
                batches.push(batch);
                batch = [];
            }
            batch.push(check);
        }
        if (batch.length) batches.push(batch);
        return batches;
    }
    function csv(report) {
        const rows = [['Student', 'Grade', 'Class', 'Report period', 'Period from', 'Period to', 'Homework', 'Assigned', 'Due', 'Status', 'Note']];
        for (const assignment of report.assignments || []) rows.push([report.student.full_name, report.student.grade, report.student.class_name, periodLabel(report), report.from, report.to, assignment.title, assignment.assign_date, assignment.due_date, status(assignment.status).label, assignment.note]);
        return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    }
    function html(report) {
        const { counts, total } = summarize(report);
        const student = report.student || {};
        const name = escape(student.full_name);
        const period = report.from === report.to ? formatDate(report.from) : `${formatDate(report.from)} – ${formatDate(report.to)}`;
        const rows = (report.assignments || []).map(item => `<tr><td><strong>${escape(item.title)}</strong>${item.description ? `<p>${escape(item.description)}</p>` : ''}</td><td>${escape(formatDate(item.assign_date))}</td><td>${escape(formatDate(item.due_date))}</td><td>${escape(status(item.status).label)}</td><td>${escape(item.note) || '—'}</td></tr>`).join('');
        return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} — Homework report</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f9;color:#263349;font:14px/1.6 Arial,sans-serif}.report{max-width:1050px;margin:30px auto;background:white;border:1px solid #e3e7ef;padding:38px;border-radius:18px}.brand{font-size:11px;letter-spacing:.15em;color:#6543dc;font-weight:bold}h1{font-size:30px;line-height:1.2;margin:12px 0 8px}h2{font-size:18px;margin:26px 0 12px}.meta,.hint{color:#66758a}.meta{margin:0 0 7px}.counts{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:24px 0}.count{padding:13px;background:#f7f6fb;border:1px solid #eeebf7;border-radius:9px}.count strong{font-size:23px;display:block}.graph{max-width:620px}.hint{font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:12px 9px;vertical-align:top;border-bottom:1px solid #e5e9f0;overflow-wrap:anywhere}th{background:#f6f7fa;color:#66758a;font-size:11px}td p{margin:5px 0 0;color:#66758a;white-space:pre-wrap}td:last-child{white-space:pre-wrap}button{border:0;border-radius:8px;background:#6543dc;color:white;padding:12px 16px;font:600 13px Arial;cursor:pointer}.toolbar{display:flex;justify-content:space-between;gap:15px;align-items:center}.empty{padding:20px;background:#f7f8fb;border-radius:10px}.footer{border-top:1px solid #e5e9f0;margin-top:30px;padding-top:16px;font-size:11px;color:#66758a}@media(max-width:650px){.report{padding:20px;margin:0;border-radius:0}.counts{grid-template-columns:repeat(2,1fr)}.toolbar{align-items:flex-start;flex-direction:column}.table-wrap{overflow:auto}}@media print{body{background:white}.report{margin:0;padding:0;border:0;max-width:none}.toolbar button{display:none}.count,.graph{break-inside:avoid}tr{break-inside:avoid}table{font-size:10px}thead{display:table-header-group}.table-wrap{overflow:visible}.counts{grid-template-columns:repeat(2,1fr)}@page{margin:16mm}}.hw-chart-mobile{display:none}.hw-mobile-status>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px;color:#596980;line-height:1.6;margin-bottom:7px}.hw-mobile-status strong{color:#334155;font-size:13px}.hw-mobile-track{height:9px;overflow:hidden;background:#f1f3f8;border-radius:4px}.hw-mobile-track>span{display:block;height:100%;border-radius:4px}@media(max-width:600px){.hw-chart-svg{display:none}.hw-chart-mobile{display:grid;gap:16px;margin-bottom:18px}}@media print{.hw-chart-svg{display:block!important}.hw-chart-mobile{display:none!important}}</style></head><body><main class="report"><div class="toolbar"><span class="brand">FLD PRIMARY · STUDENT REPORT</span><button type="button" onclick="window.print()">Print / Save as PDF</button></div><h1>${name}</h1><p class="meta">${escape(student.grade)} · Class ${escape(student.class_name)}${student.is_active === false ? ' · Archived student' : ''}</p><p class="meta">${escape(period)} · ${periodLabel(report)} report · ${total} assignments</p><p class="hint">Includes homework assigned by today with due dates in this period, including archived homework. Unreviewed means no status has been recorded; it is not counted as not done.</p><div class="counts"><div class="count"><strong>${total}</strong>Total assignments</div><div class="count"><strong style="color:#23835b">${counts.completed}</strong>Completed</div></div><h2>Homework status</h2><div class="graph"><div class="hw-chart-svg">${chart(report)}</div>${mobileChart(report)}</div><h2>Assignment details</h2>${total ? `<div class="table-wrap"><table><thead><tr><th>Homework</th><th>Assigned</th><th>Due</th><th>Status</th><th>Teacher note</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">No assignments are due in this period.</p>'}<p class="footer">FLD Primary · Dates follow the school calendar (Europe/Istanbul). This report reflects saved checks when downloaded.</p></main></body></html>`;
    }
    return { statuses, escape, schoolToday, formatDate, range, summarize, chart, mobileChart, csv, html, csvCell, status, periodLabel, checkBatches };
});
