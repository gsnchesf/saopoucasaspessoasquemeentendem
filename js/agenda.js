'use strict';
/* ==========================================================
   Agenda: compromissos/consultas (com recorrência), aulas da
   grade da faculdade e prazos (provas, trabalhos, entregas)
   reunidos num só calendário — visões mês, semana e dia.
   ========================================================== */

const HOUR = 48; // altura (px) de uma hora na visão semana/dia
const BADGE_LABEL = { ...ASSESSMENT_KINDS, entrega: 'Entrega' };

/* ---------- Fontes de itens ---------- */

/** Datas em que o evento ocorre dentro de [from, to]. */
function occurrences(ev, from, to) {
  const rep = ev.repeat || 'none';
  const ex = ev.exdates || [];
  const end = ev.until && ev.until < to ? ev.until : to;
  const out = [];
  const push = d => { if (d >= from && !ex.includes(d)) out.push(d); };
  if (rep === 'none') { if (ev.date <= to) push(ev.date); return out; }
  if (ev.date > end) return out;
  if (rep === 'daily' || rep === 'weekdays' || rep === 'weekly') {
    const step = rep === 'weekly' ? 7 : 1;
    const k = Math.max(0, Math.floor(diffDays(ev.date, from) / step));
    for (let d = addDays(ev.date, k * step); d <= end; d = addDays(d, step)) {
      if (rep === 'weekdays' && (weekday(d) === 0 || weekday(d) === 6)) continue;
      push(d);
    }
  } else {
    const step = rep === 'yearly' ? 12 : 1;
    const a = fromISO(ev.date), f = fromISO(from);
    let k = Math.max(0, Math.floor(((f.getFullYear() - a.getFullYear()) * 12 + f.getMonth() - a.getMonth()) / step) - 1);
    for (let d = addMonths(ev.date, k * step); d <= end; d = addMonths(ev.date, ++k * step)) push(d);
  }
  return out;
}

/** Aulas geradas a partir dos horários das matérias, dentro do semestre. */
function classItems(from, to) {
  const { semesterStart: s0, semesterEnd: s1 } = Store.settings;
  if (s0 && s0 > from) from = s0;
  if (s1 && s1 < to) to = s1;
  const out = [];
  if (from > to || !Store.data.subjects.length) return out;
  const byDay = Array.from({ length: 7 }, () => []);
  for (const s of Store.data.subjects) for (const sl of s.slots || []) byDay[sl.weekday]?.push([s, sl]);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const [s, sl] of byDay[weekday(d)]) {
      out.push({
        kind: 'class', id: s.id, date: d, title: s.name, start: sl.start, end: sl.end,
        color: s.color, place: sl.room || s.room, label: s.professor ? `Prof. ${s.professor}` : '',
        weight: sl.weight || 1, allDay: false, deadline: false,
      });
    }
  }
  return out;
}

const workColor = () => Store.data.categories.find(c => norm(c.name) === 'trabalho')?.color || '#f59e0b';

/** Todos os itens da agenda entre duas datas, agrupados por dia. */
function agendaItems(from, to, { classes = true, work = true } = {}) {
  const map = {};
  const add = it => (map[it.date] ||= []).push(it);

  for (const ev of Store.data.events) {
    for (const d of occurrences(ev, from, to)) add({
      kind: 'event', id: ev.id, date: d, title: ev.title,
      start: ev.allDay ? '' : ev.start, end: ev.allDay ? '' : ev.end, allDay: !!ev.allDay, deadline: false,
      color: catColor(ev.category), label: cat(ev.category)?.name, place: ev.location,
      repeats: !!ev.repeat && ev.repeat !== 'none',
    });
  }
  if (classes) classItems(from, to).forEach(add);
  if (work) workItems(from, to).forEach(add);
  for (const a of Store.data.assessments) {
    if (a.date < from || a.date > to) continue;
    const s = subject(a.subjectId);
    add({ kind: 'assessment', id: a.id, date: a.date, title: a.title, start: a.time || '', allDay: true, deadline: true,
      color: s?.color || 'var(--faint)', label: s?.name, badge: a.kind, done: !!a.done });
  }
  for (const d of Store.data.deliverables) {
    if (!d.due || d.due < from || d.due > to) continue;
    add({ kind: 'deliverable', id: d.id, date: d.due, title: d.title, start: d.time || '', allDay: true, deadline: true,
      color: workColor(), label: d.project, badge: 'entrega', done: d.status === 'entregue' });
  }
  for (const d in map) map[d].sort(itemSort);
  return map;
}

