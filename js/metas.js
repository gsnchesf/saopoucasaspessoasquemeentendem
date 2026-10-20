'use strict';
/* ==========================================================
   Metas: atividades agrupadas em áreas (fitness, date,
   projetos paralelos…), cada uma com um tipo de meta:
   - tempo:     X horas/minutos por semana ou mês
   - vezes:     N vezes por semana ou mês
   - objetivo:  lista de ações/objetivos específicos
   ========================================================== */

const activitiesList = () => Store.data.activities.filter(a => !a.archived)
  .sort((a, b) => (area(a.areaId)?.name || '').localeCompare(area(b.areaId)?.name || '') || a.name.localeCompare(b.name));
const logsOf = id => Store.data.activityLogs.filter(l => l.activityId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

function goalText(a) {
  const per = `por ${PERIODS[a.period || 'semana']}`;
  if (a.goalType === 'tempo') return `${fmtDuration(a.target)} ${per}`;
  if (a.goalType === 'vezes') return `${a.target}× ${per}`;
  return plural((a.objectives || []).length, 'objetivo', 'objetivos');
}

function goalProgress(a) {
  if (a.goalType === 'objetivo') {
    const o = a.objectives || [];
    const done = o.filter(x => x.done).length;
    return { value: done, target: o.length, p: o.length ? done / o.length : 0, text: `${done} de ${o.length}` };
  }
  const period = a.period || 'semana';
  const [from, to] = periodRange(period);
  const logs = Store.data.activityLogs.filter(l => l.activityId === a.id && l.date >= from && l.date <= to);
  const value = a.goalType === 'tempo' ? logs.reduce((n, l) => n + (+l.minutes || 0), 0) : logs.reduce((n, l) => n + (+l.count || 1), 0);
  const target = +a.target || 0;
  // Ritmo esperado: fração do período que já passou.
  const elapsed = (diffDays(from, today()) + 1) / (diffDays(from, to) + 1);
  const p = target ? value / target : 0;
  const status = p >= 1 ? 'Meta batida' : p >= elapsed ? 'No ritmo' : 'Abaixo do ritmo';
  const left = Math.max(0, target - value);
  const text = a.goalType === 'tempo' ? fmtDuration(value) : `${value}×`;
  const leftText = a.goalType === 'tempo' ? fmtDuration(left) : `${left}×`;
  return { value, target, p, text, status, leftText, period };
}

/** Registro de hoje feito pelo "Fiz hoje" (não conta os que vieram de treino). */
const doneToday = a => Store.data.activityLogs.find(l => l.activityId === a.id && l.date === today() && !l.workoutId);

const statusClass = s => s === 'Meta batida' ? 'ok' : s === 'No ritmo' ? '' : 'warn';

function goalCard(a) {
  const ar = area(a.areaId), color = ar?.color || 'var(--accent)';
  const g = goalProgress(a);
  const logs = a.goalType === 'objetivo' ? [] : logsOf(a.id).slice(0, 3);
  let main;
  if (a.goalType === 'objetivo') {
    main = `${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      <div class="list">${(a.objectives || []).map(o => `<div class="task ${o.done ? 'done' : ''}">
        <button class="checkbox ${o.done ? 'on' : ''}" data-action="toggle-objective" data-id="${esc(a.id)}" data-obj="${esc(o.id)}" role="checkbox" aria-checked="${!!o.done}" aria-label="${esc(o.text)}"></button>
        <span class="task-main"><span class="task-title">${esc(o.text)}</span></span></div>`).join('') || '<p class="empty">Sem objetivos.</p>'}</div>`;
  } else {
    main = `<div class="goal-progress"><span><b>${g.text}</b> de ${a.goalType === 'tempo' ? fmtDuration(g.target) : g.target + '×'}</span>
        <span class="badge ${statusClass(g.status)}">${g.status}</span></div>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      <p class="desc" style="margin:0">${g.p >= 1 ? `Concluída nest${g.period === 'mes' ? 'e mês' : 'a semana'}.` : `Faltam ${g.leftText} nest${g.period === 'mes' ? 'e mês' : 'a semana'}.`}</p>`;
  }
  const buttons = a.goalType === 'tempo'
    ? `<button class="btn btn-sm btn-primary" data-action="log-activity" data-id="${esc(a.id)}">${icon('clock')}Registrar tempo</button>`
    : a.goalType === 'vezes'
      ? (doneToday(a)
        ? `<button class="btn btn-sm" data-action="quick-log" data-id="${esc(a.id)}" aria-pressed="true" title="Clique para desmarcar">${icon('check')}Fiz hoje</button>`
        : `<button class="btn btn-sm btn-primary" data-action="quick-log" data-id="${esc(a.id)}">${icon('plus')}Fiz hoje</button>`)
        + `<button class="btn btn-sm" data-action="log-activity" data-id="${esc(a.id)}">Detalhes</button>`
      : '';
  return `<article class="card goal-card">
    <div class="goal-top">
      <div><h3>${esc(a.name)}</h3><p class="sub"><span class="pill" style="--c:${esc(color)}">${esc(ar?.name || 'Sem área')}</span> · ${esc(goalText(a))}</p></div>
      <button class="icon-btn ghost sm" data-action="edit-activity" data-id="${esc(a.id)}" aria-label="Editar ${esc(a.name)}">${icon('edit')}</button>
    </div>
    ${main}
    ${buttons ? `<div class="goal-actions">${buttons}</div>` : ''}
    ${logs.length ? `<ul class="goal-log">${logs.map(l => `<li><span>${relDay(l.date)}${l.minutes ? ' · ' + fmtDuration(l.minutes) : ''}${l.note ? ' · ' + esc(l.note) : ''}</span>
      <button class="icon-btn ghost sm" data-action="del-log" data-id="${esc(l.id)}" aria-label="Remover registro">${icon('x')}</button></li>`).join('')}</ul>` : ''}
  </article>`;
}

/** Resumo compacto das metas (usado em Hoje). */
function goalsMini() {
  const list = activitiesList();
  if (!list.length) return `<p class="empty">Nenhuma meta ainda. <a class="link" href="#/metas">Criar metas</a></p>`;
  return `<div class="list">${list.map(a => {
    const g = goalProgress(a), color = area(a.areaId)?.color;
    return `<a class="mini-goal" href="#/metas" style="color:inherit;text-decoration:none">
      <span class="top"><span>${esc(a.name)}</span><span>${a.goalType === 'objetivo' ? g.text : `${g.text} / ${a.goalType === 'tempo' ? fmtDuration(g.target) : g.target + '×'}`}</span></span>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
    </a>`;
  }).join('')}</div>`;
}

/* ---------- Tela ---------- */

screens.metas = () => {
  const areas = Store.data.areas;
  const sel = state.goalArea;
  const list = activitiesList().filter(a => !sel || a.areaId === sel);
  const periodic = activitiesList().filter(a => a.goalType !== 'objetivo');
  const onTrack = periodic.filter(a => goalProgress(a).status !== 'Abaixo do ritmo').length;

  const head = `<div class="title-block"><h1>Metas</h1>
      <p class="sub">${periodic.length ? `${onTrack} de ${periodic.length} no ritmo` : ''}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-activity">${icon('plus')}Atividade</button></div>`;

  const filter = `<div class="segmented">
    <button data-action="goal-area" data-id="" class="${!sel ? 'active' : ''}">Todas</button>
    ${areas.map(a => `<button data-action="goal-area" data-id="${esc(a.id)}" class="${sel === a.id ? 'active' : ''}">${esc(a.name)}</button>`).join('')}
  </div>`;

  let content;
  if (!list.length) {
    content = `<div class="card card-pad"><p class="empty">Nenhuma atividade${sel ? ' nesta área' : ''}.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="new-activity">${icon('plus')}Criar atividade</button></div></div>`;
  } else {
    const groups = (sel ? areas.filter(a => a.id === sel) : [...areas, { id: '', name: 'Sem área' }])
      .map(ar => [ar, list.filter(a => (area(a.areaId) ? a.areaId : '') === ar.id)]).filter(([, l]) => l.length);
    content = groups.map(([ar, l]) => `<section>
      ${sel ? '' : `<h2 style="display:flex;align-items:center;gap:8px;margin:4px 0 10px">${ar.color ? `<span class="dot" style="--c:${esc(ar.color)}"></span>` : ''}${esc(ar.name)}</h2>`}
      <div class="goal-grid">${l.map(goalCard).join('')}</div></section>`).join('');
  }
  // Tempo de tela mora aqui também (era de Hábitos).
  return { head, body: `<div class="stack"><div>${filter}</div>${content}${screenCard()}</div>`, after: bindChartTooltip };
};

/* ---------- Formulários ---------- */

function activityForm(a) {
  if (!Store.data.areas.length) Store.upsert('areas', { id: uid(), name: 'Geral', color: SWATCHES[0] });
  const isNew = !a;
  a = a ? structuredClone(a) : { id: uid(), name: '', areaId: state.goalArea || Store.data.areas[0].id, goalType: 'vezes', target: 3, period: 'semana', objectives: [], notes: '' };
  const tH = a.goalType === 'tempo' ? Math.floor(a.target / 60) : 2, tM = a.goalType === 'tempo' ? a.target % 60 : 0;
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Nova atividade' : 'Editar atividade')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Atividade</span><input name="name" maxlength="80" value="${esc(a.name)}" ${isNew ? 'autofocus' : ''}></label>
        <label class="field"><span>Área</span><select name="areaId">${areaOptions(a.areaId)}</select></label>
      </div>
      <label class="field"><span>Tipo de meta</span><select name="goalType">${options([
        ['vezes', 'Vezes'], ['tempo', 'Tempo'], ['objetivo', 'Objetivos']], a.goalType)}</select></label>
      <div class="row g-vezes" ${a.goalType === 'vezes' ? '' : 'hidden'}>
        <label class="field xs"><span>Vezes</span><input type="number" name="times" min="1" max="99" value="${a.goalType === 'vezes' ? a.target : 3}"></label>
      </div>
      <div class="row g-tempo" ${a.goalType === 'tempo' ? '' : 'hidden'}>
        <label class="field xs"><span>Horas</span><input type="number" name="h" min="0" max="200" value="${tH}"></label>
        <label class="field xs"><span>Minutos</span><input type="number" name="m" min="0" max="59" value="${tM}"></label>
      </div>
      <label class="field g-period" ${a.goalType === 'objetivo' ? 'hidden' : ''}><span>Período</span><select name="period">${options([['semana', 'Por semana'], ['mes', 'Por mês']], a.period || 'semana')}</select></label>
      <div class="g-objetivo" ${a.goalType === 'objetivo' ? '' : 'hidden'}><span class="fieldset-label">Objetivos</span>
        <div style="margin-top:6px">${listEditor('objectives', a.objectives || [], { addLabel: 'Adicionar objetivo' })}</div></div>
      <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(a.notes)}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const sync = () => {
        const t = form.elements.goalType.value;
        $('.g-vezes', form).hidden = t !== 'vezes';
        $('.g-tempo', form).hidden = t !== 'tempo';
        $('.g-period', form).hidden = t === 'objetivo';
        $('.g-objetivo', form).hidden = t !== 'objetivo';
      };
      form.elements.goalType.addEventListener('change', sync);
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.name.trim()) return formError(form, 'Falta o nome.');
      let target = 0;
      if (f.goalType === 'vezes') target = Math.max(1, +f.times || 1);
      if (f.goalType === 'tempo') target = (+f.h || 0) * 60 + (+f.m || 0);
      if (f.goalType === 'tempo' && !target) return formError(form, 'Falta o tempo.');
      const objectives = readList(form, 'objectives');
      if (f.goalType === 'objetivo' && !objectives.length) return formError(form, 'Adicione pelo menos um objetivo.');
      Object.assign(a, { name: f.name.trim(), areaId: f.areaId, goalType: f.goalType, target, period: f.period || 'semana', objectives, notes: f.notes.trim() });
      Store.upsert('activities', a);
      closeModal();
      render();
      toast(isNew ? 'Atividade criada' : 'Atividade atualizada');
    },
    onDelete: async () => {
      if (!await confirmDelete(`“${a.name}” e seus registros`)) return;
      Store.removeWhere('activityLogs', l => l.activityId === a.id);
      Store.remove('activities', a.id);
      closeModal();
      render();
      toast('Atividade excluída');
    },
  });
}

