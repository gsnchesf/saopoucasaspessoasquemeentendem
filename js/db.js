'use strict';
/* ==========================================================
   Banco de dados
   - DB: acesso direto ao IndexedDB (cópia local, por conta).
   - Sync: fila de envio para o servidor (Supabase) e download.
   - Store: cópia em memória + gravação local + fila. As telas só
     conversam com o Store.
   O servidor é a fonte da verdade; a cópia local deixa o app
   abrir rápido e funcionar sem internet (a fila espera a conexão).
   ========================================================== */

const DB_NAME = 'organizador';
const DB_VERSION = 6; // 2: coleção 'blocks' (Essa semana); 3: 'workouts' (rotina de treinos); 4: 'meds' (remédios); 5: finanças; 6: lista de compras

/** Coleções carregadas em memória. Arquivos binários ficam à parte em 'blobs' (só neste aparelho). */
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
  'blocks',        // blocos do cronograma "Essa semana"
  'workouts',      // rotina de treinos (dias, horário, exercícios)
  'meds',          // remédios (todo dia ou toda semana, horários, doses tomadas)
  'recurring',     // finanças: entradas e gastos fixos (salário, aluguel…)
  'transactions',  // finanças: lançamentos (gastos, entradas, fatura paga, poupança)
  'shopping',      // lista de compras (texto e se já comprou)
];

