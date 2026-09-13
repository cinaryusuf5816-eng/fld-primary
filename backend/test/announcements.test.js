const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { hashPassword } = require('../auth/passwords');
const { digest } = require('../auth/middleware');
const { testDatabase } = require('./database');

test('announcements persist with admin-only management and grade-scoped reading',async t => {
    const database=await testDatabase();const {pool}=database;t.after(()=>database.close());await migrate(pool);
    const config=readConfig({APP_ORIGINS:'http://localhost:5500'});
    const passwordHash=await hashPassword(randomBytes(32).toString('hex'));const staff={};
    for(const [key,role,grades] of [['admin','admin',[]],['coordinator','coordinator',[]],['grade3','teacher',['Grade 3']],['grade4','teacher',['Grade 4']],['shared','teacher',[]]]) {
        const id=(await pool.query('INSERT INTO users(email,full_name,password_hash,role,grades) VALUES($1,$2,$3,$4,$5) RETURNING id',[`${key}@announcements.test`,key,passwordHash,role,grades])).rows[0].id;
        const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')",[id,digest(token)]);
        staff[key]={id,cookie:`${config.cookieName}=${token}`};
    }
    const server=createApp({pool,config}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
    const base=`http://127.0.0.1:${server.address().port}/api/announcements`;
    async function request(user=staff.admin,method='GET',body,suffix='') {
        const response=await fetch(base+suffix,{method,redirect:'manual',headers:{Origin:'http://localhost:5500',...(user?{Cookie:user.cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
        return {status:response.status,data:await response.json(),headers:response.headers};
    }
    const body=overrides=>({title:'Department update',description:'Please review the new resources.',category:'Update',date:'2026-10-01',grades:[],...overrides});
    let shared,grade3,grade4;
    await t.test('only admins can create announcements; reads and writes require authentication',async()=>{
        assert.equal((await request(null)).status,401);assert.equal((await request(null,'POST',body())).status,401);
        for(const user of [staff.coordinator,staff.grade3,staff.grade4,staff.shared]) assert.equal((await request(user,'POST',body())).status,403);
        const created=await request(staff.admin,'POST',body());assert.equal(created.status,201);shared=created.data.announcement;assert.equal(String(shared.created_by),String(staff.admin.id));
        const first=await request(staff.admin,'POST',body({title:'Grade 3 update',grades:['Grade 3']}));assert.equal(first.status,201);grade3=first.data.announcement;
        const second=await request(staff.admin,'POST',body({title:'Grade 4 update',grades:['Grade 4']}));assert.equal(second.status,201);grade4=second.data.announcement;
    });
    await t.test('list and detail responses enforce Shared and assigned grades without exposing unrelated posts',async()=>{
        for(const [user,expected] of [[staff.admin,3],[staff.coordinator,3],[staff.grade3,2],[staff.grade4,2],[staff.shared,1]]) assert.equal((await request(user)).data.announcements.length,expected);
        for(const [user,own,other] of [[staff.grade3,grade3,grade4],[staff.grade4,grade4,grade3]]) {
            assert.equal((await request(user,'GET',undefined,`/${own.id}`)).status,200);assert.equal((await request(user,'GET',undefined,`/${shared.id}`)).status,200);
            assert.equal((await request(user,'GET',undefined,`/${other.id}`)).status,404);
        }
        assert.equal((await request(staff.shared,'GET',undefined,`/${grade3.id}`)).status,404);
        assert.equal((await request(null,'GET',undefined,`/${shared.id}`)).status,401);
        assert.equal((await request(staff.grade3)).headers.get('cache-control'),'no-store');
    });
    await t.test('admin edits persist as data, including markup-like text, and coordinators remain read-only',async()=>{
        const title='<img src=x onerror=alert(1)> & Grade 3';const description='<script>alert("example")</script> is text, not markup.';
        const edited=await request(staff.admin,'PATCH',{title,description,category:'Meeting',date:'2026-10-02'},`/${grade3.id}`);assert.equal(edited.status,200);
        const detail=(await request(staff.grade3,'GET',undefined,`/${grade3.id}`)).data.announcement;assert.equal(detail.title,title);assert.equal(detail.description,description);assert.equal(detail.date,'2026-10-02');
        const listed=(await request(staff.grade3)).data.announcements.find(item=>String(item.id)===String(grade3.id));assert.equal(listed.title,title);
        for(const user of [staff.coordinator,staff.grade3,staff.grade4,staff.shared]) for(const change of [{title:'Forbidden edit'},{is_archived:true}]) assert.equal((await request(user,'PATCH',change,`/${shared.id}`)).status,403);
        assert.equal((await request(staff.admin,'PATCH',{grades:['Grade 4']},`/${grade3.id}`)).status,200);
        assert.equal((await request(staff.grade3,'GET',undefined,`/${grade3.id}`)).status,404);assert.equal((await request(staff.grade4,'GET',undefined,`/${grade3.id}`)).status,200);
    });
    await t.test('invalid dates, extra fields and malformed audiences are rejected without creating records',async()=>{
        const before=Number((await pool.query('SELECT count(*) FROM announcements')).rows[0].count);
        for(const change of [{date:'2026-02-30'},{date:'2026-13-01'},{date:'0000-01-01'},{date:'2026-10-01T00:00:00Z'},{title:' '},{description:''},{category:'Unknown'},{grades:['Grade 5']},{grades:['Grade 3','Grade 3']},{grades:'Grade 3'},{created_by:staff.grade3.id},{is_archived:true}]) assert.equal((await request(staff.admin,'POST',body(change))).status,400);
        assert.equal((await request(staff.admin,'PATCH',{is_archived:'true'},`/${shared.id}`)).status,400);
        assert.equal((await request(staff.admin,'PATCH',{role:'admin'},`/${shared.id}`)).status,400);
        assert.equal((await request(staff.admin,'GET',undefined,'?grade=Grade%203')).status,400);
        assert.equal(Number((await pool.query('SELECT count(*) FROM announcements')).rows[0].count),before);
    });
    await t.test('removing an announcement hides it from lists and detail for every role while retaining history',async()=>{
        assert.equal((await request(staff.admin,'PATCH',{is_archived:true},`/${shared.id}`)).status,200);
        for(const user of Object.values(staff)) {
            assert.equal((await request(user,'GET',undefined,`/${shared.id}`)).status,404);
            assert.ok(!(await request(user)).data.announcements.some(item=>String(item.id)===String(shared.id)));
        }
        assert.equal((await pool.query('SELECT is_archived FROM announcements WHERE id=$1',[shared.id])).rows[0].is_archived,true);
        assert.equal((await request(staff.admin,'PATCH',{title:'Removed'},`/${shared.id}`)).status,404);
    });
});
