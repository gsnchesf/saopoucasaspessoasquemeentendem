'use strict';
/* ==========================================================
   Contas: login, sessão e usuários, no Supabase.
   - Login com usuário + senha (vira o e-mail interno do Supabase).
   - Ninguém se cadastra: admins criam as contas (página Admin).
   - Quem é admin fica no banco (profiles.is_admin), e as funções
     de admin conferem isso no servidor (supabase/schema.sql).
   - A sessão fica salva neste aparelho até clicar em "Sair".
   ========================================================== */

const MIN_PASSWORD = 4;
const PROFILE_KEY = 'organizador:perfil'; // último perfil, para abrir sem internet

const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'organizador:sessao' },
});

const normUser = s => String(s ?? '').trim().toLowerCase();
const userEmail = u => `${normUser(u)}@${CONFIG.emailDomain}`;

/** Erro do servidor com a mensagem em português das funções do banco. */
function serverError(error) {
  const msg = error?.message || '';
  if (/fetch|network|Failed to/i.test(msg)) return new Error('Sem conexão com o servidor. Tente de novo.');
  return new Error(msg || 'Erro no servidor.');
}

const Auth = {
  user: null, // { id, username, name, isAdmin, dbName }

  profileFrom(id, p) {
    return { id, username: p.username, name: p.name, isAdmin: !!p.is_admin, dbName: `${DB_NAME}-${id}` };
  },

  /** Lê o perfil no servidor; sem internet, usa o último salvo neste aparelho. */
  async loadProfile(id) {
    const { data, error } = await sb.from('profiles').select('username, name, is_admin').eq('id', id).maybeSingle();
    if (data) {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ id, ...data })); } catch {}
      return this.profileFrom(id, data);
    }
    if (!error) return null; // conta excluída
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch {}
    return cached?.id === id ? this.profileFrom(id, cached) : null;
  },

  async restore() {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user?.id;
    this.user = id ? await this.loadProfile(id) : null;
    if (id && !this.user) await sb.auth.signOut({ scope: 'local' });
    return this.user;
  },

  async login(username, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: userEmail(username), password });
    if (error) {
      if (error.status === 400) return null;
      throw serverError(error);
    }
    this.user = await this.loadProfile(data.user.id);
    return this.user;
  },

  isAdmin(user = this.user) { return !!user?.isAdmin; },

  async logout() {
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    try { localStorage.removeItem(PROFILE_KEY); } catch {}
    location.reload(); // recarregar garante que nada da conta anterior fica na memória
  },

  /* ----- Funções do servidor (as de admin conferem a permissão lá) ----- */

  async rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw serverError(error);
    return data;
  },
  async listUsers() {
    const { data, error } = await sb.from('profiles').select('id, username, name, is_admin').order('name');
    if (error) throw serverError(error);
    return data;
  },
  createUser: ({ name, username, password }) => Auth.rpc('admin_create_user', { p_username: normUser(username), p_name: name.trim(), p_password: password }),
  setPassword: (id, password) => Auth.rpc('set_password', { p_user: id, p_password: password }),
  rename: (id, name) => Auth.rpc('admin_rename_user', { p_user: id, p_name: name.trim() }),
  removeUser: id => Auth.rpc('admin_delete_user', { p_user: id }),
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
    const f = formData(form);
    if (!f.username.trim() || !f.password) return formError(form, 'Informe usuário e senha.');
    btn.disabled = true;
    let user;
    try {
      user = await Auth.login(f.username, f.password);
    } catch (err) {
      return formError(form, err.message);
    } finally {
      btn.disabled = false;
    }
    if (!user) return formError(form, 'Usuário ou senha incorretos.');
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('signed-out');
    await start();
  });
}

/* ---------- Trocar senha (a própria, ou a de alguém pela página Admin) ---------- */

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
      try { await Auth.setPassword(user.id, password); }
      catch (err) { return formError(form, err.message); }
      closeModal();
      toast('Senha alterada');
    },
  });
}

Object.assign(actions, {
  'logout': () => Auth.logout(),
  'change-password': () => passwordForm(Auth.user, true),
});
