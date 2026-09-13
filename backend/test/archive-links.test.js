const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {randomBytes}=require('node:crypto');const {once}=require('node:events');
const {testDatabase}=require('./database');const {migrate}=require('../scripts/migrate');
const {loadSession,digest}=require('../auth/middleware');const {eventRoutes}=require('../routes/events');const {academicRoutes}=require('../routes/academic');
const library=require('../materials');

test('archive metadata is enforced in hydrated links without losing hidden history',async t=>{
 const database=await testDatabase();const {pool}=database;t.after(()=>database.close());await migrate(pool);
 const config={cookieName:'fld_archive_links_test'};
 async function actor(role,grades,label){const id=(await pool.query("INSERT INTO users(email,full_name,password_hash,role,grades) VALUES($1,$2,'unused-test-hash',$3,$4) RETURNING id",[`${label}@archive-links.test`,label,role,grades])).rows[0].id;const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')",[id,digest(token)]);return{id,cookie:`${config.cookieName}=${token}`,session:{userId:id,tokenHash:digest(token)}};}
 const admin=await actor('admin',[],'admin'),coordinator=await actor('coordinator',[],'coordinator'),teacher=await actor('teacher',['Grade 3'],'teacher'),other=await actor('teacher',['Grade 4'],'other'),sharedOnly=await actor('teacher',[],'shared');
 async function record(title,visibility,review,grades=[],inMaterials=false,retired=false){return(await pool.query(`INSERT INTO materials(title,kind,url,created_by,grades,visibility,review_status,in_materials,is_archived,academic_year,term,area)
 VALUES($1,'link','https://example.org/resource',$2,$3,$4,$5,$6,$7,'2026-2027','Term 1','Teaching & Learning') RETURNING id`,[title,admin.id,grades,visibility,review,inMaterials,retired])).rows[0].id;}
 const shared=await record('Shared approved','shared','approved',[],true),grade3=await record('Grade 3 archive-only','grades','approved',['Grade 3']),management=await record('Management private','management','approved'),pending=await record('Pending private','shared','needs_review'),grade4=await record('Other grade private','grades','approved',['Grade 4']),retired=await record('Retired shared','shared','approved',[],false,true);
 const app=express();app.use(express.json(),loadSession(pool,config));app.use('/api/events',eventRoutes(pool,config));app.use('/api',academicRoutes(pool,config));app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const base=`http://127.0.0.1:${server.address().port}`;
 async function request(url,user=admin,method='GET',body){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:user.cookie},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};}
 const homeworkBody={title:'Archive-linked homework',grade:'Grade 3',class_name:'A',assign_date:'2026-09-01',due_date:'2026-09-10',material_ids:[shared,grade3]};
 const eventBody={title:'Archive-linked event',startDate:'2026-09-13',endDate:'2026-09-13',category:'activity',grades:['Grade 3'],material_ids:[shared,grade3]};
 const createdHomework=await request('/api/homework',teacher,'POST',homeworkBody);assert.equal(createdHomework.status,201);const homework=createdHomework.data.homework;
 const createdEvent=await request('/api/events',admin,'POST',eventBody);assert.equal(createdEvent.status,201);const event=createdEvent.data;
 // Seed legacy/inconsistent links directly to exercise read defenses, not creation permissions.
 for(const id of [management,pending,grade4,retired]){await pool.query('INSERT INTO homework_materials(homework_id,material_id) VALUES($1,$2)',[homework.id,id]);await pool.query('INSERT INTO event_materials(event_id,material_id) VALUES($1,$2)',[event.id,id]);}
 const visible=[shared,grade3,retired].map(String).sort();
 await t.test('teachers receive neither restricted metadata nor hidden material IDs through lists or checks',async()=>{
  const list=(await request('/api/homework',teacher)).data.homeworks[0];const checks=(await request(`/api/homework/${homework.id}/checks`,teacher)).data.homework;const calendar=(await request('/api/events',teacher)).data[0];
  for(const item of [list,checks,calendar]){assert.deepEqual(item.material_ids.map(String).sort(),visible);assert.deepEqual(item.materials.map(material=>String(material.id)).sort(),visible);assert.ok(!JSON.stringify(item).includes('Management private'));assert.ok(!JSON.stringify(item).includes('Pending private'));assert.ok(!JSON.stringify(item).includes('Other grade private'));}
  assert.equal(list.materials.find(material=>String(material.id)===String(grade3)).in_materials,false);assert.equal(list.materials[0].academic_year,'2026-2027');
  for(const user of [admin,coordinator]){assert.equal((await request('/api/homework',user)).data.homeworks[0].materials.length,6);assert.equal((await request('/api/events',user)).data[0].materials.length,6);}
  assert.deepEqual((await request('/api/events',sharedOnly)).data,[]);assert.deepEqual((await request('/api/events',other)).data,[]);
 });
 await t.test('teacher form edits preserve hidden stored links while returning only visible IDs',async()=>{
  const changed=await request(`/api/homework/${homework.id}`,teacher,'PATCH',{title:'Updated visible title',material_ids:visible});assert.equal(changed.status,200);assert.deepEqual(changed.data.homework.material_ids.map(String).sort(),visible);
  assert.equal(Number((await pool.query('SELECT count(*) FROM homework_materials WHERE homework_id=$1',[homework.id])).rows[0].count),6);
  assert.equal((await request(`/api/homework/${homework.id}`,teacher,'PATCH',{description:'A second edit'})).status,200);
  assert.equal(Number((await pool.query('SELECT count(*) FROM homework_materials WHERE homework_id=$1',[homework.id])).rows[0].count),6);
 });
 await t.test('new attachments and audience changes cannot bypass review or management restrictions',async()=>{
  for(const id of [management,pending]){assert.equal((await request('/api/homework',teacher,'POST',{...homeworkBody,material_ids:[id]})).status,400);assert.equal((await request('/api/events',admin,'POST',{...eventBody,material_ids:[id]})).status,400);}
  assert.equal((await request(`/api/homework/${homework.id}`,admin,'PATCH',{grade:'Grade 4'})).status,400);
  assert.equal((await request(`/api/events/${event.id}`,admin,'PATCH',{grades:['Grade 4']})).status,400);
  assert.equal((await request('/api/homework',admin)).data.homeworks[0].grade,'Grade 3');assert.deepEqual((await request('/api/events',admin)).data[0].grades,['Grade 3']);
 });
 await t.test('Archive cannot narrow access or mark linked approved records pending, but catalog placement is independent',async()=>{
  for(const change of [{visibility:'management',grades:[],in_materials:false},{review_status:'needs_review',in_materials:false},{visibility:'grades',grades:['Grade 4']}])await assert.rejects(library.updateMaterial(pool,admin.session,shared,change,{archive:true}),{status:409});
  await library.updateMaterial(pool,admin.session,shared,{in_materials:false,academic_year:'2027-2028',area:'Planning & Curriculum'},{archive:true});
  const visibleRecord=(await request('/api/events',teacher)).data[0].materials.find(item=>String(item.id)===String(shared));assert.equal(visibleRecord.in_materials,false);assert.equal(visibleRecord.academic_year,'2027-2028');assert.equal(visibleRecord.area,'Planning & Curriculum');
 });
});
