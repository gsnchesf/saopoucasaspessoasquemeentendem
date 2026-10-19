'use strict';
/* ==========================================================
   Hábitos diários personalizáveis (sim/não ou quantidade)
   e registro de tempo de tela com limite diário.
   ========================================================== */

/* ---------- Regras dos hábitos ---------- */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const habitsList = () => Store.data.habits.filter(h => !h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
const habitStart = h => h.since || toISO(new Date(h.createdAt || Date.now()));
const habitActive = (h, d) => (h.weekdays || ALL_DAYS).includes(weekday(d)) && d >= habitStart(h);
const logKey = (hid, d) => `${hid}|${d}`;
const habitValue = (hid, d) => Store.get('habitLogs', logKey(hid, d))?.value || 0;
const habitDone = (h, v) => v >= (h.kind === 'qtd' ? h.target || 1 : 1);

function setHabitValue(h, d, value) {
  const id = logKey(h.id, d);
  if (value <= 0) Store.remove('habitLogs', id);
  else Store.upsert('habitLogs', { id, habitId: h.id, date: d, value });
}

/** Dias seguidos cumpridos (ignora dias em que o hábito não se aplica). */
function habitStreak(h) {
  let d = today(), n = 0;
  if (habitActive(h, d) && !habitDone(h, habitValue(h.id, d))) d = addDays(d, -1);
  const start = habitStart(h);
  for (let guard = 0; guard < 1000 && d >= start; guard++, d = addDays(d, -1)) {
    if (!habitActive(h, d)) continue;
    if (!habitDone(h, habitValue(h.id, d))) break;
    n++;
  }
  return n;
}

/** % de dias cumpridos nos últimos 30 dias (desde a criação). */
function habitRate(h) {
  let total = 0, done = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today(), -i);
    if (!habitActive(h, d)) continue;
    total++;
    if (habitDone(h, habitValue(h.id, d))) done++;
  }
  return total ? done / total : 0;
}

function habitsToday() {
  const t = today();
  const list = habitsList().filter(h => habitActive(h, t));
  return { list, done: list.filter(h => habitDone(h, habitValue(h.id, t))).length };
}

const habitGoalText = h => {
  const days = (h.weekdays || ALL_DAYS).length === 7 ? 'todo dia' : (h.weekdays || []).map(d => WEEKDAYS[d]).join(', ');
  return h.kind === 'qtd' ? `${h.target} ${h.unit || 'vezes'} · ${days}` : days;
};

