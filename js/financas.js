'use strict';
/* ==========================================================
   Finanças: saldo da conta e do VR na hora, entradas e gastos
   fixos agendados (salário, adiantamento, VR, aluguel…), gastos
   no débito, Pix, dinheiro, VR ou crédito (crédito vai para a
   fatura certa, com parcelas), meta de poupança e o orçamento
   dos Eventos da agenda como gasto previsto.

   settings.finance: { setup, start, balance, vr,
     cards: [{ id, name, close, due, limit, open, openDue }], save: { initial, monthly, day, target, deadline, skips } }
     (o antigo `card: { on, close, due, open }` é lido como um cartão só, id 'card')
   recurring: { id, dir: 'in' | 'out', kind, name, amount, method, card, category,
     freq: 'mes' | 'semana' | 'ano', day, business, last, weekday, date, start, end, skips: [data],
     daily,  ← só no VR: amount é por dia, vezes os dias de trabalho do mês seguinte
     advance: { amount, day, skips } }  ← só no salário: parte paga antes (o resto cai no dia do salário)
   transactions: { id, dir: 'in' | 'out' | 'save' | 'unsave' | 'card' | 'adjust', name, amount,
     date, kind, method, card, category, parts, fixedId, occ, eventId, eventDate, due, full, wallet }
   Sem `card`, crédito e pagamento de fatura são do primeiro cartão. `parts` vale em qualquer
   pagamento: no crédito vai para as faturas, nos outros sai da conta uma parcela por mês.
   `start` do fixo é o dia em que foi criado; `end` é antigo e some ao editar.
   shopping: { id, text, done, budget, date }  ← lista de compras, no card da tela (orçamento e data opcionais)

   O saldo informado no começo vale para o dia `start`: lançamentos a partir
   desse dia contam; fixos começam no dia seguinte. Fixos, faturas e poupança
   entram sozinhos no dia, como uma linha do tempo. Mudar o valor ou a data de
   um dia vira lançamento com `fixedId` + `occ` (ou `occ` na poupança, `due` +
   `full` na fatura); cancelar vai para `skips`. Compra no crédito só sai
   da conta quando a fatura é paga. Gasto ligado a um Evento desconta do
   orçamento previsto dele, sem contar duas vezes.
   ========================================================== */

const FIN_COLOR = '#16a34a';
const PAY = { debito: 'Débito', credito: 'Crédito', pix: 'Pix', dinheiro: 'Dinheiro', vr: 'VR' };
const INCOME = { salario: 'Salário', adiantamento: 'Adiantamento', vr: 'Vale-refeição', outro: 'Outra' };
const FIXED_INCOME = ['salario', 'vr', 'outro']; // adiantamento fica dentro do salário
const SPEND = {
  moradia: ['Moradia', '#6366f1'], contas: ['Contas', '#0ea5e9'], financeiro: ['Financeiro', '#b45309'],
  comida: ['Alimentação', '#f59e0b'], assinaturas: ['Assinaturas', '#f97316'], transporte: ['Transporte', '#64748b'],
  saude: ['Saúde', '#ef4444'], educacao: ['Educação', '#14b8a6'],
  mercado: ['Mercado', '#10b981'], restaurante: ['Restaurante', '#ea580c'], delivery: ['Delivery', '#e11d48'],
  lazer: ['Lazer', '#ec4899'], compras: ['Compras', '#8b5cf6'], roupas: ['Roupas', '#7c3aed'], beleza: ['Beleza', '#db2777'],
  presentes: ['Presentes', '#c026d3'], viagem: ['Viagem', '#0284c7'], casa: ['Casa', '#78716c'],
  eventos: ['Eventos', '#a855f7'], outros: ['Outros', '#94a3b8'],
};
/** Gastos fixos são agrupados em categorias grandes; o nome diz qual é. */
const FIXED_CATS = ['moradia', 'contas', 'financeiro', 'comida', 'assinaturas', 'transporte', 'saude', 'educacao', 'outros'];
const FIXED_NAMES = {
  moradia: ['Aluguel', 'Condomínio', 'Financiamento', 'IPTU', 'Diarista'],
  contas: ['Luz', 'Água', 'Gás', 'Internet', 'Celular'],
  financeiro: ['Empréstimo', 'Juros', 'Consórcio', 'Seguro', 'Tarifa do banco'],
  comida: ['Mercado', 'Feira', 'Marmita'],
  assinaturas: ['Netflix', 'Spotify', 'Prime Video', 'iCloud', 'YouTube Premium'],
  transporte: ['Combustível', 'Metrô', 'Ônibus', 'Estacionamento', 'Seguro do carro', 'IPVA'],
  saude: ['Plano de saúde', 'Academia', 'Terapia', 'Remédios'],
  educacao: ['Faculdade', 'Curso', 'Idiomas'],
  outros: [],
};
/** Gastos do dia a dia, lançados na hora. */
const MOVE_CATS = ['mercado', 'restaurante', 'delivery', 'transporte', 'lazer', 'compras', 'roupas', 'saude', 'beleza', 'presentes', 'viagem', 'casa', 'eventos', 'outros'];
const FREQ = { mes: 'Todo mês', semana: 'Toda semana', ano: 'Todo ano' };
const WHEN = [['dia', 'Dia do mês'], ['util', 'Dia útil']];
const LAST = 'Último', MAX_BUSINESS = 20; // dia útil vai do 1º ao 20º, e o último fecha a volta
const MOVE_TITLE = { out: 'gasto', in: 'entrada', save: 'Guardar', unsave: 'Resgatar', card: 'Pagar fatura', adjust: 'Ajuste de saldo' };
const CARD_COLOR = '#334155';

const fin = () => Store.settings.finance || {};
const finOn = () => !!fin().setup;
const finStart = () => fin().start || today();
const r2 = n => Math.round(n * 100) / 100;
const spendCat = k => SPEND[k] || SPEND.outros;
const fixedCat = f => FIXED_CATS.includes(f.category) ? f.category : f.category === 'mercado' ? 'comida' : 'outros';

function setFin(patch) {
  Store.settings.finance = { ...fin(), ...patch };
  Store.saveSettings(true);
}

/* ---------- Datas ---------- */

const ymOf = d => d.slice(0, 7);
const nextYm = (m, n = 1) => addMonths(`${m}-01`, n).slice(0, 7);
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const monthDay = (m, day) => `${m}-${pad(Math.min(Math.max(1, day), lastDay(m)))}`;
const monthEnd = m => monthDay(m, 31);

/** N-ésimo dia útil (seg–sex) do mês. */
function businessDay(m, n) {
  let d = `${m}-01`, k = 0;
  for (let i = 0; i < 40; i++, d = addDays(d, 1)) {
    const w = weekday(d);
    if (w > 0 && w < 6 && ++k === n) return d;
  }
  return monthEnd(m);
}

