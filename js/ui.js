'use strict';
/* ==========================================================
   Interface compartilhada: toasts, modal, diálogo de
   confirmação, menu suspenso e peças de formulário.
   ========================================================== */

/* ---------- Toast ---------- */

function toast(msg, action, ms) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  $('#toasts').append(el);
  const timer = setTimeout(() => el.remove(), ms || (action ? 6000 : 3200));
  if (action) el.querySelector('button').onclick = () => { clearTimeout(timer); el.remove(); action.fn(); };
}

/* ---------- Modal ---------- */

let modalCtx = null;

function openModal(html, { onSubmit, onDelete, onMount } = {}) {
  closeMenu();
  const root = $('#modal');
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.hidden = false;
  document.body.classList.add('no-scroll');
  modalCtx = { lastFocus: document.activeElement, downOnBackdrop: false };

  const form = $('form', root);
  form?.addEventListener('submit', e => { e.preventDefault(); onSubmit?.(form); });

  root.onmousedown = e => { modalCtx.downOnBackdrop = e.target === root; };
  root.onclick = e => {
    const t = e.target;
    if (t === root && modalCtx.downOnBackdrop) return closeModal();
    if (t.closest('[data-close]')) return closeModal();
    if (t.closest('[data-delete]')) return onDelete?.();
    const addItem = t.closest('[data-add-item]');
    if (addItem) return addListRow(addItem.closest('.edit-list'));
    if (t.closest('[data-remove-item]')) return t.closest('.item').remove();
    const note = t.closest('[data-note]');
    if (note) return noteFormat($('textarea', note.closest('.note-field')), note.dataset.note);
    const addSlot = t.closest('[data-add-slot]');
    if (addSlot) {
      addSlot.insertAdjacentHTML('beforebegin', slotRow({ id: uid(), weekday: 1, start: '19:00', end: '20:40', weight: 2, room: '' }));
      return;
    }
    if (t.closest('[data-remove-slot]')) t.closest('.slot-row').remove();
  };
  // Enter dentro de uma lista editável cria o próximo item em vez de enviar o formulário.
  root.onkeydown = e => {
    if (e.key === 'Enter' && e.target.matches('.edit-list input[type="text"]')) {
      e.preventDefault();
      addListRow(e.target.closest('.edit-list'), e.target.closest('.item'));
    }
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.note-field textarea')) noteEnter(e);
  };

  onMount?.(form, root);
  requestAnimationFrame(() => $('[autofocus]', root)?.focus());
}

function closeModal() {
  const root = $('#modal');
  if (root.hidden) return;
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  modalCtx?.lastFocus?.focus?.();
  modalCtx = null;
}

const modalOpen = () => !$('#modal').hidden || !$('#dialog').hidden;

/* ---------- Ficha ---------- */

/** Ficha pronta de um registro (clicar num item abre isto, não o formulário).
    rows: [rótulo, html] (vazios somem); buttons: [{ label, kind, run }] à esquerda; "Editar" abre onEdit. */
function openSheet({ title, color, sub = '', rows = [], body = '', buttons = [], onEdit }) {
  const list = rows.filter(r => r && r[1]);
  openModal(`<div class="sheet" style="${color ? `--c:${esc(color)}` : ''}">
    ${modalHead(title)}
    <div class="modal-body">
      ${sub ? `<p class="sheet-sub">${color ? '<span class="dot"></span>' : ''}${sub}</p>` : ''}
      ${list.length ? `<dl class="sheet-rows">${list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
      ${body}
    </div>
    <footer class="modal-actions">
      ${buttons.map((b, i) => `<button type="button" class="btn ${b.kind ? 'btn-' + b.kind : ''}" data-sheet-btn="${i}">${b.label}</button>`).join('')}
      <span class="spacer"></span>
      ${onEdit ? `<button type="button" class="btn btn-primary" data-sheet-edit>${icon('edit')}Editar</button>` : '<button type="button" class="btn" data-close>Fechar</button>'}
    </footer>
  </div>`, {
    onMount(_, root) {
      $('[data-sheet-edit]', root)?.addEventListener('click', () => { closeModal(); onEdit(); });
      $$('[data-sheet-btn]', root).forEach(el => el.addEventListener('click', () => { closeModal(); buttons[el.dataset.sheetBtn].run(); }));
    },
  });
}

/* ---------- Etiqueta de hover (data-tip com HTML já escapado) ---------- */

(() => {
  let tip, cur;
  const hide = () => { if (tip) tip.hidden = true; cur = null; };
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.('[data-tip]');
    if (el === cur) return;
    if (!el) return hide();
    cur = el;
    tip ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'hover-tip', role: 'tooltip' }));
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
    const above = r.top - t.height - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${above > 8 ? above : r.bottom + 6}px`;
  });
  ['scroll', 'pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, hide, true));
  document.addEventListener('pointerleave', hide);
})();

