'use strict';
/* ==========================================================
   Faculdade: matérias (horários, professor, sala), faltas com
   limite, provas/trabalhos/atividades, conteúdos e arquivos.
   ========================================================== */

/* ---------- Faltas ---------- */

const absencesOf = id => Store.data.absences.filter(a => a.subjectId === id).sort((a, b) => b.date.localeCompare(a.date));

/** O limite é sempre 30% das aulas do semestre, calculado pelos horários da matéria. */
function absInfo(s) {
  const used = absencesOf(s.id).reduce((n, a) => n + (a.count || 1), 0);
  const total = totalClasses(s.slots || []);
  const limit = Math.floor(total * ABSENCE_RATE);
  const remaining = limit - used;
  const level = !limit ? '' : remaining <= 0 ? 'danger' : remaining / limit <= 0.25 ? 'warn' : 'ok';
  return { used, total, limit, remaining, level };
}

/** Aulas que a matéria tem num dia (soma dos horários daquele dia da semana). */
const classesOn = (s, date) => (s.slots || []).filter(x => x.weekday === weekday(date)).reduce((n, x) => n + (x.weight || 1), 0);

const noLimitText = () => Store.settings.semesterStart && Store.settings.semesterEnd
  ? 'Cadastre os horários da matéria para calcular o limite.'
  : 'Defina o início e o fim do semestre para calcular o limite de 30%.';

/** Quantas vezes ainda dá para faltar num dia que vale `weight` aulas. */
const timesLeft = (info, weight) => Math.max(0, Math.floor(info.remaining / (weight || 1)));

/** Selo "pode faltar N vezes" + botão de marcar falta, usado nas linhas de aula. */
function absenceControls(it) {
  const s = subject(it.id);
  if (!s) return '';
  const info = absInfo(s);
  const marked = Store.data.absences.some(a => a.subjectId === s.id && a.date === it.date);
  let html = '';
  if (info.limit) {
    const n = timesLeft(info, it.weight);
    html += `<span class="badge ${info.level}" title="${info.remaining} de ${info.limit} aulas de falta restantes">${n ? `pode faltar ${plural(n, 'vez', 'vezes')}` : 'sem faltas'}</span>`;
  }
  if (it.date <= today()) {
    html += `<button class="btn btn-sm ${marked ? 'btn-danger-ghost' : ''}" data-action="toggle-absence" data-id="${esc(s.id)}" data-date="${it.date}" data-weight="${it.weight}" aria-pressed="${marked}">${marked ? 'Falta marcada' : 'Faltei'}</button>`;
  }
  return html;
}

function toggleAbsence(subjectId, date, weight) {
  const s = subject(subjectId);
  if (!s) return;
  const existing = Store.data.absences.filter(a => a.subjectId === subjectId && a.date === date);
  if (existing.length) {
    Store.removeWhere('absences', a => a.subjectId === subjectId && a.date === date);
    render();
    toast('Falta desmarcada');
    return;
  }
  Store.upsert('absences', { id: uid(), subjectId, date, count: weight || 1, note: '' });
  render();
  const info = absInfo(s);
  toast(info.limit ? `Falta registrada em ${s.name} · restam ${Math.max(0, info.remaining)} de ${info.limit}` : `Falta registrada em ${s.name}`);
}

/* ---------- Auxiliares ---------- */

const slotsText = s => (s.slots || []).slice().sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
  .map(x => `${WEEKDAYS[x.weekday]} ${x.start}–${x.end}`).join(' · ');

const assessmentsOf = id => Store.data.assessments.filter(a => a.subjectId === id).sort((a, b) => a.date.localeCompare(b.date));
const contentsOf = id => Store.data.contents.filter(c => c.subjectId === id).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.createdAt - b.createdAt);
const filesOf = id => Store.data.files.filter(f => f.subjectId === id).sort((a, b) => b.addedAt - a.addedAt);

function semesterLabel() {
  const { semesterStart: a, semesterEnd: b } = Store.settings;
  if (!a || !b) return 'Semestre não definido';
  const f = s => fmt(s, { day: 'numeric', month: 'short' }).replace('.', '');
  return `Semestre: ${f(a)} – ${f(b)}`;
}

