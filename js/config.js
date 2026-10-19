'use strict';
/* ==========================================================
   Configuração do organizador. Editada pelo dono do
   repositório (à mão ou pedindo ao Claude Code) e publicada
   com um commit.
   ========================================================== */

const CONFIG = {
  /** Usuários com acesso à página Admin. */
  admins: ['gsanches'],

  /** Contas criadas sozinhas em todo aparelho que ainda não as tem.
      Só o hash da senha inicial fica aqui (PBKDF2-SHA256, 600 mil iterações); a pessoa troca depois.
      Para gerar: node -e "const c=require('crypto'),s=c.randomBytes(16);console.log(s.toString('base64'),c.pbkdf2Sync('SENHA',s,600000,32,'sha256').toString('base64'))" */
  seedUsers: [
    { username: 'gsanches', name: 'Gabriel Sanches', salt: 'PlXH6BgbJcbRnwcJiV7NUA==', hash: 'BQK4++3j8B5l6NWxeOrMF9NdWIjvvnwDYr7ihv1TusI=' },
  ],
};
