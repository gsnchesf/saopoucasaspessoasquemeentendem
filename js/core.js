'use strict';
/* ==========================================================
   Núcleo: utilidades, datas, ícones, constantes e estado
   compartilhado entre as telas.
   ========================================================== */

/* ---------- Texto ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/* ---------- Datas ----------
   Datas trafegam como 'AAAA-MM-DD' (horário local) e horas como 'HH:MM'. */

const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => toISO(new Date());
const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const addMonths = (s, n) => {
  const d = fromISO(s), day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISO(d);
};
const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);
const weekday = s => fromISO(s).getDay();
const startOfWeek = (s, weekStart = +Store.settings.weekStart) => addDays(s, -((weekday(s) - weekStart + 7) % 7));
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmt = (s, opts) => fromISO(s).toLocaleDateString('pt-BR', opts);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

function relDay(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  if (n === -1) return 'Ontem';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (s.slice(0, 4) !== today().slice(0, 4)) opts.year = 'numeric';
  return cap(fmt(s, opts).replace(/\./g, ''));
}

/** "em 3 dias", "há 2 dias", "hoje" — para prazos. */
function untilLabel(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Período atual (dia, semana ou mês) que contém a data. */
function periodRange(period, ref = today()) {
  if (period === 'dia') return [ref, ref];
  if (period === 'mes') {
    const first = ref.slice(0, 8) + '01';
    return [first, addDays(addMonths(first, 1), -1)];
  }
  const s = startOfWeek(ref);
  return [s, addDays(s, 6)];
}

function fmtDuration(min) {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${pad(m)}min` : `${h}h`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
}

/* ---------- Constantes ---------- */

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const PALETTES = [
  { id: 'classico', name: 'Clássico', desc: 'Índigo sóbrio, limpo e direto.' },
  { id: 'naruto', name: 'Naruto', desc: 'Laranja de Konoha de dia, noite ninja no escuro.', tagline: 'Não volto atrás na minha palavra. Esse é o meu jeito ninja!', hello: 'ninja' },
  { id: 'sakura', name: 'Sakura', desc: 'Rosé delicado com tipografia serifada.' },
  { id: 'grafite', name: 'Grafite', desc: 'Monocromático com detalhes em bronze.' },
];
const palette = () => PALETTES.find(p => p.id === Store.settings.palette) || PALETTES[0];

const REPEAT_LABELS = {
  none: 'Não repete', daily: 'Todos os dias', weekdays: 'Dias úteis (seg–sex)',
  weekly: 'Toda semana', monthly: 'Todo mês', yearly: 'Todo ano',
};
const REMINDERS = [
  ['', 'Sem lembrete'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'], ['15', '15 min antes'],
  ['30', '30 min antes'], ['60', '1 hora antes'], ['120', '2 horas antes'], ['1440', '1 dia antes'],
];
const ABSENCES_PER_DAY = 4; // faltas permitidas por dia de aula na semana (1 dia = 4, 2 dias = 8)
const ASSESSMENT_KINDS = { prova: 'Prova', trabalho: 'Trabalho', seminario: 'Seminário', atividade: 'Atividade' }; // lista fechada
const DELIVERY_STATUS = [['afazer', 'A fazer'], ['andamento', 'Em andamento'], ['revisao', 'Em revisão'], ['entregue', 'Entregue']];
const PRIORITIES = [['', 'Sem prioridade'], ['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']];
const GOAL_TYPES = { tempo: 'Tempo', vezes: 'Vezes', quantidade: 'Quantidade', objetivo: 'Etapas' };
const PERIODS = { dia: 'dia', semana: 'semana', mes: 'mês' };
const SWATCHES = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];

/* ---------- Ícones (traço, 24×24) ---------- */

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-7 0-3-1.6-5.4-3.4-7.3-.5 2-1.6 3.3-3.1 3.6.6-3.2-.4-6.5-3-9.3C9 5.6 5 8.9 5 15c0 4.3 3 7 7 7z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkSquare: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  week: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M9 9v12M15 9v12M5.5 12.5h1.5M11 15h2M17 12.5h1.5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M14 9l2 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  konoha: '<path d="M12 12a1.75 1.75 0 0 1 3.5 0a3.5 3.5 0 0 1-7 0a5.25 5.25 0 0 1 10.5 0a7 7 0 0 1-14 0M5 12C4.6 8.6 3.6 6.4 2 4.5C5.5 4.6 8 5.6 9.8 7.3"/>',
  logo: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2.5v3M16 2.5v3M8.5 13.5l2.5 2.5 4.5-5"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  pill: '<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="m8.5 8.5 7 7"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1.1a5.5 5.5 0 0 0 0-7.7z"/>',
};

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- Estado de navegação e registros ---------- */

const state = {
  view: 'hoje',
  param: '',            // ex.: id da matéria em #/faculdade/<id>
  cursor: today(),      // data de referência da agenda
  selected: today(),    // dia selecionado na agenda
  calMode: 'mes',
  gridScroll: null,
  planWeek: null,       // semana exibida em "Essa semana" (null = atual)
  planScroll: null,
  facTab: 'materias',
  facSubject: '',
  workQuery: '',
  habitWeek: null,      // início da semana exibida em Hábitos
  screenDay: today(),
  goalArea: '',
};

/** Ações disparadas por elementos com data-action (preenchido por cada módulo). */
const actions = {};
/** Telas: cada uma retorna { head, body, after? } (preenchido por cada módulo). */
const screens = {};
