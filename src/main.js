import './style.css';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const KEY = 'mediketh-v1';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const starter = { products: [], logs: {} };
let state = load();
let activeTab = 'Today';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved && Array.isArray(saved.products) ? saved : starter;
  } catch { return starter; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function logForDay(day = today()) { state.logs[day] ||= {}; return state.logs[day]; }
function isDone(id, day = today()) { return Boolean(logForDay(day)[id]?.confirmed); }
function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function render() {
  const done = state.products.filter(p => isDone(p.id)).length;
  const total = state.products.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.querySelector('#app').innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#"><span class="brand-mark">m</span><span>mediketh</span></a>
        <span class="date-pill">${new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</span>
      </header>
      <main>
        <section class="hero">
          <div class="eyebrow"><span class="pulse"></span> YOUR DAILY COMPANION</div>
          <h1>Small steps.<br><em>Better days.</em></h1>
          <p>Your medicine and skincare routine, in one calm place.</p>
          <div class="progress-wrap">
            <div class="progress-copy"><span>Today's progress</span><strong>${done} of ${total} completed</strong></div>
            <div class="track"><span style="width:${pct}%"></span></div>
          </div>
        </section>
        <nav class="tabs">${['Today','Routine','History'].map(t=>`<button class="tab ${activeTab===t?'active':''}" data-tab="${t}">${t}</button>`).join('')}</nav>
        <section id="view"></section>
        <button class="reminder-setup" id="reminders">Enable daily notifications</button>
      </main>
      <footer><span>MEDIKETH</span><span>Built for consistency, not perfection.</span></footer>
    </div>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{activeTab=b.dataset.tab;render();}));
  document.querySelector('#reminders').addEventListener('click', enableReminders);
  renderView();
}
function renderView() {
  const view = document.querySelector('#view');
  if (activeTab === 'Today') {
    view.innerHTML = `
      <div class="section-heading"><div><div class="eyebrow muted">YOUR PLAN</div><h2>Today's routine</h2></div><button class="text-button" id="add">+ Add item</button></div>
      ${state.products.length ? state.products.map(p=>`
        <article class="routine-card ${isDone(p.id)?'completed':''}">
          <div class="item-icon">${p.kind==='Skincare'?'✧':'✚'}</div>
          <div class="item-copy"><strong>${esc(p.name)}</strong><span>${esc(p.kind)} · ${p.time}</span></div>
          <button class="check-button" data-confirm="${p.id}" aria-label="Confirm ${esc(p.name)}">${isDone(p.id)?'✓':'○'}</button>
        </article>`).join('') : '<div class="empty">Your routine starts with one small step. Add your first item.</div>'}
      <div class="note"><span>✦</span><p><strong>Take your time.</strong> Confirm any time today. A photo cannot prove that a medicine was taken or a product applied, so Mediketh asks you to confirm it yourself.</p></div>`;
    document.querySelector('#add').addEventListener('click',addProduct);
    document.querySelectorAll('[data-confirm]').forEach(b=>b.addEventListener('click',()=>confirmProduct(b.dataset.confirm)));
  } else if (activeTab === 'Routine') {
    view.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted">YOUR ITEMS</div><h2>Manage routine</h2></div><button class="text-button" id="add">+ Add item</button></div>
      ${state.products.map(p=>`<article class="routine-card"><div class="item-icon">${p.kind==='Skincare'?'✧':'✚'}</div><div class="item-copy"><strong>${esc(p.name)}</strong><span>${esc(p.kind)} · ${p.time}</span></div><button class="remove-button" data-remove="${p.id}">×</button></article>`).join('') || '<div class="empty">No routine items yet.</div>'}`;
    document.querySelector('#add').addEventListener('click',addProduct);
    document.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{state.products=state.products.filter(p=>p.id!==b.dataset.remove);save();render();}));
  } else {
    const entries=Object.entries(state.logs).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,30);
    view.innerHTML=`<div class="section-heading"><div><div class="eyebrow muted">YOUR ACTIVITY</div><h2>Recent history</h2></div></div>
      ${entries.length?entries.map(([day,items])=>{const count=Object.values(items).filter(x=>x.confirmed).length;return `<article class="history-row"><div><strong>${new Date(day+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</strong><span>${count} confirmations</span></div><span class="history-count">${count} / ${state.products.length}</span></article>`;}).join(''):'<div class="empty">Your confirmations will appear here.</div>'}`;
  }
}
function addProduct() {
  const name=prompt('Medicine or skincare product name?');
  if(!name?.trim()) return;
  const kind=prompt('Type "Medicine" or "Skincare"','Medicine')||'Medicine';
  const time=prompt('Reminder time (24-hour HH:MM)','08:00')||'08:00';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){alert('Enter a valid time, e.g. 08:30.');return;}
  state.products.push({id:crypto.randomUUID(),name:name.trim(),kind:kind.toLowerCase().startsWith('skin')?'Skincare':'Medicine',time});
  save();render();
}
function confirmProduct(id) {
  const p=state.products.find(x=>x.id===id);
  if(!p) return;
  if(!confirm(`Please confirm: did you actually use "${p.name}" today, following your prescribed or label directions?`)) return;
  logForDay()[id]={confirmed:true,at:new Date().toISOString()};
  save();render();
}
async function enableReminders() {
  if(!Capacitor.isNativePlatform()){alert('Install the Android app to enable device notifications.');return;}
  const permission=await LocalNotifications.requestPermissions();
  if(permission.display!=='granted'){alert('Notification permission was not granted.');return;}
  const notifications=state.products.map((p,i)=>{
    const [hour,minute]=p.time.split(':').map(Number);
    return {id:1000+i,title:'Mediketh reminder',body:`Time for your routine: ${p.name}`,schedule:{on:{hour,minute},allowWhileIdle:true}};
  });
  await LocalNotifications.cancel({notifications:state.products.map((_,i)=>({id:1000+i}))});
  if(notifications.length) await LocalNotifications.schedule({notifications});
  alert('Daily reminders scheduled on this device.');
}
render();
