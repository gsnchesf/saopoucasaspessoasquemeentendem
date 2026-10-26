'use strict';
/* ==========================================================
   Ajustes: tema (paleta, modo, cor de destaque), preferências,
   tipos de compromisso, áreas de metas, notificações e dados.
   ========================================================== */

/* ---------- Tema ---------- */

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const resolvedMode = () => {
  const t = Store.settings.theme;
  return t === 'dark' || (t !== 'light' && darkMQ.matches) ? 'dark' : 'light';
};

/** Texto legível (claro/escuro) sobre uma cor de fundo. */
function contrastText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

function applyTheme() {
  const s = Store.settings, d = document.documentElement;
  d.dataset.palette = PALETTES.some(p => p.id === s.palette) ? s.palette : 'classico';
  d.dataset.mode = resolvedMode();
  if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) {
    d.style.setProperty('--accent', s.accent);
    d.style.setProperty('--on-accent', contrastText(s.accent));
  } else {
    d.style.removeProperty('--accent');
    d.style.removeProperty('--on-accent');
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(d).getPropertyValue('--bg').trim();
  renderBrand();
}

/** Mostra a ilustração da conta na barra lateral. */
function renderIllustration() {
  const el = $('#side-art');
  if (!el) return;
  el.hidden = !Store.illustration;
  el.style.backgroundImage = Store.illustration ? `url("${Store.illustration}")` : '';
  $('.sidebar')?.classList.toggle('has-art', !!Store.illustration);
}

/** Reduz a imagem (até 900 px no lado maior) para caber no banco sem pesar. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const webp = c.toDataURL('image/webp', 0.85);
      resolve(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('imagem'));
    img.src = URL.createObjectURL(file);
  });
}

async function setIllustration(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Escolha um arquivo de imagem.');
  try {
    const src = await shrinkImage(file);
    if (src.length > 1.5e6) return toast('A imagem ficou grande demais. Tente outra menor.');
    await Store.saveIllustration(src);
    renderIllustration();
    render();
    toast('Ilustração salva');
  } catch {
    toast('Não foi possível abrir essa imagem.');
  }
}

function renderBrand() {
  const el = $('#brand');
  if (el) el.innerHTML = `<span class="brand-mark">${icon(Store.settings.palette === 'naruto' ? 'konoha' : 'logo')}</span><span>Organizador</span>`;
}

/* ---------- Tela ---------- */

function colorNameRows(coll, label) {
  return Store.data[coll].map(c => `<div class="cat-row">
    <input type="color" value="${esc(c.color)}" data-edit-coll="${coll}" data-id="${esc(c.id)}" data-field="color" aria-label="Cor de ${esc(c.name)}">
    <input type="text" class="input" value="${esc(c.name)}" data-edit-coll="${coll}" data-id="${esc(c.id)}" data-field="name" maxlength="40" aria-label="Nome ${label}">
    <button class="icon-btn ghost" data-action="del-row" data-coll="${coll}" data-id="${esc(c.id)}" aria-label="Excluir ${esc(c.name)}">${icon('trash')}</button>
  </div>`).join('');
}

