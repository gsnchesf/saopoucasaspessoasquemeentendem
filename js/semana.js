'use strict';
/* ==========================================================
   Essa semana: cronograma em blocos de horário, de segunda a
   domingo — tudo o que se pretende fazer em cada hora do dia,
   com aulas e compromissos da agenda ao fundo.
   ========================================================== */

const BLOCK_REPEAT = [['none', 'Não repete'], ['weekly', 'Toda semana'], ['weekdays', 'Dias úteis (seg–sex)'], ['daily', 'Todos os dias']];

/** Dias exibidos: sempre começa na segunda; o fim de semana pode ser escondido. */
function planDays() {
  const start = startOfWeek(state.planWeek || today(), 1);
  return Array.from({ length: Store.settings.planHideWeekend ? 5 : 7 }, (_, i) => addDays(start, i));
}

/** Blocos planejados entre duas datas, já expandidos pela repetição. */
function blockItems(from, to) {
  const out = [];
  for (const b of Store.data.blocks) {
    for (const d of occurrences(b, from, to)) out.push({
      kind: 'block', id: b.id, date: d, title: b.title, start: b.start, end: b.end,
      color: catColor(b.category), category: b.category, done: (b.doneDates || []).includes(d),
      repeats: b.repeat && b.repeat !== 'none',
    });
  }
  return out;
}

const minutesOf = it => Math.max(0, toMin(it.end) - toMin(it.start));

/* ---------- Tela ---------- */

screens.semana = () => {
  const days = planDays();
  const [first, last] = [days[0], addDays(startOfWeek(days[0], 1), 6)];
  const isThisWeek = first === startOfWeek(today(), 1);
  const s = Store.settings;
  const showAgenda = s.planShowAgenda !== false;
  const blocks = blockItems(first, last);

  // Resumo: horas planejadas por tipo nos dias visíveis.
  const visible = blocks.filter(b => days.includes(b.date));
  const byCat = {};
  for (const b of visible) (byCat[b.category || ''] ||= { color: b.color, name: cat(b.category)?.name || 'Sem tipo', min: 0 }).min += minutesOf(b);
  const total = visible.reduce((n, b) => n + minutesOf(b), 0);
  const done = visible.filter(b => b.done).reduce((n, b) => n + minutesOf(b), 0);
  const summary = visible.length
    ? `<div class="plan-summary">
        <span class="plan-chip strong">${fmtDuration(total)} planejadas${done ? ` · ${fmtDuration(done)} feitas` : ''}</span>
        ${Object.values(byCat).sort((a, b) => b.min - a.min).map(c => `<span class="plan-chip" style="--c:${esc(c.color)}"><i></i>${esc(c.name)} · ${fmtDuration(c.min)}</span>`).join('')}
      </div>`
    : '';

  const head = `<div class="title-block"><h1>${isThisWeek ? 'Essa semana' : esc(weekTitle(first, last))}</h1>
      <p class="sub">${isThisWeek ? esc(weekTitle(first, last)) : 'Cronograma da semana'}</p></div>
    <div class="toolbar">
      <div class="btn-group">
        <button class="icon-btn" data-action="plan-nav" data-dir="-1" aria-label="Semana anterior" title="Semana anterior (←)">${icon('left')}</button>
        <button class="btn" data-action="plan-nav" data-dir="0">Hoje</button>
        <button class="icon-btn" data-action="plan-nav" data-dir="1" aria-label="Próxima semana" title="Próxima semana (→)">${icon('right')}</button>
      </div>
      <button class="btn ${s.planHideWeekend ? 'btn-ghost' : ''}" data-action="plan-weekend" aria-pressed="${!s.planHideWeekend}" title="Mostrar/esconder sábado e domingo">${icon('calendar')}Fim de semana</button>
      <button class="btn ${showAgenda ? '' : 'btn-ghost'}" data-action="plan-agenda" aria-pressed="${showAgenda}" title="Mostrar/esconder aulas, trabalho e compromissos">${icon('book')}Agenda ao fundo</button>
      <button class="btn btn-primary hide-mobile" data-action="new-block">${icon('plus')}Bloco</button>
    </div>`;

  const body = `${summary}${planGrid(days, blocks, showAgenda)}`;
  const after = () => {
    const el = $('#tg-body');
    if (!el) return;
    el.scrollTop = state.planScroll ?? Store.settings.dayStart * HOUR;
    el.addEventListener('scroll', () => { state.planScroll = el.scrollTop; }, { passive: true });
  };
  return { head, body, after };
};

