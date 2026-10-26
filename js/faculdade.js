'use strict';
/* ==========================================================
   Faculdade: matérias (horários, professor, sala), faltas com
   limite, provas/trabalhos/atividades, conteúdos e arquivos.
   ========================================================== */

/* ---------- Faltas ---------- */

/** Lista assinada por outra pessoa não é falta. Registros antigos de "Assinaram por mim" ficam de fora. */
const signedList = a => a.present && !a.delivery && dayMode(subject(a.subjectId) || {}, a.date) === 'lista';

const absencesOf = id => Store.data.absences.filter(a => a.subjectId === id && !signedList(a)).sort((a, b) => b.date.localeCompare(a.date));

/** Dias da semana em que a matéria tem aula. */
const classDays = slots => new Set(slots.map(x => x.weekday)).size;

/** Aulas da matéria num dia, em ordem. Um horário de 3 h ou mais (ex.: 19:30–23:00) são duas aulas seguidas. */
function dayClasses(s, date) {
  const out = [];
  (s.slots || []).filter(x => x.weekday === weekday(date)).sort((a, b) => a.start.localeCompare(b.start)).forEach(x => {
    const n = toMin(x.end) - toMin(x.start) >= 180 ? 2 : 1;
    for (let i = 0; i < n; i++) out.push(x);
  });
  return out;
}

/** Como a matéria conta presença. No exercício dá para ter presença sem assistir a aula
    (entregou o exercício); na lista assinada, a pessoa simplesmente não faltou. */
const ATTENDANCE = {
  lista: { label: 'Lista' },
  exercicio: { label: 'Exercício', action: 'Entreguei o exercício', state: 'Exercício entregue' },
  chamada: { label: 'Chamada' },
};
const attendance = s => ATTENDANCE[s.attendance] ? s.attendance : 'lista';

/** Faltável (checkbox da matéria): falta fica registrada, mas não tem limite. 'livre' é o jeito antigo de marcar. */
const isFree = s => !!s.faltavel || s.attendance === 'livre';

/** Quanto do dia a pessoa perdeu: o dia inteiro vale 1; parte das aulas vale a fração (1 de 2 = 0,5). */
function absShare(a, s) {
  if (!a.aulas?.length) return 1;
  return Math.min(1, a.aulas.length / Math.max(1, dayClasses(s, a.date).length));
}

/** Quanto conta no limite: com presença sem ter assistido (present) ou em matéria faltável, nada. */
const absWeight = (a, s) => a.present || isFree(s) ? 0 : absShare(a, s);

/** "1ª aula", "1ª e 2ª aulas". */
const aulasLabel = aulas => `${aulas.map(i => `${i + 1}ª`).join(' e ')} ${aulas.length > 1 ? 'aulas' : 'aula'}`;

/** Número de faltas com meia falta: 3,5. */
const absNum = n => String(Math.round(n * 10) / 10).replace('.', ',');

/** Limite: 4 faltas por dia de aula na semana (1 dia = 4, 2 dias = 8). Cada dia faltado conta 1,
    não importa quantas aulas tenha naquele dia; faltar só em parte delas conta a fração. */
function absInfo(s) {
  const list = absencesOf(s.id);
  const free = isFree(s);
  const used = list.reduce((n, a) => n + absWeight(a, s), 0);
  const missed = list.reduce((n, a) => n + absShare(a, s), 0); // aulas não assistidas, contando ou não
  const pending = list.filter(a => a.delivery && !a.present).length; // exercícios ainda por entregar
  const days = classDays(s.slots || []);
  const limit = free ? 0 : days * ABSENCES_PER_DAY;
  const remaining = limit - used;
  const level = !limit ? '' : remaining <= 0 ? 'danger' : remaining / limit <= 0.25 ? 'warn' : 'ok';
  return { used, missed, pending, free, days, limit, remaining, level };
}

/** Aulas que a matéria tem num dia (soma dos horários daquele dia da semana). */
const classesOn = (s, date) => (s.slots || []).filter(x => x.weekday === weekday(date)).reduce((n, x) => n + (x.weight || 1), 0);

const noLimitText = () => 'Cadastre os horários para calcular o limite.';

/** Selo "pode faltar N vezes" + botão de marcar falta, usado nas linhas de aula. */
function absenceControls(it) {
  const s = subject(it.id);
  if (!s) return '';
  const info = absInfo(s);
  const marked = absenceOn(s.id, it.date);
  let html = '';
  if (info.free) html += '<span class="badge ok">faltável</span>';
  else if (info.limit) {
    const n = Math.max(0, info.remaining);
    html += `<span class="badge ${info.level}" title="${absNum(n)} de ${info.limit} faltas restantes">${n ? `restam ${absNum(n)}` : 'no limite'}</span>`;
  }
  const ex = exerciseDay(s, it.date);
  if (ex && !it.canceled && attendance(s) !== 'exercicio') html += '<span class="badge k-exercicio">exercício</span>';
  if (it.canceled) {
    const label = !ex ? 'Cancelada' : !marked || it.date > today() ? 'Cancelada · exercício'
      : marked.present ? 'Exercício entregue' : marked.delivery ? `Exercício até ${shortDate(marked.delivery)}` : 'Não entreguei';
    html += `<button class="btn btn-sm ${marked && absWeight(marked, s) ? 'btn-danger-ghost' : ''}" data-action="toggle-absence" data-id="${esc(s.id)}" data-date="${it.date}">${label}</button>`;
  } else if (it.date <= today()) {
    const label = !marked ? 'Faltei' : marked.present ? ATTENDANCE[dayMode(s, it.date)].state || 'Com presença'
      : marked.delivery ? `Exercício até ${shortDate(marked.delivery)}`
      : marked.aulas?.length ? `Faltei na ${aulasLabel(marked.aulas)}` : 'Falta marcada';
    html += `<button class="btn btn-sm ${marked && absWeight(marked, s) ? 'btn-danger-ghost' : ''}" data-action="toggle-absence" data-id="${esc(s.id)}" data-date="${it.date}" aria-pressed="${!!marked}">${label}</button>`;
  } else {
    // Aula futura: dá para cancelar ou combinar presença por exercício.
    html += `<button class="icon-btn ghost sm" data-action="toggle-absence" data-id="${esc(s.id)}" data-date="${it.date}" aria-label="Opções da aula" title="Cancelada? Exercício?">${icon('more')}</button>`;
  }
  return html;
}

