'use strict';
/* ==========================================================
   Trabalho: entregas com prazo, detalhes, prioridade e
   checklist, organizadas num quadro por status.
   ========================================================== */

const PRIO_RANK = { alta: 0, media: 1, baixa: 2 };
const deliverySort = (a, b) => (a.due || '9999').localeCompare(b.due || '9999')
  || (a.time || '99').localeCompare(b.time || '99')
  || (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3);

function deliveryCard(d) {
  const t = today();
  const open = d.status !== 'entregue';
  const late = open && d.due && d.due < t;
  const soon = open && !late && d.due && diffDays(t, d.due) <= 2;
  const items = d.checklist || [];
  const done = items.filter(i => i.done).length;
  const prio = d.priority === 'alta' || d.priority === 'media'
    ? `<span class="badge ${d.priority === 'alta' ? 'danger' : 'warn'}">${icon('flag')}${d.priority === 'alta' ? 'Alta' : 'Média'}</span>` : '';
  return `<button class="dcard" draggable="true" data-action="edit-deliverable" data-id="${esc(d.id)}">
    <b>${esc(d.title)}</b>
    <span class="meta">
      ${d.project ? `<span>${esc(d.project)}</span>` : ''}
      ${d.due ? `<span class="${late ? 'late' : soon ? 'soon' : ''}">${icon('clock')} ${relDay(d.due)}${d.time ? ' · ' + d.time : ''}</span>` : '<span>Sem prazo</span>'}
      ${prio}
    </span>
    ${items.length ? `<span class="meta"><span>${done}/${items.length} itens</span></span>${meter(done / items.length)}` : ''}
  </button>`;
}

function kanbanHTML() {
  const q = norm(state.workQuery.trim());
  const list = Store.data.deliverables.filter(d => !q || norm(`${d.title} ${d.project} ${d.details}`).includes(q));
  return DELIVERY_STATUS.map(([status, label]) => {
    let items = list.filter(d => (d.status || 'afazer') === status);
    let extra = '';
    if (status === 'entregue') {
      items.sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));
      if (items.length > 8) { extra = `<p class="desc" style="padding:0 4px">+${items.length - 8} entregas anteriores</p>`; items = items.slice(0, 8); }
    } else items.sort(deliverySort);
    return `<section class="kcol" data-status="${status}">
      <div class="kcol-head"><h3>${label} <span class="count">${items.length}</span></h3>
        ${status === 'afazer' ? `<button class="icon-btn ghost sm" data-action="new-deliverable" aria-label="Nova entrega">${icon('plus')}</button>` : ''}</div>
      ${items.map(deliveryCard).join('') || '<p class="desc" style="padding:0 4px 6px">Nada aqui.</p>'}${extra}
    </section>`;
  }).join('');
}

screens.trabalho = () => {
  const t = today();
  const all = Store.data.deliverables;
  const open = all.filter(d => d.status !== 'entregue');
  const late = open.filter(d => d.due && d.due < t).length;
  const weekEnd = periodRange('semana')[1];
  const thisWeek = open.filter(d => d.due && d.due >= t && d.due <= weekEnd).length;
  const doing = open.filter(d => d.status === 'andamento' || d.status === 'revisao').length;
  const month = t.slice(0, 7);
  const deliveredMonth = all.filter(d => d.status === 'entregue' && d.deliveredAt && toISO(new Date(d.deliveredAt)).slice(0, 7) === month).length;

  const head = `<div class="title-block"><h1>Trabalho</h1><p class="sub">${plural(open.length, 'entrega em aberto', 'entregas em aberto')}</p></div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="work-search" type="search" placeholder="Buscar entregas" value="${esc(state.workQuery)}"></label>
      <button class="btn btn-primary" data-action="new-deliverable">${icon('plus')}Entrega</button>
    </div>`;
  const body = `<div class="stats">
      <div class="card stat ${late ? 'danger' : ''}"><div class="n">${late}</div><div class="l">${late === 1 ? 'atrasada' : 'atrasadas'}</div></div>
      <div class="card stat"><div class="n">${thisWeek}</div><div class="l">vencem esta semana</div></div>
      <div class="card stat"><div class="n">${doing}</div><div class="l">em andamento / revisão</div></div>
      <div class="card stat"><div class="n">${deliveredMonth}</div><div class="l">entregues no mês</div></div>
    </div>
    <div class="kanban" id="kanban">${kanbanHTML()}</div>`;
  return { head, body, after: bindKanbanDnD };
};

