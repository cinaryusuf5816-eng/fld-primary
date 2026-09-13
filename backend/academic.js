const { failure } = require('./auth/users');
const { GRADES, assertGradeAccess, withActor } = require('./auth/grades');
const { validateMaterialLinks, canAccessMaterial } = require('./materials');

const TODAY = "(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul')::date";
const HOMEWORK_FIELDS = `h.id, h.title, h.description, h.pages, h.grade, h.class_name,
    to_char(h.assign_date, 'YYYY-MM-DD') AS assign_date,
    to_char(h.due_date, 'YYYY-MM-DD') AS due_date,
    h.created_by, h.is_archived, h.created_at, h.updated_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id::text,'title',m.title,'grades',m.grades,
        'is_archived',m.is_archived,'kind',m.kind,'visibility',m.visibility,'review_status',m.review_status,
        'in_materials',m.in_materials,'academic_year',m.academic_year,'term',m.term,'area',m.area) ORDER BY m.id)
        FROM homework_materials hm JOIN materials m ON m.id=hm.material_id
        WHERE hm.homework_id=h.id), '[]'::jsonb) AS materials`;
const STUDENT_FIELDS = 'id, full_name, grade, class_name, is_active, created_at, updated_at';
const CHECK_FIELDS = 'homework_id, student_id, status, note, checked_at, checked_by';
const STATUSES = ['completed', 'partially-done', 'not-done', 'late', 'absent', 'unreviewed'];