const itemSort = (a, b) => (b.deadline - a.deadline) || (b.allDay - a.allDay) || (a.start || '').localeCompare(b.start || '');

/* ---------- Componentes ---------- */

const ITEM_ACTION = { event: 'edit-event', class: 'open-subject', assessment: 'edit-assessment', deliverable: 'edit-deliverable', work: 'edit-work', commute: 'edit-work' };
const itemAttrs = it => `data-action="${ITEM_ACTION[it.kind]}" data-id="${esc(it.id)}" data-date="${it.date}"`;

function itemRow(it) {
  const t = today(), n = nowMin();
  let st = '';
  if (it.deadline) st = it.done ? 'past' : '';
  else if (it.date < t) st = 'past';
  else if (it.date === t && it.start) {
    const s = toMin(it.start), e = it.end ? toMin(it.end) : s + 60;
    st = n >= e ? 'past' : n >= s ? 'now' : '';
  }
  const time = it.deadline
    ? (it.start ? `<b>até</b><small>${it.start}</small>` : '<b>Prazo</b>')
    : it.allDay ? '<b>Dia todo</b>' : `<b>${it.start}</b>${it.end ? `<small>${it.end}</small>` : ''}`;
  const meta = [
    it.label && `<span>${esc(it.label)}</span>`,
    it.place && `<span>${icon('map')}${esc(it.place)}</span>`,
    it.repeats && `<span title="Recorrente">${icon('repeat')}</span>`,
  ].filter(Boolean).join('');
  const badge = it.badge ? `<span class="badge k-${it.badge}">${it.done ? icon('check') : ''}${BADGE_LABEL[it.badge]}</span>` : '';

  const row = `<button class="ev-row ${st}" style="--c:${esc(it.color)}" ${itemAttrs(it)}>
    <span class="ev-time">${time}</span><span class="ev-bar"></span>
    <span class="ev-main">
      <span class="ev-title"><span>${esc(it.title)}</span>${st === 'now' ? '<span class="badge-now">agora</span>' : ''}</span>
      ${meta ? `<span class="ev-meta">${meta}</span>` : ''}
    </span>
    ${badge ? `<span class="ev-side">${badge}</span>` : ''}
  </button>`;
  return it.kind === 'class' ? `<div class="row-wrap">${row}<div class="ev-side">${absenceControls(it)}</div></div>` : row;
}

function itemChip(it) {
  const cls = it.deadline ? 'deadline' : it.kind === 'class' ? 'cls' : it.allDay ? 'allday' : '';
  const time = !it.deadline && !it.allDay && it.start ? `<b>${it.start}</b>` : '';
  const prefix = it.deadline ? `${BADGE_LABEL[it.badge]}: ` : '';
  return `<button class="chip ${cls}" style="--c:${esc(it.color)}" ${itemAttrs(it)} title="${esc(prefix + it.title)}">${time}${esc(prefix + it.title)}</button>`;
}

/* ---------- Tela ---------- */

screens.agenda = () => {
  const mode = state.calMode;
  const showClasses = Store.settings.showClasses !== false;
  let title, body, after;

  if (mode === 'mes') {
    title = cap(fmt(state.cursor, { month: 'long', year: 'numeric' }));
    body = `<div class="agenda-layout">${monthView(showClasses)}${dayPanel(state.selected, showClasses)}</div>`;
  } else {
    const days = mode === 'semana'
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(state.cursor), i))
      : [state.cursor];
    title = mode === 'semana' ? weekTitle(days[0], days[6]) : cap(fmt(state.cursor, { weekday: 'long', day: 'numeric', month: 'long' }));
    body = timeGrid(days, showClasses);
    after = () => {
      const el = $('#tg-body');
      if (!el) return;
      el.scrollTop = state.gridScroll ?? Store.settings.dayStart * HOUR;
      el.addEventListener('scroll', () => { state.gridScroll = el.scrollTop; }, { passive: true });
    };
  }

  const modes = [['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']];
  const head = `<div class="title-block"><h1>${esc(title)}</h1></div>
    <div class="toolbar">
      <div class="btn-group">
        <button class="icon-btn" data-action="cal-prev" aria-label="Anterior" title="Anterior (←)">${icon('left')}</button>
        <button class="btn" data-action="cal-today">Hoje</button>
        <button class="icon-btn" data-action="cal-next" aria-label="Próximo" title="Próximo (→)">${icon('right')}</button>
      </div>
      <div class="segmented">${modes.map(([m, l]) => `<button data-action="cal-mode" data-mode="${m}" class="${m === mode ? 'active' : ''}" aria-pressed="${m === mode}">${l}</button>`).join('')}</div>
      <button class="btn ${showClasses ? '' : 'btn-ghost'}" data-action="toggle-classes" aria-pressed="${showClasses}" title="Mostrar/ocultar aulas">${icon('book')}Aulas</button>
      <button class="btn btn-primary hide-mobile" data-action="new-event" data-date="${state.selected}">${icon('plus')}Compromisso</button>
    </div>`;
  return { head, body, after };
};

