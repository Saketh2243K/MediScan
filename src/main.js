import './style.css';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const KEY = 'mediketh-v1';
const ROUTINE_SNAPSHOT_KEY = '_routine';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const starter = { products: [], logs: {}, remindersEnabled: false, needsLegacyNotificationCleanup: false };
let state = load();
let activeTab = 'Today';
let legacyCleanupPromise = Promise.resolve();

function notificationIdFor(productId, usedIds) {
  let hash = 2166136261;
  for (const char of productId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let id = (hash >>> 0) % 2147483646 + 1;
  while (usedIds.has(id)) id = id === 2147483647 ? 1 : id + 1;
  usedIds.add(id);
  return id;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || !Array.isArray(saved.products)) return starter;
    const usedIds = new Set();
    const products = saved.products
      .filter(product => product && typeof product.id === 'string' && typeof product.name === 'string')
      .map(product => {
        let notificationId = product.notificationId;
        if (!Number.isInteger(notificationId) || notificationId < 1 || notificationId > 2147483647 || usedIds.has(notificationId)) {
          notificationId = notificationIdFor(product.id, usedIds);
        } else {
          usedIds.add(notificationId);
        }
        return {
          ...product,
          name: product.name.trim(),
          kind: product.kind === 'Skincare' ? 'Skincare' : 'Medicine',
          time: /^([01]\d|2[0-3]):[0-5]\d$/.test(product.time) ? product.time : '08:00',
          notificationId
        };
      });
    const logs = saved.logs && typeof saved.logs === 'object' && !Array.isArray(saved.logs)
      ? saved.logs
      : {};
    return {
      ...saved,
      products,
      logs,
      remindersEnabled: saved.remindersEnabled === true,
      needsLegacyNotificationCleanup: saved.remindersEnabled === undefined
    };
  } catch {
    return starter;
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    throw new Error('Your changes could not be saved on this device. Check available storage and try again.');
  }
}

function dayLog(day = today()) {
  return state.logs[day] || {};
}