function fields(body, allowed, required = []) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
        Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))) {
        throw failure(400, 'Invalid or unknown fields.');
    }
}
function text(value, maximum, required = false) {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw failure(400, 'Invalid text input.');
    return value.trim();
}
function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function classroom(grade, className) {
    if (!GRADES.includes(grade) || typeof className !== 'string' || !/^[A-G]$/.test(className)) {
        throw failure(400, 'Choose a valid grade and class.');
    }
}
function id(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n) {
        throw failure(400, 'Invalid ID.');
    }
    return String(value);
}
function readScope(user) {
    const active = user?.is_active !== false && !user?.deleted_at;
    return [active && ['admin', 'coordinator'].includes(user?.role),
        active && user?.role === 'teacher' && Array.isArray(user.grades) ? user.grades : []];
}
function materialIds(value) {
    if (!Array.isArray(value) || value.length > 30) throw failure(400, 'Attach at most 30 materials.');
    const ids = value.map(id);
    if (new Set(ids).size !== ids.length) throw failure(400, 'A material can only be attached once.');
    return ids;
}
async function replaceMaterialLinks(client, homeworkId, ids) {
    await client.query('DELETE FROM homework_materials WHERE homework_id=$1', [homeworkId]);
    if (ids.length) await client.query('INSERT INTO homework_materials (homework_id,material_id) SELECT $1,unnest($2::bigint[])', [homeworkId, ids]);
}
function canManage(actor, homework) {
    if (actor.role === 'teacher' && String(homework.created_by) !== String(actor.id)) throw failure(403, 'Teachers can only change their own homework.');
}
function canManageStudents(actor) {
    if (!['admin', 'coordinator'].includes(actor.role)) throw failure(403, 'Only admins and coordinators can manage the class roster.');
}
async function homeworkById(pool, homeworkId, actor, lock = false) {
    if (lock) await pool.query('LOCK TABLE homework_assignments IN ROW EXCLUSIVE MODE');
    const result = await pool.query(`SELECT ${HOMEWORK_FIELDS}, (h.assign_date <= ${TODAY}) AS is_assigned
        FROM homework_assignments h WHERE h.id = $1 AND ($2::boolean OR h.grade=ANY($3::text[]))${lock ? ' FOR UPDATE' : ''}`, [id(homeworkId), ...readScope(actor)]);
    if (!result.rows[0]) throw failure(404, 'Homework not found.');
    return result.rows[0];
}
function publicHomework(homework, actor) {
    const { is_assigned, ...result } = homework;
    const materials = result.materials.filter(material => canAccessMaterial(actor,material));
    return { ...result, materials, material_ids: materials.map(material => String(material.id)) };
}
function homeworkInput(body, previous) {
    const allowed = ['title', 'description', 'pages', 'grade', 'class_name', 'assign_date', 'due_date', 'material_ids'];
    fields(body, previous ? [...allowed, 'is_archived'] : allowed, previous ? [] : ['title', 'grade', 'class_name', 'assign_date', 'due_date']);
    const values = { description: '', pages: '', material_ids: previous?.materials.map(material => String(material.id)) || [], ...previous, ...body };
    values.title = text(values.title, 500, true);
    values.description = text(values.description, 10000);
    values.pages = text(values.pages, 120);
    classroom(values.grade, values.class_name);
    values.material_ids = materialIds(values.material_ids);
    if (!validDate(values.assign_date) || !validDate(values.due_date) || values.due_date < values.assign_date) throw failure(400, 'Use valid assignment and due dates; the due date cannot be earlier.');
    if ('is_archived' in body && typeof body.is_archived !== 'boolean') throw failure(400, 'Invalid archive state.');
    return values;
}
async function listHomework(pool, actor) {
    return (await pool.query(`SELECT ${HOMEWORK_FIELDS} FROM homework_assignments h
        WHERE ($1::boolean OR h.grade=ANY($2::text[])) ORDER BY h.assign_date DESC, h.id DESC`, readScope(actor))).rows.map(homework=>publicHomework(homework,actor));
}
async function checkHomeworkDuplicates(pool, body, actor) {
    fields(body, ['title', 'pages', 'grade', 'class_name', 'exclude_id'], ['title', 'grade', 'class_name']);
    const title = text(body.title, 500, true), pages = text(body.pages ?? '', 120);
    classroom(body.grade, body.class_name);
    assertGradeAccess(actor, body.grade);
    const excluded = body.exclude_id === undefined ? null : id(body.exclude_id);
    const normalizeTitle = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
    const normalizePages = value => value.normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015\u2212]/gu, '-').replace(/\s+/gu, '');
    const candidates = (await pool.query(`SELECT id,title,pages,
        to_char(assign_date,'YYYY-MM-DD') AS assign_date,to_char(due_date,'YYYY-MM-DD') AS due_date,is_archived
        FROM homework_assignments WHERE grade=$1 AND class_name=$2 AND ($3::bigint IS NULL OR id<>$3)
        ORDER BY assign_date DESC,id DESC`, [body.grade, body.class_name, excluded])).rows;
    // With no page details, matching titles deserve an advisory warning too.
    return candidates.filter(candidate => normalizeTitle(candidate.title) === normalizeTitle(title) &&
        (!pages || normalizePages(candidate.pages) === normalizePages(pages)));
}
async function createHomework(pool, session, body) {
    const values = homeworkInput(body);
    return withActor(pool, session, async (client, actor) => {
        assertGradeAccess(actor, values.grade);
        await validateMaterialLinks(client, values.material_ids, [values.grade]);
        const created = await client.query(`INSERT INTO homework_assignments (title, description, grade, class_name, assign_date, due_date, created_by, pages)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [values.title, values.description, values.grade, values.class_name, values.assign_date, values.due_date, actor.id, values.pages]);
        await replaceMaterialLinks(client, created.rows[0].id, values.material_ids);
        return publicHomework(await homeworkById(client, created.rows[0].id, actor),actor);
    });
}
async function updateHomework(pool, session, homeworkId, body) {
    id(homeworkId);
    return withActor(pool, session, async (client, actor) => {
        const previous = await homeworkById(client, homeworkId, actor, true);
        canManage(actor, previous);
        const values = homeworkInput(body, previous);
        // Older records can contain restricted links hidden from a teacher.
        // A visible form edit must preserve those links without disclosing IDs.
        const hiddenIds = previous.materials.filter(material=>!canAccessMaterial(actor,material)).map(material=>String(material.id));
        values.material_ids = materialIds([...new Set([...values.material_ids,...hiddenIds])]);
        assertGradeAccess(actor, values.grade);
        if (values.grade !== previous.grade || values.class_name !== previous.class_name) {
            const saved = await client.query('SELECT 1 FROM homework_checks WHERE homework_id = $1 LIMIT 1', [homeworkId]);
            if (saved.rows.length) throw failure(409, 'The class cannot change after homework has been checked.');
        }
        const previousIds = new Set(previous.materials.map(material => String(material.id)));
        const newIds = values.grade !== previous.grade ? values.material_ids : values.material_ids.filter(materialId => !previousIds.has(materialId));
        await validateMaterialLinks(client, newIds, [values.grade]);
        await client.query(`UPDATE homework_assignments SET title=$1, description=$2, grade=$3, class_name=$4,
            assign_date=$5, due_date=$6, is_archived=$7, pages=$8 WHERE id=$9`,
        [values.title, values.description, values.grade, values.class_name, values.assign_date, values.due_date, values.is_archived, values.pages, homeworkId]);
        await replaceMaterialLinks(client, homeworkId, values.material_ids);
        return publicHomework(await homeworkById(client, homeworkId, actor),actor);
    });
}
async function listStudents(pool, query, actor) {
    const keys = ['grade', 'class_name', 'include_inactive'];
    if (Object.keys(query).some(key => !keys.includes(key))) throw failure(400, 'Invalid roster filters.');
    classroom(query.grade, query.class_name);
    assertGradeAccess(actor, query.grade);
    if (query.include_inactive !== undefined && !['true', 'false'].includes(query.include_inactive)) throw failure(400, 'Invalid inactive filter.');
    return (await pool.query(`SELECT ${STUDENT_FIELDS} FROM students WHERE grade=$1 AND class_name=$2
        ${query.include_inactive === 'true' ? '' : 'AND is_active=TRUE'} ORDER BY full_name, id`, [query.grade, query.class_name])).rows;
}
async function createStudent(pool, session, body) {
    fields(body, ['full_name', 'grade', 'class_name'], ['full_name', 'grade', 'class_name']);
    const name = text(body.full_name, 120, true);
    classroom(body.grade, body.class_name);
    return withActor(pool, session, async (client, actor) => {
        canManageStudents(actor);
        return (await client.query(`INSERT INTO students (full_name, grade, class_name) VALUES ($1,$2,$3) RETURNING ${STUDENT_FIELDS}`, [name, body.grade, body.class_name])).rows[0];
    });
}
async function updateStudent(pool, session, studentId, body) {
    id(studentId);
    fields(body, ['full_name', 'is_active']);
    if ('full_name' in body) text(body.full_name, 120, true);
    if ('is_active' in body && typeof body.is_active !== 'boolean') throw failure(400, 'Invalid active state.');
    return withActor(pool, session, async (client, actor) => {
        canManageStudents(actor);
        await client.query('LOCK TABLE students IN ROW EXCLUSIVE MODE');
        const result = await client.query(`SELECT ${STUDENT_FIELDS} FROM students WHERE id=$1 FOR UPDATE`, [studentId]);
        if (!result.rows[0]) throw failure(404, 'Student not found.');
        const previous = result.rows[0];
        return (await client.query(`UPDATE students SET full_name=$1, is_active=$2 WHERE id=$3 RETURNING ${STUDENT_FIELDS}`,
            ['full_name' in body ? body.full_name.trim() : previous.full_name, body.is_active ?? previous.is_active, studentId])).rows[0];
    });
}
async function getChecks(pool, homeworkId, actor) {
    const homework = await homeworkById(pool, homeworkId, actor);
    const students = (await pool.query(`SELECT ${STUDENT_FIELDS} FROM students WHERE grade=$1 AND class_name=$2 AND is_active=TRUE ORDER BY full_name,id`, [homework.grade, homework.class_name])).rows;
    const checks = (await pool.query(`SELECT ${CHECK_FIELDS} FROM homework_checks WHERE homework_id=$1 ORDER BY student_id`, [homework.id])).rows;
    return { homework: publicHomework(homework,actor), students, checks };
}
async function saveChecks(pool, session, homeworkId, body) {
    id(homeworkId);
    fields(body, ['checks'], ['checks']);
    if (!Array.isArray(body.checks) || body.checks.length < 1 || body.checks.length > 100) throw failure(400, 'Submit between 1 and 100 checks.');
    const seen = new Set();
    const checks = body.checks.map(check => {
        fields(check, ['student_id', 'status', 'note'], ['student_id', 'status']);
        const studentId = id(check.student_id);
        if (seen.has(studentId) || !STATUSES.includes(check.status)) throw failure(400, 'Invalid or duplicate student check.');
        seen.add(studentId);
        return { student_id: studentId, status: check.status, note: text(check.note ?? '', 2000) };
    }).sort((a, b) => BigInt(a.student_id) < BigInt(b.student_id) ? -1 : 1);
    return withActor(pool, session, async (client, actor) => {
        const homework = await homeworkById(client, homeworkId, actor, true);
        canManage(actor, homework);
        if (homework.is_archived || !homework.is_assigned) throw failure(409, 'Only assigned, unarchived homework can be checked.');
        const students = (await client.query(`SELECT id, grade, class_name, is_active FROM students
            WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE`, [checks.map(check => check.student_id)])).rows;
        if (students.length !== checks.length || students.some(student => !student.is_active || student.grade !== homework.grade || student.class_name !== homework.class_name)) {
            throw failure(400, 'Each student must be active and belong to the homework class.');
        }
        for (const check of checks) {
            if (check.status === 'unreviewed') await client.query('DELETE FROM homework_checks WHERE homework_id=$1 AND student_id=$2', [homework.id, check.student_id]);
            else await client.query(`INSERT INTO homework_checks (homework_id,student_id,status,note,checked_by)
                VALUES ($1,$2,$3,$4,$5) ON CONFLICT (homework_id,student_id) DO UPDATE
                SET status=EXCLUDED.status,note=EXCLUDED.note,checked_by=EXCLUDED.checked_by,checked_at=clock_timestamp()`,
            [homework.id, check.student_id, check.status, check.note, actor.id]);
        }
        return getChecks(client, homework.id, actor);
    });
}
async function studentReport(pool, studentId, query, actor) {
    id(studentId);
    if (Object.keys(query).some(key => !['from', 'to'].includes(key)) || !validDate(query.from) || !validDate(query.to) || query.to < query.from) throw failure(400, 'Choose a valid inclusive report date range.');
    const result = await pool.query(`SELECT ${STUDENT_FIELDS} FROM students WHERE id=$1
        AND ($2::boolean OR grade=ANY($3::text[]))`, [studentId, ...readScope(actor)]);
    const student = result.rows[0];
    if (!student) throw failure(404, 'Student not found.');
    const assignments = (await pool.query(`SELECT h.id,h.title,h.description,
        to_char(h.assign_date,'YYYY-MM-DD') AS assign_date,to_char(h.due_date,'YYYY-MM-DD') AS due_date,
        COALESCE(c.status,'unreviewed') AS status,COALESCE(c.note,'') AS note,c.checked_at
        FROM homework_assignments h LEFT JOIN homework_checks c ON c.homework_id=h.id AND c.student_id=$1
        WHERE h.grade=$2 AND h.class_name=$3 AND h.due_date BETWEEN $4::date AND $5::date AND h.assign_date<=${TODAY}
        ORDER BY h.due_date,h.id`, [student.id, student.grade, student.class_name, query.from, query.to])).rows;
    return { student, from: query.from, to: query.to, assignments };
}

module.exports = { listHomework, checkHomeworkDuplicates, createHomework, updateHomework, listStudents, createStudent, updateStudent, getChecks, saveChecks, studentReport, withActor };