function weekTitle(a, b) {
  const f = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  return f.formatRange ? f.formatRange(fromISO(a), fromISO(b)) : `${f.format(fromISO(a))} – ${f.format(fromISO(b))}`;
}

const MAX_CHIPS = 3;

function monthView(showClasses) {
  const first = state.cursor.slice(0, 8) + '01';
  const last = addDays(addMonths(first, 1), -1);
  const start = startOfWeek(first);
  const weeks = Math.ceil((diffDays(start, last) + 1) / 7);
  const end = addDays(start, weeks * 7 - 1);
  const map = agendaItems(start, end, { classes: showClasses });
  const t = today(), month = first.slice(0, 7), ws = +Store.settings.weekStart;

  // No mês, aulas e trabalho ficam por último para não esconder prazos e compromissos;
  // o deslocamento só aparece nas visões com horário.
  const rank = it => it.deadline ? 0 : it.kind === 'class' ? 2 : it.kind === 'work' ? 3 : 1;
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const items = (map[d] || []).filter(it => it.kind !== 'commute').sort((a, b) => rank(a) - rank(b) || itemSort(a, b));
    const cls = ['mcell', d.slice(0, 7) !== month && 'out', d === t && 'today', d === state.selected && 'selected'].filter(Boolean).join(' ');
    cells += `<div class="${cls}" data-action="select-day" data-date="${d}" aria-label="${esc(fmt(d, { day: 'numeric', month: 'long' }))}${items.length ? `, ${plural(items.length, 'item', 'itens')}` : ''}">
      <span class="mday">${+d.slice(8)}</span>
      <div class="chips">${items.slice(0, MAX_CHIPS).map(itemChip).join('')}${items.length > MAX_CHIPS ? `<span class="more">+${items.length - MAX_CHIPS} mais</span>` : ''}</div>
    </div>`;
  }
  const names = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + ws) % 7]);
  return `<div class="card month"><div class="mhead">${names.map(n => `<span>${n}</span>`).join('')}</div><div class="mgrid">${cells}</div></div>`;
}

function dayPanel(d, showClasses = true) {
  const items = agendaItems(d, d, { classes: showClasses })[d] || [];
  const title = diffDays(today(), d) === 0 ? 'Hoje' : cap(fmt(d, { weekday: 'long' }));
  return `<aside class="card card-pad day-panel">
    <div class="card-head"><div><h2>${esc(title)}</h2><p class="sub">${esc(fmt(d, { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div></div>
    ${items.length ? `<div class="list">${items.map(itemRow).join('')}</div>` : '<p class="empty">Dia livre.</p>'}
    <div class="panel-actions">
      <button class="btn btn-sm" data-action="new-event" data-date="${d}">${icon('plus')}Compromisso</button>
      <button class="btn btn-sm" data-action="new-assessment" data-date="${d}">${icon('plus')}Prazo faculdade</button>
      <button class="btn btn-sm" data-action="new-deliverable" data-date="${d}">${icon('plus')}Entrega</button>
    </div>
  </aside>`;
}

/** Distribui eventos sobrepostos em colunas lado a lado. */
function layoutDay(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], cols = [], clusterEnd = -1;
  const flush = () => { for (const it of cluster) it.n = cols.length; cluster = []; cols = []; };
  for (const it of items) {
    if (it.s >= clusterEnd) flush();
    let c = cols.findIndex(end => end <= it.s);
    if (c < 0) { c = cols.length; cols.push(it.e); } else cols[c] = it.e;
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return items;
}

