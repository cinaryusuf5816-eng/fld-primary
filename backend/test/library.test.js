const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { hashPassword } = require('../auth/passwords');
const { digest } = require('../auth/middleware');
const { testDatabase } = require('./database');

test('material library stores private files and enforces grade and management permissions', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'fld-library-test-'));
    t.after(async () => {
        const resolved = await fs.realpath(directory); const temporaryRoot = await fs.realpath(os.tmpdir());
        assert.equal(path.dirname(resolved),temporaryRoot);
        assert.ok(path.basename(resolved).startsWith('fld-library-test-'));
        await fs.rm(resolved,{recursive:true,force:true});
    });
    const database = await testDatabase(); const { pool } = database;
    t.after(() => database.close()); await migrate(pool);
    const config = readConfig({APP_ORIGINS:'http://localhost:5500',MATERIAL_STORAGE_DIR:directory});
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    const staff = {};
    for (const [key,role,grades] of [['admin','admin',[]],['coordinator','coordinator',[]],['grade3','teacher',['Grade 3']],['grade4','teacher',['Grade 4']],['shared','teacher',[]]]) {
        const id = (await pool.query('INSERT INTO users(email,full_name,password_hash,role,grades) VALUES($1,$2,$3,$4,$5) RETURNING id',[`${key}@library.test`,key,passwordHash,role,grades])).rows[0].id;
        const token = randomBytes(32).toString('hex');
        await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')",[id,digest(token)]);
        staff[key]={id,cookie:`${config.cookieName}=${token}`};
    }
    const server = createApp({pool,config}).listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(() => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url,user=staff.admin,method='GET',body) {
        const response = await fetch(base+url,{method,redirect:'manual',headers:{Origin:'http://localhost:5500',...(user ? {Cookie:user.cookie} : {}),...(body!==undefined ? {'Content-Type':'application/json'} : {})},...(body!==undefined ? {body:JSON.stringify(body)} : {})});
        const bytes=Buffer.from(await response.arrayBuffer());
        let data; try {data=JSON.parse(bytes.toString('utf8'));} catch {data=null;}
        return {status:response.status,data,bytes,headers:response.headers};
    }
    const link = overrides => ({title:'Reusable link',kind:'link',url:'https://example.org/lesson',category:'Worksheet',unit:'Unit 1',description:'Teaching resource',grades:[],...overrides});
    const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    const textBytes=Buffer.from('Classroom notes: read chapter one.\n','utf8');
    const upload = (bytes,file_name,overrides={}) => ({title:file_name,kind:'file',file_name,content_base64:bytes.toString('base64'),grades:['Grade 3'],category:'Worksheet',...overrides});
    let pdf,txt,shared,grade4;
    await t.test('file uploads persist bytes privately and downloads use safe attachment headers',async () => {
        const created = await request('/api/materials',staff.admin,'POST',upload(pdfBytes,'practice.pdf'));
        assert.equal(created.status,201);pdf=created.data.material;
        assert.equal(pdf.kind,'file');assert.equal(pdf.file_size,pdfBytes.length);assert.ok(!('storage_key' in pdf));
        assert.equal((await request(`/api/materials/${pdf.id}`,staff.grade3)).status,200);
        const downloaded=await request(`/api/materials/${pdf.id}/download`,staff.grade3);
        assert.equal(downloaded.status,200);assert.deepEqual(downloaded.bytes,pdfBytes);
        assert.match(downloaded.headers.get('content-disposition'),/^attachment;.*practice\.pdf/);
        assert.match(downloaded.headers.get('content-type'),/^application\/pdf/);
        assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
        assert.match(downloaded.headers.get('content-security-policy'),/sandbox/);
        assert.equal(downloaded.headers.get('cache-control'),'no-store');
        const stored = await fs.readdir(directory);assert.equal(stored.length,1);assert.match(stored[0],/^[a-f0-9]{64}\.bin$/);
        assert.deepEqual(await fs.readFile(path.join(directory,stored[0])),pdfBytes);
        assert.equal((await request(`/backend/.local-materials/${stored[0]}`,staff.admin)).status,404);
    });
    await t.test('anonymous and unrelated-grade readers cannot obtain file metadata or bytes',async () => {
        for(const url of ['/api/materials',`/api/materials/${pdf.id}`,`/api/materials/${pdf.id}/download`]) assert.equal((await request(url,null)).status,401);
        for(const user of [staff.grade4,staff.shared]) {
            assert.equal((await request(`/api/materials/${pdf.id}`,user)).status,404);
            assert.equal((await request(`/api/materials/${pdf.id}/download`,user)).status,404);
            assert.equal((await request('/api/materials',user)).data.materials.length,0);
        }
    });
    await t.test('teachers can create files and links only for assigned grades',async () => {
        const own=await request('/api/materials',staff.grade3,'POST',upload(textBytes,'notes.txt'));
        assert.equal(own.status,201);txt=own.data.material;assert.equal(String(txt.created_by),String(staff.grade3.id));
        const downloaded=await request(`/api/materials/${txt.id}/download`,staff.grade3);assert.equal(downloaded.status,200);assert.deepEqual(downloaded.bytes,textBytes);assert.match(downloaded.headers.get('content-type'),/^text\/plain/);
        assert.equal((await request('/api/materials',staff.grade3,'POST',link({grades:['Grade 3']}))).status,201);
        for(const grades of [[],['Grade 4'],['Grade 3','Grade 4']]) assert.equal((await request('/api/materials',staff.grade3,'POST',link({grades}))).status,403);
        assert.equal((await request('/api/materials',staff.shared,'POST',link())).status,403);
        const createdShared=await request('/api/materials',staff.coordinator,'POST',link({title:'Shared library link'}));assert.equal(createdShared.status,201);shared=createdShared.data.material;
        const other=await request('/api/materials',staff.admin,'POST',link({title:'Grade 4 link',grades:['Grade 4']}));assert.equal(other.status,201);grade4=other.data.material;
        assert.equal((await request(`/api/materials/${shared.id}`,staff.shared)).status,200);
        const visible=(await request('/api/materials',staff.grade3)).data.materials;
        assert.ok(visible.some(item=>String(item.id)===String(shared.id)));assert.ok(!visible.some(item=>String(item.id)===String(grade4.id)));
    });
    await t.test('only admins and coordinators can edit or archive; audience is immutable and archived files remain available',async () => {
        for(const id of [txt.id,pdf.id]) for(const body of [{title:'Not permitted'},{is_archived:true}]) assert.equal((await request(`/api/materials/${id}`,staff.grade3,'PATCH',body)).status,403);
        assert.equal((await request(`/api/materials/${pdf.id}`,staff.admin,'PATCH',{grades:['Grade 4']})).status,400);
        const edited=await request(`/api/materials/${pdf.id}`,staff.coordinator,'PATCH',{title:'Updated practice',unit:'Unit 2'});assert.equal(edited.status,200);assert.equal(edited.data.material.title,'Updated practice');
        assert.equal((await request(`/api/materials/${pdf.id}`,staff.grade3)).data.material.unit,'Unit 2');
        assert.equal((await request(`/api/materials/${pdf.id}`,staff.admin,'PATCH',{is_archived:true})).status,200);
        assert.ok(!(await request('/api/materials',staff.grade3)).data.materials.some(item=>String(item.id)===String(pdf.id)));
        assert.ok((await request('/api/materials?include_archived=true',staff.grade3)).data.materials.some(item=>String(item.id)===String(pdf.id)));
        const oldDownload=await request(`/api/materials/${pdf.id}/download`,staff.grade3);assert.equal(oldDownload.status,200);assert.deepEqual(oldDownload.bytes,pdfBytes);
    });
    await t.test('invalid files, path names and unsafe links do not create records or stored files',async () => {
        const before=(await request('/api/materials?include_archived=true')).data.materials.length;
        const diskBefore=(await fs.readdir(directory)).sort();
        for(const body of [
            upload(textBytes,'program.exe'),upload(textBytes,'fake.pdf'),upload(pdfBytes,'../escape.pdf'),upload(pdfBytes,'..\\escape.pdf'),upload(pdfBytes,'bad\nname.pdf'),
            {...upload(pdfBytes,'bad.pdf'),content_base64:'not base64!'}, {...upload(pdfBytes,'bad.pdf'),content_base64:'Zg='}, {...upload(pdfBytes,'bad.pdf'),content_base64:''},
            link({url:'javascript:alert(1)'}),link({url:'http://example.org/resource'}),link({url:'https://name:secret@example.org/resource'}),link({kind:'file',file_name:'mixed.txt',content_base64:textBytes.toString('base64')}),
            link({grades:['Grade 3','Grade 3']}),link({created_by:staff.grade3.id})
        ]) assert.equal((await request('/api/materials',staff.admin,'POST',body)).status,400);
        assert.equal((await request('/api/materials?include_archived=true')).data.materials.length,before);
        assert.deepEqual((await fs.readdir(directory)).sort(),diskBefore);
    });
    await t.test('shared material usage lists never disclose another teaching grade',async () => {
        const eventIds={},homeworkIds={};
        for(const grade of ['Grade 3','Grade 4']) {
            const event=await request('/api/events',staff.admin,'POST',{title:`${grade} event`,startDate:'2026-10-01',endDate:'2026-10-01',category:'activity',grades:[grade],material_ids:[shared.id]});
            assert.equal(event.status,201);eventIds[grade]=event.data.id;
            const homework=await request('/api/homework',staff.admin,'POST',{title:`${grade} homework`,grade,class_name:'A',assign_date:'2026-09-01',due_date:'2026-09-10',material_ids:[shared.id]});
            assert.equal(homework.status,201);homeworkIds[grade]=homework.data.homework.id;
        }
        for(const [user,grade] of [[staff.grade3,'Grade 3'],[staff.grade4,'Grade 4']]) {
            const detail=(await request(`/api/materials/${shared.id}`,user)).data;
            assert.deepEqual(detail.used_in.events.map(item=>String(item.id)),[String(eventIds[grade])]);
            assert.deepEqual(detail.used_in.homework.map(item=>String(item.id)),[String(homeworkIds[grade])]);
        }
        const empty=(await request(`/api/materials/${shared.id}`,staff.shared)).data;assert.deepEqual(empty.used_in.events,[]);assert.deepEqual(empty.used_in.homework,[]);
        const all=(await request(`/api/materials/${shared.id}`,staff.coordinator)).data;assert.equal(all.used_in.events.length,2);assert.equal(all.used_in.homework.length,2);
    });
});