function isDone(id, day = today()) {
  return Boolean(dayLog(day)[id]?.confirmed);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function render() {
  const done = state.products.filter(product => isDone(product.id)).length;
  const total = state.products.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.querySelector('#app').innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#"><span class="brand-mark">m</span><span>mediketh</span></a>
        <span class="date-pill">${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </header>
      <main>
        <section class="hero">
          <div class="eyebrow"><span class="pulse"></span> YOUR DAILY COMPANION</div>
          <h1>Small steps.<br><em>Better days.</em></h1>
          <p>Your medicine and skincare routine, in one calm place.</p>
          <div class="progress-wrap">
            <div class="progress-copy"><span>Today's progress</span><strong>${done} of ${total} completed</strong></div>
            <div class="track" role="progressbar" aria-label="Today's routine progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          </div>
        </section>
        <nav class="tabs" aria-label="Main navigation">${['Today', 'Routine', 'History'].map(tab => `<button class="tab ${activeTab === tab ? 'active' : ''}" data-tab="${tab}" ${activeTab === tab ? 'aria-current="page"' : ''}>${tab}</button>`).join('')}</nav>
        <section id="view"></section>
        <div class="reminder-actions">
          <button class="reminder-setup" id="reminders">${state.remindersEnabled ? 'Refresh daily notifications' : 'Enable daily notifications'}</button>
          ${state.remindersEnabled ? '<button class="reminder-disable" id="reminders-off">Turn off notifications</button>' : ''}
        </div>
      </main>
      <footer><span>MEDIKETH</span><span>Built for consistency, not perfection.</span></footer>
    </div>`;
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    render();
  }));
  document.querySelector('#reminders').addEventListener('click', toggleReminders);
  document.querySelector('#reminders-off')?.addEventListener('click', disableReminders);
  renderView();
}

function renderView() {
  const view = document.querySelector('#view');
  if (activeTab === 'Today') {
    view.innerHTML = `
      <div class="section-heading"><div><div class="eyebrow muted">YOUR PLAN</div><h2>Today's routine</h2></div><button class="text-button" id="add">+ Add item</button></div>
      ${state.products.length ? state.products.map(product => `
        <article class="routine-card ${isDone(product.id) ? 'completed' : ''}">
          <div class="item-icon" aria-hidden="true">${product.kind === 'Skincare' ? '✧' : '✚'}</div>
          <div class="item-copy"><strong>${esc(product.name)}</strong><span>${esc(product.kind)} · ${esc(product.time)}</span></div>
          <button class="check-button" data-confirm="${esc(product.id)}" aria-label="${isDone(product.id) ? 'Undo confirmation for' : 'Confirm'} ${esc(product.name)}">${isDone(product.id) ? '✓' : '○'}</button>
        </article>`).join('') : '<div class="empty">Your routine starts with one small step. Add your first item.</div>'}
      <div class="note"><span aria-hidden="true">✦</span><p><strong>Take your time.</strong> Confirm any time today. A photo cannot prove that a medicine was taken or a product applied, so Mediketh asks you to confirm it yourself.</p></div>`;
    document.querySelector('#add').addEventListener('click', () => openProductForm());
    document.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', () => confirmProduct(button.dataset.confirm)));
  } else if (activeTab === 'Routine') {
    view.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted">YOUR ITEMS</div><h2>Manage routine</h2></div><button class="text-button" id="add">+ Add item</button></div>
      ${state.products.map(product => `<article class="routine-card"><div class="item-icon" aria-hidden="true">${product.kind === 'Skincare' ? '✧' : '✚'}</div><div class="item-copy"><strong>${esc(product.name)}</strong><span>${esc(product.kind)} · ${esc(product.time)}</span></div><button class="edit-button" data-edit="${esc(product.id)}" aria-label="Edit ${esc(product.name)}">Edit</button><button class="remove-button" data-remove="${esc(product.id)}" aria-label="Remove ${esc(product.name)}">×</button></article>`).join('') || '<div class="empty">No routine items yet.</div>'}`;
    document.querySelector('#add').addEventListener('click', () => openProductForm());
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openProductForm(button.dataset.edit)));
    document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => confirmRemove(button.dataset.remove)));
  } else {
    const entries = Object.entries(state.logs)
      .filter(([, log]) => log && typeof log === 'object' && Object.keys(log).some(key => key !== ROUTINE_SNAPSHOT_KEY && log[key]?.confirmed))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 30);
    view.innerHTML = `<div class="section-heading"><div><div class="eyebrow muted">YOUR ACTIVITY</div><h2>Recent history</h2></div></div>
      ${entries.length ? entries.map(([day, log]) => {
        const count = Object.entries(log).filter(([key, item]) => key !== ROUTINE_SNAPSHOT_KEY && item?.confirmed).length;
        const snapshot = Array.isArray(log[ROUTINE_SNAPSHOT_KEY]) ? log[ROUTINE_SNAPSHOT_KEY] : null;
        const summary = snapshot
          ? `${count} / ${snapshot.length}`
          : `${count} confirmations · routine details unavailable`;
        return `<article class="history-row"><div><strong>${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><span>${count} confirmations</span></div><span class="history-count">${summary}</span></article>`;
      }).join('') : '<div class="empty">Your confirmations will appear here.</div>'}`;
  }
}