/* ---------- Fiz / Não fiz num dia (blocos, treinos e doses de remédio: doneDates / skippedDates) ---------- */

const dayState = (rec, date) => (rec.doneDates || []).includes(date) ? 'done' : (rec.skippedDates || []).includes(date) ? 'skipped' : null;

/** Cópia do registro com o dia marcado como 'done', 'skipped' ou sem marca (null). */
function withDayState(rec, date, st) {
  const next = structuredClone(rec);
  next.doneDates = (rec.doneDates || []).filter(d => d !== date);
  next.skippedDates = (rec.skippedDates || []).filter(d => d !== date);
  if (st === 'done') next.doneDates = [...next.doneDates, date].sort();
  if (st === 'skipped') next.skippedDates = [...next.skippedDates, date].sort();
  if (!next.skippedDates.length) delete next.skippedDates;
  return next;
}

/** Botões "Fiz" / "Não fiz" da ficha: o marcado leva ✓ e clicar de novo desmarca. */
const dayStateButtons = (st, set, [yes, no] = ['Fiz', 'Não fiz']) => [
  { label: `${st === 'done' ? icon('check') : ''}${yes}`, kind: st === 'done' ? 'primary' : '', run: () => set(st === 'done' ? null : 'done') },
  { label: `${st === 'skipped' ? icon('check') : ''}${no}`, kind: st === 'skipped' ? 'danger-ghost' : '', run: () => set(st === 'skipped' ? null : 'skipped') },
];

/** Texto livre com quebras de linha, para as fichas. */
const sheetText = t => t ? `<span class="pre">${esc(t)}</span>` : '';

/* ---------- Diálogo de confirmação ---------- */

/** Mostra uma pergunta e resolve com o `value` do botão escolhido (ou null). */
function ask(message, buttons) {
  return new Promise(resolve => {
    const root = $('#dialog');
    root.innerHTML = `<div class="modal dialog" role="alertdialog" aria-modal="true">
      <p>${esc(message)}</p>
      <div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.kind ? 'btn-' + b.kind : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    root.hidden = false;
    const done = v => {
      root.hidden = true;
      root.innerHTML = '';
      root.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    root.onclick = e => {
      const b = e.target.closest('[data-i]');
      if (b) done(buttons[b.dataset.i].value);
      else if (e.target === root) done(null);
    };
    $('[data-i]:last-child', root)?.focus();
  });
}

const confirmDelete = (what) => ask(`Excluir ${what}?`, [
  { label: 'Cancelar', value: false },
  { label: 'Excluir', value: true, kind: 'danger' },
]);

/* ---------- Menu suspenso ---------- */

function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => it.sep ? '<hr>' :
    `<button role="menuitem" data-i="${i}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`).join('');
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const top = r.bottom + mh + 8 > innerHeight ? r.top - mh - 8 : r.bottom + 8;
  const left = clamp(r.left, 8, innerWidth - mw - 8);
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;

  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeMenu();
    items[b.dataset.i].run();
  });
  setTimeout(() => document.addEventListener('click', closeMenuOutside), 0);
  $('button', menu)?.focus();
}

function closeMenuOutside(e) { if (!e.target.closest('#menu')) closeMenu(); }
function closeMenu() {
  $('#menu')?.remove();
  document.removeEventListener('click', closeMenuOutside);
}

/* ---------- Peças de formulário ---------- */

