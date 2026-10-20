'use strict';
/* ==========================================================
   App: navegação, renderização, eventos globais, atalhos,
   lembretes e inicialização.
   ========================================================== */

const VIEWS = [
  { id: 'hoje', label: 'Hoje', icon: 'sun' },
  { id: 'semana', label: 'Essa semana', icon: 'week' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'faculdade', label: 'Faculdade', icon: 'book' },
  { id: 'trabalho', label: 'Trabalho', icon: 'briefcase' },
  { id: 'habitos', label: 'Hábitos', icon: 'flame' },
  { id: 'metas', label: 'Metas', icon: 'target' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear', bottom: true },
  { id: 'admin', label: 'Admin', icon: 'shield', bottom: true, adminOnly: true },
];
/** Telas que o usuário logado pode ver (Admin só para admins). */
const views = () => VIEWS.filter(v => !v.adminOnly || Auth.isAdmin());
const TAB_VIEWS = ['hoje', 'semana', 'agenda', 'faculdade'];

/* ---------- Renderização ---------- */

function navLink(v) {
  const on = state.view === v.id;
  return `<a href="#/${v.id}" class="${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${v.label}</span></a>`;
}

function renderNav() {
  const vs = views();
  $('#nav').innerHTML = vs.filter(v => !v.bottom).map(navLink).join('') + '<div class="nav-sep"></div>' + vs.filter(v => v.bottom).map(navLink).join('');
  const moreOn = !TAB_VIEWS.includes(state.view);
  $('#tabbar').innerHTML = vs.filter(v => TAB_VIEWS.includes(v.id)).map(navLink).join('')
    + `<button class="${moreOn ? 'active' : ''}" data-action="more-menu" aria-label="Mais seções">${icon('more')}<span>${moreOn ? VIEWS.find(v => v.id === state.view).label : 'Mais'}</span></button>`;
}

function render() {
  renderNav();
  const r = (screens[state.view] || screens.hoje)();
  $('#topbar').innerHTML = r.head;
  const view = $('#view');
  view.innerHTML = r.body;
  view.className = `view-${state.view}`;
  r.after?.();
}

function route() {
  const [v, param = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const view = views().some(x => x.id === v) ? v : 'hoje';
  const changed = view !== state.view || param !== state.param;
  state.view = view;
  state.param = decodeURIComponent(param);
  closeMenu();
  closeModal();
  render();
  if (changed) window.scrollTo(0, 0);
}

/* ---------- Menus ---------- */

function quickNew(anchor) {
  openMenu(anchor, [
    { label: 'Compromisso ou consulta', icon: 'calendar', key: 'E', run: () => eventForm(null, state.view === 'agenda' ? state.selected : today()) },
    { label: 'Bloco no cronograma da semana', icon: 'week', key: 'B', run: () => actions['new-block']() },
    { label: 'Prova, trabalho ou atividade', icon: 'book', key: 'P', run: () => assessmentForm(null, { date: state.view === 'agenda' ? state.selected : '' }) },
    { label: 'Entrega do trabalho', icon: 'briefcase', key: 'W', run: () => deliverableForm(null, state.view === 'agenda' ? state.selected : '') },
    { sep: true },
    { label: 'Matéria', icon: 'book', run: () => subjectForm() },
    { label: 'Hábito', icon: 'flame', run: () => habitForm() },
    { label: 'Atividade / meta', icon: 'target', run: () => activityForm() },
  ]);
}

Object.assign(actions, {
  'quick-new': el => quickNew(el),
  'more-menu': el => openMenu(el, views().filter(v => !TAB_VIEWS.includes(v.id)).map(v => ({
    label: v.label, icon: v.icon, run: () => { location.hash = `#/${v.id}`; },
  }))),
});

/* ---------- Eventos globais ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) {
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
    return;
  }
  // Clique num espaço vazio da grade semanal: novo compromisso (Agenda) ou bloco (Essa semana) naquele horário.
  const col = e.target.closest('.tg-col');
  if (col) {
    const y = e.clientY - col.getBoundingClientRect().top;
    const start = fromMin(Math.min(Math.floor(y / HOUR * 2) * 30, 23 * 60));
    if (col.closest('.plan-grid')) blockForm(null, col.dataset.date, start);
    else eventForm(null, col.dataset.date, start);
  }
});

document.addEventListener('dblclick', e => {
  const cell = e.target.closest('.mcell');
  if (cell && !e.target.closest('.chip')) eventForm(null, cell.dataset.date);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'screen-time') return saveScreenTime(form);
  if (form.dataset.form === 'quick-content') {
    const text = form.elements.q.value.trim();
    if (!text) return;
    Store.upsert('contents', { id: uid(), subjectId: form.dataset.id, title: text, date: '', done: false });
    render();
    $('[data-form="quick-content"] input')?.focus();
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'work-search') {
    state.workQuery = t.value;
    $('#kanban').innerHTML = kanbanHTML();
  } else if (t.id === 'accent-input') {
    Store.settings.accent = t.value; // prévia ao vivo; salva no "change"
    applyTheme();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.setting) {
    const key = t.dataset.setting;
    Store.settings[key] = ['weekStart', 'dayStart'].includes(key) ? +t.value : t.value.trim();
    if (key === 'dayStart') state.gridScroll = null;
    Store.saveSettings();
    applyTheme();
    render();
  } else if (t.id === 'accent-input') {
    Store.settings.accent = t.value;
    Store.saveSettings();
    applyTheme();
    render();
  } else if (t.dataset.editColl) {
    const item = Store.get(t.dataset.editColl, t.dataset.id);
    if (!item) return;
    const v = t.value.trim();
    if (t.dataset.field === 'name' && !v) { t.value = item.name; return; }
    item[t.dataset.field] = v;
    Store.upsert(t.dataset.editColl, item);
    render();
  } else if (t.id === 'import-file') {
    importFile(t.files[0]);
    t.value = '';
  } else if (t.id === 'file-input') {
    addFiles(t.dataset.id, t.files);
  } else if (t.id === 'fac-subject-filter') {
    state.facSubject = t.value;
    render();
  } else if (t.name === 'date' && t.closest('[data-form="screen-time"]')) {
    state.screenDay = t.value || today();
    render();
  }
});

document.addEventListener('keydown', e => {
  if (!Auth.user || !$('#auth').hidden) return; // tela de entrada: sem atalhos
  if (!$('#dialog').hidden) return; // o diálogo trata o próprio teclado
  if ($('#menu')) { if (e.key === 'Escape') closeMenu(); return; }
  if (!$('#modal').hidden) {
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#modal form')?.requestSubmit();
    return;
  }
  if (e.target.closest('input, textarea, select, [contenteditable]')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const anchor = [...document.querySelectorAll('[data-action="quick-new"]')].find(b => b.offsetParent);
  if (k === 'n' && anchor) quickNew(anchor);
  else if (k === 'e') eventForm(null, state.view === 'agenda' ? state.selected : today());
  else if (k === 'p') assessmentForm(null);
  else if (k === 'w') deliverableForm(null);
  else if (k === 'b') actions['new-block']();
  else if (/^[1-9]$/.test(k) && views()[+k - 1]) location.hash = `#/${views()[+k - 1].id}`;
  else if (state.view === 'agenda' && k === 'arrowleft') navCal(-1);
  else if (state.view === 'agenda' && k === 'arrowright') navCal(1);
  else if (state.view === 'semana' && k === 'arrowleft') navPlan(-1);
  else if (state.view === 'semana' && k === 'arrowright') navPlan(1);
  else return;
  e.preventDefault();
});

/* ---------- Lembretes ---------- */

const FIRED_KEY = 'organizador:lembretes';

function checkReminders() {
  const now = Date.now(), t = today();
  let fired;
  try { fired = JSON.parse(localStorage.getItem(FIRED_KEY)) || []; } catch { fired = []; }
  let changed = false;
  for (const ev of Store.data.events) {
    if (ev.reminder == null || ev.allDay || !ev.start) continue;
    for (const d of occurrences(ev, t, addDays(t, 1))) {
      const at = fromISO(d);
      at.setHours(0, toMin(ev.start) - ev.reminder, 0, 0);
      const key = `${ev.id}@${d}`;
      if (now >= at.getTime() && now - at.getTime() < 10 * 60e3 && !fired.includes(key)) {
        fired.push(key);
        changed = true;
        notify(ev, d);
      }
    }
  }
  if (changed) try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired.slice(-300))); } catch {}
}

