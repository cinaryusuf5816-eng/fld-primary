const { Router } = require('express');
const { requireAuth, requireRoles, readSessionToken, digest } = require('../auth/middleware');
const academic = require('../academic');
const reportFormat = require('../../homework-report');

function exportOptions(query) {
    const invalid = () => Object.assign(new Error('Choose a valid report period and export format.'), { status: 400 });
    if (Object.keys(query).some(key => !['from', 'to', 'period', 'format'].includes(key)) ||
        !['daily', 'weekly', 'monthly'].includes(query.period) || !['csv', 'html'].includes(query.format) ||
        typeof query.from !== 'string' || typeof query.to !== 'string') throw invalid();
    let expected;
    try { expected = reportFormat.range(query.from, query.period); }
    catch { throw invalid(); }
    if (expected.from !== query.from || expected.to !== query.to) throw invalid();
    return { from: query.from, to: query.to, period: query.period, format: query.format };
}

function academicRoutes(pool, config) {
    const router = Router();
    router.use(['/homework', '/students'], requireAuth);
    const session = req => ({ userId: req.user.id, tokenHash: digest(readSessionToken(req, config)) });
    router.get('/homework', async (req, res) => res.json({ homeworks: await academic.listHomework(pool, req.user) }));
    router.post('/homework/check-duplicates', async (req, res) => res.json({ duplicates: await academic.checkHomeworkDuplicates(pool, req.body, req.user) }));
    router.post('/homework', async (req, res) => res.status(201).json({ homework: await academic.createHomework(pool, session(req), req.body) }));
    router.patch('/homework/:id', async (req, res) => res.json({ homework: await academic.updateHomework(pool, session(req), req.params.id, req.body) }));
    router.get('/homework/:id/checks', async (req, res) => res.json(await academic.getChecks(pool, req.params.id, req.user)));
    router.put('/homework/:id/checks', async (req, res) => res.json(await academic.saveChecks(pool, session(req), req.params.id, req.body)));
    router.get('/students', async (req, res) => res.json({ students: await academic.listStudents(pool, req.query, req.user) }));
    router.post('/students', requireRoles('admin', 'coordinator'), async (req, res) => res.status(201).json({ student: await academic.createStudent(pool, session(req), req.body) }));
    router.patch('/students/:id', requireRoles('admin', 'coordinator'), async (req, res) => res.json({ student: await academic.updateStudent(pool, session(req), req.params.id, req.body) }));
    router.get('/students/:id/report', async (req, res) => res.json(await academic.studentReport(pool, req.params.id, req.query, req.user)));
    router.get('/students/:id/report/export', async (req, res) => {
        const options = exportOptions(req.query);
        const report = await academic.studentReport(pool, req.params.id, { from: options.from, to: options.to }, req.user);
        report.period = options.period;
        const filename = `student-${report.student.id}-homework-${report.from}-${report.to}.${options.format}`;
        res.attachment(filename).type(options.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8');
        res.send(reportFormat[options.format](report));
    });
    return router;
}

module.exports = { academicRoutes };
