'use strict';
/* ==========================================================
   Admin: só para admins (profiles.is_admin no banco). Gerencia
   o que não é pessoal (por enquanto, os usuários). A agenda e os
   dados de cada pessoa continuam só dela.
   ========================================================== */

screens.admin = () => {
  const head = `<div class="title-block"><h1>Admin</h1><p class="sub">Usuários e configurações que não são pessoais</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-user">${icon('plus')}Novo usuário</button></div>`;
  const body = `<div class="settings">
    <section class="card card-pad">
      <h2>Usuários</h2>
      <p class="desc" style="margin:0 0 6px">Você cria o nome, o usuário e a senha inicial. Cada pessoa tem a própria agenda, entra de qualquer aparelho e pode trocar a senha depois em Ajustes.</p>
      <div class="cats" id="users-admin"><p class="empty">Carregando…</p></div>
    </section>
    <section class="card card-pad">
      <h2>Administradores</h2>
      <p class="desc" style="margin:0" id="admins-list">Quem é admin fica no banco de dados. Para mudar, peça ao Claude Code.</p>
    </section>
  </div>`;
  return { head, body, after: renderUsers };
};

async function renderUsers() {
  const el = $('#users-admin');
  if (!el) return;
  let users;
  try { users = await Auth.listUsers(); }
  catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
  users.sort((a, b) => b.is_admin - a.is_admin || a.name.localeCompare(b.name));
  el.innerHTML = users.map(u => {
    const self = u.id === Auth.user.id;
    return `<div class="cat-row user-row">
      <span class="user-main"><b>${esc(u.name)}</b><span class="desc">${esc(u.username)}${u.is_admin ? ' · admin' : ''}${self ? ' · você' : ''}</span></span>
      <button class="btn btn-sm" data-action="rename-user" data-id="${esc(u.id)}" data-name="${esc(u.name)}" data-username="${esc(u.username)}">${icon('edit')}Nome</button>
      ${self ? '' : `<button class="btn btn-sm" data-action="reset-user-password" data-id="${esc(u.id)}" data-name="${esc(u.name)}" data-username="${esc(u.username)}">${icon('key')}Nova senha</button>
        <button class="icon-btn ghost" data-action="remove-user" data-id="${esc(u.id)}" data-name="${esc(u.name)}" data-username="${esc(u.username)}" aria-label="Excluir ${esc(u.name)}">${icon('trash')}</button>`}
    </div>`;
  }).join('');
  const admins = users.filter(u => u.is_admin).map(u => `<b>${esc(u.username)}</b>`).join(', ');
  $('#admins-list').innerHTML = `${admins}. Quem é admin fica no banco de dados; para mudar, peça ao Claude Code.`;
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
      if (!f.name.trim()) return formError(form, 'Informe o nome.');
      if (!/^[a-z0-9._-]{3,30}$/.test(normUser(f.username))) return formError(form, 'O usuário precisa ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.');
      if (f.password.length < MIN_PASSWORD) return formError(form, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
      try { await Auth.createUser(f); }
      catch (err) { return formError(form, err.message); }
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
      try { await Auth.rename(u.id, name); }
      catch (err) { return formError(form, err.message); }
      if (u.id === Auth.user.id) { Auth.user.name = name.trim(); renderAccount(); }
      closeModal();
      renderUsers();
      toast('Nome alterado');
    },
  });
}

/** Usuário do botão clicado (o servidor confere de novo se quem pede é admin). */
const targetUser = el => Auth.isAdmin() ? { id: el.dataset.id, name: el.dataset.name, username: el.dataset.username } : null;

Object.assign(actions, {
  'new-user': () => Auth.isAdmin() && newUserForm(),
  'rename-user': el => { const u = targetUser(el); if (u) renameForm(u); },
  'reset-user-password': el => { const u = targetUser(el); if (u) passwordForm(u, false); },
  'remove-user': async el => {
    const u = targetUser(el);
    if (!u) return;
    const ok = await ask(`Excluir o usuário ${u.username} (${u.name})? A agenda e todos os dados dele serão apagados do servidor.`, [
      { label: 'Cancelar', value: false }, { label: 'Excluir', value: true, kind: 'danger' }]);
    if (!ok) return;
    try { await Auth.removeUser(u.id); }
    catch (err) { return toast(err.message); }
    renderUsers();
    toast('Usuário excluído');
  },
});
