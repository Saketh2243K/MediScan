import './style.css';
import { Capacitor } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';

const STORAGE_KEY = 'mediketh-v1';
const DAY_SNAPSHOT_KEY = '_routine';
const DAY_NOTE_KEY = '_note';
const WEEKDAYS = [
  { value: 1, short: 'Mon', full: 'Monday' },
  { value: 2, short: 'Tue', full: 'Tuesday' },
  { value: 3, short: 'Wed', full: 'Wednesday' },
  { value: 4, short: 'Thu', full: 'Thursday' },
  { value: 5, short: 'Fri', full: 'Friday' },
  { value: 6, short: 'Sat', full: 'Saturday' },
  { value: 7, short: 'Sun', full: 'Sunday' }
];
const DEFAULT_WEEK = WEEKDAYS.map(day => day.value);
const ROUTES = ['today', 'routine', 'calendar', 'more', 'history', 'insights', 'notes', 'settings'];
const ROUTE_INFO = {
  today: ['Today', 'Your daily plan, one step at a time.'],
  routine: ['My routine', 'Set up the times and days that fit your plan.'],
  calendar: ['Calendar', 'See your routine activity by day.'],
  more: ['More', 'Your activity, notes, and preferences.'],
  history: ['History', 'A record of your confirmed routine.'],
  insights: ['Insights', 'A gentle overview of your recent consistency.'],
  notes: ['Daily notes', 'Private notes saved on this device.'],
  settings: ['Settings', 'Make Mediketh work the way you prefer.']
};
const DEFAULT_STATE = {
  products: [],
  logs: {},
  remindersEnabled: false,
  needsLegacyNotificationCleanup: false,
  preferences: { theme: 'system', locale: 'system' }
};

function emptyState() {
  return { ...DEFAULT_STATE, products: [], logs: {}, preferences: { ...DEFAULT_STATE.preferences } };
}

let storageWarning = '';
let notificationSync = Promise.resolve();
let reminderSyncWarning = '';
let currentRoute = 'today';
let selectedDate = dateKey(new Date());
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let toastTimer;
let state = loadState();

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function weekdayFor(key) {
  return parseDate(key).getDay() || 7;
}

function formatWeekday(day, style = 'short') {
  return new Intl.DateTimeFormat(locale(), { weekday: style }).format(new Date(2026, 0, day + 4, 12));
}

function todayKey() {
  return dateKey(new Date());
}

function makeId() {
  return crypto.randomUUID();
}

function notificationIdFor(value, used = new Set()) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let id = (hash >>> 0) % 2147483646 + 1;
  while (used.has(id)) id = id === 2147483647 ? 1 : id + 1;
  used.add(id);
  return id;
}

function snoozeNotificationId(day, key) {
  const used = new Set(state.products.flatMap(product => Object.values(product.notificationIds || {}).flatMap(days => Object.values(days))));
  return notificationIdFor(`snooze:${day}:${key}`, used);
}

function normalizeProduct(product, usedNotificationIds) {
  if (!product || typeof product.id !== 'string' || typeof product.name !== 'string' || !product.name.trim()) return null;
  const legacyTimes = typeof product.time === 'string' ? [product.time] : [];
  const times = Array.isArray(product.times) ? product.times : legacyTimes;
  const validTimes = [...new Set(times.filter(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();
  const notifications = product.notificationIds && typeof product.notificationIds === 'object'
    ? product.notificationIds
    : {};
  const notificationIds = {};
  for (const time of validTimes) {
    notificationIds[time] = {};
    for (const day of DEFAULT_WEEK) {
      const savedId = notifications[time]?.[day];
      if (Number.isInteger(savedId) && savedId > 0 && savedId <= 2147483647 && !usedNotificationIds.has(savedId)) {
        notificationIds[time][day] = savedId;
        usedNotificationIds.add(savedId);
      } else {
        notificationIds[time][day] = notificationIdFor(`${product.id}:${time}:${day}`, usedNotificationIds);
      }
    }
  }
  return {
    id: product.id,
    name: product.name.trim(),
    kind: product.kind === 'Skincare' ? 'Skincare' : 'Medicine',
    times: validTimes.length ? validTimes : ['08:00'],
    days: Array.isArray(product.days)
      ? [...new Set(product.days.filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b)
      : [...DEFAULT_WEEK],
    notificationIds,
    stock: Number.isInteger(product.stock) && product.stock >= 0 ? product.stock : null,
    refillAt: Number.isInteger(product.refillAt) && product.refillAt >= 0 ? product.refillAt : null,
    expiryDate: typeof product.expiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(product.expiryDate) ? product.expiryDate : '',
    barcode: typeof product.barcode === 'string' ? product.barcode.trim().slice(0, 64) : '',
    note: typeof product.note === 'string' ? product.note.slice(0, 1000) : ''
  };
}

function normalizeLogs(rawLogs, products) {
  const logs = {};
  for (const [day, rawLog] of Object.entries(rawLogs).slice(-5000)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || dateKey(parseDate(day)) !== day || !rawLog || typeof rawLog !== 'object' || Array.isArray(rawLog)) continue;
    const log = {};
    for (const [key, record] of Object.entries(rawLog)) {
      if (key === DAY_NOTE_KEY && typeof record === 'string') {
        log[DAY_NOTE_KEY] = record.slice(0, 2000);
      } else if (key === DAY_SNAPSHOT_KEY && Array.isArray(record)) {
        log[DAY_SNAPSHOT_KEY] = record.filter(entry =>
          entry && typeof entry.id === 'string' && typeof entry.name === 'string' &&
          typeof entry.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)
        ).map(entry => ({
          id: entry.id,
          name: entry.name.slice(0, 80),
          kind: entry.kind === 'Skincare' ? 'Skincare' : 'Medicine',
          time: entry.time,
          key: doseKey(entry.id, entry.time)
        }));
      } else if (key.includes('@') && record && typeof record === 'object' && ['taken', 'skipped'].includes(record.status)) {
        log[key] = { status: record.status, at: typeof record.at === 'string' ? record.at : '' };
      } else if (key.includes('@') && record && typeof record === 'object' && typeof record.snoozedUntil === 'string' && Number.isFinite(Date.parse(record.snoozedUntil))) {
        log[key] = { snoozedUntil: record.snoozedUntil };
      }
    }
    for (const product of products) {
      const oldRecord = rawLog[product.id];
      if (oldRecord?.confirmed) {
        const key = doseKey(product.id, product.times[0]);
        log[key] ||= { status: 'taken', at: typeof oldRecord.at === 'string' ? oldRecord.at : '' };
      }
    }
    if (Object.keys(log).length) logs[day] = log;
  }
  return logs;
}

function normalizePreferences(raw) {
  const supportedLocales = ['system', 'en-US', 'en-GB', 'hi-IN', 'es-ES', 'ar'];
  return {
    theme: ['system', 'light', 'dark'].includes(raw?.theme) ? raw.theme : 'system',
    locale: supportedLocales.includes(raw?.locale) ? raw.locale : 'system',
    reducedMotion: raw?.reducedMotion === true
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.products)) throw new Error('Saved routine data has an unexpected format.');
    const usedNotificationIds = new Set();
    const products = saved.products.map(product => normalizeProduct(product, usedNotificationIds)).filter(Boolean);
    const rawLogs = saved.logs && typeof saved.logs === 'object' && !Array.isArray(saved.logs) ? saved.logs : {};
    const logs = normalizeLogs(rawLogs, products);
    return {
      ...emptyState(),
      ...saved,
      products,
      logs,
      preferences: normalizePreferences(saved.preferences),
      remindersEnabled: saved.remindersEnabled === true,
      needsLegacyNotificationCleanup: saved.remindersEnabled === undefined
    };
  } catch (error) {
    storageWarning = `Saved data could not be loaded: ${error.message}`;
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageWarning = '';
  } catch {
    throw new Error('Changes could not be saved on this device. Check available storage and try again.');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function locale() {
  const selected = state.preferences.locale;
  return selected && selected !== 'system' ? selected : navigator.language || 'en-US';
}

function formatDate(key, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(locale(), options).format(parseDate(key));
}

function formatTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute));
}