function lastBusinessDay(m) {
  let d = monthEnd(m);
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

/** Dias de trabalho do mês: os do expediente, ou seg–sex. */
function workdays(m) {
  const days = workSchedule()?.days || [1, 2, 3, 4, 5];
  let n = 0;
  for (let d = `${m}-01`; d.startsWith(m); d = addDays(d, 1)) if (days.includes(weekday(d))) n++;
  return n;
}

/** Valor de uma ocorrência: VR por dia conta os dias de trabalho do mês seguinte. */
const fixedAmount = (f, d) => f.daily ? r2(f.amount * workdays(nextYm(ymOf(d)))) : f.amount;

/** Datas do fixo entre from e to (só depois do dia em que o saldo foi informado); com `canceled`, só as canceladas. */
function fixedDates(f, from, to, canceled = false) {
  const lo = [from, f.start, addDays(finStart(), 1)].filter(Boolean).sort().at(-1);
  const hi = [to, f.end].filter(Boolean).sort()[0];
  const out = [];
  if (lo > hi) return out;
  if (f.freq === 'semana') {
    for (let d = lo; d <= hi; d = addDays(d, 1)) if (weekday(d) === +f.weekday) out.push(d);
  } else {
    for (let m = ymOf(lo); m <= ymOf(hi); m = nextYm(m)) {
      if (f.freq === 'ano' && m.slice(5) !== (f.date || '').slice(5, 7)) continue;
      const d = f.freq === 'ano' ? monthDay(m, +f.date.slice(8)) : f.last ? lastBusinessDay(m) : f.business ? businessDay(m, +f.day) : monthDay(m, +f.day);
      if (d >= lo && d <= hi) out.push(d);
    }
  }
  return out.filter(d => (f.skips || []).includes(d) === canceled);
}

const fixedWhen = f => f.freq === 'semana' ? `Toda ${WEEKDAYS_LONG[f.weekday].toLowerCase()}`
  : f.freq === 'ano' ? `Todo ano em ${fmt(f.date, { day: 'numeric', month: 'short' })}`
  : f.last ? 'Último dia útil' : f.business ? `${f.day}º dia útil` : `Dia ${f.day}`;
const fixedName = f => f.name || (f.dir === 'in' ? INCOME[f.kind] : spendCat(f.category)[0]);

/** Fixos como acontecem: salário com adiantamento vira duas entradas, o adiantamento e o restante. */
function fixedList() {
  const out = [];
  for (const f of Store.data.recurring) {
    const adv = f.kind === 'salario' && f.advance?.amount > 0 ? f.advance : null;
    if (!adv) { out.push(f); continue; }
    out.push({ ...f, amount: r2(f.amount - adv.amount), rest: true });
    out.push({ ...f, id: `${f.id}:adv`, parent: f.id, kind: 'adiantamento', name: 'Adiantamento', amount: adv.amount,
      freq: 'mes', day: adv.day, business: false, last: false, skips: adv.skips || [] });
  }
  return out;
}
const getFixed = id => fixedList().find(f => f.id === id);

/** Adiantamento cadastrado à parte (antes de ir para dentro do salário) passa a fazer parte dele. */
function migrateAdvance() {
  const a = Store.data.recurring.find(f => f.kind === 'adiantamento');
  const sal = Store.data.recurring.find(f => f.kind === 'salario' && !f.advance);
  if (!a || !sal) return;
  Store.upsert('recurring', { ...structuredClone(sal), amount: r2(sal.amount + a.amount), advance: { amount: a.amount, day: a.day, skips: a.skips || [] } });
  Store.remove('recurring', a.id);
  for (const m of Store.data.transactions.filter(x => x.fixedId === a.id)) Store.upsert('transactions', { ...m, fixedId: `${sal.id}:adv` });
}

/* ---------- Saldos ---------- */

const moves = () => Store.data.transactions.filter(m => m.date >= finStart());

/** Onde o valor mexe: { conta, vr, reserva }. Compra no crédito só mexe quando a fatura é paga. */
function moveEffect(m) {
  const a = m.amount;
  switch (m.dir) {
    case 'in': return m.kind === 'vr' ? { vr: a } : { conta: a };
    case 'out': return m.method === 'credito' ? {} : m.method === 'vr' ? { vr: -a } : { conta: -a };
    case 'card': return { conta: -a };
    case 'save': return { conta: -a, reserva: a };
    case 'unsave': return { conta: a, reserva: -a };
    case 'adjust': return { [m.wallet || 'conta']: a };
  }
  return {};
}
/** Parcelas de um gasto fora do crédito: uma por mês desde o dia da compra (a última leva os centavos que sobram).
    No crédito as parcelas vão para as faturas (ver invoices). */
function moveParts(m) {
  const n = m.dir === 'out' && m.method !== 'credito' ? Math.max(1, +m.parts || 1) : 1;
  if (n === 1) return [{ date: m.date, amount: m.amount, i: 1, n }];
  const each = Math.floor(m.amount / n * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({ date: addMonths(m.date, i), amount: i === n - 1 ? r2(m.amount - each * (n - 1)) : each, i: i + 1, n }));
}
const fixedWallet = f => f.dir === 'in' ? (f.kind === 'vr' ? 'vr' : 'conta') : f.method === 'vr' ? 'vr' : 'conta';

/** Onde um previsto mexe (fixo no crédito só mexe na fatura). */
const pendEffect = p => p.credit ? {} : p.type === 'save' ? { conta: -p.amount, reserva: p.amount } : { [p.wallet]: p.sign * p.amount };

/** Saldos no fim do dia `upTo`: o lançado e os fixos, faturas e poupança que já caíram. */
function balances(upTo = today()) {
  const b = { conta: fin().balance || 0, vr: fin().vr || 0, reserva: fin().save?.initial || 0 };
  const add = e => { for (const k in e) b[k] += e[k]; };
  for (const m of moves()) for (const p of moveParts(m)) if (p.date <= upTo) add(moveEffect({ ...m, amount: p.amount }));
  for (const p of pendings(finStart(), upTo)) if (p.type !== 'event') add(pendEffect(p));
  return b;
}

const doneOcc = () => new Set(Store.data.transactions.filter(m => m.fixedId).map(m => `${m.fixedId}|${m.occ}`));

/* ---------- Cartão de crédito ---------- */

/** Cartões cadastrados (o antigo cartão único vira o primeiro). */
function allCards() {
  const f = fin();
  return f.cards || (f.card?.on ? [{ id: 'card', name: 'Cartão', ...f.card }] : []);
}
const cards = () => allCards().filter(c => c.close && c.due);
const cardOn = () => cards().length > 0;
/** Cartão de uma compra, fixo ou pagamento; sem cartão marcado é o primeiro. */
const itemCard = x => x.card ? cards().find(c => c.id === x.card) : cards()[0];
const payLabel = x => x.method === 'credito' && cards().length > 1 ? itemCard(x)?.name || PAY.credito : PAY[x.method];
const invoiceName = c => cards().length > 1 ? `Fatura ${c.name}` : 'Fatura do cartão';

/** Vencimento da fatura de uma compra feita nesse dia (no dia do fechamento já vai para a próxima). */
function cardDue(c, date) {
  let closing = monthDay(ymOf(date), c.close);
  if (date >= closing) closing = monthDay(nextYm(ymOf(date)), c.close);
  let d = monthDay(ymOf(closing), c.due);
  if (d <= closing) d = monthDay(nextYm(ymOf(closing)), c.due);
  return d;
}
const shiftDue = (c, due, i) => monthDay(nextYm(ymOf(due), i), c.due);
/** Primeiro vencimento a partir do dia (a "próxima fatura" informada no começo). */
function nextDue(c, date) {
  const d = monthDay(ymOf(date), c.due);
  return d >= date ? d : monthDay(nextYm(ymOf(date)), c.due);
}

/** Faturas de cada cartão com vencimento entre from e to: compras (parcelas), fixos no crédito e a fatura informada no começo.
    Com `bought`, só o que foi comprado até esse dia. `items` detalha o que entrou e `pays` os pagamentos. */
function invoices(from, to, bought = to) {
  if (!cardOn()) return [];
  const map = {};
  const add = (c, due, amount, item) => {
    if (!c || due < from || due > to) return;
    const v = map[`${c.id}|${due}`] ||= { card: c, due, amount: 0, items: [] };
    v.amount += amount;
    v.items.push({ ...item, amount: r2(amount) });
  };
  for (const m of moves()) if (m.dir === 'out' && m.method === 'credito' && m.date <= bought) {
    const c = itemCard(m);
    if (!c) continue;
    const n = Math.max(1, +m.parts || 1), first = cardDue(c, m.date);
    for (let i = 0; i < n; i++) add(c, shiftDue(c, first, i), m.amount / n, { name: m.name || spendCat(m.category)[0], date: m.date, color: spendCat(m.category)[1], part: n > 1 ? `${i + 1}/${n}` : '', move: m.id });
  }
  const done = doneOcc();
  for (const f of fixedList()) if (f.dir === 'out' && f.method === 'credito') {
    const c = itemCard(f);
    if (c) for (const d of fixedDates(f, addDays(from, -70), bought < to ? bought : to)) if (!done.has(`${f.id}|${d}`)) add(c, cardDue(c, d), fixedAmount(f, d), { name: fixedName(f), date: d, color: spendCat(f.category)[1], fixed: f.id });
  }
  for (const c of cards()) if (c.open) add(c, c.openDue || nextDue(c, finStart()), c.open, { name: 'Fatura informada', date: finStart(), color: CARD_COLOR });
  return Object.entries(map).sort(([, a], [, b]) => a.due.localeCompare(b.due)).map(([id, v]) => {
    const pays = moves().filter(m => m.dir === 'card' && m.due === v.due && itemCard(m)?.id === v.card.id);
    const paid = pays.reduce((n, m) => n + m.amount, 0);
    // Pagamento com `full` é o valor real da fatura: não sobra resto.
    const left = pays.some(m => m.full) ? 0 : Math.max(0, v.amount - paid);
    return { id, card: v.card, due: v.due, amount: r2(v.amount), paid: r2(paid), left: r2(left),
      items: v.items.sort((a, b) => a.date.localeCompare(b.date)), pays: pays.sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

/** Limite usado: tudo o que já foi comprado e vence depois de hoje, menos o que já foi pago dessas faturas.
    A fatura que vence hoje já conta como paga (entra sozinha na linha do tempo). */
function cardUsed(c) {
  const t = today();
  return r2(invoices(addDays(t, 1), addMonths(t, 26), t).filter(v => v.card.id === c.id).reduce((n, v) => n + v.left, 0));
}

/* ---------- Eventos e poupança ---------- */

/** Quanto já foi gasto num evento (e numa data, se ele se repete). */
const eventSpent = (id, date) => Store.data.transactions
  .filter(m => m.eventId === id && (!date || !m.eventDate || m.eventDate === date)).reduce((n, m) => n + m.amount, 0);

/** Eventos com orçamento de hoje em diante: o que falta gastar entra como gasto previsto no dia. */
function eventBudgets(from, to) {
  const lo = from < today() ? today() : from;
  const out = [];
  if (lo > to) return out;
  for (const ev of Store.data.events) if (ev.budget) for (const d of occurrences(ev, lo, to)) {
    const spent = eventSpent(ev.id, d);
    out.push({ ev, date: d, spent: r2(spent), left: r2(Math.max(0, ev.budget - spent)) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Dias da poupança do mês ainda não lançados (ou só os cancelados). */
function saveDates(from, to, canceled = false) {
  const s = fin().save || {};
  if (!s.monthly || !s.day) return [];
  const done = new Set(moves().filter(m => m.dir === 'save' && m.occ).map(m => m.occ));
  return fixedDates({ freq: 'mes', day: s.day, skips: s.skips }, from, to, canceled).filter(d => !done.has(d));
}

/* ---------- Linha do tempo ---------- */

const fixedMeta = f => f.dir === 'in' ? (f.kind === 'vr' ? 'VR' : f.rest ? 'Restante' : '') : payLabel(f) || '';

/** Fixos, faturas, poupança e eventos entre from e to que não viraram lançamento. Os que já passaram contam no saldo. */
function pendings(from, to) {
  const out = [];
  const done = doneOcc();
  for (const f of fixedList()) {
    const credit = f.dir === 'out' && f.method === 'credito'; // aparece no dia, mas sai da conta pela fatura
    for (const d of fixedDates(f, from, to)) if (!done.has(`${f.id}|${d}`)) out.push({
      type: 'fixed', id: f.id, date: d, name: fixedName(f), amount: fixedAmount(f, d), sign: f.dir === 'in' ? 1 : -1, credit,
      wallet: fixedWallet(f), color: f.dir === 'in' ? FIN_COLOR : spendCat(f.category)[1], meta: fixedMeta(f),
    });
  }
  for (const v of invoices(from, to)) if (v.left > 0) out.push({
    type: 'invoice', id: v.id, date: v.due, name: invoiceName(v.card), amount: v.left, sign: -1, wallet: 'conta', color: CARD_COLOR,
    meta: v.paid ? `${brl(v.paid)} já pago` : '',
  });
  const s = fin().save || {};
  for (const d of saveDates(from, to)) out.push({ type: 'save', id: d, date: d, name: 'Poupança', amount: s.monthly, sign: -1, wallet: 'conta', color: FIN_COLOR, meta: 'Reserva' });
  for (const b of eventBudgets(from, to)) if (b.left > 0) out.push({
    type: 'event', id: b.ev.id, date: b.date, name: eventTitle(b.ev), amount: b.left, sign: -1, wallet: 'conta', color: EVENT_KINDS.evento.color,
    meta: b.spent ? `Evento · ${brl(b.spent)} já gasto` : 'Evento',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fixos e poupança cancelados entre from e to (ficam riscados, para dar para trazer de volta). */
function canceledItems(from, to) {
  const out = [];
  for (const f of fixedList()) for (const d of fixedDates(f, from, to, true)) out.push({
    type: 'fixed', id: f.id, date: d, name: fixedName(f), amount: fixedAmount(f, d), sign: f.dir === 'in' ? 1 : -1,
    color: f.dir === 'in' ? FIN_COLOR : spendCat(f.category)[1], meta: 'Cancelado', canceled: true,
  });
  for (const d of saveDates(from, to, true)) out.push({ type: 'save', id: d, date: d, name: 'Poupança', amount: fin().save.monthly, sign: -1, color: FIN_COLOR, meta: 'Cancelado', canceled: true });
  return out;
}

/** Tudo o que acontece entre from e to, em ordem: lançamentos, previstos e cancelados. */
function timeline(from, to) {
  const list = [];
  for (const m of moves()) if (m.dir !== 'adjust') for (const p of moveParts(m))
    if (p.date >= from && p.date <= to) list.push({ move: m, part: p.n > 1 ? p : null, date: p.date, createdAt: m.createdAt || 0 });
  for (const p of [...pendings(from, to), ...canceledItems(from, to)]) list.push({ pend: p, date: p.date, createdAt: 0 });
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

/** Saldos previstos no fim do dia: o que já caiu até lá mais o que falta gastar nos eventos. */
function projected(date) {
  const b = balances(date);
  for (const p of pendings(finStart(), date)) if (p.type === 'event') b.conta -= p.amount;
  return b;
}

/** Entradas e saídas do mês (conta e VR), lançadas e previstas, e o que foi para a reserva. */
function monthFlow(m) {
  const from = `${m}-01`, to = monthEnd(m);
  const r = { in: 0, out: 0, saved: 0 };
  for (const mv of moves()) for (const { date, amount: a } of moveParts(mv)) {
    if (date < from || date > to) continue;
    if (mv.dir === 'in') r.in += a;
    else if (mv.dir === 'out' && mv.method !== 'credito') r.out += a;
    else if (mv.dir === 'card') r.out += a;
    else if (mv.dir === 'save') r.saved += a;
    else if (mv.dir === 'unsave') r.saved -= a;
  }
  for (const p of pendings(from, to)) {
    if (p.credit) continue;
    if (p.type === 'save') r.saved += p.amount;
    else if (p.sign > 0) r.in += p.amount;
    else r.out += p.amount;
  }
  return { in: r2(r.in), out: r2(r.out), saved: r2(r.saved), left: r2(r.in - r.out - r.saved) };
}

/** Gastos do mês por categoria, pela data da compra (crédito entra inteiro no mês da compra). */
function monthSpending(m) {
  const from = `${m}-01`, to = monthEnd(m);
  const by = {};
  for (const mv of moves()) if (mv.dir === 'out' && mv.date >= from && mv.date <= to) by[mv.category || 'outros'] = (by[mv.category || 'outros'] || 0) + mv.amount;
  const done = doneOcc();
  for (const f of fixedList()) if (f.dir === 'out')
    for (const d of fixedDates(f, from, to)) if (!done.has(`${f.id}|${d}`)) by[f.category || 'outros'] = (by[f.category || 'outros'] || 0) + fixedAmount(f, d);
  return Object.entries(by).map(([k, v]) => [k, r2(v)]).sort((a, b) => b[1] - a[1]);
}

/* ---------- Componentes ---------- */

const amt = (n, sign = 0) => `<span class="amt ${sign > 0 ? 'in' : ''}">${sign > 0 ? '+' : sign < 0 ? '−' : ''}${esc(brl(Math.abs(n)))}</span>`;
const moveSign = m => m.dir === 'in' || m.dir === 'unsave' || (m.dir === 'adjust' && m.amount > 0) ? 1 : -1;

function pendRow(p) {
  const open = p.type === 'event' ? `data-action="edit-event" data-id="${esc(p.id)}" data-date="${p.date}"`
    : `data-action="fin-item" data-type="${p.type}" data-id="${esc(p.id)}" data-date="${p.date}"`;
  const meta = [relDay(p.date), p.meta].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  return `<button class="ev-row ${p.canceled ? 'canceled' : ''}" style="--c:${esc(p.color)}" ${open}>
    <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(p.name)}</span></span><span class="ev-meta">${meta}</span></span>
    <span class="ev-side">${amt(p.amount, p.sign)}</span></button>`;
}

const tlRow = it => it.move ? moveRow(it.move, it.part) : pendRow(it.pend);

/** Linha de um lançamento; com `part`, só aquela parcela (gasto parcelado fora do crédito). */
function moveRow(m, part = null) {
  const color = m.dir === 'out' ? spendCat(m.category)[1] : m.dir === 'card' ? CARD_COLOR : FIN_COLOR;
  const ev = m.eventId && Store.get('events', m.eventId);
  const meta = [relDay(part ? part.date : m.date), m.dir === 'out' && payLabel(m), m.dir === 'card' && cards().length > 1 && itemCard(m)?.name,
    part ? `${part.i}/${part.n}` : m.parts > 1 && `${m.parts}x`, m.dir === 'in' && m.kind === 'vr' && 'VR',
    m.dir === 'out' && spendCat(m.category)[0], ev && eventTitle(ev)].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  return `<button class="ev-row" style="--c:${esc(color)}" data-action="fin-move" data-id="${esc(m.id)}">
    <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(m.name || MOVE_TITLE[m.dir])}</span></span><span class="ev-meta">${meta}</span></span>
    <span class="ev-side">${amt(Math.abs(part ? part.amount : m.amount), moveSign(m))}</span></button>`;
}

/** Cartão de Hoje: saldos e o que entra e sai hoje. */
function finToday() {
  if (!finOn()) return '';
  const b = balances();
  const day = timeline(today(), today()).filter(it => !it.pend?.canceled && it.pend?.type !== 'event');
  return `<section class="card card-pad">
    <div class="card-head"><h2>Finanças</h2><a class="link" href="#/financas">Abrir</a></div>
    <div class="fin-mini"><span>Conta <b class="${b.conta < 0 ? 'late' : ''}">${esc(brl(r2(b.conta)))}</b></span>${b.vr || hasVR() ? `<span>VR <b>${esc(brl(r2(b.vr)))}</b></span>` : ''}</div>
    ${day.length ? `<div class="list" style="margin-top:8px">${day.map(tlRow).join('')}</div>` : ''}
    <div class="panel-actions"><button class="btn btn-sm" data-action="fin-new" data-dir="out">${icon('plus')}Gasto</button><button class="btn btn-sm" data-action="fin-new" data-dir="in">${icon('plus')}Entrada</button></div>
  </section>`;
}
const hasVR = () => !!fin().vr || Store.data.recurring.some(f => f.kind === 'vr' || f.method === 'vr');

/* ---------- Tela ---------- */

screens.financas = () => {
  migrateAdvance();
  return !finOn() || state.finEdit ? finSetup() : finView();
};

function finView() {
  const t = today();
  const m = state.finMonth || ymOf(t);
  const from = `${m}-01`, to = monthEnd(m);
  const b = balances();
  const flow = monthFlow(m);
  const end = projected(to < t ? t : to);
  const card = cardOn() ? invoices(t, addDays(t, 70)).find(v => v.left > 0) : null;
  const s = fin().save || {};

  const head = `<div class="title-block"><h1>Finanças</h1><p class="sub">${cap(fmt(from, { month: 'long', year: 'numeric' }))}</p></div>
    <div class="toolbar">
      <div class="btn-group">
        <button class="icon-btn" data-action="fin-month" data-n="-1" aria-label="Mês anterior">${icon('left')}</button>
        <button class="btn" data-action="fin-month" data-n="0">Este mês</button>
        <button class="icon-btn" data-action="fin-month" data-n="1" aria-label="Próximo mês">${icon('right')}</button>
      </div>
      <button class="btn" data-action="fin-edit">${icon('edit')}Editar</button>
      <button class="btn" data-action="fin-new" data-dir="in">${icon('plus')}Entrada</button>
      <button class="btn btn-primary" data-action="fin-new" data-dir="out">${icon('plus')}Gasto</button>
    </div>`;

  const stat = (n, l, cls = '') => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const stats = `<div class="stats">
    ${stat(esc(brl(r2(b.conta))), 'na conta', b.conta < 0 ? 'danger' : '')}
    ${hasVR() ? stat(esc(brl(r2(b.vr))), 'no VR') : stat(esc(brl(r2(end.conta))), `previsto em ${shortDate(to < t ? t : to)}`, end.conta < 0 ? 'danger' : '')}
    ${card ? stat(esc(brl(card.left)), `fatura${cards().length > 1 ? ` ${esc(card.card.name)}` : ''} · vence ${shortDate(card.due)}`) : stat(esc(brl(r2(flow.left))), 'sobra no mês', flow.left < 0 ? 'danger' : '')}
    ${stat(esc(brl(r2(b.reserva))), 'guardado')}
  </div>`;

  const sum = `<section class="card card-pad">
    <div class="card-head"><h2>Mês</h2></div>
    <dl class="fin-sum">
      <dt>Entradas</dt><dd>${amt(flow.in, 1)}</dd>
      <dt>Saídas</dt><dd>${amt(flow.out, -1)}</dd>
      ${flow.saved ? `<dt>Poupança</dt><dd>${amt(flow.saved)}</dd>` : ''}
      <dt>Sobra</dt><dd><b class="${flow.left < 0 ? 'late' : ''}">${esc(brl(flow.left))}</b></dd>
      <dt>Conta em ${shortDate(to < t ? t : to)}</dt><dd><b class="${end.conta < 0 ? 'late' : ''}">${esc(brl(r2(end.conta)))}</b></dd>
      ${hasVR() ? `<dt>VR em ${shortDate(to < t ? t : to)}</dt><dd>${esc(brl(r2(end.vr)))}</dd>` : ''}
    </dl>
  </section>`;

  // Próximos do mais perto ao mais longe; o que já caiu, do mais novo ao mais antigo.
  const tl = timeline(from, to);
  const next = tl.filter(it => it.date > t), done = tl.filter(it => it.date <= t).reverse();
  const both = next.length && done.length;
  const extrato = `<section class="card card-pad">
    <div class="card-head"><h2>Extrato</h2></div>
    ${next.length ? `${both ? '<h3 class="section-label">Próximos</h3>' : ''}<div class="list">${next.map(tlRow).join('')}</div>` : ''}
    ${done.length ? `${both ? '<h3 class="section-label">Até hoje</h3>' : ''}<div class="list">${done.map(tlRow).join('')}</div>` : ''}
    ${!tl.length ? '<p class="empty">Nada no mês.</p>' : ''}
  </section>`;

  const spend = monthSpending(m);
  const top = spend[0]?.[1] || 1;
  const cats = spend.length ? `<section class="card card-pad">
    <div class="card-head"><h2>Gastos por categoria</h2><span class="sub">${esc(brl(r2(spend.reduce((n, [, v]) => n + v, 0))))}</span></div>
    <div class="fin-cats">${spend.map(([k, v]) => `<div><div class="abs-line"><span>${esc(spendCat(k)[0])}</span><span>${esc(brl(v))}</span></div>${meter(v / top, '', spendCat(k)[1])}</div>`).join('')}</div>
  </section>` : '';

  const goal = s.monthly || s.target ? (() => {
    const monthsLeft = s.deadline && s.deadline > t ? Math.max(1, (+s.deadline.slice(0, 4) - +t.slice(0, 4)) * 12 + (+s.deadline.slice(5, 7) - +t.slice(5, 7))) : 0;
    const need = s.target && monthsLeft ? r2(Math.max(0, s.target - b.reserva) / monthsLeft) : 0;
    return `<section class="card card-pad">
      <div class="card-head"><h2>Poupança</h2><div class="btn-row">
        <button class="btn btn-sm" data-action="fin-new" data-dir="unsave">Resgatar</button>
        <button class="btn btn-sm" data-action="fin-new" data-dir="save">${icon('plus')}Guardar</button></div></div>
      <div class="abs-line"><span><b>${esc(brl(r2(b.reserva)))}</b>${s.target ? ` de ${esc(brl(s.target))}` : ''}</span>
        <span class="muted">${[s.monthly && `${brl(s.monthly)}/mês`, s.deadline && `até ${shortDate(s.deadline)}`].filter(Boolean).map(esc).join(' · ')}</span></div>
      ${s.target ? meter(b.reserva / s.target, '', FIN_COLOR) : ''}
      ${need && need > (s.monthly || 0) ? `<p class="muted" style="margin:8px 0 0">Para chegar lá: ${esc(brl(need))}/mês</p>` : ''}
    </section>`;
  })() : '';

  // Por fazer primeiro; com data, da mais perto à mais longe; sem data no fim.
  const shop = Store.data.shopping.slice().sort((a, b2) => a.done - b2.done
    || (a.date || '9999').localeCompare(b2.date || '9999') || (a.createdAt || 0) - (b2.createdAt || 0));
  const bought = shop.filter(x => x.done).length;
  const shopTotal = r2(shop.filter(x => !x.done).reduce((n, x) => n + (x.budget || 0), 0));
  const compras = `<section class="card card-pad">
    <div class="card-head"><h2>Lista de compras${shopTotal ? `<span class="count">${esc(brl(shopTotal))}</span>` : ''}</h2>
      ${bought ? '<button class="btn btn-sm btn-ghost" data-action="shop-clear">Limpar comprados</button>' : ''}</div>
    ${shop.length ? `<div class="list">${shop.map(x => `<div class="task ${x.done ? 'done' : ''}">
      <button class="checkbox ${x.done ? 'on' : ''}" data-action="shop-toggle" data-id="${esc(x.id)}" role="checkbox" aria-checked="${!!x.done}" aria-label="${esc(x.text)}"></button>
      <button class="task-main" data-action="shop-edit" data-id="${esc(x.id)}"><span class="task-title">${esc(x.text)}</span>
        ${x.date || x.budget ? `<span class="task-meta">${x.date ? `<span class="${!x.done && x.date < t ? 'late' : ''}">${relDay(x.date)}</span>` : ''}${x.budget ? `<span>${esc(brl(x.budget))}</span>` : ''}</span>` : ''}</button>
      <button class="icon-btn ghost sm" data-action="shop-del" data-id="${esc(x.id)}" aria-label="Remover">${icon('x')}</button>
    </div>`).join('')}</div>` : ''}
    <form class="quick-add" data-form="shopping">${icon('plus')}<input name="q" autocomplete="off" placeholder="Adicionar item" aria-label="Adicionar item"></form>
  </section>`;

  const withLimit = cards().filter(c => c.limit);
  const limites = withLimit.length ? `<section class="card card-pad">
    <div class="card-head"><h2>${withLimit.length > 1 ? 'Cartões' : 'Cartão'}</h2></div>
    <div class="fin-cats">${withLimit.map(c => {
      const used = cardUsed(c), free = r2(c.limit - used);
      return `<button class="fin-limit" data-action="fin-card" data-id="${esc(c.id)}">
        <div class="abs-line"><span>${esc(c.name)}</span><span class="${free < 0 ? 'late' : ''}"><b>${esc(brl(free))}</b> <span class="muted">livre</span></span></div>
        ${meter(used / c.limit, used > c.limit ? 'danger' : '', CARD_COLOR)}
        <div class="abs-line muted"><span>${esc(brl(used))} usado</span><span>de ${esc(brl(c.limit))}</span></div></button>`;
    }).join('')}</div>
  </section>` : '';

  const evs = eventBudgets(t, addDays(t, 365));
  const eventos = evs.length ? `<section class="card card-pad">
    <div class="card-head"><h2>Eventos</h2></div>
    <div class="list">${evs.map(({ ev, date, spent }) => `<button class="ev-row" style="--c:${EVENT_KINDS.evento.color}" data-action="edit-event" data-id="${esc(ev.id)}" data-date="${date}">
      <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(eventTitle(ev))}</span></span>
      <span class="ev-meta"><span>${relDay(date)}</span><span>${esc(brl(r2(spent)))} de ${esc(brl(ev.budget))}</span></span></span>
      <span class="ev-side">${meter(spent / ev.budget, spent > ev.budget ? 'danger' : '', EVENT_KINDS.evento.color)}</span></button>`).join('')}</div>
  </section>` : '';

  return { head, body: `${stats}<div class="home-grid">
    <div class="home-col">${extrato}</div>
    <div class="home-col">${sum}${limites}${compras}${goal}${cats}${eventos}</div>
  </div>` };
}

/* ---------- Primeira vez e edição ---------- */

const FIN_STEPS = [['saldo', 'Saldo'], ['renda', 'Entradas fixas'], ['cartao', 'Cartão de crédito'], ['fixos', 'Gastos fixos'], ['poupanca', 'Poupança']];

function fixedRow(f) {
  const adv = f.kind === 'salario' && f.advance?.amount > 0 && `adiantamento ${brl(f.advance.amount)} no dia ${f.advance.day}`;
  const next = f.daily && fixedDates(f, today(), addDays(today(), 400))[0];
  const meta = [fixedWhen(f), adv, f.daily && `${brl(f.amount)} por dia`, f.dir === 'out' && payLabel(f)]
    .filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  return `<button class="ev-row" style="--c:${f.dir === 'in' ? FIN_COLOR : spendCat(f.category)[1]}" data-action="fin-fixed" data-id="${esc(f.id)}">
    <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(fixedName(f))}</span></span><span class="ev-meta">${meta}</span></span>
    <span class="ev-side">${amt(next ? fixedAmount(f, next) : f.amount, f.dir === 'in' ? 1 : -1)}</span></button>`;
}

function cardRow(c) {
  const meta = [c.close && `fecha dia ${c.close}`, c.due && `vence dia ${c.due}`, c.limit && `limite ${brl(c.limit)}`].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  return `<button class="ev-row" style="--c:${CARD_COLOR}" data-action="fin-card" data-id="${esc(c.id)}">
    <span class="ev-bar"></span><span class="ev-main"><span class="ev-title"><span>${esc(c.name)}</span></span><span class="ev-meta">${meta}</span></span>
    ${c.open ? `<span class="ev-side">${amt(c.open, -1)}</span>` : ''}</button>`;
}

/** Gastos fixos agrupados nas categorias grandes, cada uma com o seu "Adicionar". */
function fixedGroups(outs) {
  return `<div class="fin-groups">${FIXED_CATS.map(k => {
    const list = outs.filter(o => fixedCat(o) === k);
    const [name, color] = spendCat(k);
    return `<div class="fin-group" style="--c:${color}">
      <div class="fin-group-head"><span class="fin-group-name">${esc(name)}</span>
        ${list.length ? `<span class="muted">${esc(brl(r2(list.reduce((n, o) => n + o.amount, 0))))}</span>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="fin-fixed-new" data-dir="out" data-cat="${k}">${icon('plus')}Adicionar</button></div>
      ${list.length ? `<div class="list">${list.map(fixedRow).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function finSetup() {
  const setup = !finOn();
  const step = setup ? clamp(state.finStep || 0, 0, FIN_STEPS.length - 1) : -1;
  const f = fin(), s = f.save || {};
  const b = setup ? null : balances();
  const fixedOf = dir => Store.data.recurring.filter(x => x.dir === dir).sort((a, b2) => b2.amount - a.amount);
  const ins = fixedOf('in'), outs = fixedOf('out');

  const sec = (i, body) => {
    const [id, title] = FIN_STEPS[i];
    return `<section class="card card-pad fin-sec" data-sec="${id}" ${setup && i !== step ? 'hidden' : ''}>
      <div class="card-head"><h2>${title}</h2></div>${body}</section>`;
  };

  const saldo = sec(0, `<div class="row">
      <label class="field"><span>Conta</span>${moneyInput(setup ? 'balance' : 'adj-conta', setup ? f.balance : r2(b.conta), setup ? 'data-fin="balance" autofocus' : 'data-adjust="conta"')}</label>
      <label class="field"><span>VR</span>${moneyInput(setup ? 'vr' : 'adj-vr', setup ? f.vr : r2(b.vr), setup ? 'data-fin="vr"' : 'data-adjust="vr"')}</label>
    </div>`);

  const renda = sec(1, `${ins.length ? `<div class="list">${ins.map(fixedRow).join('')}</div>` : ''}
    <div class="btn-row" style="margin-top:10px">${FIXED_INCOME.filter(k => k === 'outro' || !ins.some(x => x.kind === k)).map(k => `<button class="btn btn-sm" data-action="fin-fixed-new" data-dir="in" data-kind="${k}">${icon('plus')}${INCOME[k]}</button>`).join('')}</div>`);

  const cardList = allCards();
  const cartao = sec(2, `${cardList.length ? `<div class="list">${cardList.map(cardRow).join('')}</div>` : ''}
    <div class="btn-row" ${cardList.length ? 'style="margin-top:10px"' : ''}><button class="btn btn-sm" data-action="fin-card-new">${icon('plus')}Adicionar cartão</button></div>`);

  const fixos = sec(3, fixedGroups(outs));

  const poupanca = sec(4, `<div class="row">
      <label class="field"><span>${setup ? 'Já guardado' : 'Guardado'}</span>${moneyInput('save-initial', setup ? s.initial : r2(b.reserva), setup ? 'data-fin="save.initial"' : 'data-adjust="reserva"')}</label>
      <label class="field"><span>Guardar por mês</span>${moneyInput('save-monthly', s.monthly, 'data-fin="save.monthly"')}</label>
      <label class="field xs"><span>Dia</span><input type="number" min="1" max="31" inputmode="numeric" data-fin="save.day" value="${esc(s.day || '')}"></label>
    </div>
    <div class="row">
      <label class="field"><span>Objetivo</span>${moneyInput('save-target', s.target, 'data-fin="save.target"')}</label>
      <label class="field"><span>Até</span><input type="date" data-fin="save.deadline" value="${esc(s.deadline || '')}"></label>
    </div>`);

  const head = `<div class="title-block"><h1>${setup ? 'Finanças' : 'Editar finanças'}</h1>
      ${setup ? `<p class="sub">${step + 1} de ${FIN_STEPS.length} · ${FIN_STEPS[step][1]}</p>` : ''}</div>
    <div class="toolbar">${setup ? '' : `<button class="btn btn-primary" data-action="fin-edit-done">${icon('check')}Pronto</button>`}</div>`;

  const nav = setup ? `<div class="fin-steps">
    <div class="fin-dots">${FIN_STEPS.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'done' : ''}"></i>`).join('')}</div>
    <div class="btn-row">
      ${step ? '<button class="btn" data-action="fin-step" data-n="-1">Voltar</button>' : ''}
      ${step < FIN_STEPS.length - 1 ? '<button class="btn btn-primary" data-action="fin-step" data-n="1">Próximo</button>'
        : `<button class="btn btn-primary" data-action="fin-finish">${icon('check')}Concluir</button>`}
    </div></div>` : '';

  return { head, body: `<div class="stack fin-setup">${saldo}${renda}${cartao}${fixos}${poupanca}${nav}</div>` };
}

/** Grava na hora o que muda nos campos da configuração (assim nada se perde ao abrir um formulário). */
document.addEventListener('change', e => {
  const el = e.target;
  const path = el.dataset?.fin, wallet = el.dataset?.adjust;
  if (!path && !wallet) return;
  const raw = el.type === 'checkbox' ? el.checked : el.value;
  if (wallet) {
    const v = parseMoney(raw);
    if (Number.isNaN(v)) return;
    const diff = r2(v - balances()[wallet]);
    if (!diff) return;
    Store.upsert('transactions', { id: uid(), dir: 'adjust', wallet, amount: diff, date: today(), name: 'Ajuste de saldo' });
    toast(`Saldo ajustado: ${diff > 0 ? '+' : '−'}${brl(Math.abs(diff))}`);
    return;
  }
  const [k, sub] = path.split('.');
  let v = raw;
  if (el.type === 'number') v = raw === '' ? '' : clamp(Math.round(+raw), 1, 31);
  else if (el.type !== 'checkbox' && el.type !== 'date') { v = parseMoney(raw); if (Number.isNaN(v)) v = 0; }
  if (sub) setFin({ [k]: { ...fin()[k], [sub]: v } });
  else setFin({ [k]: v });
});

/* ---------- Formulários ---------- */

const choiceChips = (name, list, sel) => `<div class="day-toggles choice">${list.map(([v, l]) =>
  `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(sel) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
/** Formas de pagamento; cada cartão é uma opção ("credito:<id>"). */
const payList = () => Object.entries(PAY).flatMap(([k, l]) => k !== 'credito' ? [[k, l]]
  : cards().map(c => [`credito:${c.id}`, cards().length > 1 ? c.name : l]));
const payValue = x => x.method === 'credito' ? `credito:${itemCard(x)?.id || ''}` : x.method;
/** Grava a forma de pagamento escolhida (e o cartão, se for crédito) no item. */
function setPay(x, value) {
  const [method, card] = (value || 'debito').split(':');
  x.method = method;
  if (method === 'credito' && card) x.card = card; else delete x.card;
}
const catList = (keys, sel) => (keys.includes(sel) || !SPEND[sel] ? keys : [...keys, sel]).map(k => [k, spendCat(k)[0]]);
const dayInput = (name, value) => `<input type="number" name="${name}" min="1" max="31" inputmode="numeric" value="${esc(value)}">`;
const dayStepper = value => `<div class="stepper sm">
  <button type="button" class="icon-btn" data-step="-1" aria-label="Menos">−</button>
  <input name="day" inputmode="numeric" autocomplete="off" aria-label="Dia" value="${esc(value)}">
  <button type="button" class="icon-btn" data-step="1" aria-label="Mais">+</button></div>`;

/** Dia da caixinha: 1–31 no dia do mês; no dia útil, 1–20 e "Último" (depois do 20º e antes do 1º). */
function stepDay(value, mode, step = 0) {
  if (mode === 'util') {
    const order = [LAST, ...Array.from({ length: MAX_BUSINESS }, (_, i) => String(i + 1))];
    const n = parseInt(value, 10);
    const i = n >= 1 && n <= MAX_BUSINESS ? n : 0; // fora do 1–20 (ou "Último") é o último
    return order[(i + step + order.length) % order.length];
  }
  const n = value === LAST ? 31 : parseInt(value, 10);
  return String(clamp((n >= 1 ? n : 1) + step, 1, 31));
}

function fixedForm(f, { dir = 'out', kind = '', category = '' } = {}) {
  const isNew = !f;
  if (f) f = structuredClone(f);
  else {
    const k = dir === 'in' ? kind || 'outro' : '';
    f = { id: uid(), dir, kind: k, name: k && k !== 'outro' ? INCOME[k] : '', amount: 0,
      method: dir === 'out' ? 'debito' : '', category: category || 'outros', freq: 'mes',
      day: k === 'salario' ? 5 : 10, business: k === 'salario', last: k === 'vr', weekday: 1, date: today(),
      start: finOn() ? today() : '', end: '' }; // criado depois de configurar: não cobra os meses que já passaram
  }
  const income = f.dir === 'in';
  const cat = income ? '' : fixedCat(f);
  const when = f.last || f.business ? 'util' : 'dia';
  const names = k => (FIXED_NAMES[k] || []).map(n => `<option value="${esc(n)}">`).join('');
  openModal(`<form novalidate>
    ${modalHead(isNew ? (income ? 'Nova entrada fixa' : 'Novo gasto fixo') : (income ? 'Editar entrada fixa' : 'Editar gasto fixo'))}
    <div class="modal-body">
      ${income ? `<div><span class="fieldset-label">Tipo</span><div style="margin-top:6px">${choiceChips('kind', FIXED_INCOME.map(k => [k, INCOME[k]]), f.kind)}</div></div>`
        : `<div><span class="fieldset-label">Categoria</span><div style="margin-top:6px">${choiceChips('category', catList(FIXED_CATS, cat), cat)}</div></div>`}
      <label class="field"><span>Nome</span><input name="name" maxlength="80" value="${esc(f.name)}" ${income ? '' : 'list="fin-fixed-names"'} ${isNew && !f.name ? 'autofocus' : ''}></label>
      ${income ? '' : `<datalist id="fin-fixed-names">${names(cat)}</datalist>`}
      <div class="f-per"><span class="fieldset-label">Valor</span><div style="margin-top:6px">${choiceChips('per', [['mes', 'Por mês'], ['dia', 'Por dia']], f.daily ? 'dia' : 'mes')}</div></div>
      <label class="field money-big"><span class="f-amount-label">${f.daily ? 'Valor por dia' : 'Valor'}</span>${moneyInput('amount', f.amount || '', isNew && f.name ? 'autofocus' : '')}</label>
      ${income ? '' : `<div><span class="fieldset-label">Pagamento</span><div style="margin-top:6px">${choiceChips('method', payList(), payValue(f))}</div></div>`}
      <div><span class="fieldset-label">Frequência</span><div style="margin-top:6px">${choiceChips('freq', Object.entries(FREQ), f.freq)}</div></div>
      <div class="f-mes"><span class="fieldset-label">Dia</span>
        <div class="fin-day">${dayStepper(f.last ? LAST : f.day)}<label class="field"><select name="when" aria-label="Tipo de dia">${options(WHEN, when)}</select></label></div></div>
      ${income ? `<div class="f-adv">
        <label class="check"><input type="checkbox" name="hasAdvance" ${f.advance?.amount ? 'checked' : ''}> Recebo adiantamento</label>
        <div class="row f-adv-fields" style="margin-top:10px">
          <label class="field"><span>Adiantamento</span>${moneyInput('advAmount', f.advance?.amount || '')}</label>
          <label class="field xs"><span>Dia</span>${dayInput('advDay', f.advance?.day || 20)}</label>
        </div>
      </div>` : ''}
      <div class="f-semana"><span class="fieldset-label">Dia da semana</span><div style="margin-top:6px">${choiceChips('weekday', WEEKDAYS.map((w, i) => [i, w]), f.weekday)}</div></div>
      <label class="field f-ano"><span>Data</span><input type="date" name="date" value="${esc(f.date || today())}"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onMount(form) {
      const el = form.elements;
      const sync = () => {
        const fr = el.freq.value, k = el.kind?.value;
        const adv = $('.f-adv', form);
        if (adv) {
          adv.hidden = k !== 'salario' || fr !== 'mes';
          $('.f-adv-fields', form).hidden = !el.hasAdvance.checked;
        }
        $('.f-per', form).hidden = k !== 'vr' || fr !== 'mes';
        $('.f-amount-label', form).textContent = k === 'vr' && fr === 'mes' && el.per.value === 'dia' ? 'Valor por dia' : 'Valor';
        $('.f-mes', form).hidden = fr !== 'mes';
        $('.f-semana', form).hidden = fr !== 'semana';
        $('.f-ano', form).hidden = fr !== 'ano';
      };
      const day = el.day;
      const stepIt = n => { day.value = stepDay(day.value, el.when.value, n); };
      form.addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) stepIt(+b.dataset.step); });
      day.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepIt(e.key === 'ArrowUp' ? 1 : -1); } });
      let prevKind = f.kind;
      form.addEventListener('change', e => {
        if (e.target === day || e.target === el.when) stepIt(0);
        // Trocar o tipo troca o nome, se ele ainda for o nome do tipo.
        if (e.target.name === 'kind') {
          const n = el.name;
          if (!n.value.trim() || n.value === INCOME[prevKind]) n.value = e.target.value === 'outro' ? '' : INCOME[e.target.value];
          prevKind = e.target.value;
        }
        if (e.target.name === 'category') $('#fin-fixed-names', form).innerHTML = names(e.target.value);
        sync();
      });
      sync();
    },
    onSubmit(form) {
      const v = formData(form);
      const amount = parseMoney(v.amount);
      const when = v.freq === 'mes' ? v.when : 'dia';
      const last = when === 'util' && v.day === LAST;
      if (!(amount > 0)) return formError(form, 'Falta o valor.');
      if (v.freq === 'mes' && !last && !(+v.day >= 1 && +v.day <= 31)) return formError(form, 'Dia inválido.');
      if (v.freq === 'ano' && !v.date) return formError(form, 'Falta a data.');
      const withAdvance = income && v.kind === 'salario' && v.freq === 'mes' && !!v.hasAdvance;
      const advAmount = withAdvance ? parseMoney(v.advAmount) : 0;
      if (withAdvance && !(advAmount > 0)) return formError(form, 'Falta o valor do adiantamento.');
      if (withAdvance && advAmount >= amount) return formError(form, 'O adiantamento precisa ser menor que o salário.');
      if (withAdvance && !(+v.advDay >= 1 && +v.advDay <= 31)) return formError(form, 'Dia do adiantamento inválido.');
      if (withAdvance) f.advance = { ...f.advance, amount: r2(advAmount), day: +v.advDay };
      else delete f.advance;
      Object.assign(f, {
        kind: income ? v.kind : '', name: v.name.trim(), amount: r2(amount),
        daily: income && v.kind === 'vr' && v.freq === 'mes' && v.per === 'dia',
        category: income ? '' : v.category || 'outros', freq: v.freq,
        day: +v.day || f.day || 1, business: when === 'util' && !last, last, weekday: +v.weekday || 0, date: v.date || '',
        start: f.start || '', end: '', // sem "Desde"/"Até": começa quando foi criado e vai até ser excluído
      });
      if (income) { f.method = ''; delete f.card; } else setPay(f, v.method);
      delete f.variable; // valor que varia entra como lançamento comum
      Store.upsert('recurring', f);
      closeModal();
      render();
      toast(isNew ? `${fixedName(f)} · ${fixedWhen(f).toLowerCase()}` : 'Atualizado');
    },
    async onDelete() {
      if (!await confirmDelete(`“${fixedName(f)}”`)) return;
      const removed = Store.remove('recurring', f.id);
      closeModal();
      render();
      toast('Excluído', { label: 'Desfazer', fn: () => { Store.upsert('recurring', removed); render(); } });
    },
  });
}

function cardForm(c) {
  const isNew = !c;
  const list = allCards().map(x => ({ ...x }));
  c = c ? { ...c } : { id: uid(), name: '', close: '', due: '', open: 0 };
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Novo cartão' : 'Editar cartão')}
    <div class="modal-body">
      <label class="field"><span>Nome</span><input name="name" maxlength="40" value="${esc(c.name)}" ${isNew ? 'autofocus' : ''}></label>
      <div class="row">
        <label class="field"><span>Fechamento</span>${dayInput('close', c.close || '')}</label>
        <label class="field"><span>Vencimento</span>${dayInput('due', c.due || '')}</label>
      </div>
      <div class="row">
        <label class="field"><span>Limite</span>${moneyInput('limit', c.limit || '')}</label>
        <label class="field"><span>Próxima fatura</span>${moneyInput('open', c.open || '')}</label>
      </div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const v = formData(form);
      if (!(+v.close >= 1 && +v.close <= 31)) return formError(form, 'Falta o dia do fechamento.');
      if (!(+v.due >= 1 && +v.due <= 31)) return formError(form, 'Falta o dia do vencimento.');
      const open = parseMoney(v.open), limit = parseMoney(v.limit);
      Object.assign(c, { name: v.name.trim() || `Cartão${list.length && isNew ? ` ${list.length + 1}` : ''}`, close: +v.close, due: +v.due,
        open: open > 0 ? r2(open) : 0, limit: limit > 0 ? r2(limit) : 0 });
      // A "próxima fatura" vence no primeiro vencimento a partir de hoje.
      c.openDue = nextDue(c, today());
      setFin({ cards: isNew ? [...list, c] : list.map(x => x.id === c.id ? c : x) });
      closeModal();
      render();
    },
    async onDelete() {
      if (!await confirmDelete(`“${c.name}”`)) return;
      const before = allCards();
      setFin({ cards: list.filter(x => x.id !== c.id) });
      closeModal();
      render();
      toast('Cartão excluído', { label: 'Desfazer', fn: () => { setFin({ cards: before }); render(); } });
    },
  });
}

/** Item da lista de compras: nome, orçamento e quando comprar (os dois últimos podem ficar vazios). */
function shopForm(x) {
  x = structuredClone(x);
  openModal(`<form novalidate>
    ${modalHead('Item')}
    <div class="modal-body">
      <label class="field"><span>Item</span><input name="text" maxlength="100" value="${esc(x.text)}"></label>
      <div class="row">
        <label class="field"><span>Orçamento</span>${moneyInput('budget', x.budget || '')}</label>
        <label class="field"><span>Quando</span><input type="date" name="date" value="${esc(x.date || '')}"></label>
      </div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(true)}
  </form>`, {
    onSubmit(form) {
      const v = formData(form);
      if (!v.text.trim()) return formError(form, 'Falta o item.');
      const budget = parseMoney(v.budget);
      x.text = v.text.trim();
      if (budget > 0) x.budget = r2(budget); else delete x.budget;
      if (v.date) x.date = v.date; else delete x.date;
      Store.upsert('shopping', x);
      closeModal();
      render();
    },
    onDelete() {
      const removed = Store.remove('shopping', x.id);
      closeModal();
      render();
      toast('Item removido', { label: 'Desfazer', fn: () => { Store.upsert('shopping', removed); render(); } });
    },
  });
}

/** Eventos com orçamento para ligar um gasto (do último mês em diante). */
function eventChoices() {
  const out = [];
  for (const ev of Store.data.events) if (ev.budget) for (const d of occurrences(ev, addDays(today(), -31), addDays(today(), 365))) out.push([`${ev.id}|${d}`, `${eventTitle(ev)} · ${shortDate(d)}`]);
  return out.sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]));
}

function moveForm(m, { dir = 'out', fixed = null, occ = '', eventId = '', eventDate = '', amount, due = '' } = {}) {
  const isNew = !m;
  if (m) m = structuredClone(m);
  else m = {
    id: uid(), dir, name: fixed ? fixedName(fixed) : '', amount: amount ?? fixed?.amount ?? '',
    date: occ && occ < today() ? occ : today(), kind: fixed?.kind || (dir === 'in' ? 'outro' : ''),
    method: fixed?.method || (dir === 'out' ? 'debito' : ''), category: fixed?.category || (eventId ? 'eventos' : 'outros'),
    parts: 1, eventId, eventDate, due, ...(fixed ? { fixedId: fixed.id, occ } : {}), ...(fixed?.card ? { card: fixed.card } : {}),
  };
  dir = m.dir;
  const evs = dir === 'out' ? eventChoices() : [];
  const title = dir === 'out' || dir === 'in' ? `${isNew ? (dir === 'in' ? 'Nova' : 'Novo') : 'Editar'} ${MOVE_TITLE[dir]}` : MOVE_TITLE[dir];
  openModal(`<form novalidate>
    ${modalHead(title)}
    <div class="modal-body">
      <label class="field money-big"><span>Valor</span>${moneyInput('amount', m.amount, isNew ? 'autofocus' : '')}</label>
      ${dir === 'out' || dir === 'in' ? `<label class="field"><span>Descrição</span><input name="name" maxlength="100" value="${esc(m.name)}"></label>` : ''}
      ${dir === 'out' ? `
        <div><span class="fieldset-label">Categoria</span><div style="margin-top:6px">${choiceChips('category', catList(MOVE_CATS, m.category), m.category)}</div></div>
        <div><span class="fieldset-label">Pagamento</span><div style="margin-top:6px">${choiceChips('method', payList(), payValue(m))}</div></div>
        <label class="field xs"><span>Parcelas</span><select name="parts">${options(Array.from({ length: 24 }, (_, i) => [i + 1, i ? `${i + 1}x` : 'À vista']), m.parts || 1)}</select></label>` : ''}
      ${dir === 'in' ? `<div><span class="fieldset-label">Tipo</span><div style="margin-top:6px">${choiceChips('kind', Object.entries(INCOME).filter(([k]) => k !== 'adiantamento' || m.kind === k), m.kind)}</div></div>` : ''}
      <label class="field"><span>Data</span><input type="date" name="date" value="${esc(m.date)}"></label>
      ${evs.length ? `<label class="field"><span>Evento</span><select name="event"><option value="">Nenhum</option>${options(evs, m.eventId ? `${m.eventId}|${m.eventDate}` : '')}</select></label>` : ''}
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const v = formData(form);
      const value = parseMoney(v.amount);
      if (!(value > 0)) return formError(form, 'Falta o valor.');
      if (!v.date) return formError(form, 'Falta a data.');
      m.amount = r2(value);
      m.date = v.date;
      if (dir === 'out') {
        setPay(m, v.method);
        Object.assign(m, { category: v.category || 'outros', parts: +v.parts || 1 });
        m.name = v.name.trim() || spendCat(m.category)[0];
        const [eid = '', edate = ''] = (v.event || '').split('|');
        if (evs.length) { m.eventId = eid; m.eventDate = edate; }
        if (!m.eventId) { delete m.eventId; delete m.eventDate; }
      } else if (dir === 'in') {
        m.kind = v.kind || 'outro';
        m.name = v.name.trim() || INCOME[m.kind];
      } else if (!m.name) m.name = MOVE_TITLE[dir];
      Store.upsert('transactions', m);
      closeModal();
      render();
      const b = balances();
      toast(`${isNew ? 'Lançado' : 'Atualizado'} · conta ${brl(r2(b.conta))}${m.method === 'vr' || m.kind === 'vr' ? ` · VR ${brl(r2(b.vr))}` : ''}`);
    },
    async onDelete() {
      if (!await confirmDelete(`“${m.name || MOVE_TITLE[dir]}”`)) return;
      const removed = Store.remove('transactions', m.id);
      closeModal();
      render();
      toast('Lançamento excluído', { label: 'Desfazer', fn: () => { Store.upsert('transactions', removed); render(); } });
    },
  });
}

/* ---------- Ficha de um dia: valor, data, cancelar ---------- */

/** Cancela (ou traz de volta) o fixo ou a poupança num dia. */
function setSkip(type, id, date, on) {
  const edit = list => on ? [...new Set([...(list || []), date])].sort() : (list || []).filter(d => d !== date);
  if (type === 'save') {
    const s = fin().save || {};
    setFin({ save: { ...s, skips: edit(s.skips) } });
    return;
  }
  const vf = getFixed(id), f = vf && Store.get('recurring', vf.parent || vf.id);
  if (!f) return;
  const next = structuredClone(f);
  if (vf.parent) next.advance.skips = edit(f.advance.skips);
  else next.skips = edit(f.skips);
  Store.upsert('recurring', next);
}

/** O que a ficha precisa saber do fixo, fatura ou poupança naquele dia. */
function dayItem(type, id, date) {
  if (type === 'fixed') {
    const f = getFixed(id);
    if (!f) return null;
    return {
      name: fixedName(f), color: f.dir === 'in' ? FIN_COLOR : spendCat(f.category)[1], amount: fixedAmount(f, date),
      sub: [f.dir === 'in' ? INCOME[f.kind] : spendCat(f.category)[0], fixedMeta(f), fixedWhen(f)],
      canceled: (f.skips || []).includes(date), canCancel: true,
      rec: { dir: f.dir, name: fixedName(f), kind: f.kind, method: f.method, category: f.category, fixedId: f.id, occ: date, ...(f.card ? { card: f.card } : {}) },
      setup: [f.dir === 'in' ? 'Configurar recebimento' : 'Configurar pagamento', () => fixedForm(Store.get('recurring', f.parent || f.id))],
    };
  }
  if (type === 'save') {
    const s = fin().save || {};
    return {
      name: 'Poupança', color: FIN_COLOR, amount: s.monthly || 0, sub: ['Reserva', s.day && `Dia ${s.day}`],
      canceled: (s.skips || []).includes(date), canCancel: true,
      rec: { dir: 'save', name: 'Poupança', occ: date },
      setup: ['Configurar poupança', () => { state.finEdit = true; render(); }],
    };
  }
  const [cid, due] = id.split('|');
  const c = cards().find(x => x.id === cid);
  if (!c) return null;
  const v = invoices(due, due).find(x => x.id === id) || { amount: 0, paid: 0, left: 0 };
  return {
    name: invoiceName(c), color: CARD_COLOR, amount: v.left, invoice: v, card: c,
    sub: [`Fecha dia ${c.close}`, `vence dia ${c.due}`],
    rec: { dir: 'card', name: invoiceName(c), due, card: c.id, full: true },
    setup: ['Configurar cartão', () => cardForm(c)],
  };
}

/** Linha "Total · pago · restam" da fatura, quando já tem pagamento. */
/** Detalhe da fatura: cada compra, parcela e fixo que entrou nela, os pagamentos e o total até agora. */
const invoiceDetail = v => `<div class="inv-items">${v.items.map(x => `<div class="inv-item ${x.date > today() ? 'soon' : ''}" style="--c:${esc(x.color)}">
    <span class="dot"></span><span class="inv-name">${esc(x.name)}${x.part ? ` <span class="muted">${esc(x.part)}</span>` : ''}</span>
    <span class="muted">${esc(shortDate(x.date))}</span><span class="inv-amt">${esc(brl(x.amount))}</span></div>`).join('')}</div>
  <dl class="fin-sum">
    <dt>Total</dt><dd><b>${esc(brl(v.amount))}</b></dd>
    ${v.pays.map(p => `<dt>Pago em ${esc(shortDate(p.date))}</dt><dd>${amt(p.amount, -1)}</dd>`).join('')}
    ${v.paid ? `<dt>Restante</dt><dd><b>${esc(brl(v.left))}</b></dd>` : ''}
  </dl>`;

/** Paga parte da fatura: sai da conta no dia e o resto continua previsto para o vencimento. */
function partialForm(c, v) {
  openModal(`<form novalidate>
    ${modalHead('Pagar parte')}
    <div class="modal-body">
      <p class="sheet-sub" style="--c:${CARD_COLOR}"><span class="dot"></span>${esc(`${invoiceName(c)} · vence ${shortDate(v.due)} · restam ${brl(v.left)}`)}</p>
      <label class="field money-big"><span>Valor</span>${moneyInput('amount', '', 'autofocus')}</label>
      <label class="field"><span>Data</span><input type="date" name="date" value="${today()}"></label>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Pagar')}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      const value = r2(parseMoney(f.amount));
      if (!(value > 0)) return formError(form, 'Falta o valor.');
      if (!f.date) return formError(form, 'Falta a data.');
      if (f.date < finStart()) return formError(form, `Antes de ${shortDate(finStart())}, quando o saldo foi informado.`);
      const rec = { id: uid(), dir: 'card', name: invoiceName(c), amount: value, date: f.date, due: v.due, card: c.id };
      if (value >= v.left) rec.full = true; // pagou tudo o que faltava
      Store.upsert('transactions', rec);
      closeModal();
      render();
      const left = invoices(v.due, v.due).find(x => x.id === v.id)?.left || 0;
      toast(left ? `Restam ${brl(left)} da fatura` : 'Fatura paga', { label: 'Desfazer', fn: () => { Store.remove('transactions', rec.id); render(); } });
    },
  });
}