const shortDate = d => fmt(d, { day: 'numeric', month: 'short' });

const absenceOn = (subjectId, date) => Store.data.absences.find(a => a.subjectId === subjectId && a.date === date && !signedList(a));

/* ---------- Aula cancelada (fica na matéria: s.canceled = datas) ---------- */

const isCanceled = (s, date) => (s.canceled || []).includes(date);

function setCanceled(s, date, on) {
  const next = structuredClone(s);
  next.canceled = (s.canceled || []).filter(d => d !== date);
  if (on) next.canceled = [...next.canceled, date].sort();
  if (!next.canceled.length) delete next.canceled;
  // Aula que não houve não tem falta (o Desfazer devolve).
  const removed = on ? Store.data.absences.filter(a => a.subjectId === s.id && a.date === date) : [];
  if (removed.length) Store.removeWhere('absences', a => a.subjectId === s.id && a.date === date);
  Store.upsert('subjects', next);
  render();
  const undo = () => { setCanceled(next, date, false); removed.forEach(a => Store.upsert('absences', a)); render(); };
  toast(on ? `Aula de ${s.name} cancelada` : 'Aula de volta', on ? { label: 'Desfazer', fn: undo } : null);
}

/* ---------- Presença por exercício num dia (s.exerciseDays = datas) ----------
   Ex.: normalmente é lista, mas nessa semana é exercício; ou a aula foi
   cancelada e a presença é o exercício entregue (às vezes sim, às vezes não). */

const exerciseDay = (s, date) => (s.exerciseDays || []).includes(date);
const dayMode = (s, date) => exerciseDay(s, date) ? 'exercicio' : attendance(s);

function setExerciseDay(s, date, on) {
  const next = structuredClone(s);
  next.exerciseDays = (s.exerciseDays || []).filter(d => d !== date);
  if (on) next.exerciseDays = [...next.exerciseDays, date].sort();
  if (!next.exerciseDays.length) delete next.exerciseDays;
  Store.upsert('subjects', next);
  render();
  toast(on ? `Presença por exercício em ${shortDate(date)}` : `Presença de ${shortDate(date)} volta ao normal`);
}

/** Grava a falta do dia: aulas = null (sem falta), [] (todas) ou os índices das aulas faltadas.
    extra: outros campos do registro (present, delivery); undefined/false apaga o campo. */
function setAbsence(s, date, aulas, extra = {}) {
  const cur = absenceOn(s.id, date);
  const total = dayClasses(s, date).length;
  if (aulas && aulas.length >= total) aulas = [];
  if (!aulas) {
    if (!cur) return;
    Store.removeWhere('absences', a => a.subjectId === s.id && a.date === date);
    render();
    toast('Falta desmarcada');
    return;
  }
  if (!cur) Store.removeWhere('absences', a => a.subjectId === s.id && a.date === date); // "Assinaram por mim" antigo
  const rec = cur ? { ...cur } : { id: uid(), subjectId: s.id, date, note: '' };
  if (aulas.length) rec.aulas = aulas.slice().sort(); else delete rec.aulas;
  for (const [k, v] of Object.entries(extra)) { if (v === undefined || v === false) delete rec[k]; else rec[k] = v; }
  Store.upsert('absences', rec);
  render();
  absenceToast(s, rec);
}

/** Presença sem ter assistido (entregou o exercício): fica registrado, mas não conta falta. */
function setPresent(s, date, on) {
  const cur = absenceOn(s.id, date);
  if (!cur) return;
  const rec = { ...cur };
  if (on) rec.present = true; else delete rec.present;
  if (on && rec.delivery > today()) rec.delivery = today(); // entregou antes do combinado
  Store.upsert('absences', rec);
  render();
  absenceToast(s, rec);
}

function absenceToast(s, rec) {
  const info = absInfo(s);
  const mode = ATTENDANCE[dayMode(s, rec.date)];
  if (info.free) return toast(`Falta em ${s.name} · faltável`);
  const left = info.limit ? ` · restam ${absNum(Math.max(0, info.remaining))}` : '';
  if (rec.present) return toast(`${mode.state} em ${s.name}${left}`);
  if (rec.delivery) return toast(`Exercício de ${s.name} até ${shortDate(rec.delivery)}`);
  toast(`Falta em ${s.name}${left}`, mode.action ? { label: mode.action, fn: () => setPresent(s, rec.date, true) } : null);
}

