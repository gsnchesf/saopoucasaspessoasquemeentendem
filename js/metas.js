'use strict';
/* ==========================================================
   Metas: objetivos agrupados em áreas (corpo, leitura…). A
   pessoa escreve a meta do jeito dela ("treinar 3x por semana",
   "perder 5 kg até dezembro") e parseGoal preenche os campos,
   que continuam ajustáveis. Cada meta mede (goalType):
   - tempo:       minutos
   - vezes:       quantas vezes
   - quantidade:  número com unidade (páginas, km, livros, kg)
   - objetivo:    etapas para marcar, ou só "Concluí" sem etapas
   num prazo (period): por dia, semana, mês ou longo prazo
   ('total', com data opcional em deadline, contada a partir de
   startDate). Quantidade de longo prazo soma os registros ou
   acompanha um valor (track 'valor', de `from` até `to` — ex.:
   peso de 70 a 75 kg, cada registro é o valor do dia).
   ========================================================== */

const activitiesList = () => Store.data.activities.filter(a => !a.archived)
  .sort((a, b) => (area(a.areaId)?.name || '').localeCompare(area(b.areaId)?.name || '') || a.name.localeCompare(b.name));
const logsOf = id => Store.data.activityLogs.filter(l => l.activityId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

const num = v => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const goalPeriod = a => a.goalType === 'objetivo' ? 'total' : a.period || 'semana';
const isLongTerm = a => goalPeriod(a) === 'total';
const tracksValue = a => a.goalType === 'quantidade' && isLongTerm(a) && a.track === 'valor';
const isSimple = a => a.goalType === 'objetivo' && !(a.objectives || []).length;
const isWeight = a => tracksValue(a) && /^(kg|quilos?|kilos?)$/i.test(a.unit || '');
/** Tem ritmo a acompanhar: meta por período ou de longo prazo com data. */
const hasPace = a => !isLongTerm(a) || !!a.deadline;

/** Valor na medida da meta: "2h", "3×", "20 páginas". */
function amountText(a, v) {
  if (a.goalType === 'tempo') return fmtDuration(v);
  if (a.goalType === 'vezes') return `${num(v)}×`;
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
  if (isSimple(a)) return until;
  if (a.goalType === 'objetivo') return [plural(a.objectives.length, 'etapa', 'etapas'), until].filter(Boolean).join(' ');
  if (tracksValue(a)) return [`de ${amountText(a, a.from)} para ${amountText(a, a.to)}`, until].filter(Boolean).join(' ');
  return `${amountText(a, a.target)} ${isLongTerm(a) ? until || 'no total' : `por ${PERIODS[goalPeriod(a)]}`}`;
}

function goalProgress(a) {
  const period = goalPeriod(a);
  let value, target, p, left;
  if (isSimple(a)) {
    value = a.done ? 1 : 0; target = 1; p = value; left = 1 - value;
  } else if (a.goalType === 'objetivo') {
    const o = a.objectives;
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
    status = today() > to ? 'Prazo passou' : isSimple(a) ? '' : p >= elapsed ? 'No ritmo' : 'Abaixo do ritmo';
  }
  const steps = a.goalType === 'objetivo';
  return {
    value, target, p, left, status, period,
    text: isSimple(a) ? (a.done ? 'Concluída' : 'A fazer') : steps ? `${value} de ${target}` : amountText(a, value),
    leftText: steps ? plural(left, 'etapa', 'etapas') : amountText(a, left),
    targetText: steps ? '' : amountText(a, target),
  };
}

/** Registro de hoje feito pelo "Fiz hoje" (não conta os que vieram de treino). */
const doneToday = a => Store.data.activityLogs.find(l => l.activityId === a.id && l.date === today() && !l.workoutId);

const statusClass = s => s === 'Meta batida' ? 'ok' : s === 'No ritmo' ? '' : s === 'Prazo passou' ? 'danger' : 'warn';
const onPace = a => ['Meta batida', 'No ritmo'].includes(goalProgress(a).status);

function goalFoot(a, g) {
  const nesta = { dia: 'hoje', semana: 'nesta semana', mes: 'neste mês' }[g.period];
  if (g.p >= 1) return isLongTerm(a) ? 'Concluída.' : `Concluída ${nesta}.`;
  if (isSimple(a)) return a.deadline ? `Prazo ${untilLabel(a.deadline)}.` : '';
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
  const foot = goalFoot(a, g);
  let main;
  if (isSimple(a)) {
    main = `${badge ? `<div class="goal-progress"><span></span>${badge}</div>` : ''}${foot ? `<p class="desc" style="margin:0">${esc(foot)}</p>` : ''}`;
  } else if (a.goalType === 'objetivo') {
    main = `<div class="goal-progress"><span><b>${g.value}</b> de ${g.target}</span>${badge}</div>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      ${a.deadline && g.p < 1 ? `<p class="desc" style="margin:0">${esc(foot)}</p>` : ''}
      <div class="list">${a.objectives.map(o => `<div class="task ${o.done ? 'done' : ''}">
        <button class="checkbox ${o.done ? 'on' : ''}" data-action="toggle-objective" data-id="${id}" data-obj="${esc(o.id)}" role="checkbox" aria-checked="${!!o.done}" aria-label="${esc(o.text)}"></button>
        <span class="task-main"><span class="task-title">${esc(o.text)}</span></span></div>`).join('')}</div>`;
  } else {
    main = `<div class="goal-progress"><span><b>${esc(g.text)}</b> ${tracksValue(a) ? '→' : 'de'} ${esc(g.targetText)}</span>${badge}</div>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
      <p class="desc" style="margin:0">${esc(foot)}</p>`;
  }
  const btn = (action, label, ico, primary = true, extra = '') =>
    `<button class="btn btn-sm ${primary ? 'btn-primary' : ''}" data-action="${action}" data-id="${id}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`;
  let buttons = '';
  if (isSimple(a)) buttons = a.done ? btn('toggle-goal-done', 'Concluída', 'check', false, 'aria-pressed="true"') : btn('toggle-goal-done', 'Concluí', 'check');
  else if (a.goalType === 'tempo') buttons = btn('log-activity', 'Registrar tempo', 'clock');
  else if (a.goalType === 'vezes') {
    buttons = (doneToday(a) ? btn('quick-log', 'Fiz hoje', 'check', false, 'aria-pressed="true" title="Clique para desmarcar"') : btn('quick-log', 'Fiz hoje', 'plus'))
      + btn('log-activity', 'Detalhes', '', false);
  } else if (tracksValue(a)) buttons = btn('log-activity', isWeight(a) ? 'Anotar peso' : 'Atualizar', 'edit');
  else if (a.goalType === 'quantidade') {
    // Metas de longo prazo com poucas unidades inteiras (livros, cursos) ganham o "+1" direto.
    buttons = (isLongTerm(a) && Number.isInteger(+a.target) && a.target <= 50 ? btn('plus-one', '+1', '', true) + btn('log-activity', 'Registrar', '', false) : btn('log-activity', 'Registrar', 'plus'));
  }
  const sub = [`<span class="pill" style="--c:${esc(color)}">${esc(ar?.name || 'Sem área')}</span>`, esc(goalText(a))].filter(Boolean).join(' · ');
  return `<article class="card goal-card">
    <div class="goal-top">
      <div class="goal-title"><span class="goal-emoji sm" style="--c:${esc(color)}" aria-hidden="true">${goalEmoji(a)}</span>
        <div><h3>${esc(a.name)}</h3><p class="sub">${sub}</p></div></div>
      <button class="icon-btn ghost sm" data-action="edit-activity" data-id="${id}" aria-label="Editar ${esc(a.name)}">${icon('edit')}</button>
    </div>
    ${a.why ? `<p class="goal-why">${esc(a.why)}</p>` : ''}
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
      <span class="top"><span>${goalEmoji(a)} ${esc(a.name)}</span><span>${esc(a.goalType === 'objetivo' ? g.text : `${g.text} / ${g.targetText}`)}</span></span>
      ${meter(g.p, g.p >= 1 ? 'ok' : '', color)}
    </a>`;
  }).join('')}</div>`;
}

/* ---------- Tela ---------- */

screens.metas = () => {
  const areas = Store.data.areas;
  const sel = state.goalArea;
  const list = activitiesList().filter(a => !sel || a.areaId === sel);
  const paced = activitiesList().filter(a => hasPace(a) && !isSimple(a));
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

/* ---------- Entender o que a pessoa escreveu ---------- */

const NUM_WORDS = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30 };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const STOPWORDS = new Set(['eu', 'quero', 'meta', 'de', 'do', 'da', 'por', 'em', 'a', 'o', 'os', 'as', 'no', 'na', 'e', 'ate', 'pra', 'para', 'cada', 'todo', 'toda', 'com']);
/** Áreas que a meta sugere; Corpo também acha Fitness e Saúde. */
const GOAL_AREAS = [
  { name: 'Corpo', aliases: ['corpo', 'fitness', 'saude'], re: /trein|academia|muscula|corr|caminh|nada|natac|pedal|bike|yoga|pilates|alonga|peso|\bkg\b|quilo|emagrec|engord|dieta|agua|dormir|sono|passos|abdomin|flex|lutar|futebol|esporte/ },
  { name: 'Leitura', aliases: ['leitura', 'livros'], re: /\bler\b|leitura|livro|pagina/ },
];
const parseNum = s => +String(s).replace(',', '.');

function goalAreaId(text) {
  const t = norm(text);
  const g = GOAL_AREAS.find(x => x.re.test(t));
  if (!g) return '';
  return Store.data.areas.find(a => g.aliases.includes(norm(a.name)))?.id || `new:${g.name}`;
}

function deadlineOf(m, kind) {
  const t = today();
  if (kind === 'data') {
    let y = m[3] ? +m[3] : +t.slice(0, 4);
    if (y < 100) y += 2000;
    const d = `${y}-${pad(+m[2])}-${pad(+m[1])}`;
    return !m[3] && d < t ? `${y + 1}${d.slice(4)}` : d;
  }
  if (kind === 'mes') {
    const mi = MONTHS.indexOf(m[1]);
    let y = m[2] ? +m[2] : +t.slice(0, 4);
    if (!m[2] && mi + 1 < +t.slice(5, 7)) y++;
    return addDays(addMonths(`${y}-${pad(mi + 1)}-01`, 1), -1);
  }
  if (kind === 'ano') return `${t.slice(0, 4)}-12-31`;
  const n = +m[1], u = m[2];
  if (u.startsWith('dia')) return addDays(t, n);
  if (u.startsWith('semana')) return addDays(t, n * 7);
  if (u.startsWith('mes')) return addMonths(t, n);
  return addMonths(t, n * 12);
}

/** "treinar 3x por semana" → { name: 'Treinar', goalType: 'vezes', target: 3, period: 'semana', areaId }. */
function parseGoal(raw) {
  const words = raw.toLowerCase().split(/[^\p{L}\d]+/u).filter(Boolean);
  const orig = w => words.find(x => norm(x) === w) || w;
  let s = ` ${norm(raw).replace(/×/g, 'x').replace(/(\d)\s*,\s*(\d)/g, '$1.$2')} `
    .replace(/\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta)\b/g, w => NUM_WORDS[w]);
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  const g = { areaId: goalAreaId(raw) };
  let m, nameFrom;
  const N = '(\\d+(?:\\.\\d+)?)';

  if ((m = cut(/\b(?:ate|em) (?:o )?(?:dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) g.deadline = deadlineOf(m, 'data');
  else if ((m = cut(/\bate (?:o )?(?:fim |final )?(?:de )?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*(?: de (\d{4}))?/))) g.deadline = deadlineOf(m, 'mes');
  else if ((m = cut(/\b(?:ate o (?:fim|final) do ano|(?:n?es[st]e|no) ano)\b/))) g.deadline = deadlineOf(m, 'ano');
  else if ((m = cut(/\bem (\d+) (dias?|semanas?|mes|meses|anos?)\b/))) g.deadline = deadlineOf(m, 'prazo');

  if (cut(/(?:\b(?:por|ao|cada|todo|todos os)|\/) ?dias?\b|\bdiari\w*/)) g.period = 'dia';
  else if (cut(/(?:\b(?:por|na|cada|toda|todas as)|\/) ?semanas?\b|\bsemana\w*/)) g.period = 'semana';
  else if (cut(/(?:\b(?:por|no|cada|todo)|\/) ?mes\b|\bmensa\w*/)) g.period = 'mes';

  if ((m = cut(new RegExp(`\\bde ${N} ?([a-z]*) (?:para|pra|ate|a) ${N} ?([a-z]*)`)))) {
    Object.assign(g, { goalType: 'quantidade', track: 'valor', from: parseNum(m[1]), to: parseNum(m[3]), unit: orig(m[4] || m[2]) });
  } else if ((m = s.match(new RegExp(`\\b(perder|emagrecer|secar|baixar|reduzir|ganhar|engordar|subir|aumentar)\\b(?:.*?)${N} ?(kg|quilos?|kilos?)\\b`)))) {
    const delta = parseNum(m[2]) * (/^(ganhar|engordar|subir|aumentar)$/.test(m[1]) ? 1 : -1);
    Object.assign(g, { goalType: 'quantidade', track: 'valor', delta, unit: 'kg' });
    nameFrom = `${cap(orig(m[1]))} ${num(Math.abs(delta))} kg`;
  } else if ((m = cut(new RegExp(`\\bchegar (?:a|aos?|em|nos?) ${N} ?(kg|quilos?|kilos?)?`)))) {
    Object.assign(g, { goalType: 'quantidade', track: 'valor', to: parseNum(m[1]), unit: m[2] ? 'kg' : '' });
  } else if ((m = cut(new RegExp(`${N} ?(?:h|horas?)(?: ?e? ?(\\d+) ?(?:min\\w*)?| e meia)?(?![a-z])|(\\d+) ?min\\w*`)))) {
    const minutes = m[3] ? +m[3] : Math.round(parseNum(m[1]) * 60 + (m[2] ? +m[2] : /e meia/.test(m[0]) ? 30 : 0));
    Object.assign(g, { goalType: 'tempo', target: minutes });
  } else if ((m = cut(/(\d+) ?(?:x|vezes|vez)(?![a-z])/))) {
    Object.assign(g, { goalType: 'vezes', target: +m[1] });
  } else if ((m = cut(/(\d+) ?dias?\b/))) {
    Object.assign(g, { goalType: 'vezes', target: +m[1] });
  } else if ((m = s.match(new RegExp(`${N} ?([a-z]+)?`)))) {
    // Unidade curta (km) sai do nome; palavra fica ("Ler páginas"), a não ser que venha "de": "Beber água".
    const unit = m[2] && !STOPWORDS.has(m[2]) ? m[2] : '';
    const de = unit && s.includes(`${m[0]} de `);
    s = s.replace(de ? `${m[0]} de ` : m[0], unit.length > 3 && !de ? ` ${unit} ` : ' ');
    Object.assign(g, { goalType: 'quantidade', target: parseNum(m[1]), unit: orig(unit) });
  } else g.goalType = 'objetivo';

  if (!g.period) g.period = g.goalType === 'vezes' || g.goalType === 'tempo' ? (g.deadline ? 'total' : 'semana') : 'total';
  if (g.track === 'valor') g.period = 'total';

  const rest = s.split(/\s+/).filter(Boolean);
  while (rest.length && STOPWORDS.has(rest[0])) rest.shift();
  while (rest.length && STOPWORDS.has(rest[rest.length - 1])) rest.pop();
  g.name = nameFrom || cap(rest.map(orig).join(' ')) || (g.unit === 'kg' ? 'Peso' : '');
  return g;
}

/* ---------- Formulários ----------
   Criação no jeito de Stride/TickTick/Go Dreams: ícone e nome grandes,
   sugestões que preenchem tudo, escolhas em botões, meta com − e +,
   e um "por quê" para lembrar o motivo. O nome também é lido
   (parseGoal), então "ler 20 páginas por dia" já ajusta o resto. */

const GOAL_EMOJIS = ['🎯', '🏋️', '🏃', '⚖️', '🥗', '💧', '😴', '🧘', '📖', '📚', '🗣️', '💰', '💻', '✍️', '🎸', '🎨', '🌱', '🧹', '🍳', '🚭', '📵', '❤️', '🙏', '⭐'];
const EMOJI_HINTS = [
  [/trein|academia|muscula/, '🏋️'], [/corr|caminh|passos/, '🏃'], [/peso|\bkg\b|quilo|emagrec|engord/, '⚖️'], [/dieta|comer|alimenta/, '🥗'],
  [/agua/, '💧'], [/dorm|sono/, '😴'], [/medit|respira|yoga/, '🧘'], [/livro/, '📚'], [/\bler\b|leitura|pagina/, '📖'],
  [/ingles|idioma|espanhol|frances|lingua/, '🗣️'], [/dinheiro|reais|guardar|juntar|econom|invest/, '💰'], [/estud|curso|program|codigo/, '💻'],
  [/escrev|diario/, '✍️'], [/violao|guitarra|piano|music|tocar/, '🎸'], [/desenh|pint|arte/, '🎨'], [/fum|cigarro/, '🚭'],
  [/celular|tela|redes/, '📵'], [/limp|arrum|casa/, '🧹'], [/cozinh|receita/, '🍳'],
];
const guessEmoji = text => EMOJI_HINTS.find(([re]) => re.test(norm(text)))?.[1] || '';
const goalEmoji = a => a.icon || guessEmoji(a.name) || '🎯';

/** Sugestões prontas: um toque preenche a meta inteira. */
const GOAL_IDEAS = [
  ['Corpo', [
    { icon: '🏋️', name: 'Treinar', measure: 'vezes', target: 3, period: 'semana' },
    { icon: '⚖️', name: 'Perder peso', measure: 'valor', unit: 'kg', delta: -5, due: '3m' },
    { icon: '🥗', name: 'Seguir a dieta', measure: 'vezes', target: 5, period: 'semana' },
    { icon: '🏃', name: 'Correr', measure: 'quantidade', target: 10, unit: 'km', period: 'semana' },
    { icon: '💧', name: 'Beber água', measure: 'quantidade', target: 2, unit: 'litros', period: 'dia' },
    { icon: '😴', name: 'Dormir bem', measure: 'tempo', target: 480, period: 'dia' },
  ]],
  ['Mente', [
    { icon: '📖', name: 'Ler', measure: 'quantidade', target: 20, unit: 'páginas', period: 'dia' },
    { icon: '📚', name: 'Terminar livros', measure: 'quantidade', target: 12, unit: 'livros', period: 'total', due: 'ano' },
    { icon: '🧘', name: 'Meditar', measure: 'tempo', target: 10, period: 'dia' },
    { icon: '🗣️', name: 'Estudar inglês', measure: 'tempo', target: 120, period: 'semana' },
  ]],
  ['Vida', [
    { icon: '💰', name: 'Juntar dinheiro', measure: 'quantidade', target: 1000, unit: 'reais', period: 'total', due: '3m' },
    { icon: '🎯', label: 'Concluir algo', name: '', measure: 'concluir', due: 'none' },
  ]],
];

const measureOf = a => tracksValue(a) ? 'valor' : a.goalType === 'objetivo' ? 'concluir' : a.goalType;

function dueDate(due, date) {
  const t = today();
  return { '1m': addMonths(t, 1), '3m': addMonths(t, 3), ano: `${t.slice(0, 4)}-12-31`, data: date || '' }[due] || '';
}

/** "1h30", "45", "2 horas" → minutos. */
function parseDuration(s) {
  const t = norm(s).replace(',', '.');
  const m = t.match(/(\d+(?:\.\d+)?)\s*h\w*\s*(?:e\s*)?(\d+)?/);
  if (m) return Math.round(+m[1] * 60 + (+m[2] || 0));
  const n = t.match(/\d+/);
  return n ? +n[0] : 0;
}

function activityForm(a) {
  if (!Store.data.areas.length) Store.upsert('areas', { id: uid(), name: 'Geral', color: SWATCHES[0] });
  const isNew = !a;
  a = a ? structuredClone(a) : { id: uid(), name: '', icon: '', areaId: state.goalArea || Store.data.areas[0].id, goalType: 'vezes', target: 3, period: 'semana', unit: '', track: 'soma', deadline: '', objectives: [], why: '', notes: '' };
  const m = measureOf(a);
  const newAreas = GOAL_AREAS.filter(g => !Store.data.areas.some(x => g.aliases.includes(norm(x.name))));
  const chips = (name, list, sel) => `<div class="day-toggles choice">${list.map(([v, l]) =>
    `<label><input type="radio" name="${name}" value="${esc(v)}" ${v === sel ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const stepper = (name, value, attrs) => `<div class="stepper">
    <button type="button" class="icon-btn" data-step="-1" data-for="${name}" aria-label="Menos">−</button>
    <input name="${name}" value="${esc(value)}" ${attrs}>
    <button type="button" class="icon-btn" data-step="1" data-for="${name}" aria-label="Mais">+</button></div>`;
  const areaChips = chips('areaId', [
    ...Store.data.areas.map(x => [x.id, `<i style="--c:${esc(x.color)}"></i>${esc(x.name)}`]),
    ...newAreas.map(g => [`new:${g.name}`, `<i style="--c:var(--muted)"></i>${esc(g.name)}`]),
  ], a.areaId);
  const ideas = GOAL_IDEAS.map(([group, list]) => `<div><span class="fieldset-label">${group}</span><div class="idea-row">
    ${list.map((it, i) => `<button type="button" class="idea" data-idea="${group}:${i}"><span aria-hidden="true">${it.icon}</span>${esc(it.label || it.name)}</button>`).join('')}</div></div>`).join('');
  const val = v => v == null ? '' : v;

  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Nova meta' : 'Editar meta')}
    <div class="modal-body">
      <div class="goal-hero">
        <button type="button" class="goal-emoji" data-emoji-toggle aria-label="Trocar ícone">${goalEmoji(a)}</button>
        <input type="hidden" name="icon" value="${esc(a.icon || '')}">
        <div class="goal-hero-main">
          <input class="goal-name" name="name" maxlength="80" value="${esc(a.name)}" autocomplete="off" aria-label="Meta" ${isNew ? 'autofocus' : ''}>
          <p class="goal-preview" aria-live="polite"></p>
        </div>
      </div>
      <div class="emoji-grid" hidden>${GOAL_EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
      ${isNew ? `<div class="goal-ideas">${ideas}</div>` : ''}
      <div class="goal-setup">
        <section class="goal-sec"><span class="fieldset-label">Como medir</span>
          ${chips('measure', [['vezes', 'Vezes'], ['tempo', 'Tempo'], ['quantidade', 'Quantidade'], ['valor', 'Chegar a um valor'], ['concluir', 'Concluir']], m)}</section>
        <section class="goal-sec m-vezes"><span class="fieldset-label">Meta</span><div class="target-row">
          ${stepper('times', a.goalType === 'vezes' ? a.target : 3, 'type="number" min="1" inputmode="numeric" aria-label="Quantas"')}
          <span class="unit-word">vezes</span></div></section>
        <section class="goal-sec m-tempo"><span class="fieldset-label">Meta</span><div class="target-row">
          ${stepper('duration', fmtDuration(a.goalType === 'tempo' ? a.target : 30), 'inputmode="text" aria-label="Tempo"')}</div></section>
        <section class="goal-sec m-qtd"><span class="fieldset-label">Meta</span><div class="target-row">
          ${stepper('amount', a.goalType === 'quantidade' && !tracksValue(a) ? a.target : 10, 'type="number" min="0" step="any" inputmode="decimal" aria-label="Quanto"')}
          <input class="unit-input" name="unit" maxlength="20" value="${esc(tracksValue(a) ? '' : a.unit || '')}" aria-label="Unidade"></div></section>
        <section class="goal-sec m-valor"><div class="target-row">
          <label class="value-box"><span>Hoje</span><input type="number" name="from" step="any" inputmode="decimal" value="${esc(val(a.from))}"></label>
          <span class="arrow" aria-hidden="true">→</span>
          <label class="value-box"><span>Meta</span><input type="number" name="to" step="any" inputmode="decimal" value="${esc(val(a.to))}"></label>
          <input class="unit-input" name="vunit" maxlength="20" value="${esc(tracksValue(a) ? a.unit || '' : 'kg')}" aria-label="Unidade"></div></section>
        <section class="goal-sec m-concluir"><span class="fieldset-label">Etapas</span>
          ${listEditor('objectives', a.objectives || [], { addLabel: 'Etapa' })}</section>
        <section class="goal-sec m-period"><span class="fieldset-label">Frequência</span>
          ${chips('period', [['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês'], ['total', 'No total']], goalPeriod(a))}</section>
        <section class="goal-sec m-due"><span class="fieldset-label">Prazo</span>
          ${chips('due', [['none', 'Sem data'], ['1m', '1 mês'], ['3m', '3 meses'], ['ano', 'Fim do ano'], ['data', 'Escolher data']], a.deadline ? 'data' : 'none')}
          <input type="date" class="due-date" name="deadline" value="${esc(a.deadline || '')}" aria-label="Data"></section>
        <section class="goal-sec"><span class="fieldset-label">Área</span>${areaChips}</section>
      </div>
      <label class="field"><span>Por quê</span><input name="why" maxlength="140" value="${esc(a.why || '')}"></label>
      ${!isNew || a.notes ? `<label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(a.notes)}</textarea></label>` : ''}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const el = form.elements;
      // Campo mexido à mão não é mais sobrescrito pelo nome nem pelas sugestões de texto.
      const touched = new Set();
      ['input', 'change'].forEach(ev => form.addEventListener(ev, e => { if (e.isTrusted && e.target.name && e.target.name !== 'name') touched.add(e.target.name); }));
      let delta = null;
      const put = (name, v) => { if (!touched.has(name) && v !== undefined && el[name]) el[name].value = v ?? ''; };
      const show = (sel, on) => { $(sel, form).hidden = !on; };
      const sync = () => {
        const m = el.measure.value;
        show('.m-vezes', m === 'vezes');
        show('.m-tempo', m === 'tempo');
        show('.m-qtd', m === 'quantidade');
        show('.m-valor', m === 'valor');
        show('.m-concluir', m === 'concluir');
        show('.m-period', m !== 'valor' && m !== 'concluir');
        show('.m-due', m === 'valor' || m === 'concluir' || el.period.value === 'total');
        el.deadline.hidden = el.due.value !== 'data';
        const ideas = $('.goal-ideas', form);
        if (ideas) ideas.hidden = !!el.name.value.trim();
        const emoji = $('.goal-emoji', form);
        emoji.textContent = el.icon.value || guessEmoji(el.name.value) || '🎯';
        emoji.style.setProperty('--c', area(el.areaId.value)?.color || 'var(--accent)');
        const { goal } = readGoal(form);
        const ar = goal && (area(goal.areaId)?.name || goal.areaId.replace(/^new:/, ''));
        $('.goal-preview', form).textContent = goal
          ? [m === 'valor' && el.from.value === '' ? untilText(goal) : goalText(goal), ar].filter(Boolean).join(' · ')
          : '';
      };
      const followDelta = () => {
        if (delta != null && el.from.value !== '') put('to', Math.round((+el.from.value + delta) * 100) / 100);
      };
      // Ler o nome: só mexe no resto quando ele traz número ou prazo.
      const parsed = () => {
        const p = parseGoal(el.name.value);
        if (p.areaId) put('areaId', p.areaId);
        if (p.goalType === 'objetivo' && !p.deadline) return p;
        const m = p.track === 'valor' ? 'valor' : p.goalType === 'objetivo' ? 'concluir' : p.goalType;
        put('measure', m);
        if (m === 'vezes' || m === 'tempo' || m === 'quantidade') put('period', p.period);
        if (m === 'vezes') put('times', p.target);
        if (m === 'tempo') put('duration', fmtDuration(p.target));
        if (m === 'quantidade') { put('amount', p.target); put('unit', p.unit || ''); }
        if (m === 'valor') {
          put('vunit', p.unit || '');
          if (p.from != null) put('from', p.from);
          if (p.to != null) put('to', p.to);
        }
        delta = p.delta ?? null;
        followDelta();
        if (p.deadline) { put('due', 'data'); put('deadline', p.deadline); }
        p.understood = true;
        return p;
      };
      el.name.addEventListener('input', () => { parsed(); sync(); });
      // Ao sair do campo, "ler 20 páginas por dia" vira só "Ler páginas" (o resto já está nos botões).
      el.name.addEventListener('change', () => {
        const p = parsed();
        if (p.understood && p.name) el.name.value = p.name;
        sync();
      });
      el.from.addEventListener('input', followDelta);
      form.addEventListener('input', e => { if (e.target !== el.name) sync(); });
      form.addEventListener('change', sync);
      form.addEventListener('click', e => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.matches('[data-emoji-toggle]')) {
          const grid = $('.emoji-grid', form);
          grid.hidden = !grid.hidden;
        } else if (t.dataset.emoji) {
          el.icon.value = t.dataset.emoji;
          $('.emoji-grid', form).hidden = true;
          sync();
        } else if (t.dataset.step) {
          const name = t.dataset.for, dir = +t.dataset.step, input = el[name];
          if (name === 'duration') {
            const cur = parseDuration(input.value);
            input.value = fmtDuration(Math.max(5, cur + dir * (cur >= 120 ? 30 : cur >= 30 ? 15 : 5)));
          } else {
            const cur = +input.value || 0;
            const step = name === 'amount' ? (cur >= 100 ? 10 : cur >= 20 ? 5 : 1) : 1;
            input.value = Math.max(name === 'times' ? 1 : 0, Math.round((cur + dir * step) * 100) / 100);
          }
          touched.add(name);
          sync();
        } else if (t.dataset.idea) {
          const [group, i] = t.dataset.idea.split(':');
          const it = GOAL_IDEAS.find(([g]) => g === group)[1][+i];
          touched.clear();
          el.name.value = it.name;
          el.icon.value = it.icon;
          el.measure.value = it.measure;
          if (it.period) el.period.value = it.period;
          if (it.measure === 'vezes') el.times.value = it.target;
          if (it.measure === 'tempo') el.duration.value = fmtDuration(it.target);
          if (it.measure === 'quantidade') { el.amount.value = it.target; el.unit.value = it.unit || ''; }
          if (it.measure === 'valor') { el.vunit.value = it.unit || ''; el.to.value = ''; }
          delta = it.delta ?? null;
          el.due.value = it.due || 'none';
          el.deadline.value = '';
          const ar = goalAreaId(it.name);
          if (ar) el.areaId.value = ar;
          sync();
          (it.measure === 'valor' ? el.from : el.name).focus();
        }
      });
      sync();
    },
    onSubmit(form) {
      const r = readGoal(form);
      if (r.error) return formError(form, r.error);
      let { areaId } = r.goal;
      if (areaId.startsWith('new:')) {
        const name = areaId.slice(4);
        areaId = uid();
        Store.upsert('areas', { id: areaId, name, color: SWATCHES[(Store.data.areas.length * 3) % SWATCHES.length] });
      }
      Object.assign(a, r.goal, { areaId, startDate: a.startDate || today() });
      delete a.kind;
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

/** Lê o formulário de meta: { goal } pronta para salvar e, se faltar algo, { error }. */
function readGoal(form) {
  const f = formData(form);
  const name = f.name.trim();
  if (!name) return { error: 'Falta a meta.' };
  const m = f.measure;
  const goalType = m === 'valor' ? 'quantidade' : m === 'concluir' ? 'objetivo' : m;
  const period = m === 'valor' || m === 'concluir' ? 'total' : f.period;
  let target = 0;
  if (m === 'vezes') target = Math.round(+f.times || 0);
  if (m === 'tempo') target = parseDuration(f.duration);
  if (m === 'quantidade') target = +f.amount || 0;
  const goal = {
    name, icon: f.icon || guessEmoji(name), areaId: f.areaId || '', goalType, target, period,
    track: m === 'valor' ? 'valor' : 'soma',
    unit: { quantidade: f.unit.trim(), valor: f.vunit.trim() }[m] || '',
    deadline: period === 'total' ? dueDate(f.due, f.deadline) : '',
    objectives: m === 'concluir' ? readList(form, 'objectives') : [],
    why: f.why.trim(), notes: (f.notes || '').trim(),
  };
  if (m === 'valor') {
    goal.from = f.from === '' ? undefined : +f.from;
    goal.to = f.to === '' ? undefined : +f.to;
    if (goal.from === undefined) return { goal, error: 'Falta o valor de hoje.' };
    if (goal.to === undefined) return { goal, error: 'Falta aonde quer chegar.' };
  }
  if (m === 'vezes' && target < 1) return { goal, error: 'Falta quantas vezes.' };
  if (m === 'tempo' && !target) return { goal, error: 'Falta o tempo.' };
  if (m === 'quantidade' && target <= 0) return { goal, error: 'Falta quanto.' };
  if (period === 'total' && f.due === 'data' && !f.deadline) return { goal, error: 'Falta a data.' };
  return { goal };
}

function logForm(a) {
  const qtd = a.goalType === 'quantidade', valor = tracksValue(a);
  const unit = a.unit ? ` (${esc(a.unit)})` : '';
  const amountField = qtd ? `<label class="field xs"><span>${valor ? 'Hoje' : 'Quanto'}${unit}</span><input type="number" name="amount" step="any" ${valor ? '' : 'min="0"'} autofocus value="${valor ? esc(String(goalProgress(a).value)) : ''}"></label>` : '';
  const timeFields = qtd ? '' : `<label class="field xs"><span>Horas</span><input type="number" name="h" min="0" max="24" ${a.goalType === 'tempo' ? 'autofocus' : ''} placeholder="0"></label>
        <label class="field xs"><span>Minutos</span><input type="number" name="m" min="0" max="59" placeholder="0"></label>`;
  openModal(`<form novalidate>
    ${modalHead(`${valor ? (isWeight(a) ? 'Anotar peso' : 'Atualizar') : 'Registrar'} · ${a.name}`)}
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
  'toggle-goal-done': el => {
    const a = Store.get('activities', el.dataset.id);
    if (!a) return;
    a.done = !a.done;
    Store.upsert('activities', a);
    render();
    if (a.done) toast(`“${a.name}” concluída!`);
  },
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
