const { Router } = require('express');
const { requireAuth, requireRoles, digest, readSessionToken } = require('../auth/middleware');
const { GRADES, normalizeGrades, withActor, canAccessAudience } = require('../auth/grades');
const { failure } = require('../auth/users');
const TYPES = ['General','Meeting','Deadline','Update'];
const COLUMNS = "id,title,description,category,to_char(date,'YYYY-MM-DD') AS date,grades,is_archived,created_by,created_at,updated_at";
function validId(value) {
    if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value)>9223372036854775807n) throw failure(400,'Invalid announcement ID.');
    return value;
}
function validate(body, previous) {
    const allowed = ['title','description','category','date','grades', ...(previous ? ['is_archived'] : [])];
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key=>!allowed.includes(key))) throw failure(400,'Invalid announcement fields.');
    const value = {category:'General',grades:[],...previous,...body};
    for (const [key,max] of [['title',200],['description',8000]]) {
        if (typeof value[key]!=='string' || !value[key].trim() || value[key].length>max) throw failure(400,`Enter a valid ${key}.`);
        value[key]=value[key].trim();
    }
    if (!TYPES.includes(value.category)) throw failure(400,'Choose a valid category.');
    if (typeof value.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || value.date.startsWith('0000')) throw failure(400,'Choose a valid date.');
    const date=new Date(value.date+'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value.date) throw failure(400,'Choose a valid date.');
    value.grades=normalizeGrades(value.grades);
    if ('is_archived' in value && typeof value.is_archived!=='boolean') throw failure(400,'Invalid archive state.');
    return value;
}
function announcementRoutes(pool,config) {
    const router=Router();
    router.use(requireAuth);
    const session=req=>({userId:req.user.id,tokenHash:digest(readSessionToken(req,config))});
    router.get('/',async(req,res)=>{
        if (Object.keys(req.query).length) throw failure(400,'Invalid announcement filters.');
        const result=await pool.query(`SELECT ${COLUMNS} FROM announcements WHERE NOT is_archived
            AND ($1::boolean OR cardinality(grades)=0 OR grades && $2::text[]) ORDER BY date DESC,id DESC`,
            [req.user.role!=='teacher',req.user.role==='teacher' ? req.user.grades || [] : GRADES]);
        res.json({announcements:result.rows});
    });
    router.get('/:id',async(req,res)=>{
        const result=await pool.query(`SELECT ${COLUMNS} FROM announcements WHERE id=$1 AND NOT is_archived`,[validId(req.params.id)]);
        const announcement=result.rows[0];
        if (!announcement || !canAccessAudience(req.user,announcement.grades)) throw failure(404,'Announcement not found.');
        res.json({announcement});
    });
    router.post('/',requireRoles('admin'),async(req,res)=>{
        const value=validate(req.body);
        const announcement=await withActor(pool,session(req),async(client,actor)=>{
            if (actor.role!=='admin') throw failure(403,'Only admins can manage announcements.');
            return (await client.query(`INSERT INTO announcements(title,description,category,date,grades,created_by)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
                [value.title,value.description,value.category,value.date,value.grades,actor.id])).rows[0];
        });
        res.status(201).json({announcement});
    });
    router.patch('/:id',requireRoles('admin'),async(req,res)=>{
        const id=validId(req.params.id);
        const announcement=await withActor(pool,session(req),async(client,actor)=>{
            if(actor.role!=='admin') throw failure(403,'Only admins can manage announcements.');
            const previous=(await client.query(`SELECT ${COLUMNS} FROM announcements WHERE id=$1 AND NOT is_archived FOR UPDATE`,[id])).rows[0];
            if(!previous) throw failure(404,'Announcement not found.');
            const value=validate(req.body,previous);
            return (await client.query(`UPDATE announcements SET title=$1,description=$2,category=$3,date=$4,grades=$5,is_archived=$6
                WHERE id=$7 RETURNING ${COLUMNS}`,[value.title,value.description,value.category,value.date,value.grades,value.is_archived,id])).rows[0];
        });
        res.json({announcement});
    });
    return router;
}
module.exports={announcementRoutes};
