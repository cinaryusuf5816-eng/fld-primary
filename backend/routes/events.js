const { Router } = require('express');
const { requireAuth, requireRoles, readSessionToken, digest } = require('../auth/middleware');
const { normalizeGrades, withActor } = require('../auth/grades');
const { failure } = require('../auth/users');
const { validateMaterialLinks, canAccessMaterial } = require('../materials');

const EVENT_FIELDS = `e.id,e.created_at,e.title,to_char(e.start_date,'YYYY-MM-DD') AS start_date,
    to_char(e.end_date,'YYYY-MM-DD') AS end_date,e.start_time,e.end_time,e.category,e.description,e.days,e.grades`;
function validId(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n) throw failure(400, 'Invalid ID.');
    return String(value);
}
function eventId(value) {
    if (typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) return value;
    return validId(value);
}
function eventInput(body, previous) {
    const allowed = ['title','startDate','endDate','startTime','endTime','category','description','days','grades','material_ids'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) throw failure(400, 'Invalid event fields.');
    const values = { title: previous?.title, startDate: previous?.start_date, endDate: previous?.end_date,
        startTime: previous?.start_time, endTime: previous?.end_time, category: previous?.category,
        description: previous?.description || '', days: previous?.days || null, grades: previous?.grades || [], material_ids: previous?.material_ids || [], ...body };
    const date = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
        const parsed = new Date(`${value}T12:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
    };
    const time = value => value === undefined || value === null || value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value));
    const dayNames = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    if (typeof values.title !== 'string' || !values.title.trim() || values.title.length > 500 ||
        !date(values.startDate) || !date(values.endDate) || values.endDate < values.startDate || !time(values.startTime) || !time(values.endTime) ||
        typeof values.category !== 'string' || !values.category.trim() || values.category.length > 80 ||
        (values.description != null && (typeof values.description !== 'string' || values.description.length > 10000)) ||
        (values.days != null && (typeof values.days !== 'object' || Array.isArray(values.days) || Object.entries(values.days).some(([key,value]) => !dayNames.includes(key) || typeof value !== 'boolean')))) throw failure(400, 'Invalid event input.');
    values.grades = normalizeGrades(values.grades);
    if (!Array.isArray(values.material_ids) || values.material_ids.length > 30) throw failure(400, 'Choose up to 30 materials.');
    values.material_ids = values.material_ids.map(validId);
    if (new Set(values.material_ids).size !== values.material_ids.length) throw failure(400, 'Duplicate material selection.');
    return values;
}
async function hydrateEvents(client, events, actor) {
    if (!events.length) return [];
    const links = (await client.query(`SELECT em.event_id,m.id,m.title,m.grades,m.is_archived,m.kind,
        m.visibility,m.review_status,m.in_materials,m.academic_year,m.term,m.area
        FROM event_materials em JOIN materials m ON m.id=em.material_id
        WHERE em.event_id::text=ANY($1::text[]) ORDER BY m.title,m.id`, [events.map(event => String(event.id))])).rows;
    return events.map(event => {
        const materials = links.filter(material => String(material.event_id) === String(event.id) && canAccessMaterial(actor,material))
            .map(({event_id,...material}) => material);
        return { ...event, materials, material_ids: materials.map(material => material.id) };
    });
}
function eventRoutes(pool, config) {
    const router = Router();
    router.use(requireAuth);
    router.get('/', async (req,res) => {
        const events = (await pool.query(`SELECT ${EVENT_FIELDS} FROM events e
            WHERE ($1::boolean OR cardinality(e.grades)=0 OR e.grades && $2::text[]) ORDER BY e.start_date,e.start_time,e.id`,
        [req.user.role !== 'teacher', req.user.grades || []])).rows;
        res.json(await hydrateEvents(pool, events, req.user));
    });
    const session = req => ({ userId: req.user.id, tokenHash: digest(readSessionToken(req,config)) });
    async function save(req, previousId) {
        return withActor(pool,session(req),async (client,actor) => {
            if (!['admin','coordinator'].includes(actor.role)) throw failure(403, 'Only admins and coordinators can manage calendar events.');
            let previous;
            if (previousId) {
                previous = (await client.query(`SELECT ${EVENT_FIELDS} FROM events e WHERE e.id=$1 FOR UPDATE`, [eventId(previousId)])).rows[0];
                if (!previous) throw failure(404, 'Event not found.');
                previous.material_ids = (await client.query('SELECT material_id FROM event_materials WHERE event_id=$1 ORDER BY material_id', [previous.id])).rows.map(row => row.material_id);
            }
            const values = eventInput(req.body,previous);
            const sameAudience = previous && previous.grades.length === values.grades.length && previous.grades.every(grade => values.grades.includes(grade));
            const previousLinks = new Set((previous?.material_ids || []).map(String));
            // Archiving keeps existing links usable. Only new links need to be
            // active unless the event audience changes, which revalidates all.
            const linksToValidate = sameAudience ? values.material_ids.filter(id => !previousLinks.has(id)) : values.material_ids;
            await validateMaterialLinks(client,linksToValidate,values.grades);
            const params = [values.title.trim(),values.startDate,values.endDate,values.startTime || null,values.endTime || null,values.category.trim(),values.description || '',values.days,values.grades];
            let id;
            if (previous) {
                params.push(previous.id);
                id = (await client.query(`UPDATE events SET title=$1,start_date=$2,end_date=$3,start_time=$4,end_time=$5,category=$6,description=$7,days=$8,grades=$9 WHERE id=$10 RETURNING id`,params)).rows[0].id;
                await client.query('DELETE FROM event_materials WHERE event_id=$1',[id]);
            } else id = (await client.query(`INSERT INTO events(title,start_date,end_date,start_time,end_time,category,description,days,grades) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,params)).rows[0].id;
            for (const materialId of values.material_ids) await client.query('INSERT INTO event_materials(event_id,material_id) VALUES($1,$2)',[id,materialId]);
            const events = (await client.query(`SELECT ${EVENT_FIELDS} FROM events e WHERE e.id=$1`,[id])).rows;
            return (await hydrateEvents(client,events,actor))[0];
        });
    }
    router.post('/',requireRoles('admin','coordinator'),async(req,res) => res.status(201).json(await save(req)));
    router.patch('/:id',requireRoles('admin','coordinator'),async(req,res) => res.json(await save(req,req.params.id)));
    return router;
}
module.exports = { eventRoutes };
