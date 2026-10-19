'use strict';
/* ==========================================================
   Contas: cadastro, login e sessão.
   - As contas ficam num banco próprio ('organizador-contas').
   - Cada conta tem o seu banco de dados (agenda, faculdade…).
   - A senha nunca é gravada: só um hash PBKDF2 com sal.
   Tudo é local deste navegador até existir um servidor.
   ========================================================== */

const ACCOUNTS_DB = 'organizador-contas';
const SESSION_KEY = 'organizador:sessao';
const PBKDF2_ITERATIONS = 600000;
const MIN_PASSWORD = 6;

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
      req.onsuccess = () => { this.db = req.result; resolve(); };
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

  count() { return this.req('readonly', s => s.count()); },
  byId(id) { return this.req('readonly', s => s.get(id)); },
  byUsername(u) { return this.req('readonly', s => s.index('username').get(normUser(u))); },
  save(user) { return this.req('readwrite', s => s.put(user)); },

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

  /** Cria a conta. A primeira conta do aparelho herda os dados que já existiam antes do login. */
  async register({ name, username, password }) {
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

  async changePassword(current, next) {
    const user = await this.byId(this.user.id);
    if (!await this.checkPassword(user, current)) return false;
    await this.setPassword(user, next);
    await this.save(user);
    this.user = user;
    return true;
  },

  /* ----- Sessão: "manter conectado" usa localStorage; senão, só até fechar a janela ----- */

  startSession(user, remember) {
    this.user = user;
    try {
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, user.id);
      (remember ? sessionStorage : localStorage).removeItem(SESSION_KEY);
    } catch {}
  },

  async restore() {
    let id = null;
    try { id = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch {}
    this.user = id ? await this.byId(id) || null : null;
    return this.user;
  },

  logout() {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch {}
    location.reload(); // recarregar garante que nada da conta anterior fica na memória
  },
};

/* ---------- Tela de entrada ---------- */

async function showAuth(mode) {
  const firstAccount = (await Auth.count()) === 0;
  mode ||= firstAccount ? 'cadastro' : 'entrar';
  const signup = mode === 'cadastro';
  document.body.classList.add('signed-out');
  const root = $('#auth');
  root.hidden = false;
  root.innerHTML = `<form class="auth-card card" novalidate data-mode="${mode}">
    <div class="brand auth-brand"><span class="brand-mark">${icon(document.documentElement.dataset.palette === 'naruto' ? 'spiral' : 'logo')}</span><span>Organizador</span></div>
    <h1>${signup ? 'Criar conta' : 'Entrar'}</h1>
    <p class="desc">${signup
      ? (firstAccount ? 'Crie a primeira conta deste aparelho. Os dados que já estão aqui ficam com ela.' : 'Cada conta tem a sua própria agenda e os seus próprios dados.')
      : 'Entre para ver a sua agenda.'}</p>
    ${signup ? '<label class="field"><span>Nome</span><input name="name" maxlength="40" autocomplete="name" autofocus></label>' : ''}
    <label class="field"><span>Usuário</span><input name="username" maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false" ${signup ? '' : 'autofocus'}></label>
    <label class="field"><span>Senha</span><input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    ${signup ? '<label class="field"><span>Repita a senha</span><input type="password" name="password2" autocomplete="new-password"></label>' : ''}
    <label class="check"><input type="checkbox" name="remember" checked> Manter conectado neste aparelho</label>
    <p class="form-error" hidden></p>
    <button type="submit" class="btn btn-primary btn-block">${signup ? 'Criar conta' : 'Entrar'}</button>
    ${firstAccount && signup ? '' : `<p class="auth-switch">${signup ? 'Já tem conta?' : 'Ainda não tem conta?'}
      <button type="button" class="btn btn-ghost btn-sm" data-auth-mode="${signup ? 'entrar' : 'cadastro'}">${signup ? 'Entrar' : 'Criar conta'}</button></p>`}
  </form>`;

  const form = $('form', root);
  $('[autofocus]', form)?.focus();
  $('[data-auth-mode]', form)?.addEventListener('click', e => showAuth(e.currentTarget.dataset.authMode));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    if (btn.disabled) return;
    btn.disabled = true;
    let user;
    try {
      user = await submitAuth(form, signup);
    } catch (err) {
      console.error(err);
      return formError(form, 'Não foi possível salvar a conta no banco deste navegador.');
    } finally {
      btn.disabled = false;
    }
    if (!user) return;
    Auth.startSession(user, form.elements.remember.checked);
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('signed-out');
    await start();
  });
}

async function submitAuth(form, signup) {
  const f = formData(form);
  if (!crypto.subtle) return formError(form, 'Este endereço não é seguro (https), e o navegador bloqueia a criptografia da senha. Abra pelo endereço https ou por localhost.');
  if (!signup) {
    if (!f.username.trim() || !f.password) return formError(form, 'Informe usuário e senha.');
    return await Auth.login(f.username, f.password) || formError(form, 'Usuário ou senha incorretos.');
  }
  if (!f.name.trim()) return formError(form, 'Informe seu nome.');
  if (!/^[a-z0-9._-]{3,30}$/.test(normUser(f.username))) return formError(form, 'O usuário precisa ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.');
  if (f.password.length < MIN_PASSWORD) return formError(form, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  if (f.password !== f.password2) return formError(form, 'As senhas não conferem.');
  if (await Auth.byUsername(f.username)) return formError(form, 'Esse usuário já existe neste aparelho.');
  return Auth.register(f);
}

function changePasswordForm() {
  openModal(`<form novalidate>
    ${modalHead('Trocar senha')}
    <div class="modal-body">
      <input type="text" name="username" value="${esc(Auth.user.username)}" autocomplete="username" hidden>
      <label class="field"><span>Senha atual</span><input type="password" name="current" autocomplete="current-password" autofocus></label>
      <label class="field"><span>Nova senha</span><input type="password" name="next" autocomplete="new-password"></label>
      <label class="field"><span>Repita a nova senha</span><input type="password" name="next2" autocomplete="new-password"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit: async form => {
      const f = formData(form);
      if (f.next.length < MIN_PASSWORD) return formError(form, `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
      if (f.next !== f.next2) return formError(form, 'As senhas novas não conferem.');
      if (!await Auth.changePassword(f.current, f.next)) return formError(form, 'A senha atual está incorreta.');
      closeModal();
      toast('Senha alterada');
    },
  });
}

Object.assign(actions, {
  'logout': () => Auth.logout(),
  'change-password': () => changePasswordForm(),
});
