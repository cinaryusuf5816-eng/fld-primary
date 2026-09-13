const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const D = require('../../portal-data');

test('portal school day uses Istanbul at midnight independently of browser timezone', () => {
    assert.equal(D.schoolToday(new Date('2026-09-12T21:15:00Z')), '2026-09-13');
    assert.equal(D.schoolToday(new Date('2026-09-12T20:59:59Z')), '2026-09-12');
    const modulePath = require.resolve('../../portal-data');
    for (const TZ of ['America/Los_Angeles', 'Pacific/Auckland', 'Europe/Istanbul']) {
        const result = spawnSync(process.execPath, ['-e', `const d=require(${JSON.stringify(modulePath)}); process.stdout.write(JSON.stringify([d.schoolToday(new Date('2026-09-12T21:15:00Z')), d.addDays('2026-03-08',1), d.dateOnly('2026-02-30')]));`], { encoding: 'utf8', env: { ...process.env, TZ }, windowsHide: true });
        assert.equal(result.status, 0);
        assert.deepEqual(JSON.parse(result.stdout), ['2026-09-13', '2026-03-09', '']);
    }
});

test('portal date and recurrence calculations preserve calendar date boundaries', () => {
    assert.equal(D.dateOnly('2026-09-13T00:00:00.000Z'), '2026-09-13');
    assert.equal(D.dateOnly('invalid'), '');
    assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
    const weekly = { id: 'weekly', start_date: '2026-09-01', end_date: '2026-09-30', days: { monday: true, wednesday: true } };
    assert.equal(D.occursOn(weekly, '2026-09-14'), true);
    assert.equal(D.occursOn(weekly, '2026-09-15'), false);
    assert.equal(D.occursOn(weekly, '2026-10-05'), false);
    assert.equal(D.occursOn({ ...weekly, days: null }, '2026-09-15'), true);
    assert.equal(D.occursOn({ ...weekly, start_date: '2026-09-13', end_date: '2026-09-13', days: { sunday: false } }, '2026-09-13'), true);
    assert.deepEqual(D.upcomingEvents([weekly], '2026-09-13').map(item => item.date), ['2026-09-14', '2026-09-16']);
    assert.equal(D.eventSearchDate(weekly, '2026-09-13'), '2026-09-14');
    assert.equal(D.eventSearchDate(weekly, '2026-10-01'), '2026-09-02');
});

test('material creation timestamps use the school day instead of their UTC date prefix', () => {
    assert.equal(D.schoolTimestampDate('2026-09-12T21:15:00.000Z'), '2026-09-13');
    assert.equal(D.schoolTimestampDate('2026-09-12T20:59:59.000Z'), '2026-09-12');
    assert.equal(D.schoolTimestampDate('2026-09-13T00:15:00+03:00'), '2026-09-13');
    assert.equal(D.schoolTimestampDate('invalid'), '');
    assert.equal(D.schoolTimestampDate(null), '');
});

test('calendar material links preserve valid occurrences or open the next or most recent matching day', () => {
    const event = { start_date:'2026-10-01', end_date:'2026-10-31', days:{monday:true} };
    assert.equal(D.eventLinkDate(event,'2026-10-01','2026-10-12'), '2026-10-12');
    assert.equal(D.eventLinkDate(event,'','2026-09-13'), '2026-10-05');
    assert.equal(D.eventLinkDate(event,'2026-10-05','2026-10-20'), '2026-10-05');
    assert.equal(D.eventLinkDate(event,'2026-10-01','2026-11-01'), '2026-10-26');
    assert.equal(D.eventLinkDate(event,'invalid','2026-10-28'), '2026-10-26');
    assert.equal(D.eventLinkDate({...event,days:{}},'2026-10-01','2026-10-05'), '');
    assert.equal(D.eventLinkDate({start_date:'2026-12-01',end_date:'2026-12-01',days:{}},'','2027-01-01'), '2026-12-01');
});

test('notifications use real due dates and occurrences with stable per-item IDs', () => {
    const data = {
        homeworks: [
            { id: 'today', title: 'Today', due_date: '2026-09-13' },
            { id: 'past', title: 'Past', due_date: '2026-09-06' },
            { id: 'too-old', title: 'Old', due_date: '2026-09-05' },
            { id: 'future', title: 'Later', due_date: '2026-09-20' },
            { id: 'archived', title: 'Archived', due_date: '2026-09-13', is_archived: true }
        ],
        events: [{ id: 'lesson', title: 'Speaking', start_date: '2026-09-01', end_date: '2026-10-01', days: { monday: true }, start_time: '09:00:00' }],
        announcements: [{ id: 'old', title: 'Old', date: '2026-09-12' }, { id: 'meeting', title: 'Meeting', date: '2026-09-15', url: 'announcements.html?item=meeting' }]
    };
    const reminders = D.notifications(data, '2026-09-13');
    assert.deepEqual(reminders.map(item => item.title), ['Past', 'Today', 'Speaking', 'Meeting']);
    assert.match(reminders[0].detail, /Due date passed/);
    assert.equal(reminders[2].url, 'calendar.html?date=2026-09-14&event=lesson');
    assert.equal(reminders[1].url, 'homework-check.html?homework=today');
    assert.deepEqual(D.notifications(data, '2026-09-13').map(item => item.id), reminders.map(item => item.id));
    assert.equal(new Set(reminders.map(item => item.id)).size, reminders.length);
    assert.deepEqual(D.notifications({}, '2026-09-13'), []);
});

test('portal search handles multiple terms and links encode IDs as data', () => {
    const items = [{ title: 'Homework', kind: 'page' }, { title: 'Vocabulary Quiz', detail: 'Grade 3 · A', kind: 'homework' }, { title: 'Speaking', description: 'Vocabulary practice', kind: 'event' }];
    assert.deepEqual(D.search(items, '  '), [items[0]]);
    assert.deepEqual(D.search(items, 'VOCABULARY 3'), [items[1]]);
    assert.equal(D.search(items, 'vocabulary').length, 2);
    assert.deepEqual(D.search(items, 'not present'), []);
    assert.equal(D.homeworkUrl({ id: '1&admin=true' }), 'homework-check.html?homework=1%26admin%3Dtrue');
});
