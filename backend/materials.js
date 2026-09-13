const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes, createHash } = require('node:crypto');
const { failure } = require('./auth/users');
const { GRADES, normalizeGrades, canAccessAudience, withActor } = require('./auth/grades');
const folders = require('./archive-folders');
const { transaction } = require('./db');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATEGORIES = ['Worksheet', 'Lesson plan', 'Presentation', 'Assessment', 'Audio', 'Video', 'Other'];
const AREAS = ['Teaching & Learning', 'Planning & Curriculum', 'School Events', 'Meetings', 'Reports', 'Administration', 'Other'];
const TERMS = ['', 'Full year', 'Term 1', 'Term 2', 'Summer'];
const VISIBILITIES = ['shared', 'grades', 'management'];
const REVIEW_STATUSES = ['approved', 'needs_review'];
const ARCHIVE_FIELDS = ['academic_year', 'term', 'area', 'visibility', 'review_status', 'in_materials'];
const MATERIAL_FIELDS = `m.id, m.title, m.description, m.grades, m.category, m.unit, m.kind,
    m.url, m.file_name, m.file_size, m.mime_type, m.is_archived, m.created_by, m.created_at, m.updated_at,
    m.academic_year, m.term, m.area, m.visibility, m.review_status, m.in_materials, m.folder_id::text AS folder_id,
    m.last_edited_at, m.edit_history_status,
    COALESCE(NULLIF(btrim(material_creator.full_name),''),
        CASE WHEN material_creator.deleted_at IS NOT NULL THEN 'Former staff member' ELSE 'Not recorded' END) AS creator_name,
    CASE WHEN m.edit_history_status='edited' THEN COALESCE(NULLIF(btrim(material_editor.full_name),''),
        CASE WHEN material_editor.deleted_at IS NOT NULL THEN 'Former staff member' ELSE 'Not recorded' END) ELSE NULL END AS last_editor_name`;
const MATERIAL_JOINS = `LEFT JOIN users material_creator ON material_creator.id=m.created_by
    LEFT JOIN users material_editor ON material_editor.id=m.last_edited_by`;
