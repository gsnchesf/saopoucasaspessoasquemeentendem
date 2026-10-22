'use strict';
/* ==========================================================
   Remédios: todo dia ou toda semana (em dias escolhidos), em
   um ou mais horários, com início e fim opcionais (tratamento).
   Cada dose tem "Tomei" / "Não tomei" e pode avisar na hora.
   Os de todo dia ficam em Hoje e aqui (iguais todo dia, não
   poluem a agenda); os semanais também entram na agenda.
   meds: { id, name, dose, freq: 'dia' | 'semana', days: [0..6],
           times: ['HH:MM'], start, end, remind, notes,
           doneDates / skippedDates: ['AAAA-MM-DDTHH:MM'] }
   ========================================================== */

const MED_COLOR = '#14b8a6';
const medKey = (date, time) => `${date}T${time}`;
const medActive = (m, d) => (!m.start || d >= m.start) && (!m.end || d <= m.end);
const medsList = () => Store.data.meds.slice().sort((a, b) => a.name.localeCompare(b.name));
const andList = l => l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l.at(-1)}` : l.join('');

/** "Todo dia · 08:00 e 20:00" / "Toda semana · Seg · 08:00" */
const medSchedule = m => m.freq === 'semana'
  ? `Toda semana · ${daysLabel(m.days || [])} · ${andList(m.times || [])}`
  : `Todo dia · ${andList(m.times || [])}`;

/** Doses entre duas datas, como itens da agenda. Sem `daily`, só os semanais (os de todo dia ficam fora da agenda). */
function medItems(from, to, { daily = true } = {}) {
  const out = [];
  for (const m of Store.data.meds) {
    if (!daily && m.freq !== 'semana') continue;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!medActive(m, d) || (m.freq === 'semana' && !(m.days || []).includes(weekday(d)))) continue;
      for (const time of m.times || []) out.push({
        kind: 'med', id: m.id, date: d, title: m.name, start: time, end: '', color: MED_COLOR, group: 'Remédio',
        what: m.dose || 'Remédio', label: m.dose || '', allDay: false, deadline: false, state: dayState(m, medKey(d, time)),
      });
    }
  }
  return out.sort(itemSort);
}

/** Doses dos últimos 7 dias que já passaram: quantas foram tomadas. */
function medWeek(m) {
  const t = today(), now = fromMin(nowMin());
  const due = medItems(addDays(t, -6), t).filter(it => it.id === m.id && (it.date < t || it.start <= now));
  return { due: due.length, taken: due.filter(it => it.state === 'done').length };
}

/** Ao lado da dose: "Tomei" / "Não tomei"; depois de marcado, um botão com o estado (clicar desmarca). */
function medControls(it) {
  if (it.date > today()) return '';
  const btn = (st, label, cls) => `<button class="btn btn-sm ${cls}" data-action="med-state" data-state="${it.state === st ? '' : st}" data-id="${esc(it.id)}" data-date="${it.date}" data-time="${it.start}" aria-pressed="${it.state === st}">${label}</button>`;
  if (it.state === 'done') return btn('done', `${icon('check')}Tomado`, 'btn-primary');
  if (it.state === 'skipped') return btn('skipped', 'Não tomei', 'btn-danger-ghost');
  return btn('done', 'Tomei', '') + btn('skipped', 'Não tomei', 'btn-ghost');
}

function setMedState(m, date, time, st) {
  Store.upsert('meds', withDayState(m, medKey(date, time), st));
  render();
  toast(st === 'done' ? `${m.name}: tomado` : st === 'skipped' ? `${m.name}: não tomei` : 'Dose desmarcada');
}

/** Cartão de Hoje com as doses do dia. */
function medsToday() {
  const doses = medItems(today(), today());
  if (!doses.length) return '';
  const taken = doses.filter(it => it.state === 'done').length;
  return `<section class="card card-pad">
    <div class="card-head"><h2>Remédios</h2><span class="sub">${taken} de ${doses.length}</span></div>
    <div class="list">${doses.map(itemRow).join('')}</div>
  </section>`;
}

/** Lembrete na hora de cada dose de hoje ainda sem marca. */
function medReminders(fired, now) {
  const t = today();
  let changed = false;
  for (const it of medItems(t, t)) {
    const m = Store.get('meds', it.id);
    if (!m.remind || it.state) continue;
    const at = fromISO(t);
    at.setHours(0, toMin(it.start), 0, 0);
    const key = `med:${it.id}@${medKey(t, it.start)}`;
    if (now < at.getTime() || now - at.getTime() >= 10 * 60e3 || fired.includes(key)) continue;
    fired.push(key);
    changed = true;
    toast(`Hora do remédio: ${m.name}${m.dose ? ' · ' + m.dose : ''}`, { label: 'Tomei', fn: () => setMedState(Store.get('meds', m.id) || m, t, it.start, 'done') }, 12000);
    showNotification(m.name, [m.dose, it.start].filter(Boolean).join(' · '), key);
  }
  return changed;
}

/* ---------- Tela ---------- */

screens.remedios = () => {
  const t = today();
  const list = medsList();
  const doses = medItems(t, t);
  const taken = doses.filter(it => it.state === 'done').length;

  const head = `<div class="title-block"><h1>Remédios</h1>
      <p class="sub">${doses.length ? `${taken} de ${doses.length} tomados hoje` : ''}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-med">${icon('plus')}Remédio</button></div>`;
  if (!list.length) {
    return { head, body: `<div class="card card-pad"><p class="empty">Nenhum remédio.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="new-med">${icon('plus')}Adicionar remédio</button></div></div>` };
  }

  const hoje = `<section class="card card-pad">
    <div class="card-head"><h2>Hoje</h2></div>
    ${doses.length ? `<div class="list">${doses.map(itemRow).join('')}</div>` : '<p class="empty">Nada hoje.</p>'}
  </section>`;

  const row = m => {
    const wk = medWeek(m);
    const meta = [m.dose, medSchedule(m),
      m.end && (m.end < t ? `terminou ${fmt(m.end, { day: 'numeric', month: 'short' })}` : `até ${fmt(m.end, { day: 'numeric', month: 'short' })}`),
      m.start > t && `começa ${relDay(m.start).toLowerCase()}`,
      medActive(m, t) && wk.due && `${wk.taken} de ${wk.due} na semana`].filter(Boolean).map(esc).join(' · ');
    return `<button class="ev-row ${m.end && m.end < t ? 'past' : ''}" style="--c:${MED_COLOR}" data-action="open-med" data-id="${esc(m.id)}">
      <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(m.name)}</span></span><span class="ev-meta"><span>${meta}</span></span></span></button>`;
  };
  const current = list.filter(m => !m.end || m.end >= t), ended = list.filter(m => m.end && m.end < t);
  const todos = `<section class="card card-pad">
    <div class="card-head"><h2>Todos</h2></div>
    ${current.length ? `<div class="list">${current.map(row).join('')}</div>` : ''}
    ${ended.length ? `<h3 class="section-label">Terminados</h3><div class="list">${ended.map(row).join('')}</div>` : ''}
  </section>`;

  return { head, body: `<div class="stack">${hoje}${todos}</div>` };
};