/** Abre (ou cria) um banco local com todas as coleções. */
function openLocalDB(name) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  db: null,
  name: DB_NAME, // trocado pelo banco local da conta logada (ver js/auth.js)

  async open() {
    this.db = await openLocalDB(this.name);
    // Outra aba abriu uma versão nova do app: fecha e recarrega para não travar a atualização.
    this.db.onversionchange = () => { this.db.close(); location.reload(); };
    return this.db;
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

/* ---------- Sincronização com o servidor ----------
   Cada gravação entra numa fila (guardada no banco local) e é enviada
   em seguida. Sem internet, a fila espera; ao voltar, é enviada.
   Exclusões viram linhas com deleted = true, para os outros aparelhos
   saberem que o item sumiu. */

const Sync = {
  outbox: [], // [{ coll, id, data, updatedAt, deleted }]
  flushing: null,
  timer: 0,

  async loadOutbox() { this.outbox = (await DB.get('meta', 'outbox'))?.value || []; },
  saveOutbox() { return DB.put('meta', { key: 'outbox', value: this.outbox }).catch(console.error); },

  enqueue(coll, id, data, deleted = false) {
    this.outbox = this.outbox.filter(o => !(o.coll === coll && o.id === id));
    this.outbox.push({ coll, id, data: deleted ? null : data, updatedAt: data?.updatedAt || Date.now(), deleted });
    this.saveOutbox();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  },

  /** Envia a fila. Devolve true se ficou vazia (ou já estava). */
  flush() {
    if (this.flushing) return this.flushing.then(() => this.flush());
    if (!this.outbox.length || !Auth.user) return Promise.resolve(true);
    const batch = this.outbox.slice();
    this.flushing = (async () => {
      const rows = batch.map(o => ({ user_id: Auth.user.id, coll: o.coll, id: o.id, data: o.data, updated_at: o.updatedAt, deleted: o.deleted }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from('items').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,coll,id' });
        if (error) throw error;
      }
      this.outbox = this.outbox.filter(o => !batch.includes(o)); // o que entrou durante o envio fica
      await this.saveOutbox();
      return !this.outbox.length;
    })().catch(err => { console.warn('Sincronização adiada:', err?.message || err); return false; })
      .finally(() => { this.flushing = null; });
    return this.flushing;
  },

  /** Baixa todos os itens da conta (em páginas de 1000). */
  async pull() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('items').select('coll, id, data, deleted').order('coll').order('id').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  },
};

/* ---------- Store ---------- */

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
  hasSettings: false,
  illustration: '', // imagem escolhida pela pessoa (data URL), sincronizada como meta/illustration
  channel: 'BroadcastChannel' in window ? new BroadcastChannel('organizador') : null,

  /** Abre a cópia local e sincroniza com o servidor. Com cópia local, o app já abre com ela e a
      sincronização segue em segundo plano ({ synced }); sem cópia (primeira vez neste aparelho),
      espera o servidor. Sem internet, fica com a cópia local. */
  async load() {
    if (!DB.db) await DB.open();
    await this.loadLocal();
    const firstTime = !this.hasSettings;
    const synced = this.syncNow().then(async ok => {
      // Conteúdo inicial só para conta nova de verdade (servidor confirmou que está vazio).
      if (ok && !this.hasSettings) await this.seed();
      return ok;
    });
    if (firstTime) await synced;
    return { synced };
  },

  async loadLocal() {
    const lists = await Promise.all(COLLECTIONS.map(c => DB.all(c)));
    COLLECTIONS.forEach((c, i) => { this.data[c] = lists[i] || []; });
    const saved = await DB.get('meta', 'settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(saved?.value || {}) };
    this.hasSettings = !!saved;
    this.illustration = (await DB.get('meta', 'illustration'))?.value || '';
    await Sync.loadOutbox();
  },

  /** Envia o que está na fila e troca a cópia local pelo que está no servidor. */
  async syncNow() {
    if (!Auth.user) return false;
    try {
      if (!await Sync.flush()) return false;
      await this.applyRemote(await Sync.pull());
      return true;
    } catch (err) {
      console.warn('Sem sincronização agora:', err?.message || err);
      return false;
    }
  },

  /** Assinatura do conteúdo (ids + data de alteração), para saber se o servidor trouxe algo novo. */
  signature() {
    return JSON.stringify([COLLECTIONS.map(c => this.data[c].map(x => `${x.id}:${x.updatedAt || 0}`).sort().join(',')), this.settings, this.illustration.length]);
  },

  async applyRemote(rows) {
    const before = this.signature();
    const by = Object.fromEntries(COLLECTIONS.map(c => [c, new Map()]));
    let settings = null, illustration = '';
    for (const r of rows) {
      if (r.coll === 'meta') {
        if (r.id === 'settings' && !r.deleted) settings = r.data;
        if (r.id === 'illustration' && !r.deleted) illustration = r.data?.src || '';
        continue;
      }
      if (!r.deleted && by[r.coll]) by[r.coll].set(r.id, r.data);
    }
    // O que foi alterado durante o download ainda está na fila e vale mais.
    for (const o of Sync.outbox) {
      if (o.coll === 'meta') {
        if (o.id === 'settings' && !o.deleted) settings = o.data;
        if (o.id === 'illustration') illustration = o.deleted ? '' : o.data?.src || '';
        continue;
      }
      if (!by[o.coll]) continue;
      if (o.deleted) by[o.coll].delete(o.id); else by[o.coll].set(o.id, o.data);
    }
    const lists = Object.fromEntries(COLLECTIONS.map(c => [c, [...by[c].values()]]));
    await DB.tx(COLLECTIONS, 'readwrite', t => COLLECTIONS.forEach(c => {
      const s = t.objectStore(c);
      s.clear();
      lists[c].forEach(x => s.put(x));
    }));
    COLLECTIONS.forEach(c => { this.data[c] = lists[c]; });
    if (illustration !== this.illustration) {
      this.illustration = illustration;
      await (illustration ? DB.put('meta', { key: 'illustration', value: illustration }) : DB.del('meta', 'illustration'));
    }
    if (settings) {
      const { updatedAt, ...s } = settings;
      this.settings = { ...DEFAULT_SETTINGS, ...s };
      this.hasSettings = true;
      await DB.put('meta', { key: 'settings', value: this.settings });
      this.cacheTheme();
    }
    this.changedBySync = this.signature() !== before;
  },

  /** Conteúdo inicial de uma conta nova. */
  async seed() {
    const cats = [
      ['Compromisso', '#4f46e5'], ['Consulta', '#0ea5e9'], ['Trabalho', '#f59e0b'],
      ['Faculdade', '#8b5cf6'], ['Date', '#ec4899'], ['Treino', '#10b981'], ['Pessoal', '#64748b'],
    ];
    const areas = [['Fitness', '#10b981'], ['Projetos paralelos', '#f97316']];
    const writes = [
      ...cats.map(([name, color]) => this.upsert('categories', { id: uid(), name, color }, true)),
      ...areas.map(([name, color]) => this.upsert('areas', { id: uid(), name, color }, true)),
    ];
    await Promise.all([...writes, this.saveSettings(true)]);
  },

  get(coll, id) { return this.data[coll].find(x => x.id === id); },

  /** Insere ou atualiza (memória imediata, banco local e fila do servidor em seguida). */
  upsert(coll, item, quiet = false) {
    const list = this.data[coll];
    const i = list.findIndex(x => x.id === item.id);
    item.updatedAt = Date.now();
    if (i >= 0) list[i] = item;
    else { item.createdAt ??= item.updatedAt; list.push(item); }
    Sync.enqueue(coll, item.id, item);
    return this.write(DB.put(coll, item), quiet);
  },

  remove(coll, id) {
    const list = this.data[coll];
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    const [item] = list.splice(i, 1);
    Sync.enqueue(coll, id, null, true);
    this.write(DB.del(coll, id));
    return item;
  },

  removeWhere(coll, pred) {
    const gone = this.data[coll].filter(pred);
    if (!gone.length) return [];
    this.data[coll] = this.data[coll].filter(x => !pred(x));
    gone.forEach(x => Sync.enqueue(coll, x.id, null, true));
    this.write(DB.delMany(coll, gone.map(x => x.id)));
    return gone;
  },

  cacheTheme() {
    const s = this.settings;
    try { localStorage.setItem('organizador:tema', JSON.stringify({ palette: s.palette, mode: s.theme, accent: s.accent })); } catch {}
  },

  saveSettings(quiet = false) {
    this.cacheTheme();
    this.hasSettings = true;
    Sync.enqueue('meta', 'settings', { ...this.settings, updatedAt: Date.now() });
    return this.write(DB.put('meta', { key: 'settings', value: this.settings }), quiet);
  },

  /** Troca (ou remove, com '') a ilustração da conta. */
  saveIllustration(src) {
    this.illustration = src;
    Sync.enqueue('meta', 'illustration', src ? { src, updatedAt: Date.now() } : null, !src);
    return this.write(src ? DB.put('meta', { key: 'illustration', value: src }) : DB.del('meta', 'illustration'));
  },

  write(promise, quiet = false) {
    if (!quiet) this.channel?.postMessage('changed');
    return promise.catch(err => {
      console.error(err);
      toast('Não foi possível salvar no banco de dados deste navegador.');
    });
  },

  /* ----- Arquivos (binários, só neste aparelho por enquanto) ----- */
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
      items.forEach(x => Sync.enqueue(c, x.id, { ...x, updatedAt: Date.now() }));
      await DB.tx(c, 'readwrite', t => { const s = t.objectStore(c); items.forEach(x => s.put(x)); });
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(obj.settings || {}) };
    await this.saveSettings();
  },

  async wipe(keepSettings = false) {
    for (const c of COLLECTIONS) this.data[c].forEach(x => Sync.enqueue(c, x.id, null, true));
    const stores = [...COLLECTIONS, 'blobs'];
    await DB.tx(stores, 'readwrite', t => stores.forEach(s => t.objectStore(s).clear()));
    COLLECTIONS.forEach(c => { this.data[c] = []; });
    if (!keepSettings) {
      this.settings = { ...DEFAULT_SETTINGS };
      this.hasSettings = false;
      Sync.enqueue('meta', 'settings', null, true);
      await DB.del('meta', 'settings');
    }
    this.channel?.postMessage('changed');
  },

  /* ----- Dados de antes do login (banco local antigo 'organizador') ----- */

  /** Resumo do que existe no banco antigo deste navegador, ou null. */
  async legacySummary() {
    if (!indexedDB.databases || !(await indexedDB.databases()).some(d => d.name === DB_NAME)) return null;
    const db = await openLocalDB(DB_NAME);
    const read = store => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const data = {};
    for (const c of COLLECTIONS) data[c] = await read(c);
    const settings = (await read('meta')).find(m => m.key === 'settings')?.value || null;
    const blobs = await read('blobs');
    db.close();
    const total = ['events', 'subjects', 'assessments', 'deliverables', 'blocks', 'activities', 'absences'].reduce((n, c) => n + data[c].length, 0);
    return total ? { data, settings, blobs } : null;
  },

  /** Junta os dados antigos na conta logada (mesmos ids: não duplica). */
  async importLegacy({ data, settings, blobs }) {
    for (const c of COLLECTIONS) for (const item of data[c]) this.upsert(c, item, true);
    if (settings) {
      const keep = ['semesterStart', 'semesterEnd', 'palette', 'theme', 'accent', 'weekStart', 'dayStart', 'screenLimit'];
      for (const k of keep) if (settings[k] !== undefined && settings[k] !== '') this.settings[k] = settings[k];
      await this.saveSettings(true);
    }
    for (const b of blobs) await this.saveBlob(b.id, b.blob);
    await Sync.flush();
    this.channel?.postMessage('changed');
  },
};

/* ---------- Consultas comuns ---------- */

const cat = id => Store.data.categories.find(c => c.id === id);
const catColor = id => cat(id)?.color || 'var(--faint)';
const subject = id => Store.data.subjects.find(s => s.id === id);
const area = id => Store.data.areas.find(a => a.id === id);