const options = (pairs, sel) => pairs.map(([v, l]) =>
  `<option value="${esc(v)}" ${String(sel ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('');

const catOptions = sel => `<option value="">Sem tipo</option>` + options(Store.data.categories.map(c => [c.id, c.name]), sel);
const subjectOptions = sel => options(Store.data.subjects.map(s => [s.id, s.name]), sel);
const areaOptions = sel => options(Store.data.areas.map(a => [a.id, a.name]), sel);

const modalHead = title => `<header class="modal-head"><h2>${esc(title)}</h2>
  <button type="button" class="icon-btn ghost" data-close aria-label="Fechar">${icon('x')}</button></header>`;

const modalFoot = (canDelete, saveLabel = 'Salvar') => `<footer class="modal-actions">
  ${canDelete ? '<button type="button" class="btn btn-danger-ghost" data-delete>Excluir</button>' : ''}
  <span class="spacer"></span>
  <button type="button" class="btn" data-close>Cancelar</button>
  <button type="submit" class="btn btn-primary">${esc(saveLabel)}</button>
</footer>`;

function formError(form, msg) {
  const p = $('.form-error', form);
  p.textContent = msg;
  p.hidden = false;
  return false;
}

const formData = form => Object.fromEntries(new FormData(form));

/* ---------- Dinheiro ---------- */

/** "R$ 1.500,50", "1500.5", "30" → número. */
function parseMoney(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return +s;
}
const moneyText = n => n || n === 0
  ? `${n < 0 ? '-' : ''}R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
const moneyInput = (name, value, attrs = '') =>
  `<input class="money" name="${name}" inputmode="numeric" autocomplete="off" value="${esc(moneyText(value === '' ? null : value))}" ${attrs}>`;

/** Campo de dinheiro se formata enquanto digita, como em app de banco: os dígitos entram pelos centavos. Um "-" troca o sinal. */
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList?.contains('money')) return;
  const digits = el.value.replace(/\D/g, '').replace(/^0+/, '');
  const neg = (el.value.match(/-/g) || []).length % 2 === 1;
  el.value = digits ? moneyText((neg ? -1 : 1) * +digits / 100) : neg ? '-' : '';
  el.setSelectionRange(el.value.length, el.value.length);
});

/** Lista editável (checklist de entrega, objetivos de meta…). */
function listEditor(name, items, { check = true, addLabel = 'Adicionar item' } = {}) {
  return `<div class="edit-list" data-list="${name}" data-check="${check ? 1 : 0}">
    ${items.map(it => listRow(it, check)).join('')}
    <button type="button" class="btn btn-sm" data-add-item>${icon('plus')}${esc(addLabel)}</button>
  </div>`;
}

const listRow = (it, check) => `<div class="item" data-id="${esc(it.id)}">
  ${check ? `<input type="checkbox" ${it.done ? 'checked' : ''} aria-label="Concluído">` : ''}
  <input type="text" value="${esc(it.text)}" maxlength="200">
  <button type="button" class="icon-btn ghost sm" data-remove-item aria-label="Remover item">${icon('x')}</button>
</div>`;

function addListRow(list, after) {
  const html = listRow({ id: uid(), text: '', done: false }, list.dataset.check === '1');
  if (after) after.insertAdjacentHTML('afterend', html);
  else $('[data-add-item]', list).insertAdjacentHTML('beforebegin', html);
  const row = after ? after.nextElementSibling : $('[data-add-item]', list).previousElementSibling;
  $('input[type="text"]', row).focus();
}

/* ---------- Texto com lista e checklist ("• item", "☐ item" / "☑ item") ----------
   Continua texto puro (sincroniza e exporta igual); a ficha mostra a lista e as caixinhas. */

const NOTE_MARK = { bullet: '• ', check: '☐ ' };
const NOTE_RE = /^\s*(?:[-*•]|☐|☑|\[[ xX]?\])\s?/;
const noteKind = l => /^\s*(?:☐|☑|\[[ xX]?\])/.test(l) ? 'check' : /^\s*[-*•]\s/.test(l) ? 'bullet' : '';
const noteChecked = l => /^\s*(?:☑|\[[xX]\])/.test(l);
const noteText = l => noteKind(l) ? l.replace(NOTE_RE, '') : l;

/** Campo de texto com botões de lista e checklist, como nos apps de notas. */
const noteField = (name, value, label = 'Detalhes') => `<div class="field note-field">
  <div class="note-head"><span>${esc(label)}</span><span class="note-tools">
    <button type="button" class="icon-btn ghost sm" data-note="bullet" title="Lista" aria-label="Lista">${icon('list')}</button>
    <button type="button" class="icon-btn ghost sm" data-note="check" title="Checklist" aria-label="Checklist">${icon('check')}</button>
  </span></div>
  <textarea name="${name}" rows="4">${esc(value || '')}</textarea>
</div>`;

/** Liga/desliga lista ou checklist nas linhas selecionadas (ou na linha do cursor). */
function noteFormat(ta, kind) {
  const v = ta.value;
  const a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let b = v.indexOf('\n', ta.selectionEnd);
  if (b < 0) b = v.length;
  const lines = v.slice(a, b).split('\n');
  const off = lines.every(l => l.trim() && noteKind(l) === kind);
  const out = lines.map(l => off ? noteText(l) : NOTE_MARK[kind] + noteText(l)).join('\n');
  ta.value = v.slice(0, a) + out + v.slice(b);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = a + out.length;
}