function timeGrid(days, showClasses) {
  const map = agendaItems(days[0], days[days.length - 1], { classes: showClasses });
  const t = today();

  const head = days.map(d => `<button class="tg-dayhead ${d === t ? 'today' : ''}" data-action="goto-day" data-date="${d}">
    <span class="wd">${WEEKDAYS[weekday(d)]}</span><span class="dn">${+d.slice(8)}</span></button>`).join('');

  const allday = days.map(d => `<div class="tg-allday-cell">${(map[d] || []).filter(it => it.allDay).map(itemChip).join('')}</div>`).join('');

  const hours = Array.from({ length: 24 }, (_, h) => `<div class="tg-hour"><span>${h ? pad(h) + ':00' : ''}</span></div>`).join('');

  const cols = days.map(d => {
    const timed = (map[d] || []).filter(it => !it.allDay && it.start).map(it => {
      const s = toMin(it.start);
      let e = it.end ? toMin(it.end) : s + 60;
      if (e <= s) e = s + 30;
      return { it, s, e };
    });
    const blocks = layoutDay(timed).map(({ it, s, e, col, n }) => {
      const top = s / 60 * HOUR, h = Math.max((e - s) / 60 * HOUR, 20), w = 100 / n;
      return `<button class="tg-ev ${h < 36 ? 'short' : ''} ${it.kind === 'class' ? 'cls' : ''} ${it.kind === 'commute' ? 'commute' : ''}" ${itemAttrs(it)}
        style="--c:${esc(it.color)};top:${top}px;height:${h - 2}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px)">
        <span class="t">${esc(it.title)}</span><span class="h">${it.start}${it.end ? '–' + it.end : ''}</span></button>`;
    }).join('');
    const now = d === t ? `<div class="now-line" style="top:${nowMin() / 60 * HOUR}px"></div>` : '';
    return `<div class="tg-col ${d === t ? 'today' : ''}" data-date="${d}">${blocks}${now}</div>`;
  }).join('');

  return `<div class="card timegrid" style="--days:${days.length};--hour:${HOUR}px">
    <div class="tg-head"><div class="tg-gutter"></div>${head}</div>
    <div class="tg-allday"><div class="tg-gutter"><span>prazos</span></div>${allday}</div>
    <div class="tg-body" id="tg-body"><div class="tg-hours">${hours}</div>${cols}</div>
  </div>`;
}

function navCal(dir) {
  if (state.calMode === 'mes') {
    state.cursor = addMonths(state.cursor.slice(0, 8) + '01', dir);
    const t = today();
    state.selected = t.slice(0, 7) === state.cursor.slice(0, 7) ? t : state.cursor;
  } else {
    state.cursor = addDays(state.cursor, dir * (state.calMode === 'semana' ? 7 : 1));
    state.selected = state.cursor;
  }
  render();
}

/* ---------- Formulário de compromisso ---------- */