function doseKey(productId, time) {
  return `${productId}@${time}`;
}

function dayLog(day = todayKey()) {
  return state.logs[day] || {};
}

function scheduleApplies(product, day) {
  return product.days.includes(weekdayFor(day));
}

function doseStatus(productId, time, day = selectedDate) {
  return dayLog(day)[doseKey(productId, time)]?.status || '';
}

function daySnapshot(day) {
  const saved = dayLog(day)[DAY_SNAPSHOT_KEY];
  if (Array.isArray(saved)) return saved;
  if (day < todayKey()) return [];
  return state.products
    .filter(product => scheduleApplies(product, day))
    .flatMap(product => product.times.map(time => ({
      id: product.id,
      name: product.name,
      kind: product.kind,
      time,
      key: doseKey(product.id, time)
    })));
}

function pushToast(message, type = 'success') {
  const host = document.querySelector('#toast');
  if (!host) return;
  host.textContent = message;
  host.dataset.type = type;
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.hidden = true; }, 4000);
}

function navigate(route, options = {}) {
  if (!ROUTES.includes(route)) return;
  currentRoute = route;
  if (options.date) selectedDate = options.date;
  else if (route === 'today') selectedDate = todayKey();
  if (options.month) visibleMonth = options.month;
  if (options.push !== false) history.pushState({ route, date: selectedDate }, '', `#${route}`);
  render();
  window.scrollTo({ top: 0, behavior: state.preferences.reducedMotion ? 'auto' : 'smooth' });
}

function navButton(route, icon, label) {
  const active = ['more', 'history', 'insights', 'notes', 'settings'].includes(currentRoute)
    ? route === 'more'
    : currentRoute === route;
  return `<button class="nav-item ${active ? 'active' : ''}" data-route="${route}" aria-current="${active ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

function render() {
  const [title, subtitle] = ROUTE_INFO[currentRoute] || ROUTE_INFO.today;
  const isToday = selectedDate === todayKey();
  document.documentElement.dataset.theme = state.preferences.theme || 'system';
  document.documentElement.dataset.motion = state.preferences.reducedMotion ? 'reduce' : 'full';
  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <a class="brand" href="#today" data-route="today" aria-label="Mediketh home"><span class="brand-mark" aria-hidden="true">m</span><span>mediketh</span></a>
        <button class="header-date" data-route="calendar" aria-label="Open calendar">${formatDate(todayKey())}<span aria-hidden="true">⌄</span></button>
        <button class="avatar-button" data-route="settings" aria-label="Open settings">S</button>
      </header>
      <main class="page-content">
        <div class="page-heading"><div>${['history', 'insights', 'notes', 'settings'].includes(currentRoute) ? '<button class="back-link" data-route="more"><span aria-hidden="true">‹</span> More</button>' : ''}<p class="eyebrow">${escapeHtml(formatDate(todayKey(), { weekday: 'long', month: 'long', day: 'numeric' }))}</p><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div></div>
        ${storageWarning ? `<div class="alert-card" role="alert">${escapeHtml(storageWarning)}</div>` : ''}
        <section id="screen" aria-live="polite"></section>
      </main>
      <button class="fab" data-action="add" aria-label="Add routine item"><span aria-hidden="true">＋</span><span class="fab-label">Add item</span></button>
      <nav class="bottom-nav" aria-label="Main navigation">
        ${navButton('today', '⌂', 'Today')}
        ${navButton('routine', '◷', 'Routine')}
        ${navButton('calendar', '▦', 'Calendar')}
        ${navButton('more', '•••', 'More')}
      </nav>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    </div>`;
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    navigate(button.dataset.route);
  }));
  document.querySelector('[data-action="add"]').addEventListener('click', () => openProductForm());
  document.querySelectorAll('[data-route]').forEach(button => {
    if (button.dataset.route === currentRoute) button.setAttribute('aria-current', 'page');
  });
  renderScreen();
}

function renderToday() {
  const screen = document.querySelector('#screen');
  const day = selectedDate;
  const isToday = day === todayKey();
  const items = day === todayKey()
    ? state.products.filter(product => scheduleApplies(product, day)).flatMap(product => product.times.map(time => ({ product, time })))
    : daySnapshot(day).map(entry => ({ product: state.products.find(item => item.id === entry.id) || entry, time: entry.time, key: entry.key || doseKey(entry.id, entry.time) }));
  const hasOlderRecords = !isToday && Object.keys(dayLog(day)).some(key => !key.startsWith('_'));
  const completed = items.filter(({ product, time, key }) => (dayLog(day)[key || doseKey(product.id, time)]?.status || doseStatus(product.id, time, day)) === 'taken').length;
  const progress = items.length ? Math.round(completed / items.length * 100) : 0;
  screen.innerHTML = `
    <div class="dashboard-welcome card-surface">
      <div class="welcome-copy"><span class="welcome-kicker">${isToday ? 'YOUR DAILY PLAN' : 'PAST ACTIVITY'}</span><h2>${isToday ? 'A little progress adds up.' : escapeHtml(formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2><p>${items.length ? `${completed} of ${items.length} routine steps completed` : 'No routine steps scheduled for this day.'}</p></div>
      <div class="progress-ring" style="--progress:${progress * 3.6}deg"><span>${progress}%</span></div>
    </div>
    <div class="section-title"><div><span class="section-kicker">${isToday ? 'YOUR SCHEDULE' : 'SAVED ROUTINE'}</span><h2>${isToday ? 'Today, at a glance' : 'Routine activity'}</h2></div>${isToday ? '<button class="quiet-button" data-route="routine">Edit routine <span aria-hidden="true">›</span></button>' : ''}</div>
    ${items.length ? `<div class="dose-list">${items.map(({ product, time, key }) => renderDoseCard(product, time, day, key)).join('')}</div>` : `<div class="empty-state card-surface"><span class="empty-icon" aria-hidden="true">✦</span><h3>${isToday ? 'Your routine starts here' : hasOlderRecords ? 'Older history is limited' : 'No activity saved'}</h3><p>${isToday ? 'Add your first routine item and set the days and times that suit you.' : hasOlderRecords ? 'This activity predates saved routine snapshots, so Mediketh cannot reliably show which items were scheduled.' : 'There are no recorded routine steps for this day.'}</p>${isToday ? '<button class="primary-button" data-action="add">Add your first item</button>' : ''}</div>`}
    ${isToday ? `<div class="help-card"><span aria-hidden="true">ⓘ</span><p>Only confirm a medicine after taking it as directed. Mediketh is a personal tracker, not medical advice.</p></div>` : ''}`;
  screen.querySelectorAll('[data-confirm-dose]').forEach(button => button.addEventListener('click', () => confirmDoseAction(button.dataset.product, button.dataset.time, day, 'taken')));
  screen.querySelectorAll('[data-skip-dose]').forEach(button => button.addEventListener('click', () => confirmDoseAction(button.dataset.product, button.dataset.time, day, 'skipped')));
  screen.querySelectorAll('[data-snooze-dose]').forEach(button => button.addEventListener('click', () => snoozeDose(button.dataset.product, button.dataset.time, day)));
  screen.querySelector('[data-route="routine"]')?.addEventListener('click', () => navigate('routine'));
  screen.querySelector('[data-action="add"]')?.addEventListener('click', () => openProductForm());
}