/** Exercício de uma aula faltada, entregue (ou a entregar) em outro dia. Pendente, vira prazo na agenda. */
function exerciseForm(s, date) {
  const cur = absenceOn(s.id, date);
  const when = cur?.delivery || (date < today() ? today() : addDays(date, 7));
  openModal(`<form novalidate>
    ${modalHead(`Exercício · ${s.name}`)}
    <div class="modal-body">
      <p class="desc" style="margin:0">Aula de ${esc(relDay(date).toLowerCase())}</p>
      <label class="field"><span>Entrega</span><input type="date" name="delivery" value="${when}"></label>
      <label class="check"><input type="checkbox" name="done" ${cur?.present || (!cur && when <= today()) ? 'checked' : ''}> Já entreguei</label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (!f.delivery) return formError(form, 'Falta a data.');
      closeModal();
      setAbsence(s, date, cur?.aulas?.length ? cur.aulas : [], { delivery: f.delivery === date ? undefined : f.delivery, present: !!f.done });
    },
  });
}

/** Botão "Faltei": dia com uma aula marca direto; com aulas seguidas, deixa escolher qual.
    Em dia de exercício, o menu também tem a entrega ("Entreguei o exercício"). */
function toggleAbsence(el) {
  const s = subject(el.dataset.id);
  if (!s) return;
  const date = el.dataset.date;
  const cur = absenceOn(s.id, date);
  const keep = cur?.aulas?.length ? cur.aulas : []; // presença sem assistir: mantém as aulas já marcadas
  const ex = exerciseDay(s, date);
  // Clicar de novo na opção marcada desmarca.
  const exerciseItems = [
    { label: 'Entreguei o exercício', icon: cur?.present && !cur.delivery ? 'check' : '', run: () => setAbsence(s, date, keep, { present: !(cur?.present && !cur.delivery), delivery: undefined }) },
    { label: cur?.delivery ? `Entrega em ${shortDate(cur.delivery)}…` : 'Entrega em outro dia…', icon: cur?.delivery ? 'check' : '', run: () => exerciseForm(s, date) },
  ];
  const exerciseToggle = { label: 'Presença por exercício', icon: ex ? 'check' : '', run: () => setExerciseDay(s, date, !ex) };
  const cancel = on => ({ label: 'Aula cancelada', icon: on ? 'check' : '', run: () => setCanceled(s, date, !on) });

  // Aula cancelada: às vezes a presença é o exercício entregue.
  if (isCanceled(s, date)) {
    const items = [cancel(true), { sep: true }, { ...exerciseToggle, label: 'Presença por exercício' }];
    if (ex && date <= today()) items.push(...exerciseItems,
      { label: 'Não entreguei', icon: cur && !cur.present && !cur.delivery ? 'check' : '', run: () => setAbsence(s, date, cur && !cur.present && !cur.delivery ? null : [], { present: undefined, delivery: undefined }) });
    return openMenu(el, items);
  }
  if (date > today()) return openMenu(el, [cancel(false), ...(attendance(s) !== 'exercicio' ? [exerciseToggle] : [])]);

  const n = dayClasses(s, date).length;
  const mode = dayMode(s, date);
  const all = !!cur && !cur.aulas?.length;
  const only = i => cur?.aulas?.length === 1 && cur.aulas[0] === i;
  const items = n < 2 ? [{ label: 'Faltei', icon: cur ? 'check' : '', run: () => setAbsence(s, date, cur ? null : []) }] : [
    { label: n === 2 ? 'Faltei nas duas' : 'Faltei em todas', icon: all ? 'check' : '', run: () => setAbsence(s, date, all ? null : []) },
    ...Array.from({ length: n }, (_, i) => ({ label: `Só na ${i + 1}ª aula`, icon: only(i) ? 'check' : '', run: () => setAbsence(s, date, only(i) ? null : [i]) })),
  ];
  if (mode === 'exercicio') items.push({ sep: true }, ...exerciseItems);
  items.push({ sep: true });
  if (attendance(s) !== 'exercicio') items.push(exerciseToggle);
  items.push(cancel(false));
  openMenu(el, items);
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

function fileKind(name, type = '') {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  if (ext === 'pdf') return ['PDF', '#dc2626'];
  if (['ppt', 'pptx', 'pps', 'ppsx', 'key', 'odp'].includes(ext)) return ['PPT', '#ea580c'];
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return ['DOC', '#2563eb'];
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return ['XLS', '#16a34a'];
  if (type.startsWith('image/')) return ['IMG', '#9333ea'];
  return [ext.slice(0, 4).toUpperCase() || 'ARQ', '#64748b'];
}

const valesPresenca = a => a.kind === 'atividade' && a.counts === 'presenca';

/** Ficha do prazo da faculdade. */
function assessmentView(a) {
  const s = subject(a.subjectId);
  const flip = () => { const x = Store.get('assessments', a.id); if (!x) return; if (x.skipped) delete x.skipped; else x.done = !x.done; Store.upsert('assessments', x); render(); };
  const late = !a.done && !a.skipped && a.date < today();
  openSheet({
    title: a.title, color: s?.color, sub: esc(['Faculdade', s?.name, kindLabel(a)].filter(Boolean).join(' · ')),
    rows: [
      ['Data', esc(`${cap(relDay(a.date))}${a.time ? ' · ' + a.time : ''}`) + (late ? ' <span class="late">atrasado</span>' : '')],
      ['Situação', a.done ? 'Feito' : a.skipped ? 'Não feito' : ''],
      ['Valor', esc(a.weight || '')],
      ['Nota', esc(a.grade || '')],
      ['Conteúdos', sheetText(a.topics)],
      ['Detalhes', sheetText(a.details)],
    ],
    buttons: [{ label: a.done || a.skipped ? 'Reabrir' : `${icon('check')}Feito`, run: flip },
      ...(late ? [{ label: 'Não fiz', run: () => skipDeadline('assessment', a.id) }] : [])],
    onEdit: () => assessmentForm(a),
  });
}
const kindLabel = a => ASSESSMENT_KINDS[a.kind] + (a.kind === 'atividade' ? ` · vale ${valesPresenca(a) ? 'presença' : 'nota'}` : '');

function assessmentRow(a, { showSubject = true } = {}) {
  const s = subject(a.subjectId);
  const late = !a.done && !a.skipped && a.date < today();
  const soon = !a.done && !a.skipped && !late && diffDays(today(), a.date) <= 3;
  return `<div class="task ${a.done || a.skipped ? 'done' : ''}">
    <button class="checkbox ${a.done ? 'on' : ''}" data-action="toggle-assessment" data-id="${esc(a.id)}" role="checkbox" aria-checked="${!!a.done}" aria-label="Concluir ${esc(a.title)}"></button>
    <button class="task-main" data-action="edit-assessment" data-id="${esc(a.id)}">
      <span class="task-title">${esc(a.title)}</span>
      <span class="task-meta">
        <span class="badge k-${a.kind}">${kindLabel(a)}</span>
        ${showSubject && s ? `<span class="pill" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : ''}
        <span class="${late ? 'late' : soon ? 'soon' : ''}">${relDay(a.date)}${a.time ? ' · ' + a.time : ''}${Math.abs(diffDays(today(), a.date)) > 1 ? ` (${untilLabel(a.date)})` : ''}</span>
        ${a.skipped && !a.done ? '<span>Não feito</span>' : ''}
        ${a.grade ? `<span>Nota: ${esc(a.grade)}</span>` : ''}
      </span>
    </button>
  </div>`;
}

/* ---------- Ficha da aula (uma data de uma matéria) ---------- */

/** Qual aula do semestre é esse dia: conta os dias de aula, sem os cancelados. */
function classNumber(s, date) {
  const { semesterStart: a, semesterEnd: b } = Store.settings;
  if (!a || !b || date < a || date > b || isCanceled(s, date)) return null;
  const days = new Set((s.slots || []).map(x => x.weekday));
  let n = 0, total = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) {
    if (!days.has(weekday(d)) || isCanceled(s, d)) continue;
    total++;
    if (d <= date) n++;
  }
  return { n, total };
}

/** Como ficou a presença nesse dia, no mesmo texto do botão da linha. */
function presenceLabel(s, date) {
  const cur = absenceOn(s.id, date);
  const ex = exerciseDay(s, date);
  if (isCanceled(s, date)) return ex ? 'Cancelada · presença por exercício' : 'Cancelada';
  if (cur) return cur.present ? ATTENDANCE[dayMode(s, date)].state || 'Com presença'
    : cur.delivery ? `Exercício até ${shortDate(cur.delivery)}`
    : cur.aulas?.length ? `Faltei na ${aulasLabel(cur.aulas)}` : 'Faltei';
  if (date > today()) return ex ? 'Por exercício' : '';
  return 'Presente';
}

function classSheet(s, date, start) {
  const slot = (s.slots || []).find(x => x.weekday === weekday(date) && (!start || x.start === start)) || {};
  const num = classNumber(s, date);
  const n = dayClasses(s, date).length;
  const info = absInfo(s);
  const cur = absenceOn(s.id, date);
  const topics = contentsOf(s.id).filter(c => c.date === date);
  const due = [
    ...assessmentsOf(s.id).filter(a => a.date === date).map(a => `<li class="${a.done ? 'done' : ''}"><span class="badge k-${a.kind}">${ASSESSMENT_KINDS[a.kind]}</span> ${esc(a.title)}</li>`),
    ...Store.data.absences.filter(a => a.subjectId === s.id && a.delivery === date && !a.present)
      .map(a => `<li><span class="badge k-exercicio">Exercício</span> Aula de ${shortDate(a.date)}</li>`),
  ];
  const next = assessmentsOf(s.id).find(a => !a.done && a.date > date);
  const past = date <= today() && !isCanceled(s, date);
  openSheet({
    title: s.name, color: s.color,
    sub: esc(['Faculdade', num ? `Aula ${num.n} de ${num.total}` : 'Aula'].join(' · ')),
    rows: [
      ['Quando', esc(`${cap(relDay(date))} · ${slot.start || ''}–${slot.end || ''}${n > 1 ? ` · ${n} aulas` : ''}`)],
      ['Sala', esc(slot.room || s.room || '')],
      ['Professor', esc(s.professor || '')],
      ['Presença', esc(presenceLabel(s, date))],
      ['Faltas', info.free ? 'Faltável' : info.limit ? esc(`Restam ${absNum(Math.max(0, info.remaining))} de ${info.limit}`) : ''],
      ['Conteúdo', topics.length ? `<ul class="sheet-list">${topics.map(c => `<li class="${c.done ? 'done' : ''}">${esc(c.title)}</li>`).join('')}</ul>` : ''],
      ['Prazos do dia', due.length ? `<ul class="sheet-list">${due.join('')}</ul>` : ''],
      ['Próximo prazo', next ? esc(`${ASSESSMENT_KINDS[next.kind]} · ${next.title} · ${relDay(next.date)}${next.date > today() ? ` (${untilLabel(next.date)})` : ''}`) : ''],
      ['Anotações', sheetText(s.classNotes?.[date])],
    ],
    buttons: [
      { label: 'Ver matéria', run: () => { location.hash = `#/faculdade/${s.id}`; } },
      ...(past ? [{ label: cur ? 'Tirar falta' : 'Faltei', run: () => setAbsence(s, date, cur ? null : []) }] : []),
    ],
    onEdit: () => classForm(s, date, start),
  });
}

/** Conteúdo e anotações de uma aula. Conteúdo é o mesmo da lista da matéria, com a data da aula. */
function classForm(s, date, start) {
  const topics = contentsOf(s.id).filter(c => c.date === date);
  openModal(`<form novalidate>
    ${modalHead(`${s.name} · ${shortDate(date)}`)}
    <div class="modal-body">
      <div><span class="fieldset-label">Conteúdo</span><div style="margin-top:6px">${listEditor('topics', topics.map(c => ({ id: c.id, text: c.title, done: c.done })), { addLabel: 'Conteúdo' })}</div></div>
      <label class="field"><span>Anotações</span><textarea name="notes" rows="4">${esc(s.classNotes?.[date] || '')}</textarea></label>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit(form) {
      const items = readList(form, 'topics');
      const keep = new Set(items.map(i => i.id));
      topics.filter(c => !keep.has(c.id)).forEach(c => Store.remove('contents', c.id));
      items.forEach(i => {
        const c = Store.get('contents', i.id);
        if (c?.title === i.text && !!c.done === i.done) return;
        Store.upsert('contents', { ...(c || { id: i.id, subjectId: s.id, date }), title: i.text, done: i.done });
      });
      const notes = formData(form).notes.trim();
      const cur = subject(s.id);
      if (cur && notes !== (cur.classNotes?.[date] || '')) {
        const next = structuredClone(cur);
        next.classNotes = { ...cur.classNotes, [date]: notes };
        if (!notes) delete next.classNotes[date];
        if (!Object.keys(next.classNotes).length) delete next.classNotes;
        Store.upsert('subjects', next);
      }
      closeModal();
      render();
      classSheet(subject(s.id) || s, date, start);
    },
  });
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
    return `<div class="card card-pad"><p class="empty">Nenhuma matéria cadastrada.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="import-jupiter">${icon('download')}Importar do JupiterWeb</button>
        <button class="btn" data-action="new-subject">${icon('plus')}Adicionar</button></div></div>`;
  }
  return `<div class="subject-grid">${list.map(s => {
    const info = absInfo(s);
    const next = assessmentsOf(s.id).find(a => !a.done && a.date >= today());
    const contents = contentsOf(s.id);
    const studied = contents.filter(c => c.done).length;
    const nFiles = filesOf(s.id).length;
    return `<button class="subject-card" style="--c:${esc(s.color)}" data-action="open-subject" data-id="${esc(s.id)}">
      <div><h3>${esc(s.name)}</h3>
        <div class="meta">${[s.professor && `Prof. ${esc(s.professor)}`, s.room && esc(s.room)].filter(Boolean).join(' · ')}</div></div>
      <div class="meta">${icon('clock')}${esc(slotsText(s) || 'Sem horários')}</div>
      ${info.limit ? `<div><div class="abs-line"><span class="muted">Faltas</span><span><b>${absNum(info.used)}</b> de ${info.limit} · <span class="badge ${info.level}">${info.remaining > 0 ? `restam ${absNum(info.remaining)}` : 'limite atingido'}</span></span></div>${meter(info.used / info.limit, info.level)}</div>`
        : `<div class="abs-line"><span class="muted">Faltas</span><span><b>${absNum(info.missed)}</b> · ${info.free ? 'faltável' : 'sem limite'}</span></div>`}
      <div class="meta">${next ? `<span class="badge k-${next.kind}">${ASSESSMENT_KINDS[next.kind]}</span> ${esc(next.title)} · ${untilLabel(next.date)}` : 'Sem prazos'}</div>
      <div class="meta"><span>${plural(nFiles, 'arquivo', 'arquivos')}</span><span>${studied}/${contents.length} conteúdos estudados</span></div>
    </button>`;
  }).join('')}</div>`;
}

function timetableTab() {
  const slots = Store.data.subjects.flatMap(s => (s.slots || []).map(sl => ({ s, sl })));
  if (!slots.length) return `<div class="card card-pad"><p class="empty">Nenhum horário cadastrado.</p></div>`;
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
    ['Atrasados', list.filter(a => !a.done && !a.skipped && a.date < t), 'danger'],
    ['Próximos 7 dias', list.filter(a => !a.done && !a.skipped && a.date >= t && diffDays(t, a.date) <= 7)],
    ['Mais adiante', list.filter(a => !a.done && !a.skipped && diffDays(t, a.date) > 7)],
    ['Concluídos', list.filter(a => a.done || a.skipped).reverse().slice(0, 15)],
  ].filter(g => g[1].length);
  return `<div class="card card-pad">
    <div class="filters" style="margin-bottom:8px">
      <select class="select" id="fac-subject-filter" aria-label="Filtrar por matéria"><option value="">Todas as matérias</option>${subjectOptions(sel)}</select>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="new-assessment" data-subject="${esc(sel)}">${icon('plus')}Prazo</button>
    </div>
    ${groups.length ? groups.map(([label, items, cls]) => `<h3 class="section-label ${cls || ''}">${label} <span class="count">${items.length}</span></h3>
      <div class="list">${items.map(a => assessmentRow(a)).join('')}</div>`).join('')
      : '<p class="empty">Nenhum prazo.</p>'}
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

  const faltas = `<section class="card card-pad">
    <div class="card-head"><h2>Faltas</h2><div class="btn-row">
      <button class="btn btn-sm" data-action="cancel-class" data-id="${esc(s.id)}">Aula cancelada</button>
      <button class="btn btn-sm" data-action="new-absence" data-id="${esc(s.id)}">${icon('plus')}Registrar falta</button></div></div>
    <div class="abs-mode"><label><span class="muted">Presença</span>
      <select class="select" data-attendance="${esc(s.id)}">${options(Object.entries(ATTENDANCE).map(([k, v]) => [k, v.label]), attendance(s))}</select></label>
      <label class="check"><input type="checkbox" data-faltavel="${esc(s.id)}" ${isFree(s) ? 'checked' : ''}> Faltável</label></div>
    ${info.limit ? `<div class="abs-hero">
        <div class="big-number ${info.level}">${absNum(Math.max(0, info.remaining))}</div>
        <p><b>${info.remaining > 0 ? 'Faltas restantes' : 'Limite atingido'}</b><br>
        <span class="muted">${absNum(info.used)} de ${info.limit} usadas${info.missed > info.used ? ` · ${absNum(info.missed - info.used)} com presença sem assistir` : ''}${info.pending ? ` · ${plural(info.pending, 'exercício pendente', 'exercícios pendentes')}` : ''}</span></p>
      </div>
      ${meter(info.used / info.limit, info.level)}`
      : `<p class="empty">${info.free ? `Faltável. Aulas perdidas: <b>${absNum(info.missed)}</b>.` : `${noLimitText()} Faltas registradas: <b>${absNum(info.missed)}</b>.`}</p>`}
    <h3 class="section-label" style="margin-top:16px">Histórico <span class="count">${absences.length}</span></h3>
    ${absences.length ? `<div class="list">${absences.map(a => {
        const delivery = a.delivery && (a.present ? `Entregue em ${shortDate(a.delivery)}` : `<span class="${a.delivery < today() ? 'late' : ''}">Entregar até ${shortDate(a.delivery)}</span>`);
        const meta = [a.aulas?.length && `Só na ${aulasLabel(a.aulas)}`, delivery || (isCanceled(s, a.date) && 'Aula cancelada', a.present && (ATTENDANCE[dayMode(s, a.date)].state || 'Com presença')), a.note && esc(a.note)].filter(Boolean).join(' · ');
        return `<div class="task">
        <span class="task-main"><span class="task-title">${relDay(a.date)}</span>${meta ? `<span class="task-meta">${meta}</span>` : ''}</span>
        ${dayMode(s, a.date) === 'exercicio' ? `<button class="btn btn-sm" data-action="edit-exercise" data-id="${esc(a.id)}">Exercício</button>` : ''}
        <button class="icon-btn ghost sm" data-action="del-absence" data-id="${esc(a.id)}" aria-label="Remover falta">${icon('x')}</button></div>`;
      }).join('')}</div>`
      : '<p class="empty">Nenhuma falta.</p>'}
    ${(s.canceled || []).length ? `<h3 class="section-label" style="margin-top:16px">Canceladas <span class="count">${s.canceled.length}</span></h3>
      <div class="list">${s.canceled.slice().reverse().map(d => `<div class="task">
        <span class="task-main"><span class="task-title">${relDay(d)}</span></span>
        <button class="icon-btn ghost sm" data-action="uncancel-class" data-id="${esc(s.id)}" data-date="${d}" aria-label="Desfazer cancelamento">${icon('x')}</button></div>`).join('')}</div>` : ''}
  </section>`;

  const prazos = `<section class="card card-pad">
    <div class="card-head"><h2>Provas, trabalhos e atividades</h2><button class="btn btn-sm" data-action="new-assessment" data-subject="${esc(s.id)}">${icon('plus')}Prazo</button></div>
    ${assessments.length ? `<div class="list">${assessments.map(a => assessmentRow(a, { showSubject: false })).join('')}</div>` : '<p class="empty">Nenhum prazo.</p>'}
  </section>`;

  const horarios = `<section class="card card-pad">
    <div class="card-head"><h2>Horários</h2><button class="link" data-action="edit-subject" data-id="${esc(s.id)}">Editar</button></div>
    ${slots.length ? `<div class="list">${slots.map(x => `<div class="task"><span class="task-main">
        <span class="task-title">${WEEKDAYS_LONG[x.weekday]} · ${x.start}–${x.end}</span>
        <span class="task-meta">${plural(x.weight || 1, 'aula', 'aulas')}${x.room || s.room ? ' · ' + esc(x.room || s.room) : ''}</span></span></div>`).join('')}</div>`
      : '<p class="empty">Sem horários.</p>'}
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
    <form class="quick-add" data-form="quick-content" data-id="${esc(s.id)}">${icon('plus')}<input name="q" autocomplete="off" placeholder="Adicionar conteúdo" aria-label="Adicionar conteúdo"></form>
  </section>`;

  const arquivos = `<section class="card card-pad">
    <div class="card-head"><h2>Arquivos</h2><span class="sub">${plural(files.length, 'arquivo', 'arquivos')}</span></div>
    <label class="dropzone" id="dropzone">${icon('upload')}<span><b>Anexar arquivos</b></span>
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
  if (!blob) { toast('Esse arquivo está em outro aparelho.', null, 6000); return null; }
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
        <label class="field"><span>Nome da matéria</span><input name="name" maxlength="120" value="${esc(s.name)}" ${isNew ? 'autofocus' : ''}></label>
        <label class="field xs"><span>Cor</span><input type="color" name="color" value="${esc(s.color)}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Professor</span><input name="professor" maxlength="120" value="${esc(s.professor)}"></label>
        <label class="field"><span>Sala padrão</span><input name="room" maxlength="60" value="${esc(s.room)}"></label>
      </div>
      <div>
        <span class="fieldset-label">Horários das aulas</span>
        <div class="slot-list" style="margin-top:6px">
          <div class="slot-row slot-head"><span>Dia</span><span>Início</span><span>Fim</span><span>Aulas</span><span>Sala</span><span></span></div>
          ${(s.slots || []).map(slotRow).join('')}
          <button type="button" class="btn btn-sm" data-add-slot style="justify-self:start">${icon('plus')}Horário</button>
        </div>
      </div>
      <div class="row">
        <label class="field"><span>Presença</span><select name="attendance">${options(Object.entries(ATTENDANCE).map(([k, v]) => [k, v.label]), attendance(s))}</select></label>
        <label class="check"><input type="checkbox" name="faltavel" ${isFree(s) ? 'checked' : ''}> Faltável</label>
      </div>
      <p class="hint-box calc-hint"></p>
      <label class="field"><span>Observações</span><textarea name="notes" rows="2">${esc(s.notes)}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      // Mostra, ao vivo, o limite de faltas que os horários preenchidos geram.
      const hint = $('.calc-hint', form);
      const update = () => {
        const days = classDays(readSlots(form));
        hint.innerHTML = icon('clock') + esc(form.elements.faltavel.checked ? 'Faltável: sem limite de faltas.'
          : days ? `Limite: ${days * ABSENCES_PER_DAY} faltas (${ABSENCES_PER_DAY} por dia de aula).`
          : noLimitText());
      };
      update();
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      form.addEventListener('click', () => setTimeout(update)); // adicionar/remover horário
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.name.trim()) return formError(form, 'Falta o nome.');
      const slots = readSlots(form);
      if (slots.some(x => !x.start || !x.end || x.end <= x.start)) return formError(form, 'O fim precisa ser depois do início.');
      Object.assign(s, {
        name: f.name.trim(), color: f.color, professor: f.professor.trim(), room: f.room.trim(),
        notes: f.notes.trim(), slots, attendance: f.attendance, faltavel: !!f.faltavel,
      });
      delete s.absenceLimit; // o limite agora é sempre calculado pelos dias de aula
      Store.upsert('subjects', s);
      closeModal();
      if (isNew) location.hash = `#/faculdade/${s.id}`;
      render();
      toast(isNew ? 'Matéria criada' : 'Matéria atualizada');
    },
    onDelete: async () => {
      const ok = await ask(`Excluir “${s.name}” e tudo dela?`, [
        { label: 'Cancelar', value: false }, { label: 'Excluir', value: true, kind: 'danger' }]);
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
    ${modalHead(isNew ? 'Novo prazo' : 'Editar prazo')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Matéria</span><select name="subjectId">${subjectOptions(a.subjectId)}</select></label>
        <label class="field"><span>Tipo</span><select name="kind">${options(Object.entries(ASSESSMENT_KINDS), a.kind)}</select></label>
        <label class="field" data-counts ${a.kind === 'atividade' ? '' : 'hidden'}><span>Vale</span><select name="counts">${options([['nota', 'Nota'], ['presenca', 'Presença']], a.counts || 'nota')}</select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" maxlength="160" value="${esc(a.title)}"></label>
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${a.date}"></label>
        <label class="field"><span>Horário</span><input type="time" name="time" value="${a.time || ''}"></label>
      </div>
      <label class="field"><span>Conteúdos cobrados</span><textarea name="topics" rows="3">${esc(a.topics)}</textarea></label>
      <label class="field"><span>Detalhes</span><textarea name="details" rows="2">${esc(a.details)}</textarea></label>
      <div class="row" data-grade ${valesPresenca(a) ? 'hidden' : ''}>
        <label class="field"><span>Peso</span><input name="weight" maxlength="30" value="${esc(a.weight)}"></label>
        <label class="field"><span>Nota</span><input name="grade" maxlength="30" value="${esc(a.grade)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="done" ${a.done ? 'checked' : ''}> Concluído / entregue</label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      // Só atividade escolhe se vale nota ou presença; valendo presença, não tem peso nem nota.
      const sync = () => {
        const ativ = form.elements.kind.value === 'atividade';
        $('[data-counts]', form).hidden = !ativ;
        $('[data-grade]', form).hidden = ativ && form.elements.counts.value === 'presenca';
      };
      form.elements.kind.addEventListener('change', sync);
      form.elements.counts.addEventListener('change', sync);
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.date) return formError(form, 'Falta a data.');
      Object.assign(a, {
        subjectId: f.subjectId, kind: f.kind, title: f.title.trim() || ASSESSMENT_KINDS[f.kind], date: f.date, time: f.time,
        topics: f.topics.trim(), details: f.details.trim(), weight: f.weight.trim(), grade: f.grade.trim(), done: !!f.done,
      });
      if (f.kind === 'atividade') a.counts = f.counts; else delete a.counts;
      if (a.done || a.date >= today()) delete a.skipped; // feito ou remarcado
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
  openModal(`<form novalidate>
    ${modalHead(`Registrar falta · ${s.name}`)}
    <div class="modal-body">
      <label class="field"><span>Data</span><input type="date" name="date" value="${t}"></label>
      <label class="field" data-aulas hidden><span>Aulas</span><select name="aulas"></select></label>
      <label class="field"><span>Observação</span><input name="note" maxlength="140"></label>
      ${attendance(s) === 'exercicio' ? '<label class="field"><span>Entrega do exercício</span><input type="date" name="delivery"></label>' : ''}
      ${attendance(s) === 'exercicio' ? '<label class="check"><input type="checkbox" name="present"> Entreguei o exercício</label>' : ''}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Registrar')}
  </form>`, {
    onMount(form) {
      // Dia com aulas seguidas: escolher se faltou em todas ou só numa.
      const field = $('[data-aulas]', form);
      const update = () => {
        const n = form.elements.date.value ? dayClasses(s, form.elements.date.value).length : 0;
        field.hidden = n < 2;
        form.elements.aulas.innerHTML = options([['', n === 2 ? 'Nas duas' : 'Em todas'], ...Array.from({ length: n }, (_, i) => [i, `Só na ${i + 1}ª`])], '');
      };
      update();
      form.elements.date.addEventListener('change', update);
    },
    onSubmit(form) {
      const f = formData(form);
      if (!f.date) return formError(form, 'Falta a data.');
      if (f.date > today()) return formError(form, 'Esse dia ainda não chegou.');
      if (absenceOn(s.id, f.date)) return formError(form, `Já tem falta em ${relDay(f.date).toLowerCase()}.`);
      if (isCanceled(s, f.date) && !exerciseDay(s, f.date)) return formError(form, 'A aula desse dia foi cancelada.');
      const rec = { id: uid(), subjectId: s.id, date: f.date, note: f.note.trim() };
      if (f.aulas && dayClasses(s, f.date).length > 1) rec.aulas = [+f.aulas];
      if (f.present) rec.present = true;
      if (f.delivery && f.delivery !== f.date) rec.delivery = f.delivery;
      Store.removeWhere('absences', a => a.subjectId === s.id && a.date === f.date); // "Assinaram por mim" antigo
      Store.upsert('absences', rec);
      closeModal();
      render();
      absenceToast(s, rec);
    },
  });
}

/** Próximo dia (a partir de hoje) com aula da matéria. */
function nextClassDay(s) {
  for (let i = 0, d = today(); i < 14; i++, d = addDays(d, 1)) if (dayClasses(s, d).length && !isCanceled(s, d)) return d;
  return today();
}

function cancelForm(s) {
  openModal(`<form novalidate>
    ${modalHead(`Aula cancelada · ${s.name}`)}
    <div class="modal-body">
      <label class="field"><span>Data</span><input type="date" name="date" value="${nextClassDay(s)}"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Cancelar aula')}
  </form>`, {
    onSubmit(form) {
      const { date } = formData(form);
      if (!date) return formError(form, 'Falta a data.');
      if (!dayClasses(s, date).length) return formError(form, 'Não tem aula dessa matéria nesse dia.');
      if (isCanceled(s, date)) return formError(form, 'Essa aula já está cancelada.');
      closeModal();
      setCanceled(s, date, true);
    },
  });
}

function semesterForm() {
  const st = Store.settings;
  openModal(`<form novalidate>
    ${modalHead('Semestre')}
    <div class="modal-body">
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
  'open-class': el => { const s = subject(el.dataset.id); if (s) classSheet(s, el.dataset.date, el.dataset.time); },
  'new-subject': () => subjectForm(),
  'edit-subject': el => { const s = subject(el.dataset.id); if (s) subjectForm(s); },
  'fac-tab': el => { state.facTab = el.dataset.tab; render(); },
  'edit-semester': () => semesterForm(),
  'new-assessment': el => assessmentForm(null, { date: el.dataset.date, subjectId: el.dataset.subject }),
  'edit-assessment': el => { const a = Store.get('assessments', el.dataset.id); if (a) assessmentView(a); },
  'toggle-assessment': el => {
    const a = Store.get('assessments', el.dataset.id);
    if (!a) return;
    a.done = !a.done;
    delete a.skipped;
    Store.upsert('assessments', a);
    render();
    if (a.done) toast('Feito', { label: 'Desfazer', fn: () => { a.done = false; Store.upsert('assessments', a); render(); } });
  },
  'toggle-absence': el => toggleAbsence(el),
  'edit-exercise': el => {
    const a = Store.get('absences', el.dataset.id);
    const s = a && subject(a.subjectId);
    if (s) exerciseForm(s, a.date);
  },
  'uncancel-class': el => { const s = subject(el.dataset.id); if (s) setCanceled(s, el.dataset.date, false); },
  'cancel-class': el => { const s = subject(el.dataset.id); if (s) cancelForm(s); },
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

// Presença e "Faltável" trocados direto na tela da matéria.
document.addEventListener('change', e => {
  const { attendance: aid, faltavel: fid } = e.target.dataset || {};
  const s = subject(aid || fid);
  if (!s) return;
  const next = structuredClone(s);
  if (aid) next.attendance = e.target.value;
  else next.faltavel = e.target.checked;
  if (next.attendance === 'livre') next.attendance = 'lista'; // jeito antigo de marcar faltável
  if (fid && !e.target.checked && s.attendance === 'livre') next.faltavel = false;
  Store.upsert('subjects', next);
  render();
  toast(aid ? `Presença: ${ATTENDANCE[next.attendance].label}` : e.target.checked ? 'Matéria faltável' : 'Matéria com limite de faltas');
});
