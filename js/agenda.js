'use strict';
/* ==========================================================
   Agenda: compromissos/consultas (com recorrência), aulas da
   grade da faculdade e prazos (provas, trabalhos, entregas)
   reunidos num só calendário — visões mês, semana e dia.
   ========================================================== */

const HOUR = 48; // altura (px) de uma hora na visão semana/dia
const BADGE_LABEL = { ...ASSESSMENT_KINDS, entrega: 'Entrega', exercicio: 'Exercício' };

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
      const ex = exerciseDay(s, d);
      out.push({
        kind: 'class', id: s.id, date: d, title: s.name, start: sl.start, end: sl.end, exercise: ex,
        color: s.color, group: 'Faculdade', what: ex ? 'Aula · presença por exercício' : 'Aula', place: sl.room || s.room, label: s.professor ? `Prof. ${s.professor}` : '',
        weight: sl.weight || 1, allDay: false, deadline: false, canceled: (s.canceled || []).includes(d),
      });
    }
  }
  return out;
}

const workColor = () => Store.data.categories.find(c => norm(c.name) === 'trabalho')?.color || '#f59e0b';

/** Todos os itens da agenda entre duas datas, agrupados por dia. O expediente (seg–sex, todo dia igual)
    só entra quando pedido, no fundo de Essa semana. */
function agendaItems(from, to, { classes = true, work = false } = {}) {
  const map = {};
  const add = it => (map[it.date] ||= []).push(it);

  for (const ev of Store.data.events) {
    // Termina no dia seguinte (22:00–02:00): o resto aparece no outro dia, a partir de 00:00.
    const overnight = endsNextDay(ev);
    for (const d of occurrences(ev, overnight ? addDays(from, -1) : from, to)) {
      const it = {
        kind: 'event', id: ev.id, date: d, title: eventTitle(ev),
        start: ev.allDay ? '' : ev.start, end: ev.allDay ? '' : ev.end, allDay: !!ev.allDay, deadline: false, overnight,
        color: EVENT_KINDS[eventKind(ev)].color, group: EVENT_KINDS[eventKind(ev)].label, what: eventExtra(ev), label: ev.title ? [EVENT_KINDS[eventKind(ev)].label, eventExtra(ev)].filter(Boolean).join(' · ') : '', place: ev.location,
        repeats: !!ev.repeat && ev.repeat !== 'none', money: ev.budget || 0,
      };
      if (d >= from) add(it);
      if (overnight && addDays(d, 1) <= to) add({ ...it, date: addDays(d, 1), start: '00:00', overnight: false });
    }
  }
  if (classes) classItems(from, to).forEach(add);
  workoutItems(from, to).forEach(add);
  medItems(from, to, { daily: false }).forEach(add);
  if (work) workItems(from, to).forEach(add);
  for (const a of Store.data.assessments) {
    if (a.date < from || a.date > to) continue;
    const s = subject(a.subjectId);
    add({ kind: 'assessment', id: a.id, date: a.date, title: a.title, start: a.time || '', allDay: true, deadline: true,
      color: s?.color || 'var(--faint)', group: 'Faculdade', groupSub: s?.name, what: BADGE_LABEL[a.kind], label: s?.name, badge: a.kind, done: !!a.done, skipped: !a.done && !!a.skipped });
  }
  for (const d of Store.data.deliverables) {
    if (!d.due || d.due < from || d.due > to) continue;
    add({ kind: 'deliverable', id: d.id, date: d.due, title: d.title, start: d.time || '', allDay: true, deadline: true,
      color: workColor(), group: 'Trabalho', groupSub: d.project, what: 'Entrega', label: d.project, badge: 'entrega', done: d.status === 'entregue', skipped: d.status !== 'entregue' && !!d.skipped });
  }
  // Exercício de aula faltada combinado para outro dia (presença por exercício).
  for (const a of Store.data.absences) {
    if (!a.delivery || a.present || a.delivery < from || a.delivery > to) continue;
    const s = subject(a.subjectId);
    if (s) add({ kind: 'exercise', id: a.id, date: a.delivery, title: s.name, exercise: true,
      start: '', allDay: true, deadline: true, color: s.color, group: 'Faculdade', groupSub: s.name, what: 'Exercício', label: `Aula de ${shortDate(a.date)}`, badge: 'exercicio', done: false });
  }
  for (const d in map) map[d].sort(itemSort);
  return map;
}

