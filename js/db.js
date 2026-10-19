'use strict';
/* ==========================================================
   Banco de dados
   - DB: acesso direto ao IndexedDB (banco local do navegador).
   - Store: cópia em memória + gravação no banco. As telas só
     conversam com o Store; para sincronizar com um servidor no
     futuro (app mobile), basta trocar a implementação do DB.
   ========================================================== */

const DB_NAME = 'organizador';
const DB_VERSION = 1;

/** Coleções carregadas em memória. Arquivos binários ficam à parte em 'blobs'. */
const COLLECTIONS = [
  'events',        // compromissos, consultas, encontros
  'categories',    // tipos de compromisso (cor + nome)
  'subjects',      // matérias da faculdade, com horários (slots)
  'absences',      // faltas por matéria e data
  'assessments',   // provas, trabalhos e atividades da faculdade
  'contents',      // conteúdos de cada matéria
  'files',         // metadados dos arquivos anexados às matérias
  'deliverables',  // entregas do trabalho
  'habits',        // hábitos personalizados
  'habitLogs',     // registro diário dos hábitos (id = habitId|data)
  'screenTime',    // tempo de tela por dia (id = data)
  'areas',         // áreas de metas: fitness, date, projetos…
  'activities',    // atividades com metas
  'activityLogs',  // registros das atividades
];

const DB = {
  db: null,

  open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of COLLECTIONS) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },

  tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transação abortada'));
    });
  },

  all: (store) => DB.tx(store, 'readonly', t => t.objectStore(store).getAll()),
  get: (store, key) => DB.tx(store, 'readonly', t => t.objectStore(store).get(key)),
  put: (store, value) => DB.tx(store, 'readwrite', t => t.objectStore(store).put(value)),
  del: (store, key) => DB.tx(store, 'readwrite', t => t.objectStore(store).delete(key)),
  delMany: (store, keys) => DB.tx(store, 'readwrite', t => { const s = t.objectStore(store); keys.forEach(k => s.delete(k)); }),
};

const DEFAULT_SETTINGS = {
  theme: 'auto',          // auto | light | dark
  palette: 'classico',
  accent: '',             // cor de destaque personalizada (vazio = da paleta)
  name: '',
  weekStart: 0,           // 0 = domingo, 1 = segunda
  dayStart: 7,            // hora inicial visível na semana
  calMode: 'mes',
  semesterStart: '',
  semesterEnd: '',
  screenLimit: 180,       // limite diário de tempo de tela (min)
};

