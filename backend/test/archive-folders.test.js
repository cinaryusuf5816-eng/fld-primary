const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin, createUser } = require('../auth/users');
const { testDatabase } = require('./database');

test('Archive folders organize records without widening file permissions or breaking links', async t => {
  const database = await testDatabase();
  const { pool } = database;
  t.after(() => database.close());
  await migrate(pool);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fld-folder-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('fld-folder-test-'));
    await fs.rm(directory, {recursive:true, force:true});
  });
  const password = randomBytes(24).toString('hex');
  const admin = await createInitialAdmin(pool, {email:'folder-admin@example.test',full_name:'Admin',password});
  const teacher = await createUser(pool, admin.id, {email:'folder-teacher@example.test',full_name:'Teacher',password,role:'teacher',grades:['Grade 3']});
  const coordinator = await createUser(pool, admin.id, {email:'folder-coordinator@example.test',full_name:'Coordinator',password,role:'coordinator'});
  const config = readConfig({APP_ORIGINS:'http://localhost:5500',MATERIAL_STORAGE_DIR:directory});
  const server = createApp({pool,config}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise(resolve => {server.close(resolve);server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, user=admin, method='GET', body, origin='http://localhost:5500') {
    const response = await fetch(base+route,{method,headers:{Origin:origin,...(user?.cookie?{Cookie:user.cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const text=await response.text(); let data; try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,text,headers:response.headers};
  }
  for(const user of [admin,teacher,coordinator]) {
    const result=await request('/api/auth/login',null,'POST',{email:user.email,password});
    assert.equal(result.status,200); user.cookie=result.headers.get('set-cookie').split(';')[0];
  }
  async function folder(name,fields={},user=admin) {
    const result=await request('/api/archive/folders',user,'POST',{name,parent_id:null,visibility:'shared',grades:[],...fields});
    assert.equal(result.status,201,result.text);return result.data.folder;
  }
  async function record(title,fields={},user=admin) {
    const result=await request('/api/archive',user,'POST',{title,kind:'file',file_name:'sample.txt',content_base64:Buffer.from('Sample '+title).toString('base64'),review_status:'approved',...fields});
    assert.equal(result.status,201,result.text);return result.data.material;
  }
  const shared=await folder('School records');
  const g3=await folder('Grade 3',{visibility:'grades',grades:['Grade 3']});
  const g4=await folder('Grade 4',{visibility:'grades',grades:['Grade 4']});
  const management=await folder('Management',{visibility:'management'});
  const childResult=await request('/api/archive/folders',admin,'POST',{name:'Unit 1',parent_id:g3.id});
  assert.equal(childResult.status,201,childResult.text);const child=childResult.data.folder;
  const sharedRecord=await record('Shared handbook',{visibility:'shared'});
  const gradeRecord=await record('Reading worksheet',{visibility:'grades',grades:['Grade 3']});
  const privateRecord=await record('Private report',{visibility:'management',folder_id:shared.id});
  const pendingRecord=await record('Unapproved draft',{visibility:'grades',grades:['Grade 3'],review_status:'needs_review',folder_id:shared.id});

  await t.test('folder routes require authentication and enforce manager-only mutations',async()=>{
    for(const url of ['/api/archive/folders','/api/archive?folder=root',`/api/archive/folders/${g3.id}`]) assert.equal((await request(url,null)).status,401);
    assert.equal((await request('/api/archive/folders',teacher,'POST',{name:'Denied'})).status,403);
    assert.equal((await request(`/api/archive/folders/${g3.id}`,teacher,'PATCH',{name:'Denied'})).status,403);
    assert.equal((await request('/api/archive/move',teacher,'POST',{ids:[gradeRecord.id],folder_id:g3.id})).status,403);
    assert.equal((await request('/api/archive/folders',admin,'POST',{name:'Denied'},'https://evil.test')).status,403);
  });
  await t.test('root folders and deep links respect grade scopes including empty folders',async()=>{
    const listed=await request('/api/archive?folder=root',teacher);
    assert.equal(listed.status,200,listed.text);
    assert.deepEqual(listed.data.folders.map(item=>item.name).sort(),['Grade 3','School records']);
    for(const restricted of [g4,management]) {
      assert.equal((await request(`/api/archive?folder=${restricted.id}`,teacher)).status,404);
      assert.equal((await request(`/api/archive/folders/${restricted.id}`,teacher)).status,404);
    }
    assert.equal(child.visibility,'grades');assert.deepEqual(child.grades,['Grade 3']);
    const nested=await request(`/api/archive?folder=${child.id}`,teacher);
    assert.equal(nested.status,200,nested.text);
    assert.deepEqual(nested.data.breadcrumbs.map(item=>item.name),['Grade 3','Unit 1']);
    assert.equal((await request('/api/archive?folder=999999',teacher)).status,404);
  });
  await t.test('moving files is atomic and rejects incompatible destinations',async()=>{
    const failed=await request('/api/archive/move',coordinator,'POST',{ids:[gradeRecord.id,sharedRecord.id],folder_id:child.id});
    assert.equal(failed.status,409,failed.text);
    assert.equal((await request(`/api/archive/${gradeRecord.id}`)).data.material.folder_id,null);
    const moved=await request('/api/archive/move',coordinator,'POST',{ids:[gradeRecord.id],folder_id:child.id});
    assert.equal(moved.status,200,moved.text);
    const listing=await request(`/api/archive?folder=${child.id}`,teacher);
    assert.deepEqual(listing.data.items.map(item=>String(item.id)),[String(gradeRecord.id)]);
    assert.equal((await request('/api/archive?folder=root',teacher)).data.items.some(item=>String(item.id)===String(gradeRecord.id)),false);
    const missing=await request('/api/archive/move',admin,'POST',{ids:[gradeRecord.id,'999999'],folder_id:null});
    assert.equal(missing.status,404);assert.equal(String((await request(`/api/archive/${gradeRecord.id}`)).data.material.folder_id),String(child.id));
  });
  await t.test('file downloads and homework links survive folder placement',async()=>{
    const today=(await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS day")).rows[0].day;
    const homework=await request('/api/homework',admin,'POST',{title:'Folder linked homework',grade:'Grade 3',class_name:'A',assign_date:today,due_date:today,material_ids:[gradeRecord.id]});
    assert.equal(homework.status,201,homework.text);
    const detail=await request(`/api/archive/${gradeRecord.id}`,teacher);
    assert.ok(detail.data.used_in.homework.some(item=>String(item.id)===String(homework.data.homework.id)));
    assert.equal((await request(`/api/materials/${gradeRecord.id}/download`,teacher)).text,'Sample Reading worksheet');
    for(const item of [privateRecord,pendingRecord])assert.equal((await request(`/api/materials/${item.id}/download`,teacher)).status,404);
    const visible=await request(`/api/archive?folder=${shared.id}`,teacher);
    assert.equal(visible.data.total,0);assert.deepEqual(visible.data.items,[]);
  });
  await t.test('single and bulk metadata changes cannot violate containing folder scope',async()=>{
    const single=await request(`/api/archive/${gradeRecord.id}`,admin,'PATCH',{visibility:'shared',grades:[]});
    assert.equal(single.status,409,single.text);
    const bulk=await request('/api/archive/bulk',admin,'POST',{ids:[sharedRecord.id,gradeRecord.id],changes:{academic_year:'2027-2028',visibility:'shared',grades:[]}});
    assert.equal(bulk.status,409,bulk.text);
    assert.equal((await request(`/api/archive/${sharedRecord.id}`)).data.material.academic_year,'');
    assert.deepEqual((await request(`/api/archive/${gradeRecord.id}`)).data.material.grades,['Grade 3']);
  });
  await t.test('teacher upload destination keeps grade restrictions and preserves folder contents',async()=>{
    const uploaded=await record('Teacher addition',{grades:['Grade 3'],folder_id:child.id},teacher);
    assert.equal(String(uploaded.folder_id),String(child.id));
    const failed=await request('/api/archive',teacher,'POST',{title:'Denied upload',kind:'link',url:'https://example.test/resource',grades:['Grade 3'],folder_id:g4.id});
    assert.equal(failed.status,404,failed.text);
    assert.equal((await request(`/api/archive?folder=${child.id}`,teacher)).data.total,2);
  });
  await t.test('global search retains nested file paths and never leaks private records',async()=>{
    const result=await request('/api/archive?folder=root&q=Reading',teacher);
    assert.equal(result.status,200,result.text);assert.equal(result.data.total,1);
    assert.deepEqual(result.data.items[0].folder_path.map(item=>item.name),['Grade 3','Unit 1']);
    assert.equal((await request('/api/archive?q=Private',teacher)).data.total,0);
    assert.equal((await request('/api/archive',teacher)).data.items.some(item=>String(item.id)===String(gradeRecord.id)),true);
  });
  await t.test('folder names are normalized, duplicate siblings blocked and scopes immutable',async()=>{
    assert.equal((await request('/api/archive/folders',admin,'POST',{name:' grade 3 ',parent_id:null,visibility:'grades',grades:['Grade 3']})).status,409);
    const rename=await request(`/api/archive/folders/${g3.id}`,coordinator,'PATCH',{name:'Grade 3 resources'});
    assert.equal(rename.status,200,rename.text);
    const nested=await request(`/api/archive?folder=${child.id}`,teacher);
    assert.equal(nested.data.breadcrumbs[0].name,'Grade 3 resources');
    for(const body of [{name:'Bad/name'},{name:'..'},{name:''},{name:'Bad',parent_id:child.id},{visibility:'shared',grades:[]}])assert.equal((await request(`/api/archive/folders/${g3.id}`,admin,'PATCH',body)).status,400);
    for(const query of ['folder=0','folder=-1','folder=1&folder=2','folder=9223372036854775808'])assert.equal((await request('/api/archive?'+query,admin)).status,400);
  });
  await t.test('nested folders have a bounded depth and IDs retain full PostgreSQL precision',async()=>{
    let parent=child;
    for(let depth=3;depth<=8;depth++) {
      const result=await request('/api/archive/folders',admin,'POST',{name:`Level ${depth}`,parent_id:parent.id});
      assert.equal(result.status,201,result.text); parent=result.data.folder;
    }
    assert.equal((await request('/api/archive/folders',admin,'POST',{name:'Too deep',parent_id:parent.id})).status,400);
    const largeId='9223372036854775800';
    await pool.query('INSERT INTO archive_folders(id,name,visibility) VALUES($1,$2,$3)',[largeId,'Precise ID folder','shared']);
    const listing=await request(`/api/archive?folder=${largeId}`,teacher);
    assert.equal(listing.status,200,listing.text);assert.equal(listing.data.current_folder.id,largeId);
    assert.equal(listing.data.breadcrumbs[0].id,largeId);
    const returned=await request('/api/archive/move',admin,'POST',{ids:[sharedRecord.id],folder_id:largeId});
    assert.equal(returned.status,200,returned.text);assert.equal(returned.data.folder_id,largeId);
    assert.equal(String((await request(`/api/archive/${sharedRecord.id}`)).data.material.folder_id),largeId);
  });
});