/** Evento com fim antes do início: termina no dia seguinte. */
const endsNextDay = ev => !ev.allDay && !!ev.start && !!ev.end && ev.end < ev.start;

const itemSort = (a, b) => (b.deadline - a.deadline) || (b.allDay - a.allDay) || (a.start || '').localeCompare(b.start || '');

/* ---------- Prazo atrasado: "Não fiz" ---------- */

const DEADLINE_COLL = { assessment: 'assessments', deliverable: 'deliverables', exercise: 'absences' };

/** Tira o prazo de Atrasados registrando que não foi feito. Exercício não entregue perde a entrega
    combinada e fica só a falta. on = false desfaz. */
function skipDeadline(kind, id, on = true) {
  const coll = DEADLINE_COLL[kind];
  const cur = Store.get(coll, id);
  if (!cur) return;
  const next = structuredClone(cur);
  if (kind === 'exercise') delete next.delivery;
  else if (on) next.skipped = true;
  else delete next.skipped;
  Store.upsert(coll, next);
  render();
  if (on) toast(kind === 'exercise' ? 'Exercício não entregue · conta falta' : 'Marcado como não feito',
    { label: 'Desfazer', fn: () => { Store.upsert(coll, cur); render(); } });
}

/* ---------- Componentes ---------- */

const ITEM_ACTION = { event: 'edit-event', class: 'open-class', assessment: 'edit-assessment', deliverable: 'edit-deliverable', exercise: 'edit-exercise', workout: 'open-workout', med: 'open-med', work: 'edit-work', commute: 'edit-work' };
const itemAttrs = it => `data-action="${ITEM_ACTION[it.kind]}" data-id="${esc(it.id)}" data-date="${it.date}"${it.kind === 'med' || it.kind === 'class' ? ` data-time="${it.start}"` : ''}`;

/** Etiqueta do hover: de onde vem a cor (Faculdade, Date, Treino…) e quando/onde. */
function itemTip(it) {
  const when = it.deadline ? (it.start ? `até ${it.start}` : 'Prazo') : it.allDay ? 'Dia todo' : `${it.start}${it.end ? '–' + it.end : ''}`;
  const top = [it.group, it.groupSub].filter(Boolean).join(' · ');
  const bottom = [it.canceled ? 'Cancelada' : it.what, when, it.place].filter(Boolean).join(' · ');
  return esc(`<b><i style="--c:${esc(it.color)}"></i>${esc(top)}</b><span>${esc(bottom)}</span>`);
}