/** Lista de hábitos do dia (usada em Hoje). */
function habitTodayList() {
  const t = today();
  const { list } = habitsToday();
  if (!list.length) return `<p class="empty">Nenhum hábito para hoje. <a class="link" href="#/habitos">Criar hábitos</a></p>`;
  return `<div class="list">${list.map(h => {
    const v = habitValue(h.id, t), done = habitDone(h, v);
    const control = h.kind === 'qtd'
      ? `<span class="stepper">
          <button class="icon-btn sm" data-action="habit-step" data-id="${esc(h.id)}" data-step="-1" aria-label="Diminuir">${icon('minus')}</button>
          <span>${v}/${h.target} ${esc(h.unit || '')}</span>
          <button class="icon-btn sm" data-action="habit-step" data-id="${esc(h.id)}" data-step="1" aria-label="Aumentar">${icon('plus')}</button>
        </span>`
      : '';
    return `<div class="habit-today task ${done ? 'done' : ''}">
      ${h.kind === 'qtd'
        ? `<span class="dot" style="--c:${esc(h.color)};margin:0 5px"></span>`
        : `<button class="checkbox ${done ? 'on' : ''}" style="${done ? `background:${esc(h.color)};border-color:${esc(h.color)}` : `border-color:${esc(h.color)}`}" data-action="habit-toggle" data-id="${esc(h.id)}" data-date="${t}" role="checkbox" aria-checked="${done}" aria-label="${esc(h.name)}"></button>`}
      <span class="name task-title">${esc(h.name)}</span>
      ${control}
      ${habitStreak(h) >= 2 ? `<span class="streak hot" title="Dias seguidos">${icon('flame')}${habitStreak(h)}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/* ---------- Tempo de tela ---------- */

const screenMinutes = d => Store.get('screenTime', d)?.minutes;

function screenStats() {
  const t = today();
  const avg = (from, n) => {
    const vals = Array.from({ length: n }, (_, i) => screenMinutes(addDays(from, -i))).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return { today: screenMinutes(t), avg7: avg(t, 7), prev7: avg(addDays(t, -7), 7), limit: +Store.settings.screenLimit || 0 };
}

function screenForm(d) {
  const v = screenMinutes(d);
  return `<form class="screen-input" data-form="screen-time">
    <label class="field" style="width:150px"><span>Dia</span><input type="date" name="date" value="${d}" max="${today()}"></label>
    <label class="field"><span>Horas</span><input type="number" name="h" min="0" max="24" value="${v != null ? Math.floor(v / 60) : ''}" placeholder="0"></label>
    <label class="field"><span>Minutos</span><input type="number" name="m" min="0" max="59" value="${v != null ? v % 60 : ''}" placeholder="0"></label>
    <button class="btn btn-primary">Salvar</button>
  </form>`;
}

/** Barras dos últimos `n` dias com a linha de limite. Uma série só: sem legenda, o título nomeia. */
function screenChart(n = 14) {
  const t = today(), limit = +Store.settings.screenLimit || 0;
  const days = Array.from({ length: n }, (_, i) => addDays(t, i - n + 1));
  const vals = days.map(d => screenMinutes(d));
  if (!vals.some(v => v != null)) return '<p class="empty">Registre seu tempo de tela para ver o gráfico.</p>';

  // Desenha na largura real disponível para o texto não escalar junto com o SVG.
  const W = clamp(($('#view')?.clientWidth || 700) - 40, 300, 1100);
  const H = 200, padL = 34, padB = 26, padT = 12, plotW = W - padL, plotH = H - padB - padT;
  const maxVal = Math.max(limit, ...vals.map(v => v || 0));
  const stepH = maxVal > 8 * 60 ? 120 : 60;
  const yMax = Math.max(stepH, Math.ceil(maxVal * 1.1 / stepH) * stepH);
  const y = v => padT + plotH - v / yMax * plotH;
  const slot = plotW / n, bw = Math.min(28, slot - 6);

  const grid = [];
  for (let v = 0; v <= yMax; v += stepH) {
    grid.push(`<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`);
  }
  const axisY = [];
  for (let v = 0; v <= yMax; v += stepH) axisY.push(`<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v / 60}h</text>`);

  const barPath = (x, top, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
  };

  const bars = days.map((d, i) => {
    const v = vals[i];
    const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
    const over = limit && v > limit;
    const label = `${relDay(d)}: ${v == null ? 'sem registro' : fmtDuration(v)}${over ? ' · acima do limite' : ''}`;
    const bar = v ? `<path class="bar ${over ? 'over' : ''} ${d === t ? 'today' : ''}" d="${barPath(x, y(v), bw, y(0) - y(v))}"/>` : '';
    const showLabel = slot >= 22 || i % 2 === (n - 1) % 2; // em telas estreitas, rótulo sim/não alternado
    const lbl = showLabel ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${slot >= 40 ? WEEKDAYS[weekday(d)][0] + ' ' : ''}${+d.slice(8)}</text>` : '';
    return `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" data-tip="${esc(label)}" data-x="${cx}" data-y="${v ? y(v) : y(0)}"/>${bar}${lbl}`;
  }).join('');

  const limitLine = limit ? `<line class="limit" x1="${padL}" x2="${W}" y1="${y(limit)}" y2="${y(limit)}"/>` : '';
  const key = limit ? `<p class="chart-key"><span class="key-limit"></span>limite diário (${fmtDuration(limit)}) <span class="key-over"></span>acima do limite</p>` : '';

  const table = `<table class="sr-only"><caption>Tempo de tela por dia</caption><tr><th>Dia</th><th>Tempo</th></tr>${days.map((d, i) =>
    `<tr><td>${relDay(d)}</td><td>${vals[i] == null ? 'sem registro' : fmtDuration(vals[i])}</td></tr>`).join('')}</table>`;

  return `<div class="chart" id="screen-chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tempo de tela nos últimos ${n} dias">
      <g class="grid">${grid.join('')}</g>
      <g class="axis">${axisY.join('')}</g>
      ${limitLine}
      <g class="axis">${bars}</g>
    </svg>
    <div class="tooltip" hidden></div>
    ${key}
    ${table}
  </div>`;
}