/** Ficha de um dia do fixo, fatura ou poupança (previsto ou já lançado em `m`): muda valor e data na hora, cancela ou abre a configuração. */
function dayForm(type, id, date, m = null) {
  const it = dayItem(type, id, date);
  if (!it) return m && moveForm(m);
  const canceled = !m && it.canceled;
  const amount = m ? m.amount : it.amount, when = m ? m.date : date;
  const v = it.invoice, partial = m && type === 'invoice' && !m.full;
  // Na fatura com pagamento parcial, o valor do previsto é o que falta pagar.
  const label = partial ? 'Valor pago' : v?.paid && !m ? 'Restante' : 'Valor';
  openModal(`<form novalidate>
    ${modalHead(m?.name || it.name)}
    <div class="modal-body">
      <p class="sheet-sub" style="--c:${esc(it.color)}"><span class="dot"></span>${esc([partial && 'Pagamento parcial', ...it.sub].filter(Boolean).join(' · '))}</p>
      ${v?.items ? invoiceDetail(v) : ''}
      ${canceled ? `<p class="muted" style="margin:0">Cancelado em ${esc(shortDate(date))}.</p>` : `
        <label class="field money-big"><span>${label}</span>${moneyInput('amount', amount)}</label>
        <label class="field"><span>Data</span><input type="date" name="date" value="${esc(when)}"></label>`}
      <p class="form-error" hidden></p>
    </div>
    <footer class="modal-actions wrap">
      ${it.canCancel && !canceled ? '<button type="button" class="btn btn-danger-ghost" data-day-cancel>Cancelar</button>' : ''}
      ${v && m ? '<button type="button" class="btn btn-danger-ghost" data-day-delete>Excluir</button>' : ''}
      ${v && !m && v.left > 0 ? '<button type="button" class="btn" data-day-partial>Pagar parte</button>' : ''}
      <button type="button" class="btn" data-day-setup>${esc(it.setup[0])}</button>
      <span class="spacer"></span>
      ${canceled ? '<button type="button" class="btn btn-primary" data-day-restore>Reativar</button>' : '<button type="submit" class="btn btn-primary">Salvar</button>'}
    </footer>
  </form>`, {
    onMount(form) {
      $('[data-day-setup]', form).onclick = () => { closeModal(); it.setup[1](); };
      const part = $('[data-day-partial]', form);
      if (part) part.onclick = () => { closeModal(); partialForm(it.card, v); };
      const del = $('[data-day-delete]', form);
      if (del) del.onclick = () => {
        Store.remove('transactions', m.id);
        closeModal();
        render();
        toast('Pagamento excluído', { label: 'Desfazer', fn: () => { Store.upsert('transactions', m); render(); } });
      };
      const restore = $('[data-day-restore]', form);
      if (restore) restore.onclick = () => { setSkip(type, id, date, false); closeModal(); render(); toast(`${it.name} de volta`); };
      const cancel = $('[data-day-cancel]', form);
      if (cancel) cancel.onclick = () => {
        if (m) Store.remove('transactions', m.id);
        setSkip(type, id, date, true);
        closeModal();
        render();
        toast(`${it.name} de ${shortDate(date)} cancelado`, { label: 'Desfazer', fn: () => { setSkip(type, id, date, false); if (m) Store.upsert('transactions', m); render(); } });
      };
    },
    onSubmit(form) {
      const v = formData(form);
      const value = r2(parseMoney(v.amount));
      if (!(value > 0)) return formError(form, 'Falta o valor.');
      if (!v.date) return formError(form, 'Falta a data.');
      if (v.date < finStart()) return formError(form, `Antes de ${shortDate(finStart())}, quando o saldo foi informado.`);
      // Previsto que não mudou continua previsto (e acompanha o fixo); o que mudou vira lançamento do dia.
      if (m) Store.upsert('transactions', { ...structuredClone(m), amount: value, date: v.date }); // parcial continua parcial
      else if (value !== r2(it.amount) || v.date !== date) Store.upsert('transactions', { id: uid(), ...it.rec, amount: value, date: v.date });
      closeModal();
      render();
    },
  });
}