function renderDoseCard(product, time, day, savedKey) {
  const key = savedKey || doseKey(product.id, time);
  const record = dayLog(day)[key] || {};
  const status = record.status || '';
  const isToday = day === todayKey();
  const stateLabel = status === 'taken' ? 'Completed' : status === 'skipped' ? 'Skipped' : record.snoozedUntil ? `Snoozed until ${formatTime(record.snoozedUntil.slice(11, 16))}` : '';
  return `<article class="dose-card ${status === 'taken' ? 'dose-done' : ''}">
    <div class="dose-time"><span>${escapeHtml(formatTime(time))}</span><span class="dose-dot"></span></div>
    <div class="dose-main"><div class="dose-icon ${product.kind === 'Skincare' ? 'skin' : ''}" aria-hidden="true">${product.kind === 'Skincare' ? '✧' : '✚'}</div><div class="dose-copy"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.kind)}${stateLabel ? ` · ${escapeHtml(stateLabel)}` : ''}</span></div></div>
    ${isToday ? `<div class="dose-actions">${status ? `<button class="soft-button" data-confirm-dose data-product="${escapeHtml(product.id)}" data-time="${escapeHtml(time)}">${status === 'taken' ? 'Undo' : 'Mark taken'}</button>` : `<button class="primary-button dose-taken" data-confirm-dose data-product="${escapeHtml(product.id)}" data-time="${escapeHtml(time)}">✓ Taken</button>${state.remindersEnabled && Capacitor.isNativePlatform() ? `<button class="icon-button" data-snooze-dose data-product="${escapeHtml(product.id)}" data-time="${escapeHtml(time)}" aria-label="Snooze reminder for ${escapeHtml(product.name)}">＋10m</button>` : ''}<button class="icon-button" data-skip-dose data-product="${escapeHtml(product.id)}" data-time="${escapeHtml(time)}" aria-label="Skip ${escapeHtml(product.name)} today">Skip</button>`}</div>` : ''}</article>`;
}

function renderRoutine() {
  const screen = document.querySelector('#screen');
  screen.innerHTML = `
    <div class="feature-banner"><div><span class="section-kicker">ROUTINE BUILDER</span><h2>Your schedule, your way.</h2><p>Set multiple daily times and choose which days repeat.</p></div><span class="banner-icon" aria-hidden="true">◷</span></div>
    <div class="section-title"><div><span class="section-kicker">${state.products.length} ITEMS</span><h2>Routine items</h2></div><button class="primary-button" data-add-routine>＋ Add item</button></div>
    ${state.products.length ? `<div class="routine-grid">${state.products.map(product => renderProductCard(product)).join('')}</div>` : `<div class="empty-state card-surface"><span class="empty-icon">✦</span><h3>Build a routine that works for you</h3><p>Add an item, choose multiple reminder times, and select the days it applies.</p><button class="primary-button" data-add-routine>Add a routine item</button></div>`}`;
  screen.querySelector('[data-add-routine]')?.addEventListener('click', () => openProductForm());
  screen.querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => openProductForm(button.dataset.editProduct)));
  screen.querySelectorAll('[data-remove-product]').forEach(button => button.addEventListener('click', () => confirmRemove(button.dataset.removeProduct)));
  screen.querySelectorAll('[data-stock]').forEach(button => button.addEventListener('click', () => updateStock(button.dataset.stock)));
}

function renderProductCard(product) {
  const times = product.times.map(formatTime).join(' · ');
  const days = product.days.length === 7 ? 'Every day' : product.days.map(day => formatWeekday(day)).join(', ') || 'No days selected';
  const expiring = product.expiryDate && product.expiryDate <= dateKey(new Date(Date.now() + 30 * 86400000));
  const lowStock = product.stock !== null && product.refillAt !== null && product.stock <= product.refillAt;
  return `<article class="product-card card-surface">
    <div class="product-card-top"><div class="dose-icon ${product.kind === 'Skincare' ? 'skin' : ''}" aria-hidden="true">${product.kind === 'Skincare' ? '✧' : '✚'}</div><span class="kind-chip">${escapeHtml(product.kind)}</span><button class="more-button" data-edit-product="${escapeHtml(product.id)}" aria-label="Edit ${escapeHtml(product.name)}">•••</button></div>
    <h3>${escapeHtml(product.name)}</h3><p class="product-schedule">${escapeHtml(times)} <span>·</span> ${escapeHtml(days)}</p>
    ${product.barcode ? `<p class="product-barcode">Barcode · ${escapeHtml(product.barcode)}</p>` : ''}
    ${(lowStock || expiring) ? `<div class="stock-alert">${lowStock ? `Low supply: ${product.stock} left` : ''}${lowStock && expiring ? ' · ' : ''}${expiring ? `Expires ${escapeHtml(product.expiryDate)}` : ''}</div>` : ''}
    <div class="product-meta">${product.stock !== null ? `<span>▣ ${product.stock} in supply</span>` : '<span>Local reminders</span>'}<div><button class="small-action" data-stock="${escapeHtml(product.id)}">Update supply</button><button class="small-action" data-edit-product="${escapeHtml(product.id)}">Edit</button></div></div>
  </article>`;
}

function confirmDoseAction(productId, time, day, action) {
  const key = doseKey(productId, time);
  const record = dayLog(day)[key];
  const isUndo = action === 'taken' && record?.status === 'taken';
  const isTaken = action === 'taken';
  const dialog = openDialog({
    title: isUndo ? 'Undo this confirmation?' : isTaken ? 'Confirm this routine step' : 'Skip this routine step?',
    description: isUndo
      ? 'Remove today’s confirmation for this scheduled step?'
      : isTaken
        ? 'Did you actually complete this routine step according to your prescribed or label directions?'
        : 'This only records that you skipped this step. Mediketh cannot advise whether or when to take a missed dose.',
    actions: `<button class="soft-button" type="button" data-cancel>Cancel</button><button class="${isUndo || !isTaken ? 'danger-button' : 'primary-button'}" type="button" data-confirm-action>${isUndo ? 'Undo confirmation' : isTaken ? 'Yes, confirm' : 'Mark skipped'}</button>`
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-confirm-action]').addEventListener('click', async () => {
    dialog.close();
    await setDoseStatus(productId, time, action, day);
  });
}

