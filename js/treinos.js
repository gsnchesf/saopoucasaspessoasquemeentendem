'use strict';
/* ==========================================================
   Treinos: rotina fixa da semana (ex.: Treino A seg/qua/sex
   07:00–08:00, com os exercícios). Entra na agenda nesses
   horários, dá para marcar "Fiz" no dia e, ligado a uma meta,
   o treino feito já conta nela.
   workouts: { id, name, days: [0..6], start, end,
               exercises: [{ id, text }], activityId, doneDates: [] }
   ========================================================== */

const workoutColor = () => Store.data.categories.find(c => norm(c.name) === 'treino')?.color || '#10b981';
const workoutsList = () => Store.data.workouts.slice().sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
const workoutMinutes = w => Math.max(0, toMin(w.end) - toMin(w.start));

/** Treinos da rotina entre duas datas, como itens da agenda. */
function workoutItems(from, to) {
  const out = [];
  for (const w of Store.data.workouts) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!(w.days || []).includes(weekday(d))) continue;
      const n = (w.exercises || []).length;
      out.push({ kind: 'workout', id: w.id, date: d, title: w.name, start: w.start, end: w.end, color: workoutColor(),
        label: n ? plural(n, 'exercício', 'exercícios') : '', allDay: false, deadline: false, state: dayState(w, d) });
    }
  }
  return out;
}

/** Ao lado do treino na agenda: "Fiz" / "Não fiz"; depois de marcado, um botão com o estado (clicar desmarca). */
function workoutControls(it) {
  if (it.date > today()) return '';
  const btn = (st, label, cls) => `<button class="btn btn-sm ${cls}" data-action="workout-state" data-state="${it.state === st ? '' : st}" data-id="${esc(it.id)}" data-date="${it.date}" aria-pressed="${it.state === st}">${label}</button>`;
  if (it.state === 'done') return btn('done', `${icon('check')}Feito`, 'btn-primary');
  if (it.state === 'skipped') return btn('skipped', 'Não fiz', 'btn-danger-ghost');
  return btn('done', 'Fiz', '') + btn('skipped', 'Não fiz', 'btn-ghost');
}

/** Marca o treino do dia como feito, não feito ou sem marca; feito com meta ligada registra nela. */
function setWorkoutState(w, date, st) {
  const before = dayState(w, date);
  Store.upsert('workouts', withDayState(w, date, st));
  const a = w.activityId && Store.get('activities', w.activityId);
  if (a && before === 'done') Store.removeWhere('activityLogs', l => l.workoutId === w.id && l.date === date);
  if (a && st === 'done') Store.upsert('activityLogs', { id: uid(), activityId: a.id, workoutId: w.id, date, minutes: workoutMinutes(w), count: 1, note: w.name });
  render();
  if (st === 'skipped') return toast(`${w.name}: não fiz`);
  if (!st) return toast('Treino desmarcado');
  const g = a && goalProgress(a);
  toast(!a ? `${w.name} feito` : g.p >= 1 ? `${w.name} feito · meta de “${a.name}” batida!` : `${w.name} feito · faltam ${g.leftText} em “${a.name}”`);
}

/* ---------- Tela ---------- */

screens.treinos = () => {
  const list = workoutsList();
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(t, 1), i));
  const week = workoutItems(days[0], days[6]);
  const due = week.filter(it => it.date <= t);
  const done = week.filter(it => it.state === 'done').length;

  const head = `<div class="title-block"><h1>Treinos</h1>
      <p class="sub">${week.length ? `${done} de ${week.length} feitos nesta semana` : ''}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-workout">${icon('plus')}Treino</button></div>`;
  if (!list.length) {
    return { head, body: `<div class="card card-pad"><p class="empty">Nenhum treino.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="new-workout">${icon('plus')}Criar treino</button></div></div>` };
  }

  // Semana: cada dia com treino, com Fiz / Não fiz nos que já chegaram.
  const semana = `<section class="card card-pad">
    <div class="card-head"><h2>Esta semana</h2>${due.some(it => !it.state) ? `<span class="sub">${plural(due.filter(it => !it.state).length, 'sem marcar', 'sem marcar')}</span>` : ''}</div>
    ${days.filter(d => week.some(it => it.date === d)).map(d => `<h3 class="section-label">${cap(relDay(d))}</h3>
      <div class="list">${week.filter(it => it.date === d).map(itemRow).join('')}</div>`).join('')}
  </section>`;

  const rotina = `<section class="card card-pad">
    <div class="card-head"><h2>Rotina</h2></div>
    <div class="list">${list.map(w => {
      const a = w.activityId && Store.get('activities', w.activityId);
      const meta = [`${daysLabel(w.days || [])} · ${w.start}–${w.end}`, (w.exercises || []).length && plural(w.exercises.length, 'exercício', 'exercícios'), a && `conta em “${esc(a.name)}”`].filter(Boolean).join(' · ');
      return `<button class="ev-row" style="--c:${esc(workoutColor())}" data-action="open-workout" data-id="${esc(w.id)}" data-date="${t}">
        <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(w.name)}</span></span><span class="ev-meta"><span>${meta}</span></span></span></button>`;
    }).join('')}</div>
  </section>`;

  return { head, body: `<div class="stack">${semana}${rotina}</div>` };
};

