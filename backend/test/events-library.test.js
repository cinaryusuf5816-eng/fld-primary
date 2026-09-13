const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { testDatabase } = require('./database');
const { migrate } = require('../scripts/migrate');
const { loadSession,digest } = require('../auth/middleware');
const { eventRoutes } = require('../routes/events');

test('calendar library links and grade-scoped event access', async t => {
    const database = await testDatabase(); const {pool} = database;
    t.after(() => database.close()); await migrate(pool);
    const config = {cookieName:'fld_event_test'};
    async function actor(role,grades,label) {
        const id = (await pool.query(`INSERT INTO users(email,full_name,password_hash,role,grades) VALUES($1,$2,'unused-test-hash',$3,$4) RETURNING id`,[`${label}@events.test`,label,role,grades])).rows[0].id;
        const token = randomBytes(32).toString('hex');
        await pool.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')`,[id,digest(token)]);
        return {id,cookie:`${config.cookieName}=${token}`};
    }
    const admin = await actor('admin',[],'admin'); const coordinator = await actor('coordinator',[],'coordinator');
    const grade3 = await actor('teacher',['Grade 3'],'grade3'); const grade2 = await actor('teacher',['Grade 2'],'grade2'); const sharedTeacher = await actor('teacher',[],'shared');
    async function renewSession(actor) {
        const token = randomBytes(32).toString('hex');
        await pool.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')`,[actor.id,digest(token)]);
        actor.cookie=`${config.cookieName}=${token}`;
    }
    async function material(title,grades,archived=false) {
        return (await pool.query(`INSERT INTO materials(title,grades,kind,url,created_by,is_archived,visibility,review_status) VALUES($1,$2,'link','https://example.org/lesson',$3,$4,$5,'approved') RETURNING id`,[title,grades,admin.id,archived,grades.length ? 'grades' : 'shared'])).rows[0].id;
    }
    const sharedMaterial = await material('Shared resource',[]); const grade3Material = await material('Grade 3 resource',['Grade 3']); const archivedMaterial = await material('Archived',['Grade 3'],true);
    const app = express(); app.use(express.json(),loadSession(pool,config)); app.use('/api/events',eventRoutes(pool,config));
    app.use((error,req,res,next) => res.status(error.status || 500).json({error:error.message}));
    const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(() => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}));
    const base = `http://127.0.0.1:${server.address().port}/api/events`;
    async function request(actor,method='GET',body,id='') {
        const response = await fetch(base+(id ? `/${id}` : ''),{method,headers:{'Content-Type':'application/json',...(actor ? {Cookie:actor.cookie} : {})},...(body ? {body:JSON.stringify(body)} : {})});
        return {status:response.status,data:await response.json()};
    }
    const original = {title:'Lesson',startDate:'2026-10-01',endDate:'2026-10-31',startTime:'09:00',endTime:'10:00',category:'programme',description:'Practice',days:{monday:true}};
    let sharedEvent,scopedEvent;
    await t.test('legacy requests stay Shared and signed-out access is rejected',async () => {
        assert.equal((await request(null)).status,401);
        const saved = await request(admin,'POST',original); assert.equal(saved.status,201); sharedEvent=saved.data;
        assert.deepEqual(sharedEvent.grades,[]); assert.deepEqual(sharedEvent.material_ids,[]); assert.equal(sharedEvent.start_date,original.startDate);
    });
    await t.test('admins attach matching materials and teachers see only Shared or assigned-grade events',async () => {
        const saved = await request(admin,'POST',{...original,title:'Grade 3 lesson',grades:['Grade 3'],material_ids:[sharedMaterial,grade3Material]});
        assert.equal(saved.status,201); scopedEvent=saved.data; assert.equal(scopedEvent.materials.length,2);
        assert.equal((await request(grade3)).data.length,2);
        for(const user of [grade2,sharedTeacher]) assert.deepEqual((await request(user)).data.map(event=>String(event.id)),[String(sharedEvent.id)]);
        assert.equal((await request(coordinator)).data.length,2);
        assert.equal((await request(grade3,'POST',original)).status,403);
        assert.equal((await request(grade3,'PATCH',{title:'Forged'},scopedEvent.id)).status,403);
    });
    await t.test('invalid material audiences, archived items and malformed input leave no partial events',async () => {
        const before = Number((await pool.query('SELECT count(*) FROM events')).rows[0].count);
        for(const extra of [
            {grades:[],material_ids:[grade3Material]}, {grades:['Grade 3','Grade 4'],material_ids:[grade3Material]},
            {grades:['Grade 3'],material_ids:[archivedMaterial]}, {grades:['Grade 3'],material_ids:['999999']},
            {grades:['Grade 3'],material_ids:[grade3Material,grade3Material]}, {grades:['Grade 5']}, {grades:['Grade 3','Grade 3']},
            {startDate:'2026-02-30'}, {role:'admin'}
        ]) assert.equal((await request(admin,'POST',{...original,...extra})).status,400);
        assert.equal(Number((await pool.query('SELECT count(*) FROM events')).rows[0].count),before);
    });
    await t.test('coordinators can edit existing events and audience changes must keep every link valid',async () => {
        await pool.query('UPDATE materials SET is_archived=TRUE WHERE id=$1',[grade3Material]);
        const changed=await request(coordinator,'PATCH',{title:'Updated lesson'},scopedEvent.id);
        assert.equal(changed.status,200);assert.equal(changed.data.start_date,original.startDate);assert.deepEqual(changed.data.days,original.days);assert.equal(changed.data.material_ids.length,2);
        assert.equal(changed.data.materials.find(item=>String(item.id)===String(grade3Material)).is_archived,true);
        assert.equal((await request(admin,'PATCH',{grades:['Grade 2']},scopedEvent.id)).status,400);
        assert.deepEqual((await request(admin)).data.find(event=>String(event.id)===String(scopedEvent.id)).grades,['Grade 3']);
        assert.equal((await request(admin,'PATCH',{grades:['Grade 2'],material_ids:[sharedMaterial]},scopedEvent.id)).status,200);
        assert.equal((await request(grade2)).data.length,2);assert.equal((await request(grade3)).data.length,1);
    });
    await t.test('read responses do not leak unrelated material metadata and account changes take effect immediately',async () => {
        await pool.query('INSERT INTO event_materials(event_id,material_id) VALUES($1,$2)',[sharedEvent.id,grade3Material]);
        const visible=(await request(grade2)).data.find(event=>String(event.id)===String(sharedEvent.id));
        assert.deepEqual(visible.materials,[]);assert.deepEqual(visible.material_ids,[]);
        assert.equal((await request(admin)).data.find(event=>String(event.id)===String(sharedEvent.id)).materials.length,1);
        await pool.query("UPDATE users SET grades=ARRAY['Grade 3'] WHERE id=$1",[grade2.id]);
        assert.equal((await request(grade2)).status,401); await renewSession(grade2);
        assert.equal((await request(grade2)).data.length,1);
        await pool.query("UPDATE users SET role='teacher',grades='{}' WHERE id=$1",[coordinator.id]);
        assert.equal((await request(coordinator,'PATCH',{title:'No access'},scopedEvent.id)).status,401); await renewSession(coordinator);
        assert.equal((await request(coordinator,'PATCH',{title:'No access'},scopedEvent.id)).status,403);
        await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1',[grade3.id]);assert.equal((await request(grade3)).status,401);
    });
});