/** Total de aulas da matéria no semestre (base do limite de faltas). */
function totalClasses(slots) {
  const { semesterStart: a, semesterEnd: b } = Store.settings;
  if (!a || !b || a > b) return 0;
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) for (const sl of slots) if (sl.weekday === weekday(d)) n += sl.weight || 1;
  return n;
}

function fileKind(name, type = '') {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  if (ext === 'pdf') return ['PDF', '#dc2626'];
  if (['ppt', 'pptx', 'pps', 'ppsx', 'key', 'odp'].includes(ext)) return ['PPT', '#ea580c'];
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return ['DOC', '#2563eb'];
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return ['XLS', '#16a34a'];
  if (type.startsWith('image/')) return ['IMG', '#9333ea'];
  return [ext.slice(0, 4).toUpperCase() || 'ARQ', '#64748b'];
}

function assessmentRow(a, { showSubject = true } = {}) {
  const s = subject(a.subjectId);
  const late = !a.done && a.date < today();
  const soon = !a.done && !late && diffDays(today(), a.date) <= 3;
  return `<div class="task ${a.done ? 'done' : ''}">
    <button class="checkbox ${a.done ? 'on' : ''}" data-action="toggle-assessment" data-id="${esc(a.id)}" role="checkbox" aria-checked="${!!a.done}" aria-label="Concluir ${esc(a.title)}"></button>
    <button class="task-main" data-action="edit-assessment" data-id="${esc(a.id)}">
      <span class="task-title">${esc(a.title)}</span>
      <span class="task-meta">
        <span class="badge k-${a.kind}">${ASSESSMENT_KINDS[a.kind]}</span>
        ${showSubject && s ? `<span class="pill" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : ''}
        <span class="${late ? 'late' : soon ? 'soon' : ''}">${relDay(a.date)}${a.time ? ' · ' + a.time : ''}${Math.abs(diffDays(today(), a.date)) > 1 ? ` (${untilLabel(a.date)})` : ''}</span>
        ${a.grade ? `<span>Nota: ${esc(a.grade)}</span>` : ''}
      </span>
    </button>
  </div>`;
}

/* ---------- Tela: lista de matérias ---------- */

screens.faculdade = () => {
  if (state.param) {
    const s = subject(state.param);
    if (s) return subjectScreen(s);
  }
  const tabs = [['materias', 'Matérias'], ['grade', 'Grade semanal'], ['prazos', 'Provas e trabalhos']];
  const head = `<div class="title-block"><h1>Faculdade</h1><p class="sub">${esc(semesterLabel())} · <button class="link" data-action="edit-semester">alterar</button></p></div>
    <div class="toolbar">
      <button class="btn" data-action="import-jupiter">${icon('download')}Importar do Júpiter</button>
      <button class="btn" data-action="new-assessment">${icon('plus')}Prazo</button>
      <button class="btn btn-primary" data-action="new-subject">${icon('plus')}Matéria</button>
    </div>`;
  const body = `<div class="stack">
    <div><div class="segmented">${tabs.map(([id, l]) => `<button data-action="fac-tab" data-tab="${id}" class="${state.facTab === id ? 'active' : ''}">${l}</button>`).join('')}</div></div>
    ${{ materias: subjectsTab, grade: timetableTab, prazos: deadlinesTab }[state.facTab]()}
  </div>`;
  return { head, body };
};

function subjectsTab() {
  const list = Store.data.subjects.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) {
    return `<div class="card card-pad"><p class="empty">Cadastre suas matérias com horários e professor. Elas aparecem automaticamente na agenda, e o limite de faltas (30%) é calculado sozinho.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="import-jupiter">${icon('download')}Importar do JupiterWeb</button>
        <button class="btn" data-action="new-subject">${icon('plus')}Adicionar manualmente</button></div></div>`;
  }
  return `<div class="subject-grid">${list.map(s => {
    const info = absInfo(s);
    const next = assessmentsOf(s.id).find(a => !a.done && a.date >= today());
    const contents = contentsOf(s.id);
    const studied = contents.filter(c => c.done).length;
    const nFiles = filesOf(s.id).length;
    return `<button class="subject-card" style="--c:${esc(s.color)}" data-action="open-subject" data-id="${esc(s.id)}">
      <div><h3>${esc(s.name)}</h3>
        <div class="meta">${[s.professor && `Prof. ${esc(s.professor)}`, s.room && esc(s.room)].filter(Boolean).join(' · ') || 'Sem professor cadastrado'}</div></div>
      <div class="meta">${icon('clock')}${esc(slotsText(s) || 'Sem horários')}</div>
      ${info.limit ? `<div><div class="abs-line"><span class="muted">Faltas</span><span><b>${info.used}</b> de ${info.limit} · <span class="badge ${info.level}">${info.remaining > 0 ? `restam ${info.remaining}` : 'limite atingido'}</span></span></div>${meter(info.used / info.limit, info.level)}</div>`
        : `<div class="abs-line"><span class="muted">Faltas</span><span><b>${info.used}</b> · limite ainda não calculado</span></div>`}
      <div class="meta">${next ? `<span class="badge k-${next.kind}">${ASSESSMENT_KINDS[next.kind]}</span> ${esc(next.title)} · ${untilLabel(next.date)}` : 'Nenhum prazo pendente'}</div>
      <div class="meta"><span>${plural(nFiles, 'arquivo', 'arquivos')}</span><span>${studied}/${contents.length} conteúdos estudados</span></div>
    </button>`;
  }).join('')}</div>`;
}

function timetableTab() {
  const slots = Store.data.subjects.flatMap(s => (s.slots || []).map(sl => ({ s, sl })));
  if (!slots.length) return `<div class="card card-pad"><p class="empty">Nenhum horário cadastrado. Edite uma matéria para adicionar os dias e horários das aulas.</p></div>`;
  const ws = +Store.settings.weekStart;
  // Segunda a sexta sempre; sábado e domingo só se houver aula.
  const days = Array.from({ length: 7 }, (_, i) => (i + ws) % 7)
    .filter(d => (d >= 1 && d <= 5) || slots.some(x => x.sl.weekday === d));
  const tw = weekday(today());
  return `<div class="card card-pad"><div class="timetable" style="--cols:${days.length}">${days.map(d => {
    const list = slots.filter(x => x.sl.weekday === d).sort((a, b) => a.sl.start.localeCompare(b.sl.start));
    return `<div class="tt-day ${d === tw ? 'today' : ''}"><h3>${WEEKDAYS_LONG[d]}</h3>
      ${list.length ? list.map(({ s, sl }) => `<button class="tt-slot" style="--c:${esc(s.color)}" data-action="open-subject" data-id="${esc(s.id)}">
        <b>${esc(s.name)}</b><span>${sl.start}–${sl.end} · ${plural(sl.weight || 1, 'aula', 'aulas')}</span>${sl.room || s.room ? `<span>${esc(sl.room || s.room)}</span>` : ''}</button>`).join('')
        : '<div class="tt-empty">Sem aulas</div>'}
    </div>`;
  }).join('')}</div></div>`;
}

function deadlinesTab() {
  const sel = state.facSubject;
  const list = Store.data.assessments.filter(a => !sel || a.subjectId === sel).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  const t = today();
  const groups = [
    ['Atrasados', list.filter(a => !a.done && a.date < t), 'danger'],
    ['Próximos 7 dias', list.filter(a => !a.done && a.date >= t && diffDays(t, a.date) <= 7)],
    ['Mais adiante', list.filter(a => !a.done && diffDays(t, a.date) > 7)],
    ['Concluídos', list.filter(a => a.done).reverse().slice(0, 15)],
  ].filter(g => g[1].length);
  return `<div class="card card-pad">
    <div class="filters" style="margin-bottom:8px">
      <select class="select" id="fac-subject-filter" aria-label="Filtrar por matéria"><option value="">Todas as matérias</option>${subjectOptions(sel)}</select>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="new-assessment" data-subject="${esc(sel)}">${icon('plus')}Prazo</button>
    </div>
    ${groups.length ? groups.map(([label, items, cls]) => `<h3 class="section-label ${cls || ''}">${label} <span class="count">${items.length}</span></h3>
      <div class="list">${items.map(a => assessmentRow(a)).join('')}</div>`).join('')
      : '<p class="empty">Nenhuma prova, trabalho ou atividade cadastrada.</p>'}
  </div>`;
}

/* ---------- Tela: detalhe da matéria ---------- */

function subjectScreen(s) {
  const info = absInfo(s);
  const absences = absencesOf(s.id);
  const assessments = assessmentsOf(s.id);
  const contents = contentsOf(s.id);
  const files = filesOf(s.id);
  const slots = (s.slots || []).slice().sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  const studied = contents.filter(c => c.done).length;

  const head = `<div class="title-block">
      <a class="back" href="#/faculdade">${icon('left')}Faculdade</a>
      <h1 style="display:flex;align-items:center;gap:12px"><span class="dot" style="--c:${esc(s.color)};width:14px;height:14px"></span>${esc(s.name)}</h1>
      <p class="sub">${[s.professor && `Prof. ${esc(s.professor)}`, s.room && esc(s.room)].filter(Boolean).join(' · ')}</p>
    </div>
    <div class="toolbar">
      <button class="btn" data-action="new-assessment" data-subject="${esc(s.id)}">${icon('plus')}Prazo</button>
      <button class="btn" data-action="edit-subject" data-id="${esc(s.id)}">${icon('edit')}Editar matéria</button>
    </div>`;

  // Por dia da semana: quantas vezes ainda dá para faltar naquele dia.
  const perDay = [...new Set(slots.map(x => x.weekday))].map(wd => {
    const w = slots.filter(x => x.weekday === wd).reduce((n, x) => n + (x.weight || 1), 0);
    return { wd, w, n: timesLeft(info, w) };
  });

  const faltas = `<section class="card card-pad">
    <div class="card-head"><h2>Faltas</h2><button class="btn btn-sm" data-action="new-absence" data-id="${esc(s.id)}">${icon('plus')}Registrar falta</button></div>
    ${info.limit ? `<div class="abs-hero">
        <div class="big-number ${info.level}">${Math.max(0, info.remaining)}</div>
        <p><b>${info.remaining > 0 ? 'aulas que você ainda pode faltar' : 'Limite de faltas atingido'}</b><br>
        <span class="muted">${info.used} de ${info.limit} usadas · 30% de ${info.total} aulas no semestre</span></p>
      </div>
      ${meter(info.used / info.limit, info.level)}
      ${perDay.length ? `<h3 class="section-label" style="margin-top:16px">Por dia de aula</h3><div class="list">${perDay.map(({ wd, w, n }) =>
        `<div class="task"><span class="task-main"><span class="task-title">${WEEKDAYS_LONG[wd]}</span><span class="task-meta">${plural(w, 'aula', 'aulas')} por dia</span></span>
          <span class="badge ${n ? info.level : 'danger'}">${n ? `pode faltar mais ${plural(n, 'vez', 'vezes')}` : 'não pode faltar'}</span></div>`).join('')}</div>` : ''}`
      : `<p class="empty">${noLimitText()} Faltas registradas: <b>${info.used}</b>.</p>`}
    <h3 class="section-label" style="margin-top:16px">Histórico <span class="count">${absences.length}</span></h3>
    ${absences.length ? `<div class="list">${absences.map(a => `<div class="task">
        <span class="task-main"><span class="task-title">${relDay(a.date)}</span><span class="task-meta">${plural(a.count || 1, 'aula', 'aulas')}${a.note ? ' · ' + esc(a.note) : ''}</span></span>
        <button class="icon-btn ghost sm" data-action="del-absence" data-id="${esc(a.id)}" aria-label="Remover falta">${icon('x')}</button></div>`).join('')}</div>`
      : '<p class="empty">Nenhuma falta. Continue assim!</p>'}
  </section>`;

  const prazos = `<section class="card card-pad">
    <div class="card-head"><h2>Provas, trabalhos e atividades</h2><button class="btn btn-sm" data-action="new-assessment" data-subject="${esc(s.id)}">${icon('plus')}Prazo</button></div>
    ${assessments.length ? `<div class="list">${assessments.map(a => assessmentRow(a, { showSubject: false })).join('')}</div>` : '<p class="empty">Nada cadastrado ainda.</p>'}
  </section>`;

  const horarios = `<section class="card card-pad">
    <div class="card-head"><h2>Horários</h2><button class="link" data-action="edit-subject" data-id="${esc(s.id)}">Editar</button></div>
    ${slots.length ? `<div class="list">${slots.map(x => `<div class="task"><span class="task-main">
        <span class="task-title">${WEEKDAYS_LONG[x.weekday]} · ${x.start}–${x.end}</span>
        <span class="task-meta">${plural(x.weight || 1, 'aula', 'aulas')}${x.room || s.room ? ' · ' + esc(x.room || s.room) : ''}</span></span></div>`).join('')}</div>`
      : '<p class="empty">Sem horários cadastrados.</p>'}
    ${s.notes ? `<p class="hint-box" style="margin-top:10px;white-space:pre-wrap">${esc(s.notes)}</p>` : ''}
  </section>`;

  const conteudos = `<section class="card card-pad">
    <div class="card-head"><h2>Conteúdos</h2><span class="sub">${studied}/${contents.length} estudados</span></div>
    ${contents.length ? meter(contents.length ? studied / contents.length : 0, '', s.color) : ''}
    <div class="list" style="margin-top:8px">${contents.map(c => `<div class="task ${c.done ? 'done' : ''}">
      <button class="checkbox ${c.done ? 'on' : ''}" data-action="toggle-content" data-id="${esc(c.id)}" role="checkbox" aria-checked="${!!c.done}" aria-label="Marcar como estudado"></button>
      <span class="task-main"><span class="task-title">${esc(c.title)}</span>${c.date ? `<span class="task-meta">${relDay(c.date)}</span>` : ''}</span>
      <button class="icon-btn ghost sm" data-action="del-content" data-id="${esc(c.id)}" aria-label="Remover conteúdo">${icon('x')}</button>
    </div>`).join('')}</div>
    <form class="quick-add" data-form="quick-content" data-id="${esc(s.id)}">${icon('plus')}<input name="q" autocomplete="off" placeholder="Adicionar conteúdo (Enter)" aria-label="Adicionar conteúdo"></form>
  </section>`;

  const arquivos = `<section class="card card-pad">
    <div class="card-head"><h2>Arquivos</h2><span class="sub">${plural(files.length, 'arquivo', 'arquivos')}</span></div>
    <label class="dropzone" id="dropzone">${icon('upload')}<span><b>Clique para anexar</b> ou arraste arquivos aqui</span><span class="desc">PDF, PowerPoint, Word, planilhas, imagens…</span>
      <input type="file" id="file-input" data-id="${esc(s.id)}" multiple hidden accept=".pdf,.ppt,.pptx,.pps,.ppsx,.doc,.docx,.odt,.rtf,.xls,.xlsx,.csv,.txt,.zip,image/*">
    </label>
    <div class="list">${files.map(f => {
      const [label, color] = fileKind(f.name, f.type);
      return `<div class="file-row">
        <span class="file-ico" style="--c:${color}">${label}</span>
        <span class="file-name"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${fmtSize(f.size)} · ${relDay(toISO(new Date(f.addedAt)))}</span></span>
        <button class="icon-btn ghost sm" data-action="open-file" data-id="${esc(f.id)}" aria-label="Abrir ${esc(f.name)}" title="Abrir">${icon('external')}</button>
        <button class="icon-btn ghost sm" data-action="download-file" data-id="${esc(f.id)}" aria-label="Baixar ${esc(f.name)}" title="Baixar">${icon('download')}</button>
        <button class="icon-btn ghost sm" data-action="del-file" data-id="${esc(f.id)}" aria-label="Excluir ${esc(f.name)}" title="Excluir">${icon('trash')}</button>
      </div>`;
    }).join('')}</div>
  </section>`;

  const body = `<div class="detail-grid">
    <div class="stack">${faltas}${prazos}</div>
    <div class="stack">${horarios}${conteudos}${arquivos}</div>
  </div>`;

  const after = () => {
    const dz = $('#dropzone');
    if (!dz) return;
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
    dz.addEventListener('drop', e => { e.preventDefault(); addFiles(s.id, e.dataTransfer.files); });
  };
  return { head, body, after };
}

/* ---------- Arquivos ---------- */

const MAX_FILE = 200 * 1024 * 1024;

async function addFiles(subjectId, fileList) {
  let ok = 0;
  for (const f of [...fileList]) {
    if (f.size > MAX_FILE) { toast(`"${f.name}" passa de 200 MB e não foi anexado.`); continue; }
    const id = uid();
    try { await Store.saveBlob(id, f); }
    catch { toast(`Sem espaço para salvar "${f.name}".`); continue; }
    Store.upsert('files', { id, subjectId, name: f.name, type: f.type || '', size: f.size, addedAt: Date.now() });
    ok++;
  }
  render();
  if (ok) toast(ok === 1 ? 'Arquivo anexado' : `${ok} arquivos anexados`);
}

async function fileBlob(id) {
  const meta = Store.get('files', id);
  const blob = meta && await Store.getBlob(id);
  if (!blob) { toast('Arquivo não encontrado neste dispositivo.'); return null; }
  return { meta, blob: meta.type && blob.type !== meta.type ? new Blob([blob], { type: meta.type }) : blob };
}

/* ---------- Formulários ---------- */

function subjectForm(s) {
  const isNew = !s;
  s = s ? structuredClone(s) : {
    id: uid(), name: '', professor: '', room: '', notes: '',
    color: SWATCHES[Store.data.subjects.length % SWATCHES.length],
    slots: [{ id: uid(), weekday: 1, start: '19:00', end: '20:40', weight: 2, room: '' }],
  };
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Nova matéria' : 'Editar matéria')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Nome da matéria</span><input name="name" maxlength="120" value="${esc(s.name)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Cálculo II"></label>
        <label class="field xs"><span>Cor</span><input type="color" name="color" value="${esc(s.color)}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Professor(a)</span><input name="professor" maxlength="120" value="${esc(s.professor)}"></label>
        <label class="field"><span>Sala padrão</span><input name="room" maxlength="60" value="${esc(s.room)}" placeholder="Ex.: Bloco B, 204"></label>
      </div>
      <div>
        <span class="fieldset-label">Horários das aulas</span>
        <div class="slot-list" style="margin-top:6px">
          <div class="slot-row slot-head"><span>Dia</span><span>Início</span><span>Fim</span><span>Aulas</span><span>Sala</span><span></span></div>
          ${(s.slots || []).map(slotRow).join('')}
          <button type="button" class="btn btn-sm" data-add-slot style="justify-self:start">${icon('plus')}Horário</button>
        </div>
      </div>
      <p class="hint-box calc-hint"></p>
      <label class="field"><span>Observações</span><textarea name="notes" rows="2" placeholder="Critérios de avaliação, contato do professor…">${esc(s.notes)}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      // Mostra, ao vivo, o limite de 30% que os horários preenchidos geram.
      const hint = $('.calc-hint', form);
      const update = () => {
        const total = totalClasses(readSlots(form));
        hint.innerHTML = icon('clock') + esc(total
          ? `${total} aulas no semestre → pode faltar até ${Math.floor(total * ABSENCE_RATE)} (30%). Se o dia tem 2 aulas, faltar nele conta 2.`
          : noLimitText());
      };
      update();
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      form.addEventListener('click', () => setTimeout(update)); // adicionar/remover horário
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.name.trim()) return formError(form, 'Dê um nome à matéria.');
      const slots = readSlots(form);
      if (slots.some(x => !x.start || !x.end || x.end <= x.start)) return formError(form, 'Confira os horários: o fim precisa ser depois do início.');
      Object.assign(s, {
        name: f.name.trim(), color: f.color, professor: f.professor.trim(), room: f.room.trim(),
        notes: f.notes.trim(), slots,
      });
      delete s.absenceLimit; // o limite agora é sempre calculado (30%)
      Store.upsert('subjects', s);
      closeModal();
      if (isNew) location.hash = `#/faculdade/${s.id}`;
      render();
      toast(isNew ? 'Matéria criada' : 'Matéria atualizada');
    },
    onDelete: async () => {
      const ok = await ask(`Excluir “${s.name}”? Faltas, prazos, conteúdos e arquivos dela também serão apagados.`, [
        { label: 'Cancelar', value: false }, { label: 'Excluir tudo', value: true, kind: 'danger' }]);
      if (!ok) return;
      const byS = x => x.subjectId === s.id;
      Store.removeWhere('absences', byS);
      Store.removeWhere('assessments', byS);
      Store.removeWhere('contents', byS);
      const gone = Store.removeWhere('files', byS);
      if (gone.length) Store.deleteBlobs(gone.map(f => f.id));
      Store.remove('subjects', s.id);
      closeModal();
      location.hash = '#/faculdade';
      toast('Matéria excluída');
    },
  });
}