/* ---------- Formulários ---------- */

/** Ficha do treino num dia: os exercícios à mão (para ver na academia) e Fiz / Não fiz. */
function workoutDay(w, date) {
  const ex = w.exercises || [];
  const a = w.activityId && Store.get('activities', w.activityId);
  const st = dayState(w, date);
  const plannedDay = (w.days || []).includes(weekday(date));
  openSheet({
    title: w.name, color: workoutColor(), sub: esc(`Treino · ${daysLabel(w.days || [])}`),
    rows: [
      ['Quando', esc(`${cap(relDay(date))} · ${w.start}–${w.end}`)],
      ['Conta em', a ? esc(a.name) : ''],
      ['Situação', st === 'done' ? 'Feito' : st === 'skipped' ? 'Não feito' : ''],
    ],
    body: ex.length ? `<ol class="workout-list">${ex.map(e => `<li>${esc(e.text)}</li>`).join('')}</ol>` : '',
    buttons: plannedDay && date <= today() ? dayStateButtons(st, next => setWorkoutState(Store.get('workouts', w.id) || w, date, next)) : [],
    onEdit: () => workoutForm(w),
  });
}

function workoutForm(w) {
  const isNew = !w;
  const fitness = Store.data.activities.find(a => !a.archived && ['tempo', 'vezes'].includes(a.goalType) && norm(area(a.areaId)?.name) === 'fitness');
  w = w ? structuredClone(w) : { id: uid(), name: '', days: [1, 3, 5], start: '07:00', end: '08:00', exercises: [], activityId: fitness?.id || '', doneDates: [] };
  const acts = activitiesList().filter(a => a.goalType === 'tempo' || a.goalType === 'vezes');
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo treino' : 'Editar treino')}
    <div class="modal-body">
      <label class="field"><span>Nome</span><input name="name" maxlength="80" value="${esc(w.name)}" ${isNew ? 'autofocus' : ''}></label>
      <div><span class="fieldset-label">Dias</span><div style="margin-top:6px">${dayToggles('days', w.days || [])}</div></div>
      <div class="row">
        <label class="field"><span>Início</span><input type="time" name="start" value="${esc(w.start)}"></label>
        <label class="field"><span>Fim</span><input type="time" name="end" value="${esc(w.end)}"></label>
      </div>
      <div><span class="fieldset-label">Exercícios</span><div style="margin-top:6px">${listEditor('exercises', w.exercises || [], { check: false, addLabel: 'Exercício' })}</div></div>
      ${acts.length ? `<label class="field"><span>Conta na meta</span><select name="activityId"><option value="">Nenhuma</option>${options(acts.map(a => [a.id, a.name]), w.activityId)}</select></label>` : ''}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      const days = readDays(form, 'days');
      if (!f.name.trim()) return formError(form, 'Falta o nome.');
      if (!days.length) return formError(form, 'Escolha pelo menos um dia.');
      if (!f.start || !f.end || f.end <= f.start) return formError(form, 'O fim precisa ser depois do início.');
      Object.assign(w, {
        name: f.name.trim(), days, start: f.start, end: f.end,
        exercises: readList(form, 'exercises').map(({ id, text }) => ({ id, text })),
        activityId: f.activityId || '',
      });
      Store.upsert('workouts', w);
      closeModal();
      render();
      toast(isNew ? 'Treino na agenda' : 'Treino atualizado');
    },
    async onDelete() {
      if (!await confirmDelete(`“${w.name}”`)) return;
      const removed = Store.remove('workouts', w.id);
      closeModal();
      render();
      toast('Treino excluído', { label: 'Desfazer', fn: () => { Store.upsert('workouts', removed); render(); } });
    },
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-workout': () => workoutForm(),
  'edit-workout': el => { const w = Store.get('workouts', el.dataset.id); if (w) workoutForm(w); },
  'open-workout': el => { const w = Store.get('workouts', el.dataset.id); if (w) workoutDay(w, el.dataset.date); },
  'workout-state': el => { const w = Store.get('workouts', el.dataset.id); if (w) setWorkoutState(w, el.dataset.date, el.dataset.state || null); },
});