const Store = {
  data: Object.fromEntries(COLLECTIONS.map(c => [c, []])),
  settings: { ...DEFAULT_SETTINGS },
  channel: 'BroadcastChannel' in window ? new BroadcastChannel('organizador') : null,

  async load() {
    if (!DB.db) await DB.open();
    const lists = await Promise.all(COLLECTIONS.map(c => DB.all(c)));
    COLLECTIONS.forEach((c, i) => { this.data[c] = lists[i] || []; });
    const saved = await DB.get('meta', 'settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(saved?.value || {}) };
    if (!saved) await this.seed();
  },

  /** Conteúdo inicial na primeira execução. */
  async seed() {
    const cats = [
      ['Compromisso', '#4f46e5'], ['Consulta', '#0ea5e9'], ['Trabalho', '#f59e0b'],
      ['Faculdade', '#8b5cf6'], ['Date', '#ec4899'], ['Treino', '#10b981'], ['Pessoal', '#64748b'],
    ];
    const areas = [['Fitness', '#10b981'], ['Date', '#ec4899'], ['Projetos paralelos', '#f97316']];
    const habits = [
      { name: 'Beber água', kind: 'qtd', target: 8, unit: 'copos', color: '#0ea5e9' },
      { name: 'Ler 20 minutos', kind: 'check', color: '#8b5cf6' },
      { name: 'Dormir antes da meia-noite', kind: 'check', color: '#4f46e5' },
    ];
    const writes = [
      ...cats.map(([name, color]) => this.upsert('categories', { id: uid(), name, color }, true)),
      ...areas.map(([name, color]) => this.upsert('areas', { id: uid(), name, color }, true)),
      ...habits.map((h, i) => this.upsert('habits', { id: uid(), weekdays: [0, 1, 2, 3, 4, 5, 6], target: 1, unit: '', order: i, ...h }, true)),
    ];
    await Promise.all([...writes, this.saveSettings(true)]);
  },

  get(coll, id) { return this.data[coll].find(x => x.id === id); },

  /** Insere ou atualiza (memória imediata, banco em seguida). */
  upsert(coll, item, quiet = false) {
    const list = this.data[coll];
    const i = list.findIndex(x => x.id === item.id);
    item.updatedAt = Date.now();
    if (i >= 0) list[i] = item;
    else { item.createdAt ??= item.updatedAt; list.push(item); }
    return this.write(DB.put(coll, item), quiet);
  },

  remove(coll, id) {
    const list = this.data[coll];
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    const [item] = list.splice(i, 1);
    this.write(DB.del(coll, id));
    return item;
  },

  removeWhere(coll, pred) {
    const gone = this.data[coll].filter(pred);
    if (!gone.length) return [];
    this.data[coll] = this.data[coll].filter(x => !pred(x));
    this.write(DB.delMany(coll, gone.map(x => x.id)));
    return gone;
  },

  saveSettings(quiet = false) {
    const s = this.settings;
    try { localStorage.setItem('organizador:tema', JSON.stringify({ palette: s.palette, mode: s.theme, accent: s.accent })); } catch {}
    return this.write(DB.put('meta', { key: 'settings', value: s }), quiet);
  },

  write(promise, quiet = false) {
    if (!quiet) this.channel?.postMessage('changed');
    return promise.catch(err => {
      console.error(err);
      toast('Não foi possível salvar no banco de dados deste navegador.');
    });
  },

  /* ----- Arquivos (binários) ----- */
  saveBlob: (id, blob) => DB.put('blobs', { id, blob }),
  getBlob: async (id) => (await DB.get('blobs', id))?.blob,
  deleteBlobs: (ids) => DB.delMany('blobs', ids),

  /* ----- Backup ----- */
  exportJSON() {
    // Arquivos anexados não entram no JSON (ficaria enorme); os metadados também ficam de fora
    // para o backup não apontar para arquivos que não existem.
    const data = Object.fromEntries(COLLECTIONS.filter(c => c !== 'files').map(c => [c, this.data[c]]));
    return { app: 'organizador', version: DB_VERSION, exportedAt: new Date().toISOString(), settings: this.settings, ...data };
  },

  async importJSON(obj) {
    if (!obj || obj.app !== 'organizador') throw new Error('formato');
    await this.wipe(true);
    for (const c of COLLECTIONS) {
      if (c === 'files') continue;
      const items = Array.isArray(obj[c]) ? obj[c].filter(x => x && typeof x.id === 'string') : [];
      this.data[c] = items;
      await DB.tx(c, 'readwrite', t => { const s = t.objectStore(c); items.forEach(x => s.put(x)); });
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(obj.settings || {}) };
    await this.saveSettings();
  },

  async wipe(keepSettings = false) {
    const stores = [...COLLECTIONS, 'blobs'];
    await DB.tx(stores, 'readwrite', t => stores.forEach(s => t.objectStore(s).clear()));
    COLLECTIONS.forEach(c => { this.data[c] = []; });
    if (!keepSettings) {
      this.settings = { ...DEFAULT_SETTINGS };
      await DB.del('meta', 'settings');
    }
    this.channel?.postMessage('changed');
  },
};

/* ---------- Consultas comuns ---------- */

const cat = id => Store.data.categories.find(c => c.id === id);
const catColor = id => cat(id)?.color || 'var(--faint)';
const subject = id => Store.data.subjects.find(s => s.id === id);
const area = id => Store.data.areas.find(a => a.id === id);