function planGrid(days, blocks, showAgenda) {
  const map = showAgenda ? agendaItems(days[0], days[days.length - 1], { work: true }) : {};
  for (const b of blocks) (map[b.date] ||= []).push(b);
  const t = today();

  const head = days.map(d => `<div class="tg-dayhead ${d === t ? 'today' : ''}">
    <span class="wd">${WEEKDAYS[weekday(d)]}</span><span class="dn">${+d.slice(8)}</span></div>`).join('');
  const allday = days.map(d => `<div class="tg-allday-cell">${(map[d] || []).filter(it => it.allDay).map(itemChip).join('')}</div>`).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="tg-hour"><span>${h ? pad(h) + ':00' : ''}</span></div>`).join('');

  const cols = days.map(d => {
    const timed = (map[d] || []).filter(it => !it.allDay && it.start).map(it => {
      const s = toMin(it.start);
      let e = it.end ? toMin(it.end) : s + 60;
      if (e <= s) e = s + 30;
      return { it, s, e };
    });
    const els = layoutDay(timed).map(({ it, s, e, col, n }) => {
      const top = s / 60 * HOUR, h = Math.max((e - s) / 60 * HOUR, 20), w = 100 / n;
      const isBlock = it.kind === 'block';
      const cls = ['tg-ev', h < 36 && 'short', isBlock ? 'blk' : 'ctx', it.kind === 'class' && 'cls', it.kind === 'commute' && 'commute', it.done && 'done'].filter(Boolean).join(' ');
      const attrs = isBlock ? `data-action="edit-block" data-id="${esc(it.id)}" data-date="${it.date}"` : itemAttrs(it);
      return `<button class="${cls}" ${attrs} title="${esc(`${it.title} · ${it.start}${it.end ? '–' + it.end : ''}${isBlock ? '' : ' (agenda)'}`)}"
        style="--c:${esc(it.color)};top:${top}px;height:${h - 2}px;left:calc(${col * w}% + 2px);width:calc(${w}% - 4px)">
        <span class="t">${it.done ? icon('check') : ''}${esc(it.title)}</span><span class="h">${it.start}${it.end ? '–' + it.end : ''}</span></button>`;
    }).join('');
    const now = d === t ? `<div class="now-line" style="top:${nowMin() / 60 * HOUR}px"></div>` : '';
    return `<div class="tg-col ${d === t ? 'today' : ''}" data-date="${d}">${els}${now}</div>`;
  }).join('');

  return `<div class="card timegrid plan-grid" style="--days:${days.length};--hour:${HOUR}px">
    <div class="tg-head"><div class="tg-gutter"></div>${head}</div>
    <div class="tg-allday"><div class="tg-gutter"><span>prazos</span></div>${allday}</div>
    <div class="tg-body" id="tg-body"><div class="tg-hours">${hours}</div>${cols}</div>
  </div>`;
}

/* ---------- Formulário de bloco ---------- */

function blockForm(b, date, startTime) {
  const isNew = !b;
  if (b) b = structuredClone(b);
  else {
    const start = startTime || '08:00';
    b = {
      id: uid(), title: '', category: '', date: date || today(),
      start, end: fromMin(Math.min(toMin(start) + 60, 1439)),
      repeat: 'none', until: '', exdates: [], doneDates: [], notes: '',
    };
  }
  const occDate = date || b.date;
  const repeats = b.repeat && b.repeat !== 'none';

  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo bloco' : 'Editar bloco')}
    <div class="modal-body">
      ${repeats && !isNew ? `<p class="hint-box">${icon('repeat')}Vale para todas as semanas.</p>` : ''}
      <label class="field"><span>O que vai fazer</span><input name="title" maxlength="160" value="${esc(b.title)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Estudar Cálculo"></label>
      <div class="row">
        <label class="field"><span>Tipo</span><select name="category">${catOptions(b.category)}</select></label>
        <label class="field"><span>${repeats ? 'A partir de' : 'Dia'}</span><input type="date" name="date" value="${b.date}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Início</span><input type="time" name="start" value="${b.start}"></label>
        <label class="field"><span>Fim</span><input type="time" name="end" value="${b.end}"></label>
        <label class="field"><span>Repetir</span><select name="repeat">${options(BLOCK_REPEAT, b.repeat)}</select></label>
      </div>
      <label class="field"><span>Observações</span><textarea name="notes" rows="2" placeholder="Opcional">${esc(b.notes)}</textarea></label>
      ${isNew ? '' : `<label class="check"><input type="checkbox" name="done" ${(b.doneDates || []).includes(occDate) ? 'checked' : ''}> Feito ${repeats ? `em ${esc(relDay(occDate).toLowerCase())}` : ''}</label>`}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (!f.title.trim()) return formError(form, 'Falta o título.');
      if (!f.date) return formError(form, 'Falta o dia.');
      if (!f.start || !f.end || f.end <= f.start) return formError(form, 'O fim precisa ser depois do início.');
      const doneDates = new Set(b.doneDates || []);
      if (!isNew) f.done ? doneDates.add(occDate) : doneDates.delete(occDate);
      Object.assign(b, {
        title: f.title.trim(), category: f.category, date: f.date, start: f.start, end: f.end,
        repeat: f.repeat, notes: f.notes.trim(), doneDates: [...doneDates],
      });
      Store.upsert('blocks', b);
      closeModal();
      render();
      toast(isNew ? 'Bloco criado' : 'Bloco atualizado');
    },
    onDelete: async () => {
      let mode = 'all';
      if (repeats) {
        mode = await ask(`“${b.title}” se repete. Excluir só ${relDay(occDate).toLowerCase()} ou todas as ocorrências?`, [
          { label: 'Cancelar', value: null }, { label: 'Só este dia', value: 'one' }, { label: 'Todas', value: 'all', kind: 'danger' }]);
        if (!mode) return;
      }
      closeModal();
      if (mode === 'one') {
        b.exdates = [...(b.exdates || []), occDate];
        Store.upsert('blocks', b);
        render();
        return toast('Bloco removido deste dia');
      }
      const removed = Store.remove('blocks', b.id);
      render();
      toast('Bloco excluído', { label: 'Desfazer', fn: () => { Store.upsert('blocks', removed); render(); } });
    },
  });
}

function navPlan(dir) {
  state.planWeek = dir ? addDays(startOfWeek(state.planWeek || today(), 1), dir * 7) : today();
  render();
}

Object.assign(actions, {
  'plan-nav': el => navPlan(+el.dataset.dir),
  'plan-weekend': () => { Store.settings.planHideWeekend = !Store.settings.planHideWeekend; Store.saveSettings(); render(); },
  'plan-agenda': () => { Store.settings.planShowAgenda = Store.settings.planShowAgenda === false; Store.saveSettings(); render(); },
  'new-block': () => blockForm(null, planDays().includes(today()) ? today() : planDays()[0]),
  'edit-block': el => { const b = Store.get('blocks', el.dataset.id); if (b) blockForm(b, el.dataset.date); },
});