function renderCalendar() {
  const screen = document.querySelector('#screen');
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<span class="calendar-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= count; day++) {
    const key = dateKey(new Date(year, month, day));
    const log = dayLog(key);
    const hasActivity = Object.keys(log).some(item => !item.startsWith('_') && log[item]?.status === 'taken');
    const current = key === todayKey();
    cells.push(`<button class="calendar-day ${key === selectedDate ? 'selected' : ''} ${current ? 'is-today' : ''}" data-calendar-day="${key}" aria-label="${escapeHtml(formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' }))}${hasActivity ? ', activity recorded' : ''}" aria-pressed="${key === selectedDate}">${day}${hasActivity ? '<i aria-hidden="true"></i>' : ''}</button>`);
  }
  const snapshot = daySnapshot(selectedDate);
  const dayLogForSelection = dayLog(selectedDate);
  const total = snapshot.length;
  const selectedKeys = new Set(snapshot.map(entry => entry.key || doseKey(entry.id, entry.time)));
  const done = Object.entries(dayLogForSelection).filter(([key, record]) => selectedKeys.has(key) && record?.status === 'taken').length;
  screen.innerHTML = `
    <div class="calendar-card card-surface">
      <div class="calendar-heading"><button class="calendar-arrow" data-month="-1" aria-label="Previous month">‹</button><h2>${escapeHtml(new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(visibleMonth))}</h2><button class="calendar-arrow" data-month="1" aria-label="Next month">›</button></div>
      <div class="calendar-grid calendar-weekdays">${WEEKDAYS.map(day => `<span>${escapeHtml(formatWeekday(day.value))}</span>`).join('')}</div>
      <div class="calendar-grid">${cells.join('')}</div>
      <div class="calendar-legend"><span><i class="legend-dot"></i> Confirmations recorded</span><span class="legend-today">Today</span></div>
    </div>
    <div class="section-title"><div><span class="section-kicker">SELECTED DAY</span><h2>${escapeHtml(formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2></div><div class="calendar-links">${selectedDate === todayKey() ? '<button class="quiet-button" data-open-today>Open today <span aria-hidden="true">›</span></button>' : ''}<button class="quiet-button" data-open-notes>Notes <span aria-hidden="true">›</span></button></div></div>
    <div class="summary-strip"><div><strong>${done}</strong><span>confirmed</span></div><div><strong>${total}</strong><span>scheduled</span></div><div><strong>${total ? Math.round(done / total * 100) : 0}%</strong><span>completion</span></div></div>
    ${daySnapshot(selectedDate).length ? `<div class="compact-activity">${daySnapshot(selectedDate).map(entry => `<div><span>${escapeHtml(formatTime(entry.time))}</span><strong>${escapeHtml(entry.name)}</strong><span class="activity-state">${dayLogForSelection[entry.key || doseKey(entry.id, entry.time)]?.status === 'taken' ? 'Taken' : dayLogForSelection[entry.key || doseKey(entry.id, entry.time)]?.status === 'skipped' ? 'Skipped' : '—'}</span></div>`).join('')}</div>` : '<div class="empty-inline">No routine scheduled or recorded for this date.</div>'}`;
  screen.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
    const next = new Date(year, month + Number(button.dataset.month), 1);
    navigate('calendar', { month: next });
  }));
  screen.querySelectorAll('[data-calendar-day]').forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.calendarDay;
    render();
  }));
  screen.querySelector('[data-open-today]')?.addEventListener('click', () => navigate('today'));
  screen.querySelector('[data-open-notes]')?.addEventListener('click', () => navigate('notes', { date: selectedDate }));
}

function renderMore() {
  const screen = document.querySelector('#screen');
  screen.innerHTML = `
    <div class="more-grid">
      <button class="more-card" data-open="history"><span class="more-card-icon purple">◴</span><span><strong>History</strong><small>Past confirmations</small></span><i>›</i></button>
      <button class="more-card" data-open="insights"><span class="more-card-icon green">↗</span><span><strong>Insights</strong><small>Progress at a glance</small></span><i>›</i></button>
      <button class="more-card" data-open="notes"><span class="more-card-icon amber">✎</span><span><strong>Daily notes</strong><small>Private, on this device</small></span><i>›</i></button>
      <button class="more-card" data-open="settings"><span class="more-card-icon blue">⚙</span><span><strong>Settings & privacy</strong><small>Theme, regional formats, your data</small></span><i>›</i></button>
    </div>
    <div class="privacy-card"><span aria-hidden="true">⌑</span><div><strong>Your routine stays on this device</strong><p>There is no account or cloud sync. Export a backup from Settings if you want to keep a copy.</p></div></div>`;
  screen.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.open)));
}

function renderHistory() {
  const screen = document.querySelector('#screen');
  const entries = Object.entries(state.logs)
    .filter(([, log]) => log && Object.keys(log).some(key => !key.startsWith('_') && ['taken', 'skipped'].includes(log[key]?.status)))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 90);
  screen.innerHTML = entries.length ? `<div class="history-list">${entries.map(([day, log]) => {
    const snapshot = Array.isArray(log[DAY_SNAPSHOT_KEY]) ? log[DAY_SNAPSHOT_KEY] : [];
    const doseRecords = Object.entries(log).filter(([key, record]) => !key.startsWith('_') && ['taken', 'skipped'].includes(record?.status));
    const taken = doseRecords.filter(([, record]) => record.status === 'taken').length;
    const planned = snapshot.length || doseRecords.length;
    return `<button class="history-card" data-history-day="${day}"><span class="history-date"><strong>${escapeHtml(formatDate(day, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><small>${taken} confirmed · ${doseRecords.filter(([, record]) => record.status === 'skipped').length} skipped</small></span><span class="history-result">${taken}/${planned}<i>›</i></span></button>`;
  }).join('')}</div>` : '<div class="empty-state card-surface"><span class="empty-icon">◴</span><h3>History starts with a confirmation</h3><p>When you record a routine step, you can review it here.</p><button class="primary-button" data-open-today>Go to today</button></div>';
  screen.querySelectorAll('[data-history-day]').forEach(button => button.addEventListener('click', () => navigate('today', { date: button.dataset.historyDay })));
  screen.querySelector('[data-open-today]')?.addEventListener('click', () => navigate('today'));
}

function renderInsights() {
  const screen = document.querySelector('#screen');
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    return dateKey(day);
  });
  let planned = 0;
  let taken = 0;
  const bars = days.map(day => {
    const snapshot = daySnapshot(day);
    const records = dayLog(day);
    const snapshotKeys = new Set(snapshot.map(entry => entry.key || doseKey(entry.id, entry.time)));
    const count = Object.entries(records).filter(([key, record]) => snapshotKeys.has(key) && record?.status === 'taken').length;
    planned += snapshot.length;
    taken += count;
    const percent = snapshot.length ? Math.min(100, Math.round(count / snapshot.length * 100)) : 0;
    return `<div class="chart-column"><div class="chart-track"><i style="height:${percent}%"></i></div><span>${escapeHtml(formatDate(day, { weekday: 'short' }).slice(0, 1))}</span></div>`;
  }).join('');
  const activeDays = days.filter(day => Object.entries(dayLog(day)).some(([key, record]) => !key.startsWith('_') && record?.status === 'taken')).length;
  const percentage = planned ? Math.round(taken / planned * 100) : 0;
  screen.innerHTML = `
    <div class="insight-hero"><span class="section-kicker">LAST 7 DAYS</span><h2>${percentage}%</h2><p>of scheduled routine steps confirmed</p><div class="weekly-chart">${bars}</div></div>
    <div class="summary-grid"><div class="metric-card"><span class="metric-icon">✓</span><strong>${taken}</strong><small>Confirmed steps</small></div><div class="metric-card"><span class="metric-icon">◷</span><strong>${activeDays}/7</strong><small>Active days</small></div></div>
    <div class="help-card"><span aria-hidden="true">✦</span><p>Progress is a reflection tool, not a judgment. A skipped routine does not mean you should take an extra dose.</p></div>`;
}