function logForm(a) {
  const needMinutes = a.goalType === 'tempo';
  openModal(`<form novalidate>
    ${modalHead(`Registrar · ${a.name}`)}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field xs"><span>Horas</span><input type="number" name="h" min="0" max="24" ${needMinutes ? 'autofocus' : ''} placeholder="0"></label>
        <label class="field xs"><span>Minutos</span><input type="number" name="m" min="0" max="59" placeholder="0"></label>
      </div>
      <label class="field"><span>Nota</span><input name="note" maxlength="140"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Registrar')}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      const minutes = (+f.h || 0) * 60 + (+f.m || 0);
      if (!f.date) return formError(form, 'Falta a data.');
      if (needMinutes && !minutes) return formError(form, 'Falta o tempo.');
      addLog(a, { date: f.date, minutes, note: f.note.trim() });
      closeModal();
    },
  });
}

function addLog(a, { date, minutes = 0, note = '' }) {
  const log = { id: uid(), activityId: a.id, date, minutes, count: 1, note };
  Store.upsert('activityLogs', log);
  render();
  const g = goalProgress(a);
  toast(g.p >= 1 ? `Meta de “${a.name}” batida!` : `Registrado em “${a.name}” · faltam ${g.leftText}`,
    { label: 'Desfazer', fn: () => { Store.remove('activityLogs', log.id); render(); } });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-activity': () => activityForm(),
  'edit-activity': el => { const a = Store.get('activities', el.dataset.id); if (a) activityForm(a); },
  'goal-area': el => { state.goalArea = el.dataset.id; render(); },
  'log-activity': el => { const a = Store.get('activities', el.dataset.id); if (a) logForm(a); },
  // "Fiz hoje" de novo desmarca (tira o registro de hoje).
  'quick-log': el => {
    const a = Store.get('activities', el.dataset.id);
    if (!a) return;
    const log = doneToday(a);
    if (!log) return addLog(a, { date: today() });
    Store.remove('activityLogs', log.id);
    render();
    toast('Desmarcado', { label: 'Desfazer', fn: () => { Store.upsert('activityLogs', log); render(); } });
  },
  'del-log': el => {
    const removed = Store.remove('activityLogs', el.dataset.id);
    render();
    toast('Registro removido', { label: 'Desfazer', fn: () => { Store.upsert('activityLogs', removed); render(); } });
  },
  'toggle-objective': el => {
    const a = Store.get('activities', el.dataset.id);
    const o = a?.objectives?.find(x => x.id === el.dataset.obj);
    if (!o) return;
    o.done = !o.done;
    Store.upsert('activities', a);
    render();
    if (a.objectives.every(x => x.done)) toast(`Todos os objetivos de “${a.name}” concluídos!`);
  },
});