/** Arrastar e soltar entre colunas (mouse/trackpad). */
function bindKanbanDnD() {
  const board = $('#kanban');
  if (!board || board.dataset.bound) return;
  board.dataset.bound = '1';
  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.dcard');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', e => e.target.closest('.dcard')?.classList.remove('dragging'));
  board.addEventListener('dragover', e => {
    const col = e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    $$('.kcol.over', board).forEach(c => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  });
  board.addEventListener('dragleave', e => { if (!e.relatedTarget || !board.contains(e.relatedTarget)) $$('.kcol.over', board).forEach(c => c.classList.remove('over')); });
  board.addEventListener('drop', e => {
    const col = e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    const d = Store.get('deliverables', e.dataTransfer.getData('text/plain'));
    if (d && d.status !== col.dataset.status) setDeliveryStatus(d, col.dataset.status);
    else render();
  });
}

function setDeliveryStatus(d, status) {
  const before = d.status;
  d.status = status;
  d.deliveredAt = status === 'entregue' ? Date.now() : null;
  Store.upsert('deliverables', d);
  render();
  const label = DELIVERY_STATUS.find(s => s[0] === status)[1];
  toast(`“${d.title}” → ${label}`, { label: 'Desfazer', fn: () => setDeliveryStatus(d, before) });
}

function deliverableForm(d, date = '') {
  const isNew = !d;
  d = d ? structuredClone(d) : {
    id: uid(), title: '', project: '', due: date, time: '', status: 'afazer', priority: '', details: '', checklist: [], deliveredAt: null,
  };
  const projects = [...new Set(Store.data.deliverables.map(x => x.project).filter(Boolean))];
  openModal(`<form novalidate>
    ${modalHead(isNew ? 'Nova entrega' : 'Editar entrega')}
    <div class="modal-body">
      <label class="field"><span>Entrega</span><input name="title" maxlength="160" value="${esc(d.title)}" ${isNew ? 'autofocus' : ''} placeholder="Ex.: Relatório mensal de vendas"></label>
      <label class="field"><span>Projeto / cliente</span><input name="project" maxlength="80" value="${esc(d.project)}" list="project-list" placeholder="Opcional"></label>
      <datalist id="project-list">${projects.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="row">
        <label class="field"><span>Prazo</span><input type="date" name="due" value="${d.due || ''}"></label>
        <label class="field"><span>Até às</span><input type="time" name="time" value="${d.time || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Status</span><select name="status">${options(DELIVERY_STATUS, d.status)}</select></label>
        <label class="field"><span>Prioridade</span><select name="priority">${options(PRIORITIES, d.priority)}</select></label>
      </div>
      <label class="field"><span>Detalhes</span><textarea name="details" rows="4">${esc(d.details)}</textarea></label>
      <div><span class="fieldset-label">Checklist</span><div style="margin-top:6px">${listEditor('checklist', d.checklist || [], { addLabel: 'Adicionar etapa' })}</div></div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(!isNew)}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      if (!f.title.trim()) return formError(form, 'Falta o título.');
      if (f.time && !f.due) return formError(form, 'Escolha a data também.');
      const wasDelivered = d.status === 'entregue';
      Object.assign(d, {
        title: f.title.trim(), project: f.project.trim(), due: f.due, time: f.time, status: f.status,
        priority: f.priority, details: f.details.trim(), checklist: readList(form, 'checklist'),
      });
      if (f.status === 'entregue' && !wasDelivered) d.deliveredAt = Date.now();
      if (f.status !== 'entregue') d.deliveredAt = null;
      Store.upsert('deliverables', d);
      closeModal();
      render();
      toast(isNew ? 'Entrega criada' : 'Entrega atualizada');
    },
    onDelete: () => {
      const removed = Store.remove('deliverables', d.id);
      closeModal();
      render();
      toast('Entrega excluída', { label: 'Desfazer', fn: () => { Store.upsert('deliverables', removed); render(); } });
    },
  });
}

Object.assign(actions, {
  'new-deliverable': el => deliverableForm(null, el.dataset.date || ''),
  'edit-deliverable': el => { const d = Store.get('deliverables', el.dataset.id); if (d) deliverableForm(d); },
});