function eventForm(ev, date, startTime) {
  const isNew = !ev;
  if (ev) ev = structuredClone(ev);
  else {
    const start = startTime || '09:00';
    ev = {
      id: uid(), title: '', date: date || today(), allDay: false,
      start, end: fromMin(Math.min(toMin(start) + 60, 1439)),
      category: Store.data.categories[0]?.id || '', repeat: 'none', until: '',
      reminder: null, location: '', notes: '', exdates: [],
    };
  }
  const occDate = date;
  const repeats = ev.repeat && ev.repeat !== 'none';

  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo compromisso' : 'Editar compromisso')}
    <div class="modal-body">
      ${repeats && !isNew ? `<p class="hint-box">${icon('repeat')}Compromisso recorrente: as alterações valem para todas as ocorrências.</p>` : ''}
      <label class="field"><span>Título</span><input name="title" maxlength="200" value="${esc(ev.title)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Consulta no dentista"></label>
      <div class="row">
        <label class="field"><span>Tipo</span><select name="category">${catOptions(ev.category)}</select></label>
        <label class="field"><span>Data</span><input type="date" name="date" value="${ev.date}"></label>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}> Dia inteiro</label>
        <label class="field times" ${ev.allDay ? 'hidden' : ''}><span>Início</span><input type="time" name="start" value="${ev.start || ''}"></label>
        <label class="field times" ${ev.allDay ? 'hidden' : ''}><span>Fim</span><input type="time" name="end" value="${ev.end || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Repetir</span><select name="repeat">${options(Object.entries(REPEAT_LABELS), ev.repeat || 'none')}</select></label>
        <label class="field until" ${repeats ? '' : 'hidden'}><span>Até (opcional)</span><input type="date" name="until" value="${ev.until || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Local</span><input name="location" value="${esc(ev.location)}" placeholder="Opcional"></label>
        <label class="field"><span>Lembrete</span><select name="reminder">${options(REMINDERS, ev.reminder ?? '')}</select></label>
      </div>
      <label class="field"><span>Detalhes</span><textarea name="notes" rows="3">${esc(ev.notes)}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const { allDay, start, end, repeat } = form.elements;
      allDay.addEventListener('change', () => $$('.times', form).forEach(el => { el.hidden = allDay.checked; }));
      repeat.addEventListener('change', () => { $('.until', form).hidden = repeat.value === 'none'; });
      let prev = start.value;
      start.addEventListener('change', () => {
        // Mantém a duração ao mudar o início.
        if (start.value && prev && end.value) {
          const dur = toMin(end.value) - toMin(prev);
          if (dur > 0) end.value = fromMin(Math.min(toMin(start.value) + dur, 1439));
        } else if (start.value && !end.value) end.value = fromMin(Math.min(toMin(start.value) + 60, 1439));
        prev = start.value;
      });
    },
    onSubmit(form) {
      const f = formData(form);
      const allDay = !!f.allDay;
      if (!f.title.trim()) return formError(form, 'Dê um título ao compromisso.');
      if (!f.date) return formError(form, 'Escolha uma data.');
      if (!allDay && !f.start) return formError(form, 'Informe o horário de início.');
      if (!allDay && f.end && f.end <= f.start) return formError(form, 'O fim precisa ser depois do início.');
      if (f.repeat !== 'none' && f.until && f.until < f.date) return formError(form, 'A repetição termina antes de começar.');
      Object.assign(ev, {
        title: f.title.trim(), category: f.category, date: f.date, allDay,
        start: allDay ? '' : f.start, end: allDay ? '' : f.end,
        repeat: f.repeat, until: f.repeat === 'none' ? '' : f.until,
        location: f.location.trim(), reminder: f.reminder === '' ? null : +f.reminder, notes: f.notes.trim(),
      });
      Store.upsert('events', ev);
      closeModal();
      render();
      toast(isNew ? 'Compromisso criado' : 'Compromisso atualizado');
    },
    onDelete: () => deleteEvent(ev.id, occDate),
  });
}

async function deleteEvent(id, occDate) {
  const ev = Store.get('events', id);
  if (!ev) return;
  if (ev.repeat && ev.repeat !== 'none' && occDate) {
    const v = await ask('Este compromisso se repete. O que deseja excluir?', [
      { label: 'Cancelar', value: null },
      { label: 'Só este dia', value: 'one' },
      { label: 'Toda a série', value: 'all', kind: 'danger' },
    ]);
    if (!v) return;
    if (v === 'one') {
      const before = structuredClone(ev);
      ev.exdates = [...(ev.exdates || []), occDate];
      Store.upsert('events', ev);
      closeModal();
      render();
      toast('Ocorrência excluída', { label: 'Desfazer', fn: () => { Store.upsert('events', before); render(); } });
      return;
    }
  }
  const removed = Store.remove('events', id);
  closeModal();
  render();
  toast('Compromisso excluído', { label: 'Desfazer', fn: () => { Store.upsert('events', removed); render(); } });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-event': el => eventForm(null, el.dataset.date || (state.view === 'agenda' ? state.selected : today())),
  'edit-event': el => { const ev = Store.get('events', el.dataset.id); if (ev) eventForm(ev, el.dataset.date); },
  'select-day': el => {
    const d = el.dataset.date;
    if (d.slice(0, 7) !== state.cursor.slice(0, 7)) state.cursor = d;
    state.selected = d;
    render();
  },
  'goto-day': el => { state.calMode = 'dia'; state.cursor = state.selected = el.dataset.date; render(); },
  'cal-prev': () => navCal(-1),
  'cal-next': () => navCal(1),
  'cal-today': () => { state.cursor = state.selected = today(); render(); },
  'cal-mode': el => {
    state.calMode = el.dataset.mode;
    state.cursor = state.selected;
    Store.settings.calMode = state.calMode;
    Store.saveSettings(true);
    render();
  },
  'toggle-classes': () => {
    Store.settings.showClasses = Store.settings.showClasses === false;
    Store.saveSettings(true);
    render();
  },
});