const FILE_TYPES = {
    '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};
function materialId(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'number' && !Number.isSafeInteger(value)) ||
        !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n) throw failure(400, 'Invalid material ID.');
    return String(value);
}
function inputText(value, limit, required = false) {
    if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw failure(400, 'Invalid material information.');
    return value.trim();
}
function checkKeys(body, keys) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
        Object.keys(body).some(key => !keys.includes(key))) throw failure(400, 'Invalid material fields.');
}
function validAcademicYear(value) {
    return value === '' || (typeof value === 'string' && /^\d{4}-\d{4}$/.test(value) &&
        Number(value.slice(0, 4)) >= 1 && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1);
}
function archiveMetadata(values) {
    values.academic_year = inputText(values.academic_year, 9);
    if (!validAcademicYear(values.academic_year) || !TERMS.includes(values.term) || !AREAS.includes(values.area) ||
        !VISIBILITIES.includes(values.visibility) || !REVIEW_STATUSES.includes(values.review_status) ||
        typeof values.in_materials !== 'boolean') throw failure(400, 'Choose valid archive classification fields.');
    values.grades = normalizeGrades(values.grades);
    if ((values.visibility === 'grades') !== (values.grades.length > 0)) throw failure(400, 'Grade visibility needs selected grades; Shared and Management need an empty grades array.');
    if (values.in_materials && (values.review_status !== 'approved' || values.visibility === 'management')) throw failure(400, 'Approve a Shared or grade record before adding it to Materials.');
    return values;
}
function input(body, previous, options = {}) {
    const editable = ['title', 'description', 'category', 'unit'];
    checkKeys(body, previous ? [...editable, 'is_archived', ...(options.archive ? [...ARCHIVE_FIELDS, 'grades'] : [])] :
        [...editable, 'grades', 'kind', 'url', 'file_name', 'content_base64', ...ARCHIVE_FIELDS, ...(options.archive ? ['folder_id'] : [])]);
    const result = { description: '', unit: '', category: 'Other', grades: [], academic_year: '', term: '', area: 'Other',
        review_status: 'approved', in_materials: !options.archive, ...previous, ...body };
    if (!previous && !Object.hasOwn(body, 'visibility')) result.visibility = result.grades?.length ? 'grades' : 'shared';
    result.title = inputText(result.title, 200, true);
    result.description = inputText(result.description, 5000);
    result.unit = inputText(result.unit, 120);
    if (!CATEGORIES.includes(result.category)) throw failure(400, 'Choose a valid material category.');
    if (previous) {
        if (typeof result.is_archived !== 'boolean') throw failure(400, 'Invalid archive state.');
    } else {
        if (!['file', 'link'].includes(result.kind)) throw failure(400, 'Choose a file or a link.');
        if (result.kind === 'link') {
            if ('content_base64' in body || 'file_name' in body) throw failure(400, 'Link materials cannot contain a file.');
            let url;
            try { url = new URL(inputText(result.url, 2048, true)); } catch { throw failure(400, 'Use a valid HTTPS link.'); }
            if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw failure(400, 'Use an HTTPS link without embedded credentials.');
            result.url = url.href;
        } else if ('url' in body) throw failure(400, 'File materials cannot contain a URL.');
    }
    return archiveMetadata(result);
}
function decodeFile(body) {
    const fileName = inputText(body.file_name, 180, true);
    if (/[\\/\x00-\x1f\x7f]/.test(fileName) || fileName === '.' || fileName === '..') throw failure(400, 'Use a valid file name.');
    const extension = path.extname(fileName).toLowerCase();
    const mime = FILE_TYPES[extension];
    if (!mime) throw failure(400, 'Supported files: PDF, DOCX, PPTX, XLSX, PNG, JPG, WEBP, TXT, MP3 and MP4.');
    const content = body.content_base64;
    if (typeof content !== 'string' || !content.length || content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw failure(400, 'Use a valid file up to 10 MB.');
    const bytes = Buffer.from(content, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== content) throw failure(400, 'Use a valid file up to 10 MB.');
    const starts = signature => bytes.subarray(0, signature.length).equals(signature);
    const magic = extension === '.pdf' ? starts(Buffer.from('%PDF-')) :
        ['.docx', '.pptx', '.xlsx'].includes(extension) ? starts(Buffer.from([0x50, 0x4b, 0x03, 0x04])) :
        extension === '.png' ? starts(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
        ['.jpg', '.jpeg'].includes(extension) ? starts(Buffer.from([0xff, 0xd8, 0xff])) :
        extension === '.webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' :
        extension === '.mp3' ? bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) :
        extension === '.mp4' ? bytes.toString('ascii', 4, 8) === 'ftyp' :
        !bytes.includes(0);
    if (!magic) throw failure(400, 'The file contents do not match its file type.');
    return { bytes, fileName, mime };
}
function teacherGrades(actor) { return actor.role === 'teacher' ? actor.grades || [] : GRADES; }
function assertCanCreate(actor, values) {
    if (actor.role === 'teacher' && (values.visibility !== 'grades' || values.review_status !== 'approved' ||
        !values.grades.length || values.grades.some(grade => !teacherGrades(actor).includes(grade)))) {
        throw failure(403, 'Teachers can add approved records only to their assigned grades.');
    }
}
function canAccessMaterial(actor, material) {
    if (!actor || actor.is_active === false || actor.deleted_at || !material) return false;
    if (['admin', 'coordinator'].includes(actor.role)) return true;
    return actor.role === 'teacher' && material.review_status === 'approved' &&
        (material.visibility === 'shared' || (material.visibility === 'grades' && canAccessAudience(actor, material.grades)));
}
function assertCanManage(actor) {
    if (!['admin', 'coordinator'].includes(actor.role)) throw failure(403, 'Only admins and coordinators can edit or archive materials.');
}
async function listMaterials(pool, actor, query = {}) {
    if (Object.keys(query).some(key => !['grade', 'include_archived'].includes(key)) ||
        (query.grade !== undefined && ![...GRADES, 'Shared'].includes(query.grade)) ||
        (query.include_archived !== undefined && !['true', 'false'].includes(query.include_archived))) throw failure(400, 'Invalid library filters.');
    const result = await pool.query(`SELECT ${MATERIAL_FIELDS} FROM materials m ${MATERIAL_JOINS}
        WHERE m.in_materials AND m.review_status='approved' AND m.visibility<>'management' AND ($1::boolean OR (m.review_status='approved' AND
            (m.visibility='shared' OR (m.visibility='grades' AND m.grades && $2::text[]))))
        AND ($3::boolean OR NOT m.is_archived)
        AND ($4::text IS NULL OR ($4 = 'Shared' AND m.visibility='shared')
            OR ($4 <> 'Shared' AND (m.visibility='shared' OR $4 = ANY(m.grades))))
        ORDER BY m.created_at DESC, m.id DESC`, [actor.role !== 'teacher', teacherGrades(actor), query.include_archived === 'true', query.grade ?? null]);
    return result.rows;
}
async function materialById(pool, actor, id, includeStorage = false) {
    const result = await pool.query(`SELECT ${MATERIAL_FIELDS}${includeStorage ? ', m.storage_key' : ''}
        FROM materials m ${MATERIAL_JOINS} WHERE m.id=$1`, [materialId(id)]);
    const material = result.rows[0];
    if (!material || !canAccessMaterial(actor, material)) throw failure(404, 'Material not found.');
    return material;
}
async function materialDetail(pool, actor, id) {
    const material = await materialById(pool, actor, id);
    const all = actor.role !== 'teacher', grades = teacherGrades(actor);
    const events = await pool.query(`SELECT e.id, e.title, to_char(e.start_date,'YYYY-MM-DD') AS start_date
        FROM events e JOIN event_materials em ON em.event_id=e.id WHERE em.material_id=$1
        AND ($2::boolean OR cardinality(e.grades)=0 OR e.grades && $3::text[]) ORDER BY e.start_date DESC, e.id`, [material.id, all, grades]);
    const homework = await pool.query(`SELECT h.id, h.title, to_char(h.due_date,'YYYY-MM-DD') AS due_date
        FROM homework_assignments h JOIN homework_materials hm ON hm.homework_id=h.id WHERE hm.material_id=$1
        AND ($2::boolean OR h.grade=ANY($3::text[])) ORDER BY h.due_date DESC, h.id DESC`, [material.id, all, grades]);
    const result = { material, used_in: { events: events.rows, homework: homework.rows } };
    if (['admin', 'coordinator'].includes(actor.role)) {
        result.possible_duplicates = (await pool.query(`SELECT m.id,m.title FROM materials m JOIN materials source ON source.id=$1
            WHERE m.id<>source.id AND ((source.kind='file' AND source.content_sha256 IS NOT NULL AND m.content_sha256=source.content_sha256)
                OR (source.kind='link' AND source.normalized_url IS NOT NULL AND md5(m.normalized_url)=md5(source.normalized_url) AND m.normalized_url=source.normalized_url))
            ORDER BY m.id LIMIT 20`, [material.id])).rows;
    }
    return result;
}
async function storageRoot(directory) {
    const root = path.resolve(directory);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure(500, 'Material storage is unavailable.');
    return root;
}
function storagePath(root, key) {
    if (!/^[a-f0-9]{64}\.bin$/.test(key || '')) throw failure(404, 'File not found.');
    return path.join(path.resolve(root), key);
}
async function createMaterial(pool, session, body, directory, options = {}) {
    const values = input(body, null, options);
    let savedPath, key;
    try {
        return await withActor(pool, session, async (client, actor) => {
            if (options.archive && !Object.hasOwn(body, 'review_status') && actor.role !== 'teacher') values.review_status = 'needs_review';
            archiveMetadata(values);
            assertCanCreate(actor, values);
            const folder = options.archive && Object.hasOwn(body, 'folder_id') ? folders.folderId(body.folder_id, true) : null;
            await folders.validateMaterialFolder(client, actor, folder, values);
            const file = values.kind === 'file' ? decodeFile(body) : null;
            if (file) {
                const root = await storageRoot(directory);
                key = randomBytes(32).toString('hex') + '.bin';
                savedPath = storagePath(root, key);
                await fs.writeFile(savedPath, file.bytes, { flag: 'wx', mode: 0o600 });
            }
            const inserted = await client.query(`INSERT INTO materials
                (title,description,grades,category,unit,kind,url,file_name,file_size,mime_type,storage_key,created_by,
                    academic_year,term,area,visibility,review_status,in_materials,content_sha256,normalized_url,folder_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
            [values.title, values.description, values.grades, values.category, values.unit, values.kind,
                values.url || null, file?.fileName || null, file?.bytes.length || null, file?.mime || null, key || null, actor.id,
                values.academic_year, values.term, values.area, values.visibility, values.review_status, values.in_materials,
                file ? createHash('sha256').update(file.bytes).digest('hex') : null, values.kind === 'link' ? values.url : null, folder]);
            return materialById(client, actor, inserted.rows[0].id);
        });
    } catch (error) {
        // Keep a file on uncertain database failures; never erase a committed upload.
        if (savedPath) {
            try {
                const retained = await pool.query('SELECT id FROM materials WHERE storage_key=$1', [key]);
                if (!retained.rows.length) await fs.unlink(savedPath);
            } catch { /* A future storage reconciliation may remove an orphan. */ }
        }
        throw error;
    }
}
async function assertLinksRemainAccessible(client, id, values) {
    const links = (await client.query(`SELECT ARRAY[h.grade]::text[] AS grades FROM homework_assignments h
        JOIN homework_materials hm ON hm.homework_id=h.id WHERE hm.material_id=$1
        UNION ALL SELECT e.grades FROM events e JOIN event_materials em ON em.event_id=e.id WHERE em.material_id=$1`, [id])).rows;
    if (links.length && (values.review_status !== 'approved' || values.visibility === 'management' ||
        (values.visibility === 'grades' && links.some(link => !link.grades.length || link.grades.some(grade => !values.grades.includes(grade)))))) {
        throw failure(409, 'This record is linked to homework or calendar events. Keep it approved and accessible to every linked grade, or remove those links first.');
    }
}
async function applyMaterialUpdate(client, actor, previous, body, options = {}) {
    const values = input(body, previous, options);
    await folders.validateMaterialFolder(client, actor, previous.folder_id, values);
    await assertLinksRemainAccessible(client, previous.id, values);
    await client.query(`UPDATE materials SET title=$1,description=$2,category=$3,unit=$4,is_archived=$5,
        academic_year=$6,term=$7,area=$8,visibility=$9,review_status=$10,in_materials=$11,grades=$12,
        last_edited_by=$14,last_edited_at=clock_timestamp(),edit_history_status='edited' WHERE id=$13`,
    [values.title, values.description, values.category, values.unit, values.is_archived,
        values.academic_year, values.term, values.area, values.visibility, values.review_status, values.in_materials, values.grades, previous.id, actor.id]);
    return materialById(client, actor, previous.id);
}
async function updateMaterial(pool, session, id, body, options = {}) {
    return withActor(pool, session, async (client, actor) => {
        assertCanManage(actor);
        await client.query('SELECT id FROM materials WHERE id=$1 FOR UPDATE', [materialId(id)]);
        const previous = await materialById(client, actor, id);
        return applyMaterialUpdate(client, actor, previous, body, options);
    });
}
async function validateMaterialLinks(client, materialIds, audienceGrades) {
    if (!Array.isArray(materialIds) || materialIds.length > 30) throw failure(400, 'Choose up to 30 materials.');
    const ids = materialIds.map(materialId);
    if (new Set(ids).size !== ids.length) throw failure(400, 'Choose each material only once.');
    const audience = normalizeGrades(audienceGrades);
    if (!ids.length) return [];
    const rows = (await client.query(`SELECT id,grades,is_archived,visibility,review_status FROM materials WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE`, [ids])).rows;
    if (rows.length !== ids.length || rows.some(material => material.is_archived || material.review_status !== 'approved' || material.visibility === 'management' ||
        (material.grades.length && (!audience.length || audience.some(grade => !material.grades.includes(grade)))))) {
        throw failure(400, 'Choose active materials available to every selected grade. Shared events need shared materials.');
    }
    return ids;
}
async function downloadMaterial(pool, actor, id, directory) {
    const material = await materialById(pool, actor, id, true);
    if (material.kind !== 'file') throw failure(400, 'This material uses an external link.');
    const root = path.resolve(directory);
    let bytes;
    try {
        const rootStat = await fs.lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unavailable');
        const filename = storagePath(root, material.storage_key);
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== material.file_size) throw new Error('Unavailable');
        bytes = await fs.readFile(filename);
    } catch { throw failure(404, 'The stored file is unavailable. Please contact an administrator.'); }
    return { bytes, fileName: material.file_name, mime: material.mime_type };
}
function deleteInput(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw failure(400, 'Use an empty object to confirm deletion.');
}
async function removeStoredFile(directory, key) {
    const root = path.resolve(directory), filename = storagePath(root, key);
    try {
        const rootStat = await fs.lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    } catch { return false; }
    try {
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        await fs.unlink(filename);
        return true;
    } catch (error) { return error.code === 'ENOENT'; }
}
async function cleanupDeletedMaterialFiles(pool, directory, options = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Choose a cleanup batch size between 1 and 1000.');
    const keys = options.keys ?? null;
    if (keys !== null && (!Array.isArray(keys) || keys.length > 1000 || keys.some(key => !/^[a-f0-9]{64}\.bin$/.test(key)))) throw new Error('Invalid cleanup keys.');
    return transaction(pool, async client => {
        // Only the cleanup queue is locked here; the material deletion has committed.
        // Keeping a job after an uncertain cleanup commit is safe: retry treats missing bytes as complete.
        const jobs = (await client.query(`SELECT storage_key FROM material_file_cleanup_jobs
            WHERE ($1::text[] IS NULL OR storage_key=ANY($1::text[]))
            ORDER BY created_at,storage_key LIMIT $2 FOR UPDATE SKIP LOCKED`, [keys, limit])).rows;
        let removed = 0;
        for (const job of jobs) {
            await client.query('UPDATE material_file_cleanup_jobs SET attempts=attempts+1,last_attempt_at=CURRENT_TIMESTAMP WHERE storage_key=$1', [job.storage_key]);
            const active = (await client.query('SELECT id FROM materials WHERE storage_key=$1', [job.storage_key])).rows.length;
            if (!active && await removeStoredFile(directory, job.storage_key)) {
                await client.query('DELETE FROM material_file_cleanup_jobs WHERE storage_key=$1', [job.storage_key]);
                removed++;
            }
        }
        const pending = Number((await client.query(`SELECT count(*) AS count FROM material_file_cleanup_jobs
            WHERE ($1::text[] IS NULL OR storage_key=ANY($1::text[]))`, [keys])).rows[0].count);
        return { processed: jobs.length, removed, pending };
    });
}
async function deleteMaterial(pool, session, id, directory, body = {}) {
    deleteInput(body);
    const recordId = materialId(id);
    const linkedMessage = 'This file is linked to calendar events or homework. Remove those links before deleting it.';
    let deleted;
    try {
        deleted = await withActor(pool, session, async (client, actor) => {
            if (actor.role !== 'admin') throw failure(403, 'Only admins can permanently delete archive files.');
            // FOR UPDATE conflicts with attachment validation and foreign-key key-share locks.
            // A concurrent attachment either commits first and is detected, or sees the deleted ID.
            const record = (await client.query('SELECT id::text AS id,kind,storage_key FROM materials WHERE id=$1 FOR UPDATE', [recordId])).rows[0];
            if (!record) throw failure(404, 'Material not found.');
            const linked = (await client.query(`SELECT EXISTS(SELECT 1 FROM event_materials WHERE material_id=$1)
                OR EXISTS(SELECT 1 FROM homework_materials WHERE material_id=$1) AS linked`, [recordId])).rows[0].linked;
            if (linked) throw failure(409, linkedMessage);
            if (record.kind === 'file') await client.query('INSERT INTO material_file_cleanup_jobs(storage_key) VALUES($1) ON CONFLICT DO NOTHING', [record.storage_key]);
            await client.query('DELETE FROM materials WHERE id=$1', [recordId]);
            return record;
        });
    } catch (error) {
        if (error.code === '23503') throw failure(409, linkedMessage);
        throw error;
    }
    let cleanup = 'complete';
    if (deleted.kind === 'file') {
        cleanup = 'pending';
        try {
            const result = await cleanupDeletedMaterialFiles(pool, directory, { keys: [deleted.storage_key], limit: 1 });
            if (result.pending === 0) cleanup = 'complete';
        } catch { /* The committed durable job is retried by the cleanup command. */ }
    }
    return { deleted: true, id: deleted.id, storage_cleanup: cleanup };
}
module.exports = { MAX_FILE_BYTES, CATEGORIES, AREAS, TERMS, VISIBILITIES, REVIEW_STATUSES, MATERIAL_FIELDS, MATERIAL_JOINS,
    validAcademicYear, materialId, materialById, assertCanManage, applyMaterialUpdate, canAccessMaterial,
    listMaterials, materialDetail, createMaterial, updateMaterial, validateMaterialLinks, downloadMaterial,
    deleteInput, deleteMaterial, cleanupDeletedMaterialFiles };
