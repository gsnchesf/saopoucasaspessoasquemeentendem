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
        label: n ? plural(n, 'exercício', 'exercícios') : '', allDay: false, deadline: false, done: (w.doneDates || []).includes(d) });
    }
  }
  return out;
}

/** Botão "Fiz" ao lado do treino na agenda. */
function workoutControls(it) {
  if (it.date > today()) return '';
  return `<button class="btn btn-sm ${it.done ? 'btn-primary' : ''}" data-action="workout-done" data-id="${esc(it.id)}" data-date="${it.date}" aria-pressed="${it.done}">${it.done ? icon('check') + 'Feito' : 'Fiz'}</button>`;
}

/** Marca/desmarca o treino do dia; com meta ligada, registra (ou tira) o treino nela. */
function toggleWorkoutDone(w, date) {
  const next = structuredClone(w);
  const done = (w.doneDates || []).includes(date);
  next.doneDates = done ? w.doneDates.filter(d => d !== date) : [...(w.doneDates || []), date].sort();
  Store.upsert('workouts', next);
  const a = w.activityId && Store.get('activities', w.activityId);
  if (a) {
    if (done) Store.removeWhere('activityLogs', l => l.workoutId === w.id && l.date === date);
    else Store.upsert('activityLogs', { id: uid(), activityId: a.id, workoutId: w.id, date, minutes: workoutMinutes(w), count: 1, note: w.name });
  }
  render();
  if (done) return toast('Treino desmarcado');
  const g = a && goalProgress(a);
  toast(!a ? `${w.name} feito` : g.p >= 1 ? `${w.name} feito · meta de “${a.name}” batida!` : `${w.name} feito · faltam ${g.leftText} em “${a.name}”`);
}

/* ---------- Seção em Metas ---------- */

function workoutsSection() {
  const list = workoutsList();
  if (!list.length) return '';
  return `<section class="card card-pad">
    <div class="card-head"><h2>Rotina de treinos</h2><button class="btn btn-sm" data-action="new-workout">${icon('plus')}Treino</button></div>
    <div class="list">${list.map(w => {
      const a = w.activityId && Store.get('activities', w.activityId);
      const meta = [`${daysLabel(w.days || [])} · ${w.start}–${w.end}`, (w.exercises || []).length && plural(w.exercises.length, 'exercício', 'exercícios'), a && `conta em “${esc(a.name)}”`].filter(Boolean).join(' · ');
      return `<button class="ev-row" style="--c:${esc(workoutColor())}" data-action="edit-workout" data-id="${esc(w.id)}">
        <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(w.name)}</span></span><span class="ev-meta"><span>${meta}</span></span></span></button>`;
    }).join('')}</div>
  </section>`;
}

/* ---------- Formulários ---------- */

/** Treino de um dia: os exercícios à mão (para ver na academia) e o "Fiz". */
function workoutDay(w, date) {
  const done = (w.doneDates || []).includes(date);
  const ex = w.exercises || [];
  openModal(`<form novalidate>
    ${modalHead(w.name)}
    <div class="modal-body">
      <p class="desc" style="margin:0">${esc(relDay(date))} · ${w.start}–${w.end}</p>
      ${ex.length ? `<ol class="workout-list">${ex.map(e => `<li>${esc(e.text)}</li>`).join('')}</ol>` : ''}
    </div>
    <footer class="modal-actions">
      <button type="button" class="btn" data-edit>${icon('edit')}Editar</button>
      <span class="spacer"></span>
      ${date <= today() ? `<button type="submit" class="btn ${done ? '' : 'btn-primary'}">${done ? 'Desmarcar' : 'Fiz'}</button>` : '<button type="button" class="btn" data-close>Fechar</button>'}
    </footer>
  </form>`, {
    onMount(form) { $('[data-edit]', form).addEventListener('click', () => { closeModal(); workoutForm(w); }); },
    onSubmit() { closeModal(); toggleWorkoutDone(w, date); },
  });
}

function workoutForm(w) {
  const isNew = !w;
  const fitness = Store.data.activities.find(a => !a.archived && norm(area(a.areaId)?.name) === 'fitness');
  w = w ? structuredClone(w) : { id: uid(), name: '', days: [1, 3, 5], start: '07:00', end: '08:00', exercises: [], activityId: fitness?.id || '', doneDates: [] };
  const acts = activitiesList();
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo treino' : 'Editar treino')}
    <div class="modal-body">
      <label class="field"><span>Nome</span><input name="name" maxlength="80" value="${esc(w.name)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Treino A — peito e tríceps"></label>
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
  'workout-done': el => { const w = Store.get('workouts', el.dataset.id); if (w) toggleWorkoutDone(w, el.dataset.date); },
});
