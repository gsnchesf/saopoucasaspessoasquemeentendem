'use strict';
/* ==========================================================
   Admin: só para os usuários de CONFIG.admins. Gerencia o que
   não é pessoal (por enquanto, os usuários). A agenda e os dados
   de cada pessoa continuam só dela.
   ========================================================== */

/** Valida um novo usuário; devolve o texto do erro ou null. */
async function userError({ name, username, password }) {
  if (!name.trim()) return 'Informe o nome.';
  if (!/^[a-z0-9._-]{3,30}$/.test(normUser(username))) return 'O usuário precisa ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.';
  if (password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (await Auth.byUsername(username)) return 'Esse usuário já existe.';
  return null;
}

screens.admin = () => {
  const head = `<div class="title-block"><h1>Admin</h1><p class="sub">Usuários e configurações que não são pessoais</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-user">${icon('plus')}Novo usuário</button></div>`;
  const body = `<div class="settings">
    <section class="card card-pad">
      <h2>Usuários</h2>
      <p class="desc" style="margin:0 0 6px">Você cria o nome, o usuário e a senha inicial. Cada pessoa tem a própria agenda e pode trocar a senha depois em Ajustes.</p>
      <div class="cats" id="users-admin"><p class="empty">Carregando…</p></div>
    </section>
    <section class="card card-pad">
      <h2>Administradores</h2>
      <p class="desc" style="margin:0">${CONFIG.admins.map(a => `<b>${esc(a)}</b>`).join(', ')}. A lista fica em <code>js/config.js</code> no repositório: para mudar, edite o arquivo ou peça ao Claude Code e publique com um commit.</p>
    </section>
  </div>`;
  return { head, body, after: renderUsers };
};

async function renderUsers() {
  const el = $('#users-admin');
  if (!el) return;
  const users = (await Auth.all()).sort((a, b) => Auth.isAdmin(b) - Auth.isAdmin(a) || a.name.localeCompare(b.name));
  el.innerHTML = users.map(u => {
    const self = u.id === Auth.user.id;
    return `<div class="cat-row user-row">
      <span class="user-main"><b>${esc(u.name)}</b><span class="desc">${esc(u.username)}${Auth.isAdmin(u) ? ' · admin' : ''}${self ? ' · você' : ''}</span></span>
      <button class="btn btn-sm" data-action="rename-user" data-id="${esc(u.id)}">${icon('edit')}Nome</button>
      ${self ? '' : `<button class="btn btn-sm" data-action="reset-user-password" data-id="${esc(u.id)}">${icon('key')}Nova senha</button>
        <button class="icon-btn ghost" data-action="remove-user" data-id="${esc(u.id)}" aria-label="Excluir ${esc(u.name)}">${icon('trash')}</button>`}
    </div>`;
  }).join('');
}

function newUserForm() {
  openModal(`<form novalidate>
    ${modalHead('Novo usuário')}
    <div class="modal-body">
      <label class="field"><span>Nome</span><input name="name" maxlength="40" autofocus></label>
      <label class="field"><span>Usuário</span><input name="username" maxlength="30" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="Ex.: joao"></label>
      <label class="field"><span>Senha inicial</span><input type="text" name="password" autocomplete="off" spellcheck="false"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Criar usuário')}
  </form>`, {
    onSubmit: async form => {
      const f = formData(form);
      const err = await userError(f);
      if (err) return formError(form, err);
      await Auth.createUser(f);
      closeModal();
      renderUsers();
      toast(`Usuário ${normUser(f.username)} criado`);
    },
  });
}

function renameForm(u) {
  openModal(`<form novalidate>
    ${modalHead(`Nome de ${u.username}`)}
    <div class="modal-body">
      <label class="field"><span>Nome</span><input name="name" maxlength="40" value="${esc(u.name)}" autofocus></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit: async form => {
      const { name } = formData(form);
      if (!name.trim()) return formError(form, 'Informe o nome.');
      await Auth.rename(u.id, name);
      closeModal();
      if (u.id === Auth.user.id) renderAccount();
      renderUsers();
      toast('Nome alterado');
    },
  });
}

/** Busca o usuário do botão, só se quem clicou for admin. */
const adminTarget = async el => Auth.isAdmin() ? Auth.byId(el.dataset.id) : null;

Object.assign(actions, {
  'new-user': () => Auth.isAdmin() && newUserForm(),
  'rename-user': async el => { const u = await adminTarget(el); if (u) renameForm(u); },
  'reset-user-password': async el => { const u = await adminTarget(el); if (u) passwordForm(u, false); },
  'remove-user': async el => {
    const u = await adminTarget(el);
    if (!u) return;
    const ok = await ask(`Excluir o usuário ${u.username} (${u.name})? A agenda e todos os dados dele neste aparelho serão apagados.`, [
      { label: 'Cancelar', value: false }, { label: 'Excluir', value: true, kind: 'danger' }]);
    if (!ok) return;
    await Auth.removeUser(u.id);
    renderUsers();
    toast('Usuário excluído');
  },
});