function bindChartTooltip() {
  const chart = $('#screen-chart');
  if (!chart) return;
  const tip = $('.tooltip', chart), svg = $('svg', chart);
  chart.addEventListener('pointermove', e => {
    const hit = e.target.closest('.hit');
    if (!hit) { tip.hidden = true; return; }
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect(), k = r.width / vb.width;
    tip.textContent = hit.dataset.tip;
    tip.style.left = `${hit.dataset.x * k}px`;
    tip.style.top = `${hit.dataset.y * k}px`;
    tip.hidden = false;
  });
  chart.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function screenCard({ compact = false } = {}) {
  const s = screenStats();
  const vsPrev = s.avg7 != null && s.prev7 != null && s.prev7 > 0 ? Math.round((s.avg7 / s.prev7 - 1) * 100) : null;
  const overToday = s.limit && s.today > s.limit;
  return `<section class="card card-pad">
    <div class="card-head"><h2>Tempo de tela</h2>${compact ? '<a class="link" href="#/habitos">Histórico</a>' : `<span class="sub">Limite diário: ${s.limit ? fmtDuration(s.limit) : 'não definido'} · <button class="link" data-action="edit-screen-limit">alterar</button></span>`}</div>
    <div class="screen-summary">
      <div><b>${s.today != null ? fmtDuration(s.today) : '—'}</b>hoje${overToday ? ` · <span class="late">${icon('flag')} acima do limite</span>` : ''}</div>
      <div><b>${s.avg7 != null ? fmtDuration(s.avg7) : '—'}</b>média 7 dias</div>
      ${!compact && vsPrev != null ? `<div><b>${vsPrev > 0 ? '+' : ''}${vsPrev}%</b>vs. semana anterior</div>` : ''}
    </div>
    ${compact ? screenForm(state.screenDay) : `${screenChart(14)}<div style="margin-top:14px">${screenForm(state.screenDay)}</div>`}
  </section>`;
}

/* ---------- Tela ---------- */

screens.habitos = () => {
  const t = today();
  const weekStart = state.habitWeek || startOfWeek(t);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const list = habitsList();
  const { list: todayList, done } = habitsToday();

  const rows = list.map(h => {
    const cells = days.map(d => {
      if (d > t) return `<td><span class="hcell off" style="--c:${esc(h.color)}" aria-hidden="true"></span></td>`;
      if (!habitActive(h, d)) return `<td><span class="hcell off" style="--c:${esc(h.color)}" title="Não se aplica"></span></td>`;
      const v = habitValue(h.id, d), full = habitDone(h, v);
      const cls = full ? 'full' : v ? 'partial' : '';
      const content = h.kind === 'qtd' ? (v || '') : full ? icon('check') : '';
      return `<td><button class="hcell ${cls}" style="--c:${esc(h.color)}" data-action="habit-toggle" data-id="${esc(h.id)}" data-date="${d}"
        aria-label="${esc(h.name)}, ${relDay(d)}: ${h.kind === 'qtd' ? `${v} de ${h.target}` : full ? 'feito' : 'não feito'}">${content}</button></td>`;
    }).join('');
    const st = habitStreak(h);
    return `<tr>
      <td><button class="habit-name" data-action="edit-habit" data-id="${esc(h.id)}"><span class="dot" style="--c:${esc(h.color)}"></span><span>${esc(h.name)}<br><small>${esc(habitGoalText(h))}</small></span></button></td>
      ${cells}
      <td><span class="streak ${st >= 3 ? 'hot' : ''}" title="Sequência atual · ${Math.round(habitRate(h) * 100)}% nos últimos 30 dias">${icon('flame')} ${st}</span></td>
    </tr>`;
  }).join('');

  const isThisWeek = weekStart === startOfWeek(t);
  const head = `<div class="title-block"><h1>Hábitos</h1><p class="sub">${todayList.length ? `${done} de ${todayList.length} feitos hoje` : 'Crie hábitos para acompanhar diariamente'}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-habit">${icon('plus')}Hábito</button></div>`;
  const body = `<div class="stack">
    <section class="card card-pad">
      <div class="card-head">
        <h2>${isThisWeek ? 'Esta semana' : esc(weekTitle(days[0], days[6]))}</h2>
        <div class="btn-group">
          <button class="icon-btn sm" data-action="habit-week" data-step="-1" aria-label="Semana anterior">${icon('left')}</button>
          ${isThisWeek ? '' : '<button class="btn btn-sm" data-action="habit-week" data-step="0">Hoje</button>'}
          <button class="icon-btn sm" data-action="habit-week" data-step="1" aria-label="Próxima semana" ${isThisWeek ? 'disabled' : ''}>${icon('right')}</button>
        </div>
      </div>
      ${list.length ? `<div style="overflow-x:auto"><table class="habit-table">
        <thead><tr><th>Hábito</th>${days.map(d => `<th class="${d === t ? 'today' : ''}">${WEEKDAYS[weekday(d)]}<br>${+d.slice(8)}</th>`).join('')}<th>Seq.</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="desc" style="margin:10px 8px 0">Clique num dia para marcar. Em hábitos de quantidade, cada clique soma 1 (depois da meta, zera).</p>`
        : `<p class="empty">Nenhum hábito ainda. Exemplos: beber água, ler, meditar, alongar, dormir cedo.</p>`}
    </section>
    ${screenCard()}
  </div>`;
  return { head, body, after: bindChartTooltip };
};

/* ---------- Formulários ---------- */

function habitForm(h) {
  const isNew = !h;
  h = h ? structuredClone(h) : { id: uid(), name: '', kind: 'check', target: 1, unit: '', color: SWATCHES[Store.data.habits.length % SWATCHES.length], weekdays: ALL_DAYS.slice(), since: today(), order: Store.data.habits.length };
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo hábito' : 'Editar hábito')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Hábito</span><input name="name" maxlength="80" value="${esc(h.name)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Meditar 10 minutos"></label>
        <label class="field xs"><span>Cor</span><input type="color" name="color" value="${esc(h.color)}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Tipo</span><select name="kind">${options([['check', 'Sim / não'], ['qtd', 'Quantidade por dia']], h.kind)}</select></label>
        <label class="field xs qtd" ${h.kind === 'qtd' ? '' : 'hidden'}><span>Meta</span><input type="number" name="target" min="1" max="999" value="${h.target || 1}"></label>
        <label class="field qtd" ${h.kind === 'qtd' ? '' : 'hidden'}><span>Unidade</span><input name="unit" maxlength="20" value="${esc(h.unit)}" placeholder="copos, páginas…"></label>
      </div>
      <div><span class="fieldset-label">Dias</span><div style="margin-top:6px">${dayToggles('days', h.weekdays || ALL_DAYS)}</div></div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      form.elements.kind.addEventListener('change', () => $$('.qtd', form).forEach(el => { el.hidden = form.elements.kind.value !== 'qtd'; }));
    },
    onSubmit(form) {
      const f = formData(form);
      const weekdays = readDays(form, 'days');
      if (!f.name.trim()) return formError(form, 'Dê um nome ao hábito.');
      if (!weekdays.length) return formError(form, 'Escolha pelo menos um dia.');
      Object.assign(h, { name: f.name.trim(), color: f.color, kind: f.kind, target: f.kind === 'qtd' ? Math.max(1, +f.target || 1) : 1, unit: f.kind === 'qtd' ? f.unit.trim() : '', weekdays });
      Store.upsert('habits', h);
      closeModal();
      render();
      toast(isNew ? 'Hábito criado' : 'Hábito atualizado');
    },
    onDelete: async () => {
      if (!await confirmDelete(`o hábito “${h.name}” e todo o histórico dele`)) return;
      Store.removeWhere('habitLogs', l => l.habitId === h.id);
      Store.remove('habits', h.id);
      closeModal();
      render();
      toast('Hábito excluído');
    },
  });
}