/* ---------- Ficha e formulário ---------- */

/** Ficha do remédio; vinda de uma dose (data + horário), traz "Tomei" / "Não tomei". */
function medSheet(m, date, time) {
  const dose = date && time;
  const st = dose ? dayState(m, medKey(date, time)) : null;
  const short = d => fmt(d, { day: 'numeric', month: 'short', year: d.slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' });
  openSheet({
    title: m.name, color: MED_COLOR, sub: esc(medSchedule(m)),
    rows: [
      ['Dose', esc(m.dose)],
      ['Quando', dose ? esc(`${cap(relDay(date))} · ${time}`) : ''],
      ['Desde', m.start ? esc(short(m.start)) : ''],
      ['Até', m.end ? esc(short(m.end)) : ''],
      ['Situação', st === 'done' ? 'Tomado' : st === 'skipped' ? 'Não tomado' : ''],
      ['Notas', sheetText(m.notes)],
    ],
    buttons: dose && date <= today() ? dayStateButtons(st, next => setMedState(Store.get('meds', m.id) || m, date, time, next), ['Tomei', 'Não tomei']) : [],
    onEdit: () => medForm(m),
  });
}

const medTimeRow = t => `<span class="time-item"><input type="time" value="${esc(t)}" aria-label="Horário">
  <button type="button" class="icon-btn ghost sm" data-remove-time aria-label="Remover horário">${icon('x')}</button></span>`;

function medForm(m) {
  const isNew = !m;
  m = m ? structuredClone(m) : { id: uid(), name: '', dose: '', freq: 'dia', days: [weekday(today())], times: ['08:00'], start: today(), end: '', remind: true, notes: '', doneDates: [] };
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo remédio' : 'Editar remédio')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Nome</span><input name="name" maxlength="80" value="${esc(m.name)}" ${isNew ? 'autofocus' : ''}></label>
        <label class="field"><span>Dose</span><input name="dose" maxlength="60" value="${esc(m.dose)}"></label>
      </div>
      <div><span class="fieldset-label">Frequência</span><div class="day-toggles choice" style="margin-top:6px">
        ${[['dia', 'Todo dia'], ['semana', 'Toda semana']].map(([v, l]) => `<label><input type="radio" name="freq" value="${v}" ${m.freq === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div></div>
      <div class="med-days"><span class="fieldset-label">Dias</span><div style="margin-top:6px">${dayToggles('days', m.days || [])}</div></div>
      <div><span class="fieldset-label">Horários</span><div class="time-list" style="margin-top:6px">
        ${(m.times || []).map(medTimeRow).join('')}
        <button type="button" class="btn btn-sm" data-add-time>${icon('plus')}Horário</button>
      </div></div>
      <div class="row">
        <label class="field"><span>Desde</span><input type="date" name="start" value="${esc(m.start || '')}"></label>
        <label class="field"><span>Até</span><input type="date" name="end" value="${esc(m.end || '')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="remind" ${m.remind ? 'checked' : ''}> Avisar na hora</label>
      <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(m.notes || '')}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const sync = () => { $('.med-days', form).hidden = form.elements.freq.value !== 'semana'; };
      form.addEventListener('change', sync);
      form.addEventListener('click', e => {
        if (e.target.closest('[data-remove-time]')) return e.target.closest('.time-item').remove();
        const add = e.target.closest('[data-add-time]');
        if (!add) return;
        const last = $$('.time-item input', form).map(i => i.value).filter(isTime).at(-1);
        add.insertAdjacentHTML('beforebegin', medTimeRow(last ? fromMin(Math.min(toMin(last) + 12 * 60, 22 * 60)) : '08:00'));
        add.previousElementSibling.querySelector('input').focus();
      });
      sync();
    },
    onSubmit(form) {
      const f = formData(form);
      const days = readDays(form, 'days');
      const times = [...new Set($$('.time-item input', form).map(i => i.value).filter(isTime))].sort();
      if (!f.name.trim()) return formError(form, 'Falta o nome.');
      if (f.freq === 'semana' && !days.length) return formError(form, 'Escolha pelo menos um dia.');
      if (!times.length) return formError(form, 'Falta o horário.');
      if (f.start && f.end && f.end < f.start) return formError(form, 'O fim precisa ser depois do início.');
      Object.assign(m, {
        name: f.name.trim(), dose: f.dose.trim(), freq: f.freq, days: f.freq === 'semana' ? days : [], times,
        start: f.start || '', end: f.end || '', remind: !!f.remind, notes: f.notes.trim(),
      });
      Store.upsert('meds', m);
      closeModal();
      render();
      toast(isNew ? 'Remédio salvo' : 'Remédio atualizado');
    },
    async onDelete() {
      if (!await confirmDelete(`“${m.name}”`)) return;
      const removed = Store.remove('meds', m.id);
      closeModal();
      render();
      toast('Remédio excluído', { label: 'Desfazer', fn: () => { Store.upsert('meds', removed); render(); } });
    },
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-med': () => medForm(),
  'open-med': el => { const m = Store.get('meds', el.dataset.id); if (m) medSheet(m, el.dataset.date, el.dataset.time); },
  'med-state': el => { const m = Store.get('meds', el.dataset.id); if (m) setMedState(m, el.dataset.date, el.dataset.time, el.dataset.state || null); },
});