function assessmentForm(a, { date = '', subjectId = '' } = {}) {
  if (!Store.data.subjects.length) {
    toast('Cadastre uma matéria primeiro.');
    return subjectForm();
  }
  const isNew = !a;
  a = a ? structuredClone(a) : {
    id: uid(), subjectId: subjectId || state.param || Store.data.subjects[0].id, kind: 'prova',
    title: '', date: date || addDays(today(), 7), time: '', topics: '', details: '', weight: '', grade: '', done: false,
  };
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo prazo da faculdade' : 'Editar prazo')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Matéria</span><select name="subjectId">${subjectOptions(a.subjectId)}</select></label>
        <label class="field"><span>Tipo</span><select name="kind">${options(Object.entries(ASSESSMENT_KINDS), a.kind)}</select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" maxlength="160" value="${esc(a.title)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: P1, Lista 3, Seminário"></label>
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${a.date}"></label>
        <label class="field"><span>Horário (opcional)</span><input type="time" name="time" value="${a.time || ''}"></label>
      </div>
      <label class="field"><span>Conteúdos cobrados</span><textarea name="topics" rows="3" placeholder="Capítulos, temas, listas…">${esc(a.topics)}</textarea></label>
      <label class="field"><span>Detalhes</span><textarea name="details" rows="2" placeholder="Formato, onde entregar, em grupo…">${esc(a.details)}</textarea></label>
      <div class="row">
        <label class="field"><span>Valor / peso</span><input name="weight" maxlength="30" value="${esc(a.weight)}" placeholder="Ex.: 3,0 pts"></label>
        <label class="field"><span>Nota</span><input name="grade" maxlength="30" value="${esc(a.grade)}" placeholder="Depois da correção"></label>
      </div>
      <label class="check"><input type="checkbox" name="done" ${a.done ? 'checked' : ''}> Concluído / entregue</label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (!f.title.trim()) return formError(form, 'Dê um título.');
      if (!f.date) return formError(form, 'Escolha a data.');
      Object.assign(a, {
        subjectId: f.subjectId, kind: f.kind, title: f.title.trim(), date: f.date, time: f.time,
        topics: f.topics.trim(), details: f.details.trim(), weight: f.weight.trim(), grade: f.grade.trim(), done: !!f.done,
      });
      Store.upsert('assessments', a);
      closeModal();
      render();
      toast(isNew ? 'Prazo criado' : 'Prazo atualizado');
    },
    onDelete: () => {
      const removed = Store.remove('assessments', a.id);
      closeModal();
      render();
      toast('Prazo excluído', { label: 'Desfazer', fn: () => { Store.upsert('assessments', removed); render(); } });
    },
  });
}

