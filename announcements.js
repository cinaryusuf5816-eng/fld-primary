(() => {
    'use strict';
    const $=id=>document.getElementById(id), grades=['Grade 1','Grade 2','Grade 3','Grade 4'];
    const dialog=$('notice-dialog'), form=$('notice-form');
    let user, items=[], editing=null, busy=false;
    function el(tag,text,cls) { const x=document.createElement(tag); if(text!=null)x.textContent=text;if(cls)x.className=cls;return x; }
    function button(text,cls,action) { const x=el('button',text,cls);x.type='button';x.addEventListener('click',action);return x; }
    function dateLabel(value) { return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00')); }
    function today() { const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(t=>p.find(x=>x.type===t).value).join('-'); }
    function audience(item) {return item.grades.length?item.grades.join(' · '):'All staff';}
    function syncAudience() {$('notice-grades').querySelectorAll('input').forEach(x=>{x.disabled=$('notice-shared').checked;});}
    function show() {if(!dialog.open)dialog.showModal();}
    function close() {if(!busy)dialog.close();}
    async function load(openRequested=false) {
        $('notice-status').textContent='Loading announcements…';
        try {
            items=(await window.FldAuth.request('/api/announcements')).announcements;render();
            if(openRequested) {const id=new URLSearchParams(location.search).get('announcement');if(id){const item=items.find(x=>String(x.id)===id);if(item)detail(item);else $('notice-status').textContent='This announcement is no longer available.';}}
        } catch(error) {$('notice-status').textContent=error.message;$('notice-status').append(' ',button('Try again','notice-secondary',()=>load(openRequested)));}
    }
    function actions(item) {
        const row=el('div',null,'notice-actions');
        row.append(button('Read announcement','notice-secondary',()=>detail(item)));
        if(user.role==='admin') row.append(button('Edit','notice-secondary',()=>edit(item)),button('Remove','notice-danger',()=>remove(item)));
        return row;
    }
    function render() {
        const q=$('notice-search').value.trim().toLowerCase(), type=$('notice-filter').value, grade=$('notice-grade').value;
        const visible=items.filter(x=>(!q||`${x.title} ${x.description}`.toLowerCase().includes(q))&&(!type||x.category===type)&&(!grade||(grade==='Shared'?!x.grades.length:!x.grades.length||x.grades.includes(grade))));
        $('notice-list').replaceChildren();$('notice-status').textContent=visible.length?`${visible.length} announcement${visible.length===1?'':'s'}`:items.length?'No announcements match your filters.':'No announcements yet. School updates will appear here.';
        visible.forEach(item=>{const card=el('article',null,'notice-card');card.dataset.category=item.category;const meta=el('div',null,'notice-meta');meta.append(el('span',item.category,'notice-badge'),el('span',dateLabel(item.date)),el('span',audience(item)));const heading=el('h2');heading.append(button(item.title,'notice-title-button',()=>detail(item)));card.append(meta,heading,el('p',item.description,'notice-excerpt'),actions(item));$('notice-list').append(card);});
    }
    function detail(item) {
        editing=null;form.hidden=true;$('notice-detail').hidden=false;$('notice-heading').textContent=item.title;
        $('notice-detail').replaceChildren(el('p',`${item.category} · ${dateLabel(item.date)} · ${audience(item)}`,'notice-meta'),el('p',item.description,'notice-message'));
        if(user.role==='admin'){const row=el('div',null,'notice-actions');row.append(button('Edit announcement','notice-secondary',()=>edit(item)),button('Remove','notice-danger',()=>remove(item)));$('notice-detail').append(row);}show();
    }
    function edit(item) {
        if(user.role!=='admin'||busy)return;
        editing=item?.id||null;form.reset();form.hidden=false;$('notice-detail').hidden=true;
        $('notice-heading').textContent=item?'Edit announcement':'New announcement';$('notice-title').value=item?.title||'';$('notice-message').value=item?.description||'';$('notice-type').value=item?.category||'General';$('notice-date').value=item?.date||today();$('notice-shared').checked=!item?.grades.length;
        $('notice-grades').querySelectorAll('input').forEach(x=>{x.checked=!!item?.grades.includes(x.value);});syncAudience();$('notice-error').textContent='';$('notice-save').textContent=item?'Save changes':'Publish announcement';show();$('notice-title').focus();
    }
    async function remove(item) {
        if(user.role!=='admin'||busy)return;
        if(!(await window.FldConfirm.ask({title:'Are you sure?',message:`Remove “${item.title}”? It will no longer appear in announcements or notifications for staff.`,confirmLabel:'Remove announcement',danger:true})))return;
        if(user.role!=='admin'||busy)return;
        busy=true;
        try{await window.FldAuth.request(`/api/announcements/${item.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_archived:true})});dialog.close();window.dispatchEvent(new Event('fld:announcementschange'));await load();}
        catch(error){if(dialog.open)alert(error.message);else $('notice-status').textContent=error.message;}finally{busy=false;}
    }
    form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy||user?.role!=='admin')return;
        const selected=$('notice-shared').checked?[]:Array.from($('notice-grades').querySelectorAll('input:checked'),x=>x.value);
        if(!$('notice-shared').checked&&!selected.length){$('notice-error').textContent='Select at least one grade, or choose All staff.';return;}
        const body={title:$('notice-title').value.trim(),description:$('notice-message').value.trim(),category:$('notice-type').value,date:$('notice-date').value,grades:selected};
        busy=true;$('notice-save').disabled=true;$('notice-error').textContent='';
        try{await window.FldAuth.request(editing?`/api/announcements/${editing}`:'/api/announcements',{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});dialog.close();window.dispatchEvent(new Event('fld:announcementschange'));await load();}
        catch(error){$('notice-error').textContent=error.message;}finally{busy=false;$('notice-save').disabled=false;}
    });
    $('notice-close').addEventListener('click',close);$('notice-cancel').addEventListener('click',close);dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});$('notice-add').addEventListener('click',()=>edit());$('notice-shared').addEventListener('change',syncAudience);
    for(const id of ['notice-search','notice-filter','notice-grade'])$(id).addEventListener(id==='notice-search'?'input':'change',render);
    window.FldAuth.ready.then(async account=>{if(!account)return;user=account;for(const grade of(user.role==='teacher'?user.grades||[]:grades))$('notice-grade').add(new Option(grade,grade));grades.forEach(grade=>{const label=el('label',null,'notice-check'),input=el('input');input.type='checkbox';input.value=grade;label.append(input,grade);$('notice-grades').append(label);});syncAudience();await load(true);});
})();
