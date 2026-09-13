const { transaction } = require('./db');
const { failure } = require('./auth/users');
const { GRADES, withActor } = require('./auth/grades');
const library = require('./materials');
const folders = require('./archive-folders');

const FILTERS = ['q', 'academic_year', 'term', 'area', 'visibility', 'grade', 'status', 'archived', 'limit', 'offset', 'folder'];
const BULK_FIELDS = ['academic_year', 'term', 'area', 'visibility', 'grades', 'review_status', 'in_materials', 'is_archived'];
function options(query, actor) {
    if (Object.keys(query).some(key => !FILTERS.includes(key) || typeof query[key] !== 'string')) throw failure(400, 'Invalid archive filters.');
    const result = { ...query, q: (query.q || '').trim(), status: query.status || (actor.role === 'teacher' ? 'approved' : 'all'), archived: query.archived || 'false' };
    if (result.q.length > 200 || (query.academic_year !== undefined && !library.validAcademicYear(query.academic_year)) ||
        (query.term !== undefined && !library.TERMS.includes(query.term)) || (query.area !== undefined && !library.AREAS.includes(query.area)) ||
        (query.visibility !== undefined && !library.VISIBILITIES.includes(query.visibility)) ||
        (query.grade !== undefined && !GRADES.includes(query.grade)) || !['approved', 'needs_review', 'all'].includes(result.status) ||
        !['true', 'false', 'all'].includes(result.archived)) throw failure(400, 'Choose valid archive filters.');
    if (actor.role === 'teacher' && result.status === 'needs_review') throw failure(403, 'Only admins and coordinators can review archive records.');
    for (const [key, fallback, max] of [['limit', 25, 100], ['offset', 0, 1000000]]) {
        if (query[key] !== undefined && (!/^\d+$/.test(query[key]) || Number(query[key]) > max)) throw failure(400, 'Invalid archive pagination.');
        result[key] = query[key] === undefined ? fallback : Number(query[key]);
    }
    if (result.limit < 1) throw failure(400, 'Choose a positive archive page size.');
    if (query.folder !== undefined) result.folder = folders.folderId(query.folder, true);
    return result;
}
function where(values, actor, skipYear = false) {
    const params = [['admin', 'coordinator'].includes(actor.role), actor.role === 'teacher' ? actor.grades || [] : GRADES];
    const clauses = [`($1::boolean OR (m.review_status='approved' AND
        (m.visibility='shared' OR (m.visibility='grades' AND m.grades && $2::text[]))))`];
    const add = (sql, value) => { params.push(value); clauses.push(sql.replace('?', `$${params.length}`)); };
    if (values.archived !== 'all') add('m.is_archived=?', values.archived === 'true');
    if (values.status !== 'all') add('m.review_status=?', values.status);
    for (const key of ['academic_year', 'term', 'area', 'visibility']) {
        if (values[key] !== undefined && !(skipYear && key === 'academic_year')) add(`m.${key}=?`, values[key]);
    }
    if (values.grade !== undefined) add("(m.visibility='shared' OR ?=ANY(m.grades))", values.grade);
    if (values.q) add("concat_ws(' ',m.title,m.description,m.unit,m.category,m.area,m.file_name) ILIKE ?", `%${values.q.replace(/[\\%_]/g, '\\$&')}%`);
    if (values.folder !== undefined && !values.q) add('m.folder_id IS NOT DISTINCT FROM ?::bigint', values.folder);
    return { sql: clauses.join(' AND '), params };
}
async function listArchive(pool, actor, query = {}) {
    const settings = options(query, actor);
    const filtered = where(settings, actor), yearsFilter = where(settings, actor, true);
    // A page, its total and filter facets share one database snapshot.
    return transaction(pool, async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        // Validate explicit folder access even during a global search; a guessed private
        // folder ID must never disclose breadcrumbs or silently fall back to the root.
        const context = await folders.folderContext(client, actor, settings.folder ?? null);
        const items = (await client.query(`SELECT ${library.MATERIAL_FIELDS} FROM materials m ${library.MATERIAL_JOINS} WHERE ${filtered.sql}
            ORDER BY m.created_at DESC,m.id DESC LIMIT $${filtered.params.length + 1} OFFSET $${filtered.params.length + 2}`,
        [...filtered.params, settings.limit, settings.offset])).rows;
        const total = Number((await client.query(`SELECT count(*) AS total FROM materials m WHERE ${filtered.sql}`, filtered.params)).rows[0].total);
        const years = (await client.query(`SELECT DISTINCT m.academic_year FROM materials m WHERE ${yearsFilter.sql}
            AND m.academic_year<>'' ORDER BY m.academic_year DESC`, yearsFilter.params)).rows.map(row => row.academic_year);
        const paths = await folders.pathsForFolders(client, actor, items.map(item => item.folder_id));
        for (const item of items) {
            const key = item.folder_id === null ? null : String(item.folder_id);
            item.folder_path = paths.get(key);
        }
        return { items, total, facets: { years }, ...context,
            folders: settings.q ? [] : await folders.childFolders(client, actor, settings.folder ?? null),
            search_scope: settings.q ? 'all' : settings.folder === undefined ? 'all' : 'folder' };
    });
}
async function bulkUpdateArchive(pool, session, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['ids', 'changes'].includes(key)) ||
        !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || !body.changes || typeof body.changes !== 'object' ||
        Array.isArray(body.changes) || !Object.keys(body.changes).length || Object.keys(body.changes).some(key => !BULK_FIELDS.includes(key))) {
        throw failure(400, 'Choose up to 100 records and valid bulk changes.');
    }
    const ids = body.ids.map(library.materialId).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (new Set(ids).size !== ids.length) throw failure(400, 'Choose each archive record only once.');
    return withActor(pool, session, async (client, actor) => {
        library.assertCanManage(actor);
        const previous = (await client.query(`SELECT ${library.MATERIAL_FIELDS} FROM materials m ${library.MATERIAL_JOINS}
            WHERE m.id=ANY($1::bigint[]) ORDER BY m.id FOR UPDATE OF m`, [ids])).rows;
        if (previous.length !== ids.length) throw failure(404, 'An archive record no longer exists. Refresh the list.');
        const items = [];
        for (const material of previous) items.push(await library.applyMaterialUpdate(client, actor, material, body.changes, { archive: true }));
        return { items, updated: items.length };
    });
}

module.exports = { listArchive, bulkUpdateArchive };
