'use strict';
/* ==========================================================
   Metas: objetivos agrupados em áreas (corpo, leitura…), criados
   a partir de um tipo pronto (kind, ver GOAL_KINDS) ou do zero.
   Cada meta mede uma coisa (goalType):
   - tempo:       minutos
   - vezes:       quantas vezes
   - quantidade:  número com unidade (páginas, km, livros, kg)
   - objetivo:    etapas para marcar
   num prazo (period): por semana, por mês ou longo prazo
   ('total', com data opcional em deadline, contada a partir de
   startDate). Quantidade de longo prazo soma os registros ou
   acompanha um valor (track 'valor', de `from` até `to` — ex.:
   peso de 70 a 75 kg, cada registro é o valor do dia).
   ========================================================== */

const activitiesList = () => Store.data.activities.filter(a => !a.archived)
  .sort((a, b) => (area(a.areaId)?.name || '').localeCompare(area(b.areaId)?.name || '') || a.name.localeCompare(b.name));
const logsOf = id => Store.data.activityLogs.filter(l => l.activityId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

/** Tipos prontos: preenchem medida, prazo e unidade; "outra" mostra tudo. */
const GOAL_KINDS = {
  treino: { area: 'Corpo', label: 'Treinar (vezes)', name: 'Treinar', done: 'Treinei hoje', preset: { goalType: 'vezes', target: 3, period: 'semana' } },
  treinoTempo: { area: 'Corpo', label: 'Treinar (tempo)', name: 'Treinar', preset: { goalType: 'tempo', target: 180, period: 'semana' } },
  peso: { area: 'Corpo', label: 'Ganhar ou perder peso', name: 'Peso', fixedPeriod: true, fromLabel: 'Hoje (kg)', toLabel: 'Meta (kg)', log: 'Anotar peso', preset: { goalType: 'quantidade', period: 'total', track: 'valor', unit: 'kg' } },
  dieta: { area: 'Corpo', label: 'Seguir dieta', name: 'Dieta', fixedPeriod: true, timesLabel: 'Dias por semana', timesUnit: ['dia', 'dias'], done: 'Segui hoje', preset: { goalType: 'vezes', target: 5, period: 'semana' } },
  corrida: { area: 'Corpo', label: 'Correr ou caminhar', name: 'Correr', preset: { goalType: 'quantidade', target: 10, period: 'semana', unit: 'km' } },
  leitura: { area: 'Leitura', label: 'Ler páginas', name: 'Ler', preset: { goalType: 'quantidade', target: 100, period: 'semana', unit: 'páginas' } },
  livros: { area: 'Leitura', label: 'Terminar livros', name: 'Terminar livros', fixedPeriod: true, plusOne: 'Terminei um', preset: { goalType: 'quantidade', target: 12, period: 'total', unit: 'livros' } },
  outra: { label: 'Outra' },
};
const goalKind = a => GOAL_KINDS[a.kind] || GOAL_KINDS.outra;

const num = v => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const goalPeriod = a => a.goalType === 'objetivo' ? 'total' : a.period || 'semana';
const isLongTerm = a => goalPeriod(a) === 'total';
const tracksValue = a => a.goalType === 'quantidade' && isLongTerm(a) && a.track === 'valor';
/** Tem ritmo a acompanhar: meta por período ou de longo prazo com data. */
const hasPace = a => !isLongTerm(a) || !!a.deadline;

/** Valor na medida da meta: "2h", "3×", "20 páginas". */
function amountText(a, v) {
  if (a.goalType === 'tempo') return fmtDuration(v);
  if (a.goalType === 'vezes') return goalKind(a).timesUnit ? plural(+v || 0, ...goalKind(a).timesUnit) : `${num(v)}×`;
  return a.unit ? `${num(v)} ${a.unit}` : num(v);
}

function untilText(a) {
  if (!a.deadline) return '';
  const opts = { day: 'numeric', month: 'short' };
  if (a.deadline.slice(0, 4) !== today().slice(0, 4)) opts.year = 'numeric';
  return `até ${fmt(a.deadline, opts).replace(/\./g, '')}`;
}

function goalText(a) {
  const until = untilText(a);
  if (a.goalType === 'objetivo') return [plural((a.objectives || []).length, 'etapa', 'etapas'), until].filter(Boolean).join(' ');
  if (tracksValue(a)) return [`de ${amountText(a, a.from)} para ${amountText(a, a.to)}`, until].filter(Boolean).join(' ');
  return `${amountText(a, a.target)} ${isLongTerm(a) ? until || 'no total' : `por ${PERIODS[goalPeriod(a)]}`}`;
}

function goalProgress(a) {
  const period = goalPeriod(a);
  let value, target, p, left;
  if (a.goalType === 'objetivo') {
    const o = a.objectives || [];
    value = o.filter(x => x.done).length;
    target = o.length;
    p = target ? value / target : 0;
    left = target - value;
  } else if (tracksValue(a)) {
    // Vale o registro mais recente; de `from` até `to`, subindo ou descendo.
    const last = logsOf(a.id)[0];
    value = last ? +last.amount : +a.from;
    target = +a.to;
    const span = target - a.from;
    p = span ? Math.max(0, (value - a.from) / span) : 1;
    left = p >= 1 ? 0 : Math.abs(target - value);
  } else {
    let logs = Store.data.activityLogs.filter(l => l.activityId === a.id);
    if (period !== 'total') {
      const [from, to] = periodRange(period);
      logs = logs.filter(l => l.date >= from && l.date <= to);
    }
    const field = { tempo: l => +l.minutes || 0, vezes: l => +l.count || 1, quantidade: l => +l.amount || 0 }[a.goalType];
    value = logs.reduce((n, l) => n + field(l), 0);
    target = +a.target || 0;
    p = target ? value / target : 0;
    left = Math.max(0, target - value);
  }
  // Ritmo esperado: fração do prazo que já passou.
  let status = '';
  if (p >= 1) status = 'Meta batida';
  else if (hasPace(a)) {
    const [from, to] = period === 'total' ? [a.startDate || today(), a.deadline] : periodRange(period);
    const elapsed = Math.min(1, (diffDays(from, today()) + 1) / (Math.max(0, diffDays(from, to)) + 1));
    status = today() > to ? 'Prazo passou' : p >= elapsed ? 'No ritmo' : 'Abaixo do ritmo';
  }
  const steps = a.goalType === 'objetivo';
  return {
    value, target, p, left, status, period,
    text: steps ? `${value} de ${target}` : amountText(a, value),
    leftText: steps ? plural(left, 'etapa', 'etapas') : amountText(a, left),
    targetText: steps ? '' : amountText(a, target),
  };
}

/** Registro de hoje feito pelo "Fiz hoje" (não conta os que vieram de treino). */
const doneToday = a => Store.data.activityLogs.find(l => l.activityId === a.id && l.date === today() && !l.workoutId);

const statusClass = s => s === 'Meta batida' ? 'ok' : s === 'No ritmo' ? '' : s === 'Prazo passou' ? 'danger' : 'warn';
const onPace = a => ['Meta batida', 'No ritmo'].includes(goalProgress(a).status);

function goalFoot(a, g) {
  const nesta = `nest${g.period === 'mes' ? 'e mês' : 'a semana'}`;
  if (g.p >= 1) return isLongTerm(a) ? 'Concluída.' : `Concluída ${nesta}.`;
  const faltam = g.left === 1 && a.goalType !== 'tempo' ? 'Falta' : 'Faltam';
  if (!isLongTerm(a)) return `${faltam} ${g.leftText} ${nesta}.`;
  if (!a.deadline) return `${faltam} ${g.leftText}.`;
  return `${faltam} ${g.leftText} · prazo ${untilLabel(a.deadline)}.`;
}

function logLine(a, l) {
  const bits = [relDay(l.date)];
  if (l.minutes) bits.push(fmtDuration(l.minutes));
  if (l.amount != null && a.goalType === 'quantidade') bits.push((tracksValue(a) ? '' : '+') + esc(amountText(a, l.amount)));
  if (l.note) bits.push(esc(l.note));
  return bits.join(' · ');
}

function goalCard(a) {
  const ar = area(a.areaId), color = ar?.color || 'var(--accent)';
  const g = goalProgress(a);
  const id = esc(a.id);
  const badge = g.status ? `<span class="badge ${statusClass(g.status)}">${g.status}</span>` : '';
  const logs = a.goalType === 'objetivo' ? [] : logsOf(a.id).slice(0, 3);
  let main;
  if (a.goalType === 'objetivo') {
    main = `<div class="goal-progress"><span><b>${g.value}</b> de ${g.target}</span>${badge}</div>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      ${a.deadline && g.p < 1 ? `<p class="desc" style="margin:0">${goalFoot(a, g)}</p>` : ''}
      <div class="list">${(a.objectives || []).map(o => `<div class="task ${o.done ? 'done' : ''}">
        <button class="checkbox ${o.done ? 'on' : ''}" data-action="toggle-objective" data-id="${id}" data-obj="${esc(o.id)}" role="checkbox" aria-checked="${!!o.done}" aria-label="${esc(o.text)}"></button>
        <span class="task-main"><span class="task-title">${esc(o.text)}</span></span></div>`).join('') || '<p class="empty">Sem etapas.</p>'}</div>`;
  } else {
    main = `<div class="goal-progress"><span><b>${esc(g.text)}</b> ${tracksValue(a) ? '→' : 'de'} ${esc(g.targetText)}</span>${badge}</div>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      <p class="desc" style="margin:0">${esc(goalFoot(a, g))}</p>`;
  }
  const buttons = {
    tempo: () => `<button class="btn btn-sm btn-primary" data-action="log-activity" data-id="${id}">${icon('clock')}Registrar tempo</button>`,
    vezes: () => (doneToday(a)
      ? `<button class="btn btn-sm" data-action="quick-log" data-id="${id}" aria-pressed="true" title="Clique para desmarcar">${icon('check')}${goalKind(a).done || 'Fiz hoje'}</button>`
      : `<button class="btn btn-sm btn-primary" data-action="quick-log" data-id="${id}">${icon('plus')}${goalKind(a).done || 'Fiz hoje'}</button>`)
      + `<button class="btn btn-sm" data-action="log-activity" data-id="${id}">Detalhes</button>`,
    quantidade: () => tracksValue(a)
      ? `<button class="btn btn-sm btn-primary" data-action="log-activity" data-id="${id}">${icon('edit')}${goalKind(a).log || 'Atualizar'}</button>`
      : goalKind(a).plusOne
        ? `<button class="btn btn-sm btn-primary" data-action="plus-one" data-id="${id}">${icon('plus')}${goalKind(a).plusOne}</button>`
          + `<button class="btn btn-sm" data-action="log-activity" data-id="${id}">Detalhes</button>`
        : `<button class="btn btn-sm btn-primary" data-action="log-activity" data-id="${id}">${icon('plus')}Registrar</button>`,
  }[a.goalType]?.() || '';
  return `<article class="card goal-card">
    <div class="goal-top">
      <div><h3>${esc(a.name)}</h3><p class="sub"><span class="pill" style="--c:${esc(color)}">${esc(ar?.name || 'Sem área')}</span> · ${esc(goalText(a))}</p></div>
      <button class="icon-btn ghost sm" data-action="edit-activity" data-id="${id}" aria-label="Editar ${esc(a.name)}">${icon('edit')}</button>
    </div>
    ${main}
    ${buttons ? `<div class="goal-actions">${buttons}</div>` : ''}
    ${logs.length ? `<ul class="goal-log">${logs.map(l => `<li><span>${logLine(a, l)}</span>
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
      <span class="top"><span>${esc(a.name)}</span><span>${esc(a.goalType === 'objetivo' ? g.text : `${g.text} / ${g.targetText}`)}</span></span>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
    </a>`;
  }).join('')}</div>`;
}

/* ---------- Tela ---------- */

screens.metas = () => {
  const areas = Store.data.areas;
  const sel = state.goalArea;
  const list = activitiesList().filter(a => !sel || a.areaId === sel);
  const paced = activitiesList().filter(hasPace);
  const onTrack = paced.filter(onPace).length;

  const head = `<div class="title-block"><h1>Metas</h1>
      <p class="sub">${paced.length ? `${onTrack} de ${paced.length} no ritmo` : ''}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="new-activity">${icon('plus')}Meta</button></div>`;

  const filter = `<div class="segmented">
    <button data-action="goal-area" data-id="" class="${!sel ? 'active' : ''}">Todas</button>
    ${areas.map(a => `<button data-action="goal-area" data-id="${esc(a.id)}" class="${sel === a.id ? 'active' : ''}">${esc(a.name)}</button>`).join('')}
  </div>`;

  let content;
  if (!list.length) {
    content = `<div class="card card-pad"><p class="empty">Nenhuma meta${sel ? ' nesta área' : ''}.</p>
      <div class="btn-row" style="padding:0 8px 4px"><button class="btn btn-primary" data-action="new-activity">${icon('plus')}Criar meta</button></div></div>`;
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

/** Área do tipo pronto: a que já existe (Corpo também acha Fitness e Saúde) ou "new:Nome", criada ao salvar. */
const AREA_ALIASES = { corpo: ['corpo', 'fitness', 'saude'], leitura: ['leitura', 'livros'] };
function kindAreaId(kind) {
  const name = GOAL_KINDS[kind]?.area;
  if (!name) return '';
  const names = AREA_ALIASES[norm(name)] || [norm(name)];
  return Store.data.areas.find(a => names.includes(norm(a.name)))?.id || `new:${name}`;
}

function activityForm(a) {
  if (!Store.data.areas.length) Store.upsert('areas', { id: uid(), name: 'Geral', color: SWATCHES[0] });
  const isNew = !a;
  a = a ? structuredClone(a) : { id: uid(), kind: 'treino', ...GOAL_KINDS.treino.preset, name: GOAL_KINDS.treino.name, areaId: kindAreaId('treino'), track: 'soma', deadline: '', objectives: [], notes: '' };
  const kind = a.kind && GOAL_KINDS[a.kind] ? a.kind : 'outra';
  const t = a.goalType;
  const tH = t === 'tempo' ? Math.floor(a.target / 60) : 3, tM = t === 'tempo' ? a.target % 60 : 0;
  const val = v => v == null ? '' : v;
  const kindOptions = groups => groups.map(([label, ids]) => `<optgroup label="${label}">${options(ids.map(k => [k, GOAL_KINDS[k].label]), kind)}</optgroup>`).join('');
  const newAreas = [...new Set([a.areaId, ...Object.keys(GOAL_KINDS).map(kindAreaId)])].filter(id => id.startsWith('new:'));
  const areaSel = areaOptions(a.areaId) + newAreas.map(id => `<option value="${esc(id)}" ${a.areaId === id ? 'selected' : ''}>${esc(id.slice(4))}</option>`).join('');
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Nova meta' : 'Editar meta')}
    <div class="modal-body">
      <label class="field"><span>Tipo</span><select name="kind">${kindOptions([
        ['Corpo', ['treino', 'treinoTempo', 'peso', 'dieta', 'corrida']],
        ['Leitura', ['leitura', 'livros']],
        ['Outras', ['outra']]])}</select></label>
      <div class="row">
        <label class="field"><span>Meta</span><input name="name" maxlength="80" value="${esc(a.name)}"></label>
        <label class="field"><span>Área</span><select name="areaId">${areaSel}</select></label>
      </div>
      <div class="row g-custom">
        <label class="field"><span>Medida</span><select name="goalType">${options(Object.entries(GOAL_TYPES), t)}</select></label>
        <label class="field g-track"><span>Acompanhar</span><select name="track">${options([['soma', 'Somando o que fizer'], ['valor', 'Pelo valor atual']], a.track || 'soma')}</select></label>
      </div>
      <div class="row">
        <label class="field xs g-vezes"><span class="l-vezes">Vezes</span><input type="number" name="times" min="1" max="9999" value="${t === 'vezes' ? a.target : 3}"></label>
        <label class="field xs g-tempo"><span>Horas</span><input type="number" name="h" min="0" max="9999" value="${tH}"></label>
        <label class="field xs g-tempo"><span>Minutos</span><input type="number" name="m" min="0" max="59" value="${tM}"></label>
        <label class="field xs g-soma"><span class="l-soma">Quanto</span><input type="number" name="amount" min="0" step="any" value="${t === 'quantidade' && a.track !== 'valor' ? a.target : ''}"></label>
        <label class="field xs g-valor"><span class="l-from">De</span><input type="number" name="from" step="any" value="${esc(val(a.from))}"></label>
        <label class="field xs g-valor"><span class="l-to">Para</span><input type="number" name="to" step="any" value="${esc(val(a.to))}"></label>
        <label class="field g-unit"><span>Unidade</span><input name="unit" maxlength="20" value="${esc(a.unit || '')}"></label>
        <label class="field g-period"><span>Prazo</span><select name="period">${options([['semana', 'Por semana'], ['mes', 'Por mês'], ['total', 'Longo prazo']], goalPeriod(a))}</select></label>
      </div>
      <label class="field g-deadline"><span>Até</span><input type="date" name="deadline" value="${esc(a.deadline || '')}"></label>
      <div class="g-objetivo"><span class="fieldset-label">Etapas</span>
        <div style="margin-top:6px">${listEditor('objectives', a.objectives || [], { addLabel: 'Adicionar etapa' })}</div></div>
      <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(a.notes)}</textarea></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const el = form.elements;
      let lastKind = kind;
      const sync = () => {
        const k = GOAL_KINDS[el.kind.value], custom = el.kind.value === 'outra';
        const t = el.goalType.value;
        const total = t === 'objetivo' || el.period.value === 'total';
        const valor = t === 'quantidade' && total && el.track.value === 'valor';
        $('.g-custom', form).hidden = !custom;
        $('.g-track', form).hidden = !(t === 'quantidade' && total);
        $('.g-period', form).hidden = t === 'objetivo' || !!k.fixedPeriod;
        $$('.g-vezes', form).forEach(x => { x.hidden = t !== 'vezes'; });
        $$('.g-tempo', form).forEach(x => { x.hidden = t !== 'tempo'; });
        $('.g-soma', form).hidden = t !== 'quantidade' || valor;
        $$('.g-valor', form).forEach(x => { x.hidden = !valor; });
        $('.g-unit', form).hidden = t !== 'quantidade' || !custom;
        $('.g-deadline', form).hidden = !total;
        $('.g-objetivo', form).hidden = t !== 'objetivo';
        const unit = el.unit.value.trim();
        $('.l-vezes', form).textContent = k.timesLabel || 'Vezes';
        $('.l-soma', form).textContent = custom || !unit ? 'Quanto' : unit.length < 4 ? `Quanto (${unit})` : cap(unit);
        $('.l-from', form).textContent = k.fromLabel || 'De';
        $('.l-to', form).textContent = k.toLabel || 'Para';
      };
      // Trocar o tipo preenche medida, prazo e unidade; o nome só se ainda for o padrão.
      el.kind.addEventListener('change', () => {
        const k = GOAL_KINDS[el.kind.value];
        if (k.preset) {
          el.goalType.value = k.preset.goalType;
          el.period.value = k.preset.period;
          el.track.value = k.preset.track || 'soma';
          el.unit.value = k.preset.unit || '';
          if (k.preset.goalType === 'vezes') el.times.value = k.preset.target;
          if (k.preset.goalType === 'quantidade' && k.preset.track !== 'valor') el.amount.value = k.preset.target;
          if (k.preset.goalType === 'tempo') { el.h.value = Math.floor(k.preset.target / 60); el.m.value = k.preset.target % 60; }
        }
        if (!el.name.value.trim() || el.name.value === GOAL_KINDS[lastKind].name) el.name.value = k.name || '';
        if (isNew) el.areaId.value = k.area ? kindAreaId(el.kind.value) : state.goalArea || Store.data.areas[0].id;
        lastKind = el.kind.value;
        sync();
      });
      ['goalType', 'period', 'track'].forEach(n => el[n].addEventListener('change', sync));
      el.unit.addEventListener('input', sync);
      sync();
    },
    onSubmit(form) {
      const f = formData(form);
      const k = GOAL_KINDS[f.kind];
      const period = f.goalType === 'objetivo' ? 'total' : f.period;
      const track = f.goalType === 'quantidade' && period === 'total' ? f.track : 'soma';
      let target = 0, from, to;
      if (f.goalType === 'vezes') target = Math.min(f.kind === 'dieta' ? 7 : 9999, Math.max(1, +f.times || 1));
      if (f.goalType === 'tempo') target = (+f.h || 0) * 60 + (+f.m || 0);
      if (f.goalType === 'tempo' && !target) return formError(form, 'Falta o tempo.');
      if (f.goalType === 'quantidade' && track === 'soma') {
        target = +f.amount || 0;
        if (target <= 0) return formError(form, 'Falta quanto.');
      }
      if (track === 'valor') {
        if (f.from === '') return formError(form, f.kind === 'peso' ? 'Falta o peso atual.' : 'Falta de onde parte.');
        if (f.to === '') return formError(form, f.kind === 'peso' ? 'Falta o peso que quer.' : 'Falta aonde quer chegar.');
        from = +f.from; to = +f.to;
      }
      let name = f.name.trim();
      if (f.kind === 'peso' && (!name || name === k.name)) name = to > from ? 'Ganhar peso' : to < from ? 'Perder peso' : 'Manter o peso';
      if (!name) return formError(form, 'Falta o nome.');
      const objectives = readList(form, 'objectives');
      if (f.goalType === 'objetivo' && !objectives.length) return formError(form, 'Falta pelo menos uma etapa.');
      let areaId = f.areaId;
      if (areaId.startsWith('new:')) {
        const name = areaId.slice(4);
        areaId = uid();
        Store.upsert('areas', { id: areaId, name, color: SWATCHES[(Store.data.areas.length * 3) % SWATCHES.length] });
      }
      Object.assign(a, {
        kind: f.kind, name, areaId, goalType: f.goalType, target, period, track, from, to,
        unit: f.goalType === 'quantidade' ? f.unit.trim() : '',
        deadline: period === 'total' ? f.deadline : '',
        startDate: a.startDate || today(),
        objectives, notes: f.notes.trim(),
      });
      Store.upsert('activities', a);
      closeModal();
      render();
      toast(isNew ? 'Meta criada' : 'Meta atualizada');
    },
    onDelete: async () => {
      if (!await confirmDelete(`“${a.name}” e seus registros`)) return;
      Store.removeWhere('activityLogs', l => l.activityId === a.id);
      Store.remove('activities', a.id);
      closeModal();
      render();
      toast('Meta excluída');
    },
  });
}

function logForm(a) {
  const qtd = a.goalType === 'quantidade', valor = tracksValue(a);
  const unit = a.unit ? ` (${esc(a.unit)})` : '';
  const amountField = qtd ? `<label class="field xs"><span>${valor ? 'Valor atual' : 'Quanto'}${unit}</span><input type="number" name="amount" step="any" ${valor ? '' : 'min="0"'} autofocus value="${valor ? esc(String(goalProgress(a).value)) : ''}"></label>` : '';
  const timeFields = qtd ? '' : `<label class="field xs"><span>Horas</span><input type="number" name="h" min="0" max="24" ${a.goalType === 'tempo' ? 'autofocus' : ''} placeholder="0"></label>
        <label class="field xs"><span>Minutos</span><input type="number" name="m" min="0" max="59" placeholder="0"></label>`;
  openModal(`<form novalidate>
    ${modalHead(`${valor ? goalKind(a).log || 'Atualizar' : 'Registrar'} · ${a.name}`)}
    <div class="modal-body">
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
        ${amountField}${timeFields}
      </div>
      <label class="field"><span>Nota</span><input name="note" maxlength="140"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, valor ? 'Salvar' : 'Registrar')}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (!f.date) return formError(form, 'Falta a data.');
      if (qtd) {
        if (f.amount === '' || (!valor && +f.amount <= 0)) return formError(form, valor ? 'Falta o valor.' : 'Falta quanto.');
        addLog(a, { date: f.date, amount: +f.amount, note: f.note.trim() });
      } else {
        const minutes = (+f.h || 0) * 60 + (+f.m || 0);
        if (a.goalType === 'tempo' && !minutes) return formError(form, 'Falta o tempo.');
        addLog(a, { date: f.date, minutes, note: f.note.trim() });
      }
      closeModal();
    },
  });
}

function addLog(a, { date, minutes = 0, amount, note = '' }) {
  const log = { id: uid(), activityId: a.id, date, minutes, count: 1, note };
  if (amount != null) log.amount = amount;
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
  'plus-one': el => { const a = Store.get('activities', el.dataset.id); if (a) addLog(a, { date: today(), amount: 1 }); },
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
    if (a.objectives.every(x => x.done)) toast(`Todas as etapas de “${a.name}” concluídas!`);
  },
});