screens.ajustes = () => {
  const s = Store.settings;
  const mode = resolvedMode();
  const perm = !('Notification' in window) ? 'unsupported' : Notification.permission;
  const permText = { granted: 'ativadas', denied: 'bloqueadas no navegador', default: 'desativadas', unsupported: 'não suportadas aqui' }[perm];
  const counts = `${Store.data.subjects.length} matérias · ${Store.data.events.length} compromissos · ${Store.data.deliverables.length} entregas · ${Store.data.files.length} arquivos`;

  const head = `<div class="title-block"><h1>Ajustes</h1></div>`;
  const body = `<div class="settings">
    <section class="card card-pad">
      <h2>Conta</h2>
      <div class="setting"><div><div>${esc(Auth.user.name)}</div><div class="desc">Usuário: ${esc(Auth.user.username)}${Auth.isAdmin() ? ' · admin' : ''}</div></div>
        <div class="btn-row"><button class="btn" data-action="change-password">${icon('key')}Trocar senha</button>
        <button class="btn" data-action="logout">${icon('logout')}Sair</button></div></div>
    </section>

    <section class="card card-pad">
      <h2>Aparência</h2>
      <div class="theme-grid">${PALETTES.map(p => `<button class="theme-card ${s.palette === p.id ? 'active' : ''}" data-action="set-palette" data-id="${p.id}" aria-pressed="${s.palette === p.id}">
        <div class="theme-preview" data-palette="${p.id}" data-mode="${mode}">
          <div class="tp-side"><i></i><i></i><i></i><i></i></div>
          <div class="tp-main"><b>${esc(p.name)}</b><span></span><span></span><em></em></div>
        </div>
        <strong>${esc(p.name)}</strong><small>${esc(p.desc)}</small>
      </button>`).join('')}</div>
      <div class="setting"><div><div>Modo</div></div>
        <select class="select" data-setting="theme">${options([['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']], s.theme)}</select></div>
      <div class="setting"><div><div>Cor de destaque</div></div>
        <div class="btn-row"><input type="color" class="color-input" id="accent-input" value="${esc(s.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5')}" aria-label="Cor de destaque">
        ${s.accent ? '<button class="btn btn-sm" data-action="reset-accent">Usar a do tema</button>' : ''}</div></div>
      <div class="setting"><div><div>Ilustração</div><div class="desc">Imagem da barra lateral (no celular, no topo de Hoje).</div></div>
        <div class="btn-row">${Store.illustration ? `<span class="art-thumb" style="background-image:url('${Store.illustration}')"></span>` : ''}
        <label class="btn">${icon('upload')}${Store.illustration ? 'Trocar' : 'Escolher imagem'}<input type="file" id="art-input" accept="image/*" hidden></label>
        ${Store.illustration ? '<button class="btn btn-ghost" data-action="remove-art">Remover</button>' : ''}</div></div>
      <div class="setting"><div><div>Seu nome</div></div>
        <input class="input" data-setting="name" value="${esc(s.name)}" maxlength="30"></div>
    </section>

    <section class="card card-pad">
      <h2>Agenda</h2>
      <div class="setting"><div><div>A semana começa</div></div>
        <select class="select" data-setting="weekStart">${options([['0', 'No domingo'], ['1', 'Na segunda-feira']], s.weekStart)}</select></div>
      <div class="setting"><div><div>Horário de trabalho</div><div class="desc">${esc(workSummary())}</div></div><button class="btn" data-action="edit-work">Alterar</button></div>
      <div class="setting"><div><div>A grade da semana começa às</div></div>
        <select class="select" data-setting="dayStart">${options(Array.from({ length: 13 }, (_, h) => [h, `${pad(h)}:00`]), s.dayStart)}</select></div>
      <div class="setting"><div><div>Lembretes</div><div class="desc">Notificações ${permText}</div></div>
        ${perm === 'default' ? '<button class="btn" data-action="notify-perm">Ativar</button>' : ''}</div>
      <h3 class="section-label" style="margin-top:12px;padding:0">Tipos de bloco</h3>
      <div class="cats">${colorNameRows('categories', 'do tipo')}</div>
      <button class="btn btn-sm" data-action="add-row" data-coll="categories">${icon('plus')}Tipo</button>
    </section>

    <section class="card card-pad">
      <h2>Faculdade, metas e tela</h2>
      <div class="setting"><div><div>Semestre</div><div class="desc">${esc(semesterLabel())}</div></div><button class="btn" data-action="edit-semester">Alterar</button></div>
      <div class="setting"><div><div>Limite diário de tempo de tela</div><div class="desc">${s.screenLimit ? fmtDuration(s.screenLimit) : 'Sem limite'}</div></div><button class="btn" data-action="edit-screen-limit">Alterar</button></div>
      <h3 class="section-label" style="margin-top:12px;padding:0">Áreas de metas</h3>
      <div class="cats">${colorNameRows('areas', 'da área')}</div>
      <button class="btn btn-sm" data-action="add-row" data-coll="areas">${icon('plus')}Área</button>
    </section>

    <section class="card card-pad">
      <h2>Dados</h2>
      <p class="desc">${counts}. <span id="storage-info"></span></p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-action="export-json">${icon('download')}Exportar backup</button>
        <label class="btn">${icon('upload')}Importar backup<input type="file" id="import-file" accept="application/json,.json" hidden></label>
        <button class="btn" data-action="export-ics">${icon('calendar')}Exportar agenda (.ics)</button>
        <button class="btn" data-action="persist-storage" title="Evita que o navegador apague os dados para liberar espaço">Proteger dados</button>
        <span class="spacer"></span>
        <button class="btn btn-danger-ghost" data-action="wipe">Apagar tudo</button>
      </div>
    </section>

    <section class="card card-pad">
      <h2>Atalhos de teclado</h2>
      <dl class="shortcuts">
        <dt><kbd>N</kbd></dt><dd>Menu “Novo”</dd>
        <dt><kbd>E</kbd></dt><dd>Novo compromisso</dd>
        <dt><kbd>P</kbd></dt><dd>Novo prazo</dd>
        <dt><kbd>W</kbd></dt><dd>Nova entrega</dd>
        <dt><kbd>B</kbd></dt><dd>Novo bloco na semana</dd>
        <dt><kbd>1</kbd>–<kbd>8</kbd></dt><dd>Trocar de tela</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Navegar na agenda e na semana</dd>
        <dt><kbd>Ctrl</kbd> + <kbd>Enter</kbd></dt><dd>Salvar formulário aberto</dd>
        <dt><kbd>Esc</kbd></dt><dd>Fechar janela</dd>
      </dl>
    </section>
  </div>`;

  const after = () => {
    navigator.storage?.estimate?.().then(e => {
      const el = $('#storage-info');
      if (el && e.quota) el.textContent = `${fmtSize(e.usage || 0)} de ${fmtSize(e.quota)} usados.`;
    }).catch(() => {});
  };
  return { head, body, after };
};