/* ---------- Ações ---------- */

Object.assign(actions, {
  'fin-new': el => { if (!finOn()) location.hash = '#/financas'; else moveForm(null, { dir: el.dataset.dir || 'out' }); },
  'fin-move': el => {
    const m = Store.get('transactions', el.dataset.id);
    if (!m) return;
    // Lançamento de um fixo, fatura ou poupança abre a ficha do dia; o resto, o formulário.
    if (m.fixedId && m.occ) dayForm('fixed', m.fixedId, m.occ, m);
    else if (m.dir === 'save' && m.occ) dayForm('save', m.occ, m.occ, m);
    else if (m.dir === 'card' && m.due && itemCard(m)) dayForm('invoice', `${itemCard(m).id}|${m.due}`, m.due, m);
    else moveForm(m);
  },
  'fin-item': el => dayForm(el.dataset.type, el.dataset.id, el.dataset.date),
  'fin-fixed': el => { const f = Store.get('recurring', getFixed(el.dataset.id)?.parent || el.dataset.id); if (f) fixedForm(f); },
  'fin-fixed-new': el => fixedForm(null, { dir: el.dataset.dir, kind: el.dataset.kind, category: el.dataset.cat }),
  'fin-card': el => { const c = allCards().find(x => x.id === el.dataset.id); if (c) cardForm(c); },
  'fin-card-new': () => cardForm(null),
  'shop-edit': el => { const x = Store.get('shopping', el.dataset.id); if (x) shopForm(x); },
  'shop-toggle': el => { const x = Store.get('shopping', el.dataset.id); if (x) { Store.upsert('shopping', { ...x, done: !x.done }); render(); } },
  'shop-del': el => {
    const removed = Store.remove('shopping', el.dataset.id);
    render();
    if (removed) toast('Item removido', { label: 'Desfazer', fn: () => { Store.upsert('shopping', removed); render(); } });
  },
  'shop-clear': () => {
    const removed = Store.data.shopping.filter(x => x.done);
    removed.forEach(x => Store.remove('shopping', x.id));
    render();
    toast(`${plural(removed.length, 'item removido', 'itens removidos')}`, { label: 'Desfazer', fn: () => { removed.forEach(x => Store.upsert('shopping', x)); render(); } });
  },
  'fin-month': el => { const n = +el.dataset.n; state.finMonth = n ? nextYm(state.finMonth || ymOf(today()), n) : null; render(); },
  'fin-edit': () => { state.finEdit = true; render(); },
  'fin-edit-done': () => { state.finEdit = false; render(); },
  'fin-step': el => { document.activeElement?.blur?.(); state.finStep = clamp((state.finStep || 0) + +el.dataset.n, 0, FIN_STEPS.length - 1); render(); },
  'fin-finish': () => {
    document.activeElement?.blur?.();
    setFin({ setup: true, start: today() });
    state.finStep = 0;
    render();
    toast('Finanças prontas');
  },
});