function renderNotes() {
  const screen = document.querySelector('#screen');
  const log = dayLog(selectedDate);
  const readOnly = selectedDate > todayKey();
  screen.innerHTML = `
    <div class="note-editor card-surface">
      <div class="note-date-row"><div><span class="section-kicker">ON THIS DEVICE ONLY</span><h2>${escapeHtml(formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2></div><button class="calendar-arrow" data-notes-date aria-label="Choose note date">▦</button></div>
      <label for="daily-note">Your note</label>
      <textarea id="daily-note" maxlength="2000" ${readOnly ? 'readonly' : ''} placeholder="${readOnly ? 'No note saved for this day.' : 'Add a private note for today…'}">${escapeHtml(typeof log[DAY_NOTE_KEY] === 'string' ? log[DAY_NOTE_KEY] : '')}</textarea>
      <div class="note-editor-footer"><span>${readOnly ? 'Future dates cannot be edited' : 'Saved only on this device'}</span>${readOnly ? '' : '<button class="primary-button" data-save-note>Save note</button>'}</div>
    </div>
    <div class="help-card"><span aria-hidden="true">ⓘ</span><p>Notes are personal reminders, not a medical record. For diagnosis or treatment questions, talk with a qualified health professional.</p></div>`;
  screen.querySelector('[data-notes-date]')?.addEventListener('click', () => navigate('calendar'));
  screen.querySelector('[data-save-note]')?.addEventListener('click', () => saveDailyNote(screen.querySelector('#daily-note').value, selectedDate));
}

function renderSettings() {
  const screen = document.querySelector('#screen');
  screen.innerHTML = `
    <section class="settings-section"><span class="section-kicker">APPEARANCE</span>
      <label class="setting-row"><span><strong>Theme</strong><small>Choose the app appearance</small></span><select id="theme-select"><option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="setting-row"><span><strong>Date and time format</strong><small>Choose the format for dates and times</small></span><select id="locale-select"><option value="system">Device default</option><option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option><option value="hi-IN">Hindi (India)</option><option value="es-ES">Español (España)</option><option value="ar">العربية</option></select></label>
      <label class="setting-row"><span><strong>Reduce motion</strong><small>Use fewer animated transitions</small></span><input id="motion-toggle" type="checkbox" ${state.preferences.reducedMotion ? 'checked' : ''}></label>
    </section>
    <section class="settings-section"><span class="section-kicker">REMINDERS</span>
      <div class="reminder-setting"><div><strong>${state.remindersEnabled ? 'Reminders are on' : 'Reminders are off'}</strong><small>Notifications are scheduled on this device only.</small></div><button class="${state.remindersEnabled ? 'soft-button' : 'primary-button'}" data-toggle-reminders>${state.remindersEnabled ? 'Refresh' : 'Enable'}</button></div>
      ${reminderSyncWarning ? `<p class="form-error">${escapeHtml(reminderSyncWarning)}</p>` : ''}
    </section>
    <section class="settings-section"><span class="section-kicker">YOUR DATA</span>
      <div class="setting-action"><span><strong>Export backup</strong><small>Save a copy of your local routine and history as JSON.</small></span><button class="soft-button" data-export>Export</button></div>
      <div class="setting-action"><span><strong>Import backup</strong><small>Restore a Mediketh JSON backup on this device.</small></span><button class="soft-button" data-import>Choose file</button><input id="backup-file" type="file" accept="application/json,.json" hidden></div>
      <div class="setting-action destructive"><span><strong>Delete all local data</strong><small>Permanently clear this device's routine, notes, and history.</small></span><button class="danger-button" data-delete-data>Delete</button></div>
      <p class="settings-footnote">No account, cloud sync, or analytics are configured. Exported backups may contain sensitive personal notes; keep them somewhere private.</p>
    </section>`;
  screen.querySelector('#theme-select').value = state.preferences.theme || 'system';
  screen.querySelector('#locale-select').value = state.preferences.locale || 'system';
  screen.querySelector('#theme-select').addEventListener('change', event => updatePreference('theme', event.target.value));
  screen.querySelector('#locale-select').addEventListener('change', event => updatePreference('locale', event.target.value));
  screen.querySelector('#motion-toggle').addEventListener('change', event => updatePreference('reducedMotion', event.target.checked));
  screen.querySelector('[data-toggle-reminders]').addEventListener('click', toggleReminders);
  screen.querySelector('[data-export]').addEventListener('click', exportBackup);
  screen.querySelector('[data-import]').addEventListener('click', () => screen.querySelector('#backup-file').click());
  screen.querySelector('#backup-file').addEventListener('change', importBackup);
  screen.querySelector('[data-delete-data]').addEventListener('click', confirmDeleteData);
}

function renderScreen() {
  if (currentRoute === 'today') renderToday();
  else if (currentRoute === 'routine') renderRoutine();
  else if (currentRoute === 'calendar') renderCalendar();
  else if (currentRoute === 'more') renderMore();
  else if (currentRoute === 'history') renderHistory();
  else if (currentRoute === 'insights') renderInsights();
  else if (currentRoute === 'notes') renderNotes();
  else if (currentRoute === 'settings') renderSettings();
}