/** Enter numa linha de lista continua a lista; numa linha vazia, encerra. */
function noteEnter(e) {
  const ta = e.target, v = ta.value, pos = ta.selectionStart;
  const a = v.lastIndexOf('\n', pos - 1) + 1;
  const line = v.slice(a, pos);
  const kind = noteKind(line);
  if (!kind || ta.selectionEnd !== pos) return;
  e.preventDefault();
  if (!noteText(line).trim()) {
    ta.value = v.slice(0, a) + v.slice(pos);
    ta.selectionStart = ta.selectionEnd = a;
    return;
  }
  const ins = '\n' + NOTE_MARK[kind];
  ta.value = v.slice(0, pos) + ins + v.slice(pos);
  ta.selectionStart = ta.selectionEnd = pos + ins.length;
}

/** Texto da ficha: parágrafos, listas e checklist. toggle(i) dá os atributos para marcar a linha i. */
function noteHTML(text, toggle) {
  if (!text) return '';
  const groups = [];
  text.split('\n').forEach((l, i) => {
    const kind = noteKind(l);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) last.lines.push([l, i]);
    else groups.push({ kind, lines: [[l, i]] });
  });
  return `<div class="note">${groups.map(({ kind, lines }) => {
    if (kind === 'bullet') return `<ul class="sheet-list">${lines.map(([l]) => `<li>${esc(noteText(l))}</li>`).join('')}</ul>`;
    if (kind === 'check') return `<div class="list">${lines.map(([l, i]) => {
      const on = noteChecked(l);
      return `<div class="task ${on ? 'done' : ''}"><button class="checkbox ${on ? 'on' : ''}" ${toggle ? toggle(i) : 'disabled'} role="checkbox" aria-checked="${on}" aria-label="Feito"></button>
        <span class="task-main"><span class="task-title">${esc(noteText(l))}</span></span></div>`;
    }).join('')}</div>`;
    const txt = lines.map(([l]) => l).join('\n').trim();
    return txt ? `<span class="pre">${esc(txt)}</span>` : '';
  }).join('')}</div>`;
}

/** Marca ou desmarca a linha i da checklist. */
function noteToggle(text, i) {
  const lines = text.split('\n');
  if (noteKind(lines[i]) === 'check') lines[i] = (noteChecked(lines[i]) ? '☐ ' : '☑ ') + noteText(lines[i]);
  return lines.join('\n');
}

function readList(form, name) {
  return $$(`.edit-list[data-list="${name}"] .item`, form)
    .map(row => ({
      id: row.dataset.id,
      text: $('input[type="text"]', row).value.trim(),
      done: !!$('input[type="checkbox"]', row)?.checked,
    }))
    .filter(it => it.text);
}

/** Seletor de dias da semana (chips). */
function dayToggles(name, selected) {
  const ws = +Store.settings.weekStart;
  return `<div class="day-toggles">${Array.from({ length: 7 }, (_, i) => (i + ws) % 7).map(d =>
    `<label><input type="checkbox" name="${name}" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${WEEKDAYS[d]}</span></label>`).join('')}</div>`;
}
const readDays = (form, name) => $$(`input[name="${name}"]:checked`, form).map(i => +i.value).sort();

/** Linha do editor de horários de aula. */
const slotRow = s => `<div class="slot-row" data-id="${esc(s.id)}">
  <select aria-label="Dia da semana">${options(WEEKDAYS_LONG.map((d, i) => [i, d]), s.weekday)}</select>
  <input type="time" value="${s.start}" aria-label="Início">
  <input type="time" value="${s.end}" aria-label="Fim">
  <input type="number" min="1" max="10" value="${s.weight || 1}" aria-label="Quantidade de aulas" title="Quantas aulas nesse horário">
  <input type="text" value="${esc(s.room || '')}" placeholder="Sala" aria-label="Sala">
  <button type="button" class="icon-btn ghost sm" data-remove-slot aria-label="Remover horário">${icon('x')}</button>
</div>`;

function readSlots(form) {
  return $$('.slot-row[data-id]', form).map(row => {
    const [wd, start, end, weight, room] = $$('select, input', row);
    return { id: row.dataset.id, weekday: +wd.value, start: start.value, end: end.value, weight: Math.max(1, +weight.value || 1), room: room.value.trim() };
  });
}

/** Barra de progresso. p em 0..1. */
const meter = (p, cls = '', color = '') =>
  `<div class="meter ${cls}" style="--p:${Math.round(clamp(p, 0, 1) * 100)}%;${color ? `--c:${esc(color)}` : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(p, 0, 1) * 100)}"><i></i></div>`;

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
