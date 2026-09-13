const { test } = require('node:test');
const assert = require('node:assert/strict');
const report = require('./homework-report');
const empty = { student: { id: 1, full_name: 'Sam Lee', grade: 'Grade 1', class_name: 'A', is_active: true }, from: '2026-09-01', to: '2026-09-30', period: 'monthly', assignments: [] };
test('weekly ranges use Monday to Sunday across month and year boundaries', () => {
    assert.deepEqual(report.range('2026-09-13', 'weekly'), { from: '2026-09-07', to: '2026-09-13' });
    assert.deepEqual(report.range('2026-01-01', 'weekly'), { from: '2025-12-29', to: '2026-01-04' });
    assert.deepEqual(report.range('2026-09-14', 'weekly'), { from: '2026-09-14', to: '2026-09-20' });
});
test('monthly ranges cover exactly the calendar month including leap years', () => {
    assert.deepEqual(report.range('2024-02-15', 'monthly'), { from: '2024-02-01', to: '2024-02-29' });
    assert.deepEqual(report.range('2100-02-14', 'monthly'), { from: '2100-02-01', to: '2100-02-28' });
    assert.deepEqual(report.range('2026-04-30', 'monthly'), { from: '2026-04-01', to: '2026-04-30' });
    assert.deepEqual(report.range('2026-12-31', 'monthly'), { from: '2026-12-01', to: '2026-12-31' });
});
test('daily dates stay exact and invalid dates are rejected', () => {
    assert.deepEqual(report.range('2026-09-13', 'daily'), { from: '2026-09-13', to: '2026-09-13' });
    for (const value of ['', '2026-02-29', '2026-13-01', '2026-01-01T00:00:00Z']) assert.throws(() => report.range(value));
    assert.equal(report.schoolToday(new Date('2026-09-12T21:30:00Z')), '2026-09-13');
});
test('all six statuses and empty reports retain accurate zero counts', () => {
    const zero = report.summarize(empty);
    assert.equal(zero.total, 0);
    assert.deepEqual(Object.values(zero.counts), [0, 0, 0, 0, 0, 0]);
    const mixed = report.summarize({ ...empty, assignments: [{ status: 'completed' }, { status: 'completed' }, { status: 'partially-done' }, { status: 'unreviewed' }, { status: 'late' }, { status: 'absent' }] });
    assert.equal(mixed.total, 6); assert.equal(mixed.counts.completed, 2); assert.equal(mixed.counts['not-done'], 0); assert.equal(mixed.counts.unreviewed, 1);
    const svg = report.chart(empty);
    for (const item of report.statuses) assert.ok(svg.includes(`${item.label}: 0`));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
});
test('CSV cells neutralize formulas including leading whitespace and quotes', () => {
    for (const value of ['=SUM(1,2)', '+1', '-1', '@SUM(1)', '  =cmd', '\t=cmd', '\n=cmd', '\uFEFF=cmd']) assert.ok(report.csvCell(value).startsWith('"\''));
    assert.equal(report.csvCell('She said "done"'), '"She said ""done"""');
    assert.equal(report.csvCell('ordinary note'), '"ordinary note"');
    const csv = report.csv({ ...empty, assignments: [{ title: '=HYPERLINK("x")', status: 'unreviewed', note: '\t=cmd', assign_date: '2026-09-01', due_date: '2026-09-02' }] });
    assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"Monthly"')); assert.ok(csv.includes('"Unreviewed"')); assert.ok(csv.includes('"\'=HYPERLINK'));
});
test('HTML export is standalone, monthly-labelled and escapes student data', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = report.html({ ...empty, student: { ...empty.student, full_name: payload }, assignments: [{ title: payload, description: '</script><script>alert(1)</script>', assign_date: '2026-09-01', due_date: '2026-09-02', status: 'unreviewed', note: payload }] });
    assert.ok(html.includes('Monthly report')); assert.ok(html.includes('<svg')); assert.ok(html.includes('Print / Save as PDF')); assert.ok(html.includes('Unreviewed: 1')); assert.ok(html.includes('Not done: 0'));
    assert.ok(!html.includes(payload)); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;img'));
    assert.ok(report.html(empty).includes('No assignments are due in this period.'));
});
test('multibyte notes batch below request byte and row limits without dropping checks', () => {
    const records = Array.from({ length: 125 }, (_, index) => ({ student_id: String(index + 1), status: 'completed', note: 'ğ'.repeat(2000) }));
    const batches = report.checkBatches(records);
    assert.ok(batches.length > 2);
    assert.deepEqual(batches.flat(), records);
    for (const checks of batches) { assert.ok(checks.length <= 100); assert.ok(Buffer.byteLength(JSON.stringify({ checks }), 'utf8') <= 200 * 1024); }
    assert.deepEqual(report.checkBatches([]), []);
    assert.equal(report.checkBatches(Array.from({ length: 101 }, (_, i) => ({ student_id: i, status: 'unreviewed', note: '' }))).length, 2);
});