function screenLimitForm() {
  const v = +Store.settings.screenLimit || 0;
  openModal(`<form novalidate>
    ${modalHead('Limite de tempo de tela')}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Horas</span><input type="number" name="h" min="0" max="24" value="${Math.floor(v / 60)}"></label>
        <label class="field"><span>Minutos</span><input type="number" name="m" min="0" max="59" value="${v % 60}"></label>
      </div>
      <p class="desc" style="margin:0">Deixe 0 para não usar limite.</p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      Store.settings.screenLimit = clamp((+f.h || 0) * 60 + (+f.m || 0), 0, 1440);
      Store.saveSettings();
      closeModal();
      render();
    },
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'new-habit': () => habitForm(),
  'edit-habit': el => { const h = Store.get('habits', el.dataset.id); if (h) habitForm(h); },
  'habit-toggle': el => {
    const h = Store.get('habits', el.dataset.id);
    if (!h) return;
    const d = el.dataset.date, v = habitValue(h.id, d);
    if (h.kind === 'qtd') setHabitValue(h, d, v >= h.target ? 0 : v + 1);
    else setHabitValue(h, d, v ? 0 : 1);
    render();
  },
  'habit-step': el => {
    const h = Store.get('habits', el.dataset.id);
    if (!h) return;
    const t = today();
    setHabitValue(h, t, clamp(habitValue(h.id, t) + +el.dataset.step, 0, 999));
    render();
    if (habitValue(h.id, t) === h.target && +el.dataset.step > 0) toast(`Meta de “${h.name}” cumprida hoje!`);
  },
  'habit-week': el => {
    const step = +el.dataset.step;
    const cur = state.habitWeek || startOfWeek(today());
    state.habitWeek = step === 0 ? null : addDays(cur, step * 7);
    if (state.habitWeek && state.habitWeek >= startOfWeek(today())) state.habitWeek = null;
    render();
  },
  'edit-screen-limit': () => screenLimitForm(),
});

/** Salvar tempo de tela (formulário presente em Hoje e Hábitos). */
function saveScreenTime(form) {
  const f = formData(form);
  if (!f.date || f.date > today()) return toast('Escolha um dia até hoje.');
  const minutes = clamp((+f.h || 0) * 60 + (+f.m || 0), 0, 1440);
  if (f.h === '' && f.m === '') {
    Store.remove('screenTime', f.date);
    toast('Registro removido');
  } else {
    Store.upsert('screenTime', { id: f.date, date: f.date, minutes });
    const limit = +Store.settings.screenLimit || 0;
    toast(limit && minutes > limit ? `Registrado: ${fmtDuration(minutes)} — ${fmtDuration(minutes - limit)} acima do limite` : `Registrado: ${fmtDuration(minutes)}`);
  }
  state.screenDay = f.date;
  render();
}