function itemRow(it) {
  const t = today(), n = nowMin();
  let st = '';
  if (it.deadline) st = it.done || it.skipped ? 'past' : '';
  else if (it.canceled) st = 'canceled';
  else if (it.date < t) st = 'past';
  else if (it.date === t && it.start) {
    const s = toMin(it.start), e = it.overnight ? 1440 : it.end ? toMin(it.end) : s + 60;
    st = n >= e ? 'past' : n >= s ? 'now' : '';
  }
  const time = it.deadline
    ? (it.start ? `<b>até</b><small>${it.start}</small>` : '<b>Prazo</b>')
    : it.allDay ? '<b>Dia todo</b>' : `<b>${it.start}</b>${it.end ? `<small>${it.end}</small>` : ''}`;
  const meta = [
    it.label && `<span>${esc(it.label)}</span>`,
    it.place && `<span>${icon('map')}${esc(it.place)}</span>`,
    it.money && `<span>Orçamento ${brl(it.money)}</span>`,
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
  const side = it.kind === 'class' ? absenceControls(it) : it.kind === 'workout' ? workoutControls(it) : it.kind === 'med' ? medControls(it) : '';
  return side ? `<div class="row-wrap">${row}<div class="ev-side">${side}</div></div>` : row;
}

function itemChip(it) {
  const cls = (it.deadline ? 'deadline' : it.kind === 'class' ? `cls${it.canceled ? ' canceled' : ''}` : it.allDay ? 'allday' : '') + (it.exercise ? ' ex' : '') + (it.skipped ? ' skipped' : '');
  const time = !it.deadline && !it.allDay && it.start ? `<b>${it.start}</b>` : '';
  // Exercício: a matéria vem primeiro, para não sumir quando o chip é cortado.
  const text = it.exercise ? `${it.title} · exercício` : it.deadline ? `${BADGE_LABEL[it.badge]}: ${it.title}` : it.title;
  return `<button class="chip ${cls}" style="--c:${esc(it.color)}" ${itemAttrs(it)} data-tip="${itemTip(it)}">${time}${esc(text)}</button>`;
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
      <button class="btn btn-sm" data-action="new-assessment" data-date="${d}">${icon('plus')}Prova</button>
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
      let e = it.overnight ? 1440 : it.end ? toMin(it.end) : s + (it.kind === 'med' ? 20 : 60);
      if (e <= s) e = s + 30;
      return { it, s, e };
    });
    const blocks = layoutDay(timed).map(({ it, s, e, col, n }) => {
      const top = s / 60 * HOUR, h = Math.max((e - s) / 60 * HOUR, 20), w = 100 / n;
      return `<button class="tg-ev ${h < 36 ? 'short' : ''} ${it.kind === 'class' ? 'cls' : ''} ${it.exercise ? 'ex' : ''} ${it.canceled ? 'canceled' : ''} ${it.kind === 'commute' ? 'commute' : ''}" ${itemAttrs(it)} data-tip="${itemTip(it)}"
        style="--c:${esc(it.color)};top:${top}px;height:${h - 2}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px)">
        <span class="t">${esc(it.title)}</span><span class="h">${it.start}${it.end ? '–' + it.end : ''}${it.exercise ? ' · exercício' : ''}</span></button>`;
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

/* ---------- Tipos de compromisso (lista fechada, "Outro" por último) ---------- */

const EVENT_KINDS = {
  consulta: { label: 'Consulta', color: '#0ea5e9', specialty: true },
  hangout: { label: 'Hangout', color: '#ec4899', with: true },
  date: { label: 'Date', color: '#e11d48', with: true },
  evento: { label: 'Evento', color: '#8b5cf6', with: true, title: true, needsTitle: true, money: true },
  outro: { label: 'Outro', color: '#64748b', with: true, title: true },
};

/** Tipo do compromisso; "compromisso" antigo virou hangout e os de tipo personalizado são encaixados pelo nome. */
function eventKind(ev) {
  if (ev.kind === 'compromisso') return 'hangout';
  if (EVENT_KINDS[ev.kind]) return ev.kind;
  const n = norm(cat(ev.category)?.name);
  return n === 'consulta' ? 'consulta' : n === 'compromisso' ? 'hangout' : n === 'date' ? 'date' : 'outro';
}

/** "com Ana" / "Dermatologia": o complemento do tipo. */
const eventExtra = ev => {
  const k = EVENT_KINDS[eventKind(ev)];
  return k.specialty ? ev.specialty || '' : k.with && ev.with ? `com ${ev.with}` : '';
};

/** Título exibido: o digitado (em "Evento" e "Outro") ou o tipo com o complemento. */
const eventTitle = ev => ev.title || [EVENT_KINDS[eventKind(ev)].label, eventExtra(ev)].filter(Boolean).join(' · ');

/** R$ 300 / R$ 12,50. */
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/* ---------- Formulário de compromisso ---------- */

function eventForm(ev, date, startTime) {
  const isNew = !ev;
  if (ev) ev = structuredClone(ev);
  else {
    const start = startTime || '09:00';
    ev = {
      id: uid(), title: '', date: date || today(), allDay: false,
      start, end: fromMin(Math.min(toMin(start) + 60, 1439)),
      kind: 'hangout', with: '', specialty: '', repeat: 'none', until: '',
      reminder: null, location: '', notes: '', exdates: [],
    };
  }
  const occDate = date;
  const repeats = ev.repeat && ev.repeat !== 'none';
  const kind = eventKind(ev);

  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo compromisso' : 'Editar compromisso')}
    <div class="modal-body">
      ${repeats && !isNew ? `<p class="hint-box">${icon('repeat')}Vale para todas as repetições.</p>` : ''}
      <div class="row">
        <label class="field"><span>Tipo</span><select name="kind">${options(Object.entries(EVENT_KINDS).map(([k, v]) => [k, v.label]), kind)}</select></label>
        <label class="field" data-with ${EVENT_KINDS[kind].with ? '' : 'hidden'}><span>Com quem</span><input name="with" maxlength="80" value="${esc(ev.with || '')}"></label>
        <label class="field" data-specialty ${EVENT_KINDS[kind].specialty ? '' : 'hidden'}><span>Especialidade</span><input name="specialty" maxlength="80" value="${esc(ev.specialty || '')}"></label>
      </div>
      <label class="field" data-title ${EVENT_KINDS[kind].title ? '' : 'hidden'}><span>Título</span><input name="title" maxlength="200" value="${esc(ev.title)}"></label>
      <label class="field" data-money ${EVENT_KINDS[kind].money ? '' : 'hidden'}><span>Orçamento (R$)</span><input type="number" name="budget" min="0" step="any" inputmode="decimal" value="${ev.budget ?? ''}"></label>
      <label class="field"><span>Data</span><input type="date" name="date" value="${ev.date}"></label>
      <div class="row">
        <label class="check"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}> Dia inteiro</label>
        <label class="field times" ${ev.allDay ? 'hidden' : ''}><span>Início</span><input type="time" name="start" value="${ev.start || ''}"></label>
        <label class="field times" ${ev.allDay ? 'hidden' : ''}><span data-end-label>${endsNextDay(ev) ? 'Fim (dia seguinte)' : 'Fim'}</span><input type="time" name="end" value="${ev.end || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Repetir</span><select name="repeat">${options(Object.entries(REPEAT_LABELS), ev.repeat || 'none')}</select></label>
        <label class="field until" ${repeats ? '' : 'hidden'}><span>Até</span><input type="date" name="until" value="${ev.until || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Local</span><input name="location" value="${esc(ev.location)}"></label>
        <label class="field"><span>Lembrete</span><select name="reminder">${options(REMINDERS, ev.reminder ?? '')}</select></label>
      </div>
      ${noteField('notes', eventNotes(ev))}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const { allDay, start, end, repeat, kind } = form.elements;
      kind.addEventListener('change', () => {
        $('[data-with]', form).hidden = !EVENT_KINDS[kind.value].with;
        $('[data-specialty]', form).hidden = !EVENT_KINDS[kind.value].specialty;
        $('[data-title]', form).hidden = !EVENT_KINDS[kind.value].title;
        $('[data-money]', form).hidden = !EVENT_KINDS[kind.value].money;
      });
      allDay.addEventListener('change', () => $$('.times', form).forEach(el => { el.hidden = allDay.checked; }));
      const endLabel = () => { $('[data-end-label]', form).textContent = start.value && end.value && end.value < start.value ? 'Fim (dia seguinte)' : 'Fim'; };
      start.addEventListener('change', endLabel);
      end.addEventListener('change', endLabel);
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
      const k = EVENT_KINDS[f.kind];
      if (k.title && !f.title.trim() && (k.needsTitle || !f.with.trim())) return formError(form, 'Falta o título.');
      const budget = k.money && f.budget !== '' ? +f.budget : null;
      if (budget != null && !(budget >= 0)) return formError(form, 'Valor inválido.');
      if (!f.date) return formError(form, 'Falta a data.');
      if (!allDay && !f.start) return formError(form, 'Falta o horário.');
      if (!allDay && f.end && f.end === f.start) return formError(form, 'O fim precisa ser diferente do início.');
      if (f.repeat !== 'none' && f.until && f.until < f.date) return formError(form, 'A repetição termina antes de começar.');
      Object.assign(ev, {
        title: k.title ? f.title.trim() : '', kind: f.kind, with: k.with ? f.with.trim() : '', specialty: k.specialty ? f.specialty.trim() : '', date: f.date, allDay,
        start: allDay ? '' : f.start, end: allDay ? '' : f.end,
        repeat: f.repeat, until: f.repeat === 'none' ? '' : f.until,
        location: f.location.trim(), reminder: f.reminder === '' ? null : +f.reminder, notes: f.notes.trim(),
      });
      if (budget) ev.budget = budget; else delete ev.budget;
      delete ev.buy; // a lista de compras antiga já foi para os detalhes
      delete ev.category; // o tipo agora é ev.kind
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
    const v = await ask('Excluir só este dia ou todos?', [
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

/** "R$ 300 · R$ 50/semana" (o ritmo só quando faltam duas semanas ou mais). */
function budgetText(n, date) {
  const weeks = Math.floor(diffDays(today(), date) / 7);
  return brl(n) + (weeks >= 2 ? ` · ${brl(Math.ceil(n / weeks))}/semana` : '');
}

/** Detalhes do evento. A lista de compras (ev.buy, que existiu por pouco tempo) vira checklist no texto. */
const eventNotes = ev => [ev.notes, ...(ev.buy || []).map(it => `${it.done ? '☑' : '☐'} ${it.text}${it.price != null ? ` · ${brl(it.price)}` : ''}`)]
  .filter(Boolean).join('\n');

/** Ficha do compromisso (no dia clicado, se for recorrente). */
function eventView(ev, date) {
  const d = date || ev.date;
  const when = `${cap(relDay(d))}${ev.allDay ? ' · dia inteiro' : ` · ${ev.start}${ev.end ? '–' + ev.end : ''}${endsNextDay(ev) ? ' do dia seguinte' : ''}`}`;
  const rem = REMINDERS.find(([v]) => v === String(ev.reminder ?? ''));
  openSheet({
    title: eventTitle(ev), color: EVENT_KINDS[eventKind(ev)].color, sub: esc(EVENT_KINDS[eventKind(ev)].label),
    rows: [
      ['Quando', esc(when)],
      ['Com quem', EVENT_KINDS[eventKind(ev)].with ? esc(ev.with || '') : ''],
      ['Especialidade', EVENT_KINDS[eventKind(ev)].specialty ? esc(ev.specialty || '') : ''],
      ['Repete', ev.repeat && ev.repeat !== 'none' ? esc(REPEAT_LABELS[ev.repeat] + (ev.until ? ` até ${fmt(ev.until, { day: 'numeric', month: 'short' })}` : '')) : ''],
      ['Orçamento', ev.budget ? esc(budgetText(ev.budget, d)) : ''],
      ['Gasto', ev.budget && eventSpent(ev.id, d) ? esc(`${brl(r2(eventSpent(ev.id, d)))} · ${eventSpent(ev.id, d) > ev.budget ? `${brl(r2(eventSpent(ev.id, d) - ev.budget))} acima` : `restam ${brl(r2(ev.budget - eventSpent(ev.id, d)))}`}`) : ''],
      ['Local', esc(ev.location || '')],
      ['Lembrete', ev.reminder != null && rem ? esc(rem[1]) : ''],
      ['Detalhes', noteHTML(eventNotes(ev), i => `data-action="toggle-note" data-id="${esc(ev.id)}" data-line="${i}" data-date="${d}"`)],
    ],
    buttons: ev.budget && finOn() ? [{ label: `${icon('plus')}Gasto`, run: () => moveForm(null, { dir: 'out', eventId: ev.id, eventDate: d }) }] : [],
    onEdit: () => eventForm(ev, date),
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-event': el => eventForm(null, el.dataset.date || (state.view === 'agenda' ? state.selected : today())),
  'skip-deadline': el => skipDeadline(el.dataset.kind, el.dataset.id),
  'edit-event': el => { const ev = Store.get('events', el.dataset.id); if (ev) eventView(ev, el.dataset.date); },
  'toggle-note': el => {
    const cur = Store.get('events', el.dataset.id);
    if (!cur) return;
    const ev = structuredClone(cur);
    ev.notes = noteToggle(eventNotes(cur), +el.dataset.line);
    delete ev.buy;
    Store.upsert('events', ev);
    closeModal();
    render();
    eventView(ev, el.dataset.date);
  },
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
