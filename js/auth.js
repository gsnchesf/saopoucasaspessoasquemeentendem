'use strict';
/* ==========================================================
   Contas: login, sessão e usuários.
   - Admins (lista em js/config.js) criam os usuários (nome,
     usuário e senha inicial); cada um troca a própria senha.
   - As contas de CONFIG.seedUsers são criadas sozinhas em todo
     aparelho que ainda não as tem.
   - As contas ficam num banco próprio ('organizador-contas').
   - Cada conta tem o seu banco de dados (agenda, faculdade…).
   - A senha nunca é gravada: só um hash PBKDF2 com sal.
   Tudo é local deste navegador até existir um servidor.
   ========================================================== */

const ACCOUNTS_DB = 'organizador-contas';
const SESSION_KEY = 'organizador:sessao';
const PBKDF2_ITERATIONS = 600000;
const MIN_PASSWORD = 4;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const normUser = s => String(s ?? '').trim().toLowerCase();

const Auth = {
  db: null,
  user: null,

  open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(ACCOUNTS_DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('users', { keyPath: 'id' });
        store.createIndex('username', 'username', { unique: true });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.seed()); };
      req.onerror = () => reject(req.error);
    });
  },

  req(mode, fn) {
    return new Promise((resolve, reject) => {
      const r = fn(this.db.transaction('users', mode).objectStore('users'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  all() { return this.req('readonly', s => s.getAll()); },
  count() { return this.req('readonly', s => s.count()); },
  byId(id) { return this.req('readonly', s => s.get(id)); },
  byUsername(u) { return this.req('readonly', s => s.index('username').get(normUser(u))); },
  save(user) { return this.req('readwrite', s => s.put(user)); },

  isAdmin(user = this.user) { return !!user && CONFIG.admins.includes(user.username); },

  /** Cria as contas fixas da configuração que ainda não existem neste aparelho. */
  async seed() {
    for (const s of CONFIG.seedUsers) {
      if (await this.byUsername(s.username)) continue;
      const id = uid();
      const first = (await this.count()) === 0;
      await this.save({
        id, name: s.name, username: normUser(s.username), salt: s.salt, hash: s.hash, iterations: s.iterations || PBKDF2_ITERATIONS,
        dbName: first ? DB_NAME : `${DB_NAME}-${id}`, createdAt: Date.now(),
      });
    }
  },

  async hash(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, key, 256));
  },

  async setPassword(user, password) {
    user.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    user.iterations = PBKDF2_ITERATIONS;
    user.hash = await this.hash(password, user.salt, user.iterations);
  },

  async checkPassword(user, password) {
    return (await this.hash(password, user.salt, user.iterations)) === user.hash;
  },

  /** Cria a conta. A primeira do aparelho herda os dados de antes do login. */
  async createUser({ name, username, password }) {
    const id = uid();
    const first = (await this.count()) === 0;
    const user = { id, name: name.trim(), username: normUser(username), dbName: first ? DB_NAME : `${DB_NAME}-${id}`, createdAt: Date.now() };
    await this.setPassword(user, password);
    await this.save(user); // o índice único recusa nomes de usuário repetidos
    return user;
  },

  async login(username, password) {
    const user = await this.byUsername(username);
    // Calcula o hash mesmo sem conta, para a resposta não revelar quais usuários existem.
    const ok = user ? await this.checkPassword(user, password) : (await this.hash(password, b64(new Uint8Array(16)), PBKDF2_ITERATIONS), false);
    return ok ? user : null;
  },

  /** Troca a senha de uma conta (a própria, ou qualquer uma por um admin). */
  async resetPassword(id, password) {
    const user = await this.byId(id);
    await this.setPassword(user, password);
    await this.save(user);
    if (id === this.user?.id) this.user = user;
  },

  async rename(id, name) {
    const user = await this.byId(id);
    user.name = name.trim();
    await this.save(user);
    if (id === this.user?.id) this.user = user;
  },

  /** Exclui a conta e o banco de dados dela. */
  async removeUser(id) {
    const user = await this.byId(id);
    if (!user || user.id === this.user?.id) return;
    await this.req('readwrite', s => s.delete(id));
    indexedDB.deleteDatabase(user.dbName);
  },

  /* ----- Sessão: fica conectado neste aparelho até clicar em "Sair" ----- */

  startSession(user) {
    this.user = user;
    try { localStorage.setItem(SESSION_KEY, user.id); } catch {}
  },

  async restore() {
    let id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch {}
    this.user = id ? await this.byId(id) || null : null;
    return this.user;
  },

  logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    location.reload(); // recarregar garante que nada da conta anterior fica na memória
  },
};

/* ---------- Tela de entrada ---------- */

function showAuth() {
  document.body.classList.add('signed-out');
  const root = $('#auth');
  root.hidden = false;
  root.innerHTML = `<form class="auth-card card" novalidate data-mode="entrar">
    <div class="brand auth-brand"><span class="brand-mark">${icon(document.documentElement.dataset.palette === 'naruto' ? 'spiral' : 'logo')}</span><span>Organizador</span></div>
    <label class="field"><span>Usuário</span><input name="username" maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus></label>
    <label class="field"><span>Senha</span><input type="password" name="password" autocomplete="current-password"></label>
    <p class="form-error" hidden></p>
    <button type="submit" class="btn btn-primary btn-block">Entrar</button>
  </form>`;

  const form = $('form', root);
  $('[autofocus]', form)?.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    if (btn.disabled) return;
    btn.disabled = true;
    let user;
    try {
      user = await submitLogin(form);
    } catch (err) {
      console.error(err);
      return formError(form, 'Não foi possível acessar o banco deste navegador.');
    } finally {
      btn.disabled = false;
    }
    if (!user) return;
    Auth.startSession(user);
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('signed-out');
    await start();
  });
}

async function submitLogin(form) {
  const f = formData(form);
  if (!crypto.subtle) return formError(form, 'Este endereço não é seguro (https), e o navegador bloqueia a criptografia da senha. Abra pelo endereço https ou por localhost.');
  if (!f.username.trim() || !f.password) return formError(form, 'Informe usuário e senha.');
  return await Auth.login(f.username, f.password) || formError(form, 'Usuário ou senha incorretos.');
}

/* ---------- Trocar a própria senha (Ajustes) ---------- */

function passwordForm(user, self) {
  openModal(`<form novalidate>
    ${modalHead(self ? 'Trocar senha' : `Nova senha para ${user.name}`)}
    <div class="modal-body">
      <input type="text" name="username" value="${esc(user.username)}" autocomplete="username" hidden>
      <label class="field"><span>Nova senha</span><input type="password" name="password" autocomplete="new-password" autofocus></label>
      ${self ? '' : '<p class="desc" style="margin:0">Passe a senha para a pessoa; ela pode trocar depois em Ajustes.</p>'}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit: async form => {
      const { password } = formData(form);
      if (password.length < MIN_PASSWORD) return formError(form, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
      await Auth.resetPassword(user.id, password);
      closeModal();
      toast('Senha alterada');
    },
  });
}

Object.assign(actions, {
  'logout': () => Auth.logout(),
  'change-password': () => passwordForm(Auth.user, true),
});