function openDialog({ title, description = '', content, actions, onSubmit, labelledBy = 'dialog-title' }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-labelledby', labelledBy);
  dialog.innerHTML = `<form class="dialog-card" method="dialog"><h2 id="${labelledBy}">${title}</h2>${description ? `<p class="dialog-description">${description}</p>` : ''}${content || ''}<div class="dialog-actions">${actions || '<button class="soft-button" value="cancel">Close</button>'}</div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.showModal();
  if (onSubmit) {
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      onSubmit(dialog);
    });
  }
  return dialog;
}

function openProductForm(productId) {
  const existing = state.products.find(product => product.id === productId);
  const days = existing?.days || DEFAULT_WEEK;
  const dialog = openDialog({
    title: existing ? 'Edit routine item' : 'Add to your routine',
    description: 'Set reminder times and days based on your label or care instructions.',
    content: `
      <label for="routine-name">Name</label><input id="routine-name" name="name" maxlength="80" required value="${escapeHtml(existing?.name || '')}">
      <label for="routine-barcode">Package barcode (optional)</label><div class="barcode-entry"><input id="routine-barcode" name="barcode" maxlength="64" autocomplete="off" value="${escapeHtml(existing?.barcode || '')}" aria-describedby="barcode-help"><button class="soft-button" type="button" data-scan-barcode>Scan</button></div><small id="barcode-help" class="field-help">Scanning saves the code only. Check the package and enter the name yourself; no dose or instructions are inferred.</small>
      <label for="routine-kind">Type</label><select id="routine-kind" name="kind"><option ${existing?.kind !== 'Skincare' ? 'selected' : ''}>Medicine</option><option ${existing?.kind === 'Skincare' ? 'selected' : ''}>Skincare</option></select>
      <label for="routine-times">Daily reminder times</label><input id="routine-times" name="times" type="text" placeholder="08:00, 20:00" value="${escapeHtml((existing?.times || ['08:00']).join(', '))}" aria-describedby="times-help"><small id="times-help" class="field-help">Use 24-hour times separated by commas, such as 08:00, 14:30.</small>
      <fieldset class="weekday-field"><legend>Repeat on</legend><div class="weekday-picker">${WEEKDAYS.map(day => `<label><input type="checkbox" name="days" value="${day.value}" ${days.includes(day.value) ? 'checked' : ''}><span>${escapeHtml(formatWeekday(day.value))}</span></label>`).join('')}</div></fieldset>
      <details class="optional-details"><summary>Supply and expiry (optional)</summary><div class="optional-fields"><label for="routine-stock">Units currently in supply</label><input id="routine-stock" name="stock" type="number" min="0" step="1" value="${existing?.stock ?? ''}" placeholder="Not tracking"><label for="routine-refill">Remind me when supply reaches</label><input id="routine-refill" name="refillAt" type="number" min="0" step="1" value="${existing?.refillAt ?? ''}" placeholder="Optional"><label for="routine-expiry">Expiry date</label><input id="routine-expiry" name="expiryDate" type="date" value="${escapeHtml(existing?.expiryDate || '')}"></div></details>
      <p class="form-error" role="alert"></p>`,
    actions: `<button class="soft-button" type="button" data-cancel>Cancel</button><button class="primary-button" type="submit">${existing ? 'Save changes' : 'Add item'}</button>`,
    onSubmit: async formDialog => {
      const form = formDialog.querySelector('form');
      const values = new FormData(form);
      const name = String(values.get('name') || '').trim();
      const timesText = String(values.get('times') || '');
      const times = [...new Set(timesText.split(',').map(time => time.trim()))].filter(Boolean).sort();
      const daysSelected = values.getAll('days').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
      const error = form.querySelector('.form-error');
      if (!name) {
        error.textContent = 'Enter a name for this routine item.';
        form.querySelector('#routine-name').focus();
        return;
      }
      if (!times.length || times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
        error.textContent = 'Enter one or more valid 24-hour times, separated by commas.';
        form.querySelector('#routine-times').focus();
        return;
      }
      if (!daysSelected.length) {
        error.textContent = 'Select at least one day for this schedule.';
        return;
      }
      const stock = optionalInteger(values.get('stock'));
      const refillAt = optionalInteger(values.get('refillAt'));
      const next = {
        ...(existing || {}),
        id: existing?.id || makeId(),
        name,
        kind: values.get('kind') === 'Skincare' ? 'Skincare' : 'Medicine',
        times,
        days: daysSelected,
        notificationIds: existing?.notificationIds || {},
        stock,
        refillAt,
        expiryDate: String(values.get('expiryDate') || ''),
        barcode: String(values.get('barcode') || '').trim(),
        note: existing?.note || ''
      };
      next.notificationIds = buildNotificationIds(next, state.products);
      const previous = state.products;
      state.products = existing
        ? state.products.map(product => product.id === existing.id ? next : product)
        : [...state.products, next];
      try {
        save();
      } catch (saveError) {
        state.products = previous;
        error.textContent = saveError.message;
        return;
      }
      formDialog.close();
      render();
      if (state.remindersEnabled && Capacitor.isNativePlatform()) await refreshNotificationsAfterSave();
    }
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-scan-barcode]').addEventListener('click', () => startBarcodeScan(dialog));
  dialog.querySelector('#routine-name').focus();
}

async function startBarcodeScan(dialog) {
  const error = dialog.querySelector('.form-error');
  try {
    const supported = await BarcodeScanner.isSupported();
    if (!supported.supported) {
      error.textContent = 'Camera scanning is not available here. Enter the barcode manually instead.';
      return;
    }
    let permission = await BarcodeScanner.checkPermissions();
    if (permission.camera !== 'granted') permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted') {
      error.textContent = 'Camera access was not granted. Allow camera access in your device or browser settings, or enter the code manually.';
      return;
    }
  } catch (permissionError) {
    error.textContent = `Camera access could not be checked: ${permissionError.message}`;
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'barcode-scan-overlay';
  const video = document.createElement('video');
  video.className = 'barcode-scan-video';
  video.setAttribute('aria-hidden', 'true');
  video.playsInline = true;
  overlay.append(video);
  overlay.insertAdjacentHTML('beforeend', '<div class="barcode-scan-top"><strong>Scan package barcode</strong><p>Point the camera at the barcode. Mediketh saves only the code.</p></div><div class="barcode-scan-frame" aria-hidden="true"></div><button class="soft-button barcode-scan-cancel" type="button">Cancel scan</button>');
  dialog.classList.add('barcode-scan-active');
  document.body.classList.add('barcode-scanner-active');
  document.documentElement.classList.add('barcode-scanner-active');
  if (Capacitor.isNativePlatform()) document.body.classList.add('native-barcode-scanner');
  dialog.append(overlay);
  const cancel = overlay.querySelector('.barcode-scan-cancel');
  cancel.disabled = true;
  let active = true;
  let scannerStarted = false;
  const listeners = [];

  const finish = async (barcode, message) => {
    if (!active) return;
    active = false;
    let cleanupError = null;
    try {
      if (scannerStarted) await BarcodeScanner.stopScan();
    } catch (stopError) {
      cleanupError = stopError;
    }
    for (const listener of listeners) {
      try {
        await listener.remove();
      } catch (removeError) {
        cleanupError ||= removeError;
      }
    }
    dialog.classList.remove('barcode-scan-active');
    document.body.classList.remove('barcode-scanner-active', 'native-barcode-scanner');
    document.documentElement.classList.remove('barcode-scanner-active');
    overlay.remove();
    if (cleanupError) {
      error.textContent = `Scanner could not shut down cleanly: ${cleanupError.message}`;
      return;
    }
    if (barcode) {
      dialog.querySelector('#routine-barcode').value = barcode;
      error.textContent = 'Barcode scanned. Enter and verify the package name; no product details or dose were looked up.';
    } else if (message) {
      error.textContent = message;
    }
  };

  dialog.addEventListener('close', () => {
    if (active) void finish('', '');
  }, { once: true });
  cancel.addEventListener('click', () => finish('', 'Barcode scan cancelled.'));
  try {
    listeners.push(await BarcodeScanner.addListener('barcodesScanned', event => {
      const barcode = event.barcodes.find(item => typeof item.rawValue === 'string' && item.rawValue.trim());
      if (!barcode) return;
      if (barcode.rawValue.length > 64) {
        error.textContent = 'This barcode is too long to save. You can enter a shorter code manually.';
        return;
      }
      finish(barcode.rawValue.trim(), '');
    }));
    listeners.push(await BarcodeScanner.addListener('scanError', event => {
      finish('', `Barcode scan failed: ${event.message}`);
    }));
    scannerStarted = true;
    await BarcodeScanner.startScan({
      formats: [BarcodeFormat.Ean8, BarcodeFormat.Ean13, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code128],
      lensFacing: LensFacing.Back,
      videoElement: Capacitor.isNativePlatform() ? undefined : video
    });
    if (active) cancel.disabled = false;
  } catch (scanError) {
    await finish('', `Barcode scanner could not start: ${scanError.message}`);
  }
}

function optionalInteger(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function buildNotificationIds(product, allProducts) {
  const used = new Set(allProducts.filter(item => item.id !== product.id).flatMap(item => Object.values(item.notificationIds || {}).flatMap(days => Object.values(days))));
  const result = {};
  for (const time of product.times) {
    result[time] = {};
    for (const day of product.days) {
      const saved = product.notificationIds?.[time]?.[day];
      if (Number.isInteger(saved) && saved > 0 && !used.has(saved)) {
        result[time][day] = saved;
        used.add(saved);
      } else {
        result[time][day] = notificationIdFor(`${product.id}:${time}:${day}`, used);
      }
    }
  }
  return result;
}

function confirmRemove(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const dialog = openDialog({
    title: 'Remove this item?',
    description: `Remove ${escapeHtml(product.name)} from your routine? Past records will stay in your history.`,
    actions: '<button class="soft-button" type="button" data-cancel>Keep item</button><button class="danger-button" type="button" data-remove>Remove item</button>'
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-remove]').addEventListener('click', async () => {
    const previous = state.products;
    state.products = state.products.filter(item => item.id !== productId);
    try {
      save();
      dialog.close();
      render();
      if (state.remindersEnabled && Capacitor.isNativePlatform()) await refreshNotificationsAfterSave();
    } catch (error) {
      state.products = previous;
      pushToast(error.message, 'error');
    }
  });
}

async function setDoseStatus(productId, time, status, day) {
  if (day !== todayKey()) return;
  const key = doseKey(productId, time);
  const existing = dayLog(day)[key];
  const nextStatus = status === 'taken' && existing?.status === 'taken' ? '' : status;
  const previous = state.logs;
  state.logs = { ...state.logs };
  const log = { ...dayLog(day) };
  if (!log[DAY_SNAPSHOT_KEY]) {
    log[DAY_SNAPSHOT_KEY] = state.products
      .filter(product => scheduleApplies(product, day))
      .flatMap(product => product.times.map(doseTime => ({ id: product.id, name: product.name, kind: product.kind, time: doseTime, key: doseKey(product.id, doseTime) })));
  }
  if (nextStatus) log[key] = { status: nextStatus, at: new Date().toISOString() };
  else delete log[key];
  if (!Object.keys(log).some(entryKey => ![DAY_SNAPSHOT_KEY, DAY_NOTE_KEY].includes(entryKey))) delete log[DAY_SNAPSHOT_KEY];
  if (!Object.keys(log).length) delete state.logs[day];
  else state.logs[day] = log;
  try {
    save();
    if (Capacitor.isNativePlatform()) {
      try {
        await cancelNotifications([snoozeNotificationId(day, key)]);
      } catch (error) {
        pushToast(`Status saved, but the snoozed notification could not be cleared: ${error.message}`, 'error');
      }
    }
    render();
    pushToast(nextStatus === 'taken' ? 'Confirmation saved.' : nextStatus === 'skipped' ? 'Marked as skipped. Follow your care instructions.' : 'Confirmation undone.');
  } catch (error) {
    state.logs = previous;
    pushToast(error.message, 'error');
  }
}

async function snoozeDose(productId, time, day) {
  if (!Capacitor.isNativePlatform()) {
    pushToast('Snooze reminders are available in the installed Android app.', 'info');
    return;
  }
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const key = doseKey(productId, time);
  const until = new Date(Date.now() + 10 * 60 * 1000);
  const notificationId = snoozeNotificationId(day, key);
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationId,
        title: 'Mediketh reminder',
        body: `Reminder: ${product.name}`,
        schedule: { at: until },
        extra: { mediketh: true, day, key }
      }]
    });
    const previous = state.logs;
    state.logs = { ...state.logs };
    state.logs[day] = { ...dayLog(day), [key]: { ...(dayLog(day)[key] || {}), snoozedUntil: until.toISOString() } };
    try {
      save();
      render();
      pushToast('Reminder snoozed for 10 minutes.');
    } catch (error) {
      state.logs = previous;
      await cancelNotifications([notificationId]);
      throw error;
    }
  } catch (error) {
    pushToast(`Could not snooze reminder: ${error.message}`, 'error');
  }
}

function saveDailyNote(note, day) {
  if (day > todayKey()) {
    pushToast('Notes for future dates cannot be saved.', 'error');
    return;
  }
  const previous = state.logs;
  state.logs = { ...state.logs };
  const log = { ...dayLog(day) };
  if (note.trim()) log[DAY_NOTE_KEY] = note.trim();
  else delete log[DAY_NOTE_KEY];
  if (Object.keys(log).length) state.logs[day] = log;
  else delete state.logs[day];
  try {
    save();
    render();
    pushToast('Your note is saved on this device.');
  } catch (error) {
    state.logs = previous;
    pushToast(error.message, 'error');
  }
}

function updatePreference(key, value) {
  const previous = state.preferences;
  state.preferences = { ...state.preferences, [key]: value };
  try {
    save();
    render();
    pushToast('Preference updated.');
  } catch (error) {
    state.preferences = previous;
    pushToast(error.message, 'error');
  }
}

function updateStock(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const dialog = openDialog({
    title: `Update supply for ${escapeHtml(product.name)}`,
    description: 'This is a manual estimate; Mediketh does not infer doses or automatically reduce the count.',
    content: `<label for="stock-value">Units currently in supply</label><input id="stock-value" type="number" min="0" step="1" required value="${product.stock ?? ''}"><label for="stock-threshold">Remind me when supply reaches</label><input id="stock-threshold" type="number" min="0" step="1" value="${product.refillAt ?? ''}">`,
    actions: '<button class="soft-button" type="button" data-cancel>Cancel</button><button class="primary-button" type="submit">Save supply</button>',
    onSubmit: formDialog => {
      const stock = optionalInteger(formDialog.querySelector('#stock-value').value);
      const threshold = optionalInteger(formDialog.querySelector('#stock-threshold').value);
      if (stock === null) {
        pushToast('Enter a non-negative whole number for supply.', 'error');
        return;
      }
      const previous = state.products;
      state.products = state.products.map(item => item.id === productId ? { ...item, stock, refillAt: threshold } : item);
      try {
        save();
        formDialog.close();
        render();
        pushToast('Supply updated.');
      } catch (error) {
        state.products = previous;
        pushToast(error.message, 'error');
      }
    }
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
}

function exportBackup() {
  const writeBackup = async () => {
    const payload = {
      format: 'mediketh-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state
    };
    const fileName = `mediketh-backup-${todayKey()}.json`;
    const json = JSON.stringify(payload, null, 2);
    if (Capacitor.isNativePlatform()) {
      const file = await Filesystem.writeFile({
        path: fileName,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      });
      await Share.share({
        title: 'Mediketh backup',
        text: 'Choose a private place to save this Mediketh backup.',
        files: [file.uri],
        dialogTitle: 'Save your Mediketh backup'
      });
      pushToast('Backup ready to save. Keep it somewhere private.');
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast('Backup downloaded. Store it somewhere private.');
  };
  writeBackup().catch(error => pushToast(`Backup could not be exported: ${error.message}`, 'error'));
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('Backup file is too large.');
    const backup = JSON.parse(await file.text());
    if (backup?.format !== 'mediketh-backup' || backup.version !== 1 || !backup.data || !Array.isArray(backup.data.products) || typeof backup.data.logs !== 'object') {
      throw new Error('This is not a supported Mediketh backup.');
    }
    const candidate = normalizeBackup(backup.data);
    const dialog = openDialog({
      title: 'Replace local data?',
      description: 'Importing replaces this device’s current routine, notes, and history. Export a backup first if you want to keep the current data.',
      actions: '<button class="soft-button" type="button" data-cancel>Cancel</button><button class="danger-button" type="button" data-confirm-import>Replace and import</button>'
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-confirm-import]').addEventListener('click', async () => {
      const previous = state;
      state = candidate;
      try {
        save();
        dialog.close();
        render();
        if (state.remindersEnabled && Capacitor.isNativePlatform()) await refreshNotificationsAfterSave();
        pushToast('Backup restored on this device.');
      } catch (error) {
        state = previous;
        pushToast(`Backup could not be restored: ${error.message}`, 'error');
      }
    });
  } catch (error) {
    pushToast(error.message, 'error');
  }
}

function normalizeBackup(data) {
  const used = new Set();
  const products = data.products.map(product => normalizeProduct(product, used)).filter(Boolean);
  if (!data.logs || typeof data.logs !== 'object' || Array.isArray(data.logs)) throw new Error('Backup history has an invalid format.');
  return {
    ...emptyState(),
    products,
    logs: normalizeLogs(data.logs, products),
    remindersEnabled: false,
    needsLegacyNotificationCleanup: true,
    preferences: normalizePreferences(data.preferences)
  };
}

function confirmDeleteData() {
  const dialog = openDialog({
    title: 'Delete all local data?',
    description: 'This permanently deletes routines, notes, history, and preferences from this device. Export a backup first if needed.',
    actions: '<button class="soft-button" type="button" data-cancel>Cancel</button><button class="danger-button" type="button" data-confirm-delete>Delete everything</button>'
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
    try {
      if (Capacitor.isNativePlatform()) await cancelMedikethNotifications();
      localStorage.removeItem(STORAGE_KEY);
      state = emptyState();
      selectedDate = todayKey();
      dialog.close();
      navigate('today');
      pushToast('All local app data was deleted.');
    } catch (error) {
      pushToast(`Data could not be deleted: ${error.message}`, 'error');
    }
  });
}

function renderDoseNotifications() {
  const notifications = [];
  const used = new Set();
  for (const product of state.products) {
    for (const time of product.times) {
      for (const day of product.days) {
        const [hour, minute] = time.split(':').map(Number);
        const id = product.notificationIds?.[time]?.[day] || notificationIdFor(`${product.id}:${time}:${day}`, used);
        used.add(id);
        notifications.push({
          id,
          title: 'Mediketh reminder',
          body: `Time for your routine: ${product.name}`,
          schedule: { on: { weekday: day === 7 ? 1 : day + 1, hour, minute }, allowWhileIdle: true },
          extra: { mediketh: true, productId: product.id, time, weekday: day }
        });
      }
    }
  }
  for (const [day, log] of Object.entries(state.logs)) {
    for (const [key, record] of Object.entries(log)) {
      if (record?.snoozedUntil && new Date(record.snoozedUntil) > new Date()) {
        const notificationId = notificationIdFor(`snooze:${day}:${key}`, used);
        notifications.push({
          id: notificationId,
          title: 'Mediketh reminder',
          body: 'Your snoozed routine reminder.',
          schedule: { at: new Date(record.snoozedUntil) },
          extra: { mediketh: true, day, key }
        });
      }
    }
  }
  if (notifications.length > 200) throw new Error('This routine has too many reminder occurrences to schedule at once.');
  return notifications;
}

async function cancelNotifications(ids = []) {
  const pending = await LocalNotifications.getPending();
  const owned = pending.notifications.filter(notification => notification.title === 'Mediketh reminder').map(notification => notification.id);
  const allIds = [...new Set([...owned, ...ids])];
  if (allIds.length) await LocalNotifications.cancel({ notifications: allIds.map(id => ({ id })) });
}

async function refreshNotificationsAfterSave() {
  try {
    await syncNotifications();
    reminderSyncWarning = '';
  } catch (error) {
    reminderSyncWarning = error.message;
    pushToast(`Routine saved, but reminders could not be refreshed: ${error.message}`, 'error');
  }
}

async function syncNotifications() {
  const run = async () => {
    const notifications = renderDoseNotifications();
    await cancelNotifications(notifications.map(notification => notification.id));
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  };
  const pending = notificationSync.then(run, run);
  notificationSync = pending.catch(() => {});
  await pending;
}

async function toggleReminders() {
  if (!Capacitor.isNativePlatform()) {
    pushToast('Install the Android app to use device notifications.', 'info');
    return;
  }
  try {
    if (state.remindersEnabled) {
      await syncNotifications();
      pushToast('Daily reminders refreshed.');
      return;
    }
    if (!state.products.length) {
      pushToast('Add a routine item before enabling reminders.', 'info');
      return;
    }
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== 'granted') throw new Error('Notification permission was not granted. You can enable it in device settings.');
    await syncNotifications();
    state.remindersEnabled = true;
    try {
      save();
    } catch (error) {
      state.remindersEnabled = false;
      await cancelNotifications();
      throw error;
    }
    render();
    pushToast('Daily reminders are on.');
  } catch (error) {
    pushToast(`Notifications could not be enabled: ${error.message}`, 'error');
  }
}

function start() {
  const requestedRoute = location.hash.slice(1);
  if (ROUTES.includes(requestedRoute)) currentRoute = requestedRoute;
  window.addEventListener('popstate', event => {
    currentRoute = ROUTES.includes(event.state?.route) ? event.state.route : ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
    selectedDate = event.state?.date || todayKey();
    render();
  });
  render();
  if (Capacitor.isNativePlatform() && state.needsLegacyNotificationCleanup) {
    cancelNotifications()
      .then(() => {
        state.needsLegacyNotificationCleanup = false;
        save();
      })
      .catch(error => pushToast(`Old reminders could not be cleared: ${error.message}`, 'error'));
  }
}

start();