/* ---------- Exportações ---------- */

function exportICS() {
  const d8 = s => s.replace(/-/g, '');
  const t6 = t => t.replace(':', '') + '00';
  const txt = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const RR = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Organizador pessoal//PT-BR', 'CALSCALE:GREGORIAN'];
  const vevent = (uidv, summary, lines) => L.push('BEGIN:VEVENT', `UID:${uidv}@organizador`, `DTSTAMP:${stamp}`, `SUMMARY:${txt(summary)}`, ...lines, 'END:VEVENT');

  for (const ev of Store.data.events) {
    const lines = [];
    if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${d8(ev.date)}`, `DTEND;VALUE=DATE:${d8(addDays(ev.date, 1))}`);
    else lines.push(`DTSTART:${d8(ev.date)}T${t6(ev.start)}`, `DTEND:${d8(ev.date)}T${t6(ev.end || fromMin(Math.min(toMin(ev.start) + 60, 1439)))}`);
    if (ev.location) lines.push(`LOCATION:${txt(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${txt(ev.notes)}`);
    if (RR[ev.repeat]) lines.push(`RRULE:${RR[ev.repeat]}${ev.until ? `;UNTIL=${d8(ev.until)}${ev.allDay ? '' : 'T235959'}` : ''}`);
    for (const x of ev.exdates || []) lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${d8(x)}` : `EXDATE:${d8(x)}T${t6(ev.start)}`);
    if (ev.reminder != null && !ev.allDay) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(eventTitle(ev))}`, `TRIGGER:-PT${ev.reminder}M`, 'END:VALARM');
    vevent(ev.id, eventTitle(ev), lines);
  }

  // Aulas: um evento semanal por horário, dentro do semestre.
  const { semesterStart, semesterEnd } = Store.settings;
  const from = semesterStart || today();
  for (const s of Store.data.subjects) {
    for (const sl of s.slots || []) {
      const first = addDays(from, (sl.weekday - weekday(from) + 7) % 7);
      const lines = [`DTSTART:${d8(first)}T${t6(sl.start)}`, `DTEND:${d8(first)}T${t6(sl.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[sl.weekday]}${semesterEnd ? `;UNTIL=${d8(semesterEnd)}T235959` : ''}`];
      if (sl.room || s.room) lines.push(`LOCATION:${txt(sl.room || s.room)}`);
      vevent(`${s.id}-${sl.id}`, `Aula: ${s.name}`, lines);
    }
  }

  // Prazos como eventos de dia inteiro.
  for (const a of Store.data.assessments) {
    vevent(a.id, `${ASSESSMENT_KINDS[a.kind]}: ${a.title} (${subject(a.subjectId)?.name || ''})`,
      [`DTSTART;VALUE=DATE:${d8(a.date)}`, `DTEND;VALUE=DATE:${d8(addDays(a.date, 1))}`, ...(a.topics ? [`DESCRIPTION:${txt(a.topics)}`] : [])]);
  }
  for (const d of Store.data.deliverables.filter(x => x.due)) {
    vevent(d.id, `Entrega: ${d.title}`, [`DTSTART;VALUE=DATE:${d8(d.due)}`, `DTEND;VALUE=DATE:${d8(addDays(d.due, 1))}`, ...(d.details ? [`DESCRIPTION:${txt(d.details)}`] : [])]);
  }

  L.push('END:VCALENDAR');
  download(`agenda-${today()}.ics`, L.join('\r\n'), 'text/calendar');
}

async function importFile(file) {
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); }
  catch { return toast('Arquivo inválido.'); }
  if (obj?.app !== 'organizador') return toast('Isso não é um backup do organizador.');
  const ok = await ask('Substituir todos os dados atuais por este backup?', [
    { label: 'Cancelar', value: false }, { label: 'Substituir', value: true, kind: 'primary' }]);
  if (!ok) return;
  try {
    await Store.importJSON(obj);
    applyTheme();
    render();
    toast('Backup importado');
  } catch (e) {
    console.error(e);
    toast('Não foi possível importar o backup.');
  }
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'set-palette': el => {
    Store.settings.palette = el.dataset.id;
    Store.settings.accent = '';
    Store.saveSettings();
    applyTheme();
    render();
  },
  'remove-art': async () => { await Store.saveIllustration(''); renderIllustration(); render(); toast('Ilustração removida'); },
  'reset-accent': () => { Store.settings.accent = ''; Store.saveSettings(); applyTheme(); render(); },
  'notify-perm': async () => { await Notification.requestPermission(); render(); },
  'add-row': el => {
    const coll = el.dataset.coll;
    Store.upsert(coll, { id: uid(), name: coll === 'areas' ? 'Nova área' : 'Novo tipo', color: SWATCHES[Store.data[coll].length % SWATCHES.length] });
    render();
    $$(`input[data-edit-coll="${coll}"][data-field="name"]`).pop()?.select();
  },
  'del-row': async el => {
    const { coll, id } = el.dataset;
    const item = Store.get(coll, id);
    if (!item) return;
    const used = coll === 'areas' ? Store.data.activities.filter(a => a.areaId === id).length : Store.data.blocks.filter(b => b.category === id).length;
    if (used && !await ask(`“${item.name}” está em ${plural(used, 'item', 'itens')}. Excluir mesmo assim?`, [
      { label: 'Cancelar', value: false }, { label: 'Excluir', value: true, kind: 'danger' }])) return;
    Store.remove(coll, id);
    render();
  },
  'export-json': () => download(`organizador-backup-${today()}.json`, JSON.stringify(Store.exportJSON(), null, 2), 'application/json'),
  'export-ics': () => exportICS(),
  'persist-storage': async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Dados protegidos' : 'O navegador não deixou. Instalar como app resolve.');
  },
  'wipe': async () => {
    const ok = await ask('Apagar todos os dados desta conta? Não tem volta.', [
      { label: 'Cancelar', value: false }, { label: 'Apagar tudo', value: true, kind: 'danger' }]);
    if (!ok) return;
    await Store.wipe();
    await Store.load();
    applyTheme();
    location.hash = '#/hoje';
    render();
    toast('Dados apagados');
  },
});