function notify(ev, d) {
  const when = ev.reminder === 0 ? 'Agora' : `${relDay(d)} às ${ev.start}`;
  const body = `${when}${ev.location ? ' · ' + ev.location : ''}`;
  toast(`Lembrete: ${ev.title} — ${body}`, null, 12000);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icon-192.png', tag: `${ev.id}@${d}` };
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then(r => r.showNotification(ev.title, opts));
  else try { new Notification(ev.title, opts); } catch {}
}

/* ---------- Inicialização ---------- */

let lastMinute = -1;
function tick() {
  checkReminders();
  const m = nowMin();
  if (m === lastMinute) return;
  lastMinute = m;
  const busy = modalOpen() || $('#menu') || document.activeElement?.matches('input, textarea, select');
  if (!busy && ['hoje', 'agenda', 'semana'].includes(state.view)) render();
}

function dbFailed(e) {
  console.error(e);
  document.body.classList.remove('signed-out');
  $('#auth').hidden = true;
  $('#view').innerHTML = `<div class="card card-pad"><h2>Não foi possível abrir o banco de dados</h2>
    <p class="desc">O navegador bloqueou o armazenamento local (pode acontecer em janelas anônimas). Abra o organizador numa janela normal do Chrome, Edge ou Firefox.</p></div>`;
}