function createDialog(content, labelledBy) {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-labelledby', labelledBy);
  dialog.innerHTML = content;
  document.querySelector('#app').append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

function openProductForm(productId) {
  const product = state.products.find(item => item.id === productId);
  const dialog = createDialog(`
    <form class="dialog-card" id="product-form">
      <h2 id="product-form-title">${product ? 'Edit routine item' : 'Add to your routine'}</h2>
      <p class="dialog-description">Enter the routine details from your label or care instructions.</p>
      <label for="product-name">Name</label>
      <input id="product-name" name="name" type="text" maxlength="80" autocomplete="off" required value="${esc(product?.name || '')}" />
      <label for="product-kind">Type</label>
      <select id="product-kind" name="kind"><option ${product?.kind !== 'Skincare' ? 'selected' : ''}>Medicine</option><option ${product?.kind === 'Skincare' ? 'selected' : ''}>Skincare</option></select>
      <label for="product-time">Daily reminder time</label>
      <input id="product-time" name="time" type="time" required value="${esc(product?.time || '08:00')}" />
      <p class="form-error" id="product-form-error" role="alert"></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close>Cancel</button><button class="primary-button" type="submit">${product ? 'Save changes' : 'Add item'}</button></div>
    </form>`, 'product-form-title');
  const form = dialog.querySelector('#product-form');
  const nameInput = dialog.querySelector('#product-name');
  const error = dialog.querySelector('#product-form-error');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form);
    const name = String(values.get('name') || '').trim();
    const time = String(values.get('time') || '');
    if (!name) {
      error.textContent = 'Enter a name for this routine item.';
      nameInput.focus();
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      error.textContent = 'Choose a valid reminder time.';
      return;
    }
    const existing = state.products.find(item => item.id === productId);
    const itemId = existing?.id || crypto.randomUUID();
    const updated = {
      ...(existing || {}),
      id: itemId,
      notificationId: existing?.notificationId || notificationIdFor(itemId, new Set(state.products.map(item => item.notificationId))),
      name,
      kind: values.get('kind') === 'Skincare' ? 'Skincare' : 'Medicine',
      time
    };
    const previous = existing ? { ...existing } : null;
    if (existing) state.products = state.products.map(item => item.id === productId ? updated : item);
    else state.products.push(updated);
    try {
      save();
    } catch (saveError) {
      if (previous) state.products = state.products.map(item => item.id === productId ? previous : item);
      else state.products = state.products.filter(item => item.id !== updated.id);
      error.textContent = saveError.message;
      return;
    }
    dialog.close();
    render();
    if (state.remindersEnabled && Capacitor.isNativePlatform()) {
      try {
        await syncNotifications();
      } catch {
        window.alert('Your routine was saved, but reminders could not be updated. Use “Refresh daily notifications” to try again.');
      }
    }
  });
  nameInput.focus();
}

function confirmProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const completed = isDone(id);
  const dialog = createDialog(`
    <div class="dialog-card">
      <h2 id="confirm-title">${completed ? 'Undo this confirmation?' : 'Confirm your routine'}</h2>
      <p class="dialog-description">${completed
        ? `Remove today's confirmation for ${esc(product.name)}?`
        : `Did you actually use "${esc(product.name)}" today, following your prescribed or label directions?`}</p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close>Cancel</button><button class="primary-button" type="button" data-confirm-action>${completed ? 'Undo confirmation' : 'Yes, confirm'}</button></div>
    </div>`, 'confirm-title');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-confirm-action]').addEventListener('click', () => {
    const day = today();
    const previousLogs = state.logs;
    state.logs = { ...state.logs };
    const log = { ...dayLog(day) };
    if (completed) {
      delete log[id];
      if (Object.keys(log).every(key => key === ROUTINE_SNAPSHOT_KEY)) delete state.logs[day];
      else state.logs[day] = log;
    } else {
      if (!state.logs[day]) {
        log[ROUTINE_SNAPSHOT_KEY] = state.products.map(item => ({ id: item.id, name: item.name, kind: item.kind, time: item.time }));
      }
      log[id] = { confirmed: true, at: new Date().toISOString() };
      state.logs[day] = log;
    }
    try {
      save();
      dialog.close();
      render();
    } catch (error) {
      state.logs = previousLogs;
      window.alert(error.message);
    }
  });
}

function confirmRemove(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const dialog = createDialog(`
    <div class="dialog-card">
      <h2 id="remove-title">Remove routine item?</h2>
      <p class="dialog-description">Remove ${esc(product.name)} from your routine? Past confirmations will remain in your history.</p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close>Keep item</button><button class="danger-button" type="button" data-remove-confirm>Remove</button></div>
    </div>`, 'remove-title');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-remove-confirm]').addEventListener('click', async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await cancelMedikethNotifications([product.notificationId]);
      }
      const previousProducts = state.products;
      const previousRemindersEnabled = state.remindersEnabled;
      state.products = state.products.filter(item => item.id !== id);
      if (!state.products.length) state.remindersEnabled = false;
      try {
        save();
      } catch (error) {
        state.products = previousProducts;
        state.remindersEnabled = previousRemindersEnabled;
        if (previousRemindersEnabled && Capacitor.isNativePlatform()) {
          try {
            await syncNotifications();
          } catch (notificationError) {
            throw new Error(`${error.message} Reminders also could not be restored: ${notificationError.message}`);
          }
        }
        throw error;
      }
      dialog.close();
      render();
      if (state.remindersEnabled && Capacitor.isNativePlatform()) {
        try {
          await syncNotifications();
        } catch (error) {
          window.alert(`The item was removed, but the remaining reminders could not be refreshed: ${error.message}`);
        }
      }
    } catch (error) {
      window.alert(`The item could not be removed safely: ${error.message}`);
    }
  });
}

async function syncNotifications() {
  await legacyCleanupPromise;
  const notifications = state.products.map(product => {
    const [hour, minute] = product.time.split(':').map(Number);
    return {
      id: product.notificationId,
      title: 'Mediketh reminder',
      body: `Time for your routine: ${product.name}`,
      schedule: { on: { hour, minute }, allowWhileIdle: true }
    };
  });
  await cancelMedikethNotifications(state.products.map(product => product.notificationId));
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

async function cancelMedikethNotifications(extraIds = []) {
  const pending = await LocalNotifications.getPending();
  const ownedIds = pending.notifications
    .filter(notification => notification.title === 'Mediketh reminder')
    .map(notification => notification.id);
  const ids = [...new Set([...ownedIds, ...extraIds])];
  if (ids.length) await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
}

async function toggleReminders() {
  if (!Capacitor.isNativePlatform()) {
    window.alert('Install the Android app to enable device notifications.');
    return;
  }
  try {
    if (state.remindersEnabled) {
      await syncNotifications();
      window.alert('Daily reminders have been refreshed.');
      return;
    }
    if (!state.products.length) {
      window.alert('Add at least one routine item before enabling reminders.');
      return;
    }
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== 'granted') {
      window.alert('Notification permission was not granted. You can enable it in your device settings.');
      return;
    }
    await syncNotifications();
    state.remindersEnabled = true;
    try {
      save();
    } catch (error) {
      state.remindersEnabled = false;
      await LocalNotifications.cancel({ notifications: state.products.map(product => ({ id: product.notificationId })) });
      throw error;
    }
    render();
    window.alert('Daily reminders are scheduled on this device.');
  } catch (error) {
    window.alert(`Notifications could not be updated: ${error.message}`);
  }
}

async function disableReminders() {
  try {
    await cancelMedikethNotifications(state.products.map(product => product.notificationId));
    state.remindersEnabled = false;
    try {
      save();
    } catch (error) {
      state.remindersEnabled = true;
      await syncNotifications();
      throw error;
    }
    render();
  } catch (error) {
    window.alert(`Notifications could not be turned off: ${error.message}`);
  }
}

render();
if (Capacitor.isNativePlatform() && state.needsLegacyNotificationCleanup) {
  legacyCleanupPromise = cancelMedikethNotifications()
    .then(() => {
      state.needsLegacyNotificationCleanup = false;
      try {
        save();
      } catch (error) {
        state.needsLegacyNotificationCleanup = true;
        throw error;
      }
    })
    .catch(error => {
      window.alert(`Old reminders could not be cleared: ${error.message}`);
    });
}