function absenceForm(s) {
  // Começa no dia de aula mais recente (hoje, se tiver aula hoje).
  let t = today();
  for (let i = 0; i < 7 && (s.slots || []).length && !classesOn(s, t); i++) t = addDays(t, -1);
  const w = classesOn(s, t) || 1;
  openModal(`<form novalidate>
    ${modalHead(`Registrar falta · ${s.name}`)}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${t}"></label>
        <label class="field xs"><span>Aulas</span><input type="number" name="count" min="1" max="10" value="${w}"></label>
      </div>
      <label class="field"><span>Observação</span><input name="note" maxlength="140" placeholder="Opcional (ex.: atestado)"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Registrar')}
  </form>`, {
    onMount(form) {
      // Sugere a quantidade de aulas do dia escolhido.
      form.elements.date.addEventListener('change', () => {
        const d = form.elements.date.value;
        if (!d) return;
        const n = classesOn(s, d);
        if (n) form.elements.count.value = n;
      });
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.date) return formError(form, 'Escolha a data.');
      if (f.date > today()) return formError(form, 'Só dá para registrar falta de hoje ou de dias que já passaram.');
      if (Store.data.absences.some(a => a.subjectId === s.id && a.date === f.date)) return formError(form, `Já existe uma falta registrada em ${relDay(f.date).toLowerCase()}.`);
      Store.upsert('absences', { id: uid(), subjectId: s.id, date: f.date, count: Math.max(1, +f.count || 1), note: f.note.trim() });
      closeModal();
      render();
      toast('Falta registrada');
    },
  });
}