async function init() {
  captureImportFromURL(); // dados do favorito do JupiterWeb saem do endereço antes de tudo
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    if (!await Auth.restore()) return showAuth();
  } catch (e) {
    console.error(e);
    return showAuth();
  }
  await start();
}

/** Abre o banco da conta logada e liga o app (uma vez por carregamento da página). */
async function start() {
  let synced;
  try {
    DB.name = Auth.user.dbName;
    ({ synced } = await Store.load());
  } catch (e) {
    return dbFailed(e);
  }
  if (!Store.settings.name && Auth.user.name) {
    Store.settings.name = Auth.user.name.split(' ')[0];
    Store.saveSettings(true);
  }
  renderAccount();
  state.calMode = Store.settings.calMode || 'mes';
  applyTheme();
  route();
  lastMinute = nowMin();

  window.addEventListener('hashchange', route);
  darkMQ.addEventListener?.('change', () => { if (Store.settings.theme === 'auto') applyTheme(); });
  // Ao voltar para o app: baixa o que mudou em outros aparelhos.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); refreshFromServer(); } });
  window.addEventListener('online', () => refreshFromServer());
  // Outra aba alterou os dados: relê a cópia local.
  if (Store.channel) Store.channel.onmessage = async () => { await Store.loadLocal(); applyTheme(); if (!modalOpen()) render(); };

  checkReminders();
  setInterval(tick, 30e3);
  runPendingImport();
  // Quando o servidor responder: redesenha com os dados dele e oferece trazer dados antigos.
  synced.then(ok => {
    if (ok && Store.changedBySync && !modalOpen()) { applyTheme(); render(); }
    offerLegacyImport();
  });
}

async function refreshFromServer() {
  if (await Store.syncNow() && Store.changedBySync && !modalOpen()) { applyTheme(); render(); }
}

/** Dados salvos neste navegador antes do login: oferece (uma vez) levar para a conta. */
async function offerLegacyImport() {
  const flag = `organizador:legado:${Auth.user.id}`;
  try { if (localStorage.getItem(flag)) return; } catch { return; }
  let legacy = null;
  try { legacy = await Store.legacySummary(); } catch (e) { console.warn(e); }
  if (!legacy) return;
  const n = c => legacy.data[c].length;
  const parts = [[n('subjects'), 'matéria', 'matérias'], [n('events'), 'compromisso', 'compromissos'], [n('blocks'), 'bloco', 'blocos'], [n('deliverables'), 'entrega', 'entregas']]
    .filter(([k]) => k).map(([k, one, many]) => plural(k, one, many));
  const ok = await ask(`Este navegador tem dados de antes do login (${parts.join(', ') || 'alguns registros'}). Levar para a conta de ${Auth.user.name}? Eles passam a valer em qualquer aparelho.`, [
    { label: 'Não', value: false }, { label: 'Levar para a minha conta', value: true, kind: 'primary' }]);
  try { localStorage.setItem(flag, ok ? 'importado' : 'recusado'); } catch {}
  if (!ok) return;
  await Store.importLegacy(legacy);
  applyTheme();
  render();
  toast('Dados levados para a sua conta');
}

function renderAccount() {
  $('#account').innerHTML = `<span class="account-name" title="@${esc(Auth.user.username)}">${esc(Auth.user.name)}</span>
    <button class="btn btn-ghost btn-sm" data-action="logout">${icon('logout')}Sair</button>`;
}

init();
