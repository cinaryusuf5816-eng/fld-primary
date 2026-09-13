const { transaction } = require('./db');
const { failure } = require('./auth/users');
const { GRADES, normalizeGrades, withActor } = require('./auth/grades');

const FOLDER_FIELDS = 'f.id,f.name,f.parent_id,f.visibility,f.grades,f.created_at,f.updated_at';
const MAX_DEPTH = 8;
const isManager = actor => ['admin', 'coordinator'].includes(actor?.role) && actor.is_active !== false && !actor.deleted_at;
function folderId(value, allowRoot = false) {
    if (allowRoot && (value === null || value === 'root')) return null;
    if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value)) ||
        !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n) throw failure(400, 'Choose a valid archive folder.');
    return String(value);
}
function folderName(value) {
    if (typeof value !== 'string') throw failure(400, 'Enter a folder name.');
    const name = value.trim().replace(/ +/g, ' ');
    if (!name || name.length > 120 || /[\\/\x00-\x1f\x7f]/.test(name) || ['.', '..'].includes(name)) {
        throw failure(400, 'Use a folder name of 1–120 characters without slashes or control characters.');
    }
    return name;
}
function canAccessFolder(actor, folder) {
    return Boolean(folder && actor && actor.is_active !== false && !actor.deleted_at && (isManager(actor) ||
        (actor.role === 'teacher' && (folder.visibility === 'shared' ||
            (folder.visibility === 'grades' && folder.grades.some(grade => (actor.grades || []).includes(grade)))))));
}
function present(folder, actor) {
    return { ...folder, id: String(folder.id), parent_id: folder.parent_id === null ? null : String(folder.parent_id),
        upload_allowed: isManager(actor) || (actor.role === 'teacher' && (actor.grades || []).length > 0 &&
            (folder.visibility === 'shared' || (folder.visibility === 'grades' && folder.grades.some(grade => actor.grades.includes(grade))))) };
}
async function folderById(client, actor, id, lock = false) {
    const folder = (await client.query(`SELECT ${FOLDER_FIELDS} FROM archive_folders f WHERE f.id=$1${lock ? ' FOR SHARE' : ''}`, [folderId(id)])).rows[0];
    if (!canAccessFolder(actor, folder)) throw failure(404, 'Folder not found.');
    return present(folder, actor);
}
async function pathForFolder(client, actor, id) {
    if (id === null) return [];
    return (await pathsForFolders(client, actor, [id])).get(String(id));
}
async function pathsForFolders(client, actor, ids) {
    const keys = [...new Set(ids.filter(id => id !== null).map(id => folderId(id)))];
    const paths = new Map([[null, []]]);
    if (!keys.length) return paths;
    const chain = (await client.query(`WITH RECURSIVE ancestors AS (
        SELECT id AS leaf_id,id,name,parent_id,visibility,grades,1 AS depth FROM archive_folders WHERE id=ANY($1::bigint[])
        UNION ALL SELECT a.leaf_id,f.id,f.name,f.parent_id,f.visibility,f.grades,a.depth+1 FROM archive_folders f
            JOIN ancestors a ON f.id=a.parent_id WHERE a.depth<$2
        ) SELECT * FROM ancestors ORDER BY leaf_id,depth DESC`, [keys, MAX_DEPTH])).rows;
    for (const folder of chain) {
        if (!canAccessFolder(actor, folder)) throw failure(404, 'Folder not found.');
        const key = String(folder.leaf_id);
        if (!paths.has(key)) paths.set(key, []);
        paths.get(key).push({ id: String(folder.id), name: folder.name });
    }
    if (keys.some(key => !paths.has(key))) throw failure(404, 'Folder not found.');
    return paths;
}
function assertFolderAccepts(folder, material) {
    if (!folder || folder.visibility === 'shared' || material.visibility === 'management' ||
        (folder.visibility === 'grades' && material.visibility === 'grades' && material.grades.every(grade => folder.grades.includes(grade)))) return;
    throw failure(409, 'This file is available to people outside the selected folder. Choose a compatible folder or move it to All files before changing its access.');
}
async function validateMaterialFolder(client, actor, id, material) {
    if (id === null || id === undefined) return null;
    const folder = await folderById(client, actor, id, true);
    assertFolderAccepts(folder, material);
    return folder.id;
}
async function folderContext(client, actor, parent = null) {
    const current = parent === null ? null : await folderById(client, actor, parent);
    const breadcrumbs = current ? await pathForFolder(client, actor, current.id) : [];
    return { current_folder: current, breadcrumbs };
}
async function childFolders(client, actor, parent = null) {
    const all = isManager(actor), grades = actor.role === 'teacher' ? actor.grades || [] : GRADES;
    const rows = (await client.query(`SELECT ${FOLDER_FIELDS},
        (SELECT count(*) FROM materials m WHERE m.folder_id=f.id AND NOT m.is_archived AND
            ($2::boolean OR (m.review_status='approved' AND (m.visibility='shared' OR (m.visibility='grades' AND m.grades && $3::text[]))))) AS file_count,
        (SELECT count(*) FROM archive_folders child WHERE child.parent_id=f.id AND
            ($2::boolean OR child.visibility='shared' OR (child.visibility='grades' AND child.grades && $3::text[]))) AS folder_count
        FROM archive_folders f WHERE f.parent_id IS NOT DISTINCT FROM $1::bigint AND
            ($2::boolean OR f.visibility='shared' OR (f.visibility='grades' AND f.grades && $3::text[]))
        ORDER BY lower(f.name),f.id`, [parent, all, grades])).rows;
    return rows.map(folder => present({ ...folder, file_count: Number(folder.file_count), folder_count: Number(folder.folder_count) }, actor));
}
async function listFolders(pool, actor, query = {}) {
    if (!query || Object.keys(query).some(key => key !== 'parent' || typeof query[key] !== 'string')) throw failure(400, 'Invalid folder filters.');
    const parent = folderId(query.parent ?? 'root', true);
    return transaction(pool, async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const context = await folderContext(client, actor, parent);
        return { ...context, folders: await childFolders(client, actor, parent) };
    });
}
async function folderDetail(pool, actor, id) {
    return transaction(pool, async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const context = await folderContext(client, actor, folderId(id));
        return { folder: context.current_folder, breadcrumbs: context.breadcrumbs };
    });
}
function checkBody(body, keys) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !keys.includes(key))) {
        throw failure(400, 'Choose valid folder fields.');
    }
}
function assertManager(actor) { if (!isManager(actor)) throw failure(403, 'Only admins and coordinators can organize folders.'); }
function rethrowFolderError(error) {
    if (error.code === '23505' && error.constraint === 'archive_folders_sibling_name_idx') throw failure(409, 'A folder with this name already exists here.');
    throw error;
}
async function createFolder(pool, session, body) {
    checkBody(body, ['name', 'parent_id', 'visibility', 'grades']);
    const name = folderName(body.name), parentId = folderId(body.parent_id ?? 'root', true);
    try {
        return await withActor(pool, session, async (client, actor) => {
            assertManager(actor);
            let visibility, grades;
            if (parentId !== null) {
                if (Object.hasOwn(body, 'visibility') || Object.hasOwn(body, 'grades')) throw failure(400, 'Subfolders inherit access from their parent.');
                const parent = await folderById(client, actor, parentId, true);
                if ((await pathForFolder(client, actor, parentId)).length >= MAX_DEPTH) throw failure(400, 'Folders support up to eight levels.');
                ({ visibility, grades } = parent);
            } else {
                visibility = body.visibility ?? 'shared';
                grades = normalizeGrades(body.grades ?? []);
                if (!['shared', 'grades', 'management'].includes(visibility) || ((visibility === 'grades') !== (grades.length > 0))) {
                    throw failure(400, 'Choose folder access and select grades only for grade folders.');
                }
            }
            const id = (await client.query(`INSERT INTO archive_folders (name,parent_id,visibility,grades,created_by)
                VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, parentId, visibility, grades, actor.id])).rows[0].id;
            return { folder: await folderById(client, actor, id), breadcrumbs: await pathForFolder(client, actor, id) };
        });
    } catch (error) { rethrowFolderError(error); }
}
async function renameFolder(pool, session, id, body) {
    checkBody(body, ['name']);
    const name = folderName(body.name);
    try {
        return await withActor(pool, session, async (client, actor) => {
            assertManager(actor);
            const folder = await folderById(client, actor, id);
            await client.query('UPDATE archive_folders SET name=$1 WHERE id=$2', [name, folder.id]);
            return { folder: await folderById(client, actor, id), breadcrumbs: await pathForFolder(client, actor, id) };
        });
    } catch (error) { rethrowFolderError(error); }
}
async function moveMaterials(pool, session, body) {
    checkBody(body, ['ids', 'folder_id']);
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || !Object.hasOwn(body, 'folder_id')) {
        throw failure(400, 'Choose up to 100 files and a destination folder.');
    }
    const library = require('./materials');
    const ids = body.ids.map(library.materialId).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (new Set(ids).size !== ids.length) throw failure(400, 'Choose each archive record only once.');
    const target = folderId(body.folder_id, true);
    return withActor(pool, session, async (client, actor) => {
        assertManager(actor);
        const folder = target === null ? null : await folderById(client, actor, target, true);
        const previous = (await client.query(`SELECT ${library.MATERIAL_FIELDS} FROM materials m ${library.MATERIAL_JOINS} WHERE m.id=ANY($1::bigint[]) ORDER BY m.id FOR UPDATE OF m`, [ids])).rows;
        if (previous.length !== ids.length) throw failure(404, 'An archive record no longer exists. Refresh the list.');
        for (const material of previous) assertFolderAccepts(folder, material);
        await client.query(`UPDATE materials SET folder_id=$1,last_edited_by=$3,last_edited_at=clock_timestamp(),edit_history_status='edited'
            WHERE id=ANY($2::bigint[])`, [target, ids, actor.id]);
        return { moved: ids.length, folder_id: target,
            items: (await client.query(`SELECT ${library.MATERIAL_FIELDS} FROM materials m ${library.MATERIAL_JOINS} WHERE m.id=ANY($1::bigint[]) ORDER BY m.id`, [ids])).rows };
    });
}
async function deleteFolder(pool, session, id, body = {}) {
    require('./materials').deleteInput(body);
    const recordId = folderId(id);
    const nonemptyMessage = 'This folder still contains files or subfolders, including retired files. Move or delete its contents first.';
    try {
        return await withActor(pool, session, async (client, actor) => {
            if (actor.role !== 'admin') throw failure(403, 'Only admins can permanently delete archive folders.');
            // Parent/file creation and file moves lock this folder FOR SHARE; no new
            // child can slip between the emptiness check and the committed deletion.
            const folder = (await client.query('SELECT id::text AS id FROM archive_folders WHERE id=$1 FOR UPDATE', [recordId])).rows[0];
            if (!folder) throw failure(404, 'Folder not found.');
            const nonempty = (await client.query(`SELECT EXISTS(SELECT 1 FROM materials WHERE folder_id=$1)
                OR EXISTS(SELECT 1 FROM archive_folders WHERE parent_id=$1) AS nonempty`, [recordId])).rows[0].nonempty;
            if (nonempty) throw failure(409, nonemptyMessage);
            await client.query('DELETE FROM archive_folders WHERE id=$1', [recordId]);
            return { deleted: true, id: folder.id };
        });
    } catch (error) {
        if (error.code === '23503') throw failure(409, nonemptyMessage);
        throw error;
    }
}

module.exports = { MAX_DEPTH, folderId, canAccessFolder, folderById, pathForFolder, pathsForFolders, validateMaterialFolder,
    folderContext, childFolders, listFolders, folderDetail, createFolder, renameFolder, moveMaterials, deleteFolder };