function semesterForm() {
  const st = Store.settings;
  openModal(`<form novalidate>
    ${modalHead('Semestre')}
    <div class="modal-body">
      <p class="desc" style="margin:0">As aulas aparecem na agenda apenas dentro deste período.</p>
      <div class="row">
        <label class="field"><span>Início das aulas</span><input type="date" name="start" value="${st.semesterStart}"></label>
        <label class="field"><span>Fim das aulas</span><input type="date" name="end" value="${st.semesterEnd}"></label>
      </div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (f.start && f.end && f.end < f.start) return formError(form, 'O fim precisa ser depois do início.');
      st.semesterStart = f.start;
      st.semesterEnd = f.end;
      Store.saveSettings();
      closeModal();
      render();
      toast('Semestre atualizado');
    },
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'open-subject': el => { location.hash = `#/faculdade/${el.dataset.id}`; },
  'new-subject': () => subjectForm(),
  'edit-subject': el => { const s = subject(el.dataset.id); if (s) subjectForm(s); },
  'fac-tab': el => { state.facTab = el.dataset.tab; render(); },
  'edit-semester': () => semesterForm(),
  'new-assessment': el => assessmentForm(null, { date: el.dataset.date, subjectId: el.dataset.subject }),
  'edit-assessment': el => { const a = Store.get('assessments', el.dataset.id); if (a) assessmentForm(a); },
  'toggle-assessment': el => {
    const a = Store.get('assessments', el.dataset.id);
    if (!a) return;
    a.done = !a.done;
    Store.upsert('assessments', a);
    render();
    if (a.done) toast(`${ASSESSMENT_KINDS[a.kind]} concluído(a)`, { label: 'Desfazer', fn: () => { a.done = false; Store.upsert('assessments', a); render(); } });
  },
  'toggle-absence': el => toggleAbsence(el.dataset.id, el.dataset.date, +el.dataset.weight),
  'new-absence': el => { const s = subject(el.dataset.id); if (s) absenceForm(s); },
  'del-absence': el => {
    const removed = Store.remove('absences', el.dataset.id);
    render();
    toast('Falta removida', { label: 'Desfazer', fn: () => { Store.upsert('absences', removed); render(); } });
  },
  'toggle-content': el => {
    const c = Store.get('contents', el.dataset.id);
    if (!c) return;
    c.done = !c.done;
    Store.upsert('contents', c);
    render();
  },
  'del-content': el => {
    const removed = Store.remove('contents', el.dataset.id);
    render();
    toast('Conteúdo removido', { label: 'Desfazer', fn: () => { Store.upsert('contents', removed); render(); } });
  },
  'open-file': async el => {
    const win = window.open('', '_blank'); // abre já no clique para não ser bloqueado
    const r = await fileBlob(el.dataset.id);
    if (!r) { win?.close(); return; }
    const url = URL.createObjectURL(r.blob);
    if (win) win.location.href = url;
    else download(r.meta.name, r.blob);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  'download-file': async el => {
    const r = await fileBlob(el.dataset.id);
    if (r) download(r.meta.name, r.blob);
  },
  'del-file': async el => {
    const f = Store.get('files', el.dataset.id);
    if (!f || !await confirmDelete(`“${f.name}”`)) return;
    Store.remove('files', f.id);
    Store.deleteBlobs([f.id]);
    render();
    toast('Arquivo excluído');
  },
});
