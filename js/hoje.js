'use strict';
/* ==========================================================
   Hoje: painel do dia — aulas e compromissos, prazos que se
   aproximam, remédios do dia e progresso das metas.
   ========================================================== */

screens.hoje = () => {
  const t = today();
  const map = agendaItems(t, addDays(t, 14));
  const todayItems = map[t] || [];
  // Remédios têm cartão próprio.
  const timeline = todayItems.filter(i => !i.deadline && i.kind !== 'med');
  const tomorrow = (map[addDays(t, 1)] || []).filter(i => !i.deadline && i.kind !== 'med');
  const classesToday = timeline.filter(i => i.kind === 'class' && !i.canceled);

  const overdueMap = agendaItems(addDays(t, -90), addDays(t, -1), { classes: false });
  const overdue = Object.values(overdueMap).flat().filter(i => i.deadline && !i.done && !i.skipped);
  const upcoming = [];
  for (let i = 0; i <= 14; i++) {
    const d = addDays(t, i);
    const items = (map[d] || []).filter(x => x.deadline && !x.done && !x.skipped);
    if (items.length) upcoming.push([d, items]);
  }
  const next7 = upcoming.filter(([d]) => diffDays(t, d) <= 7).reduce((n, [, l]) => n + l.length, 0);

  const workoutsToday = timeline.filter(i => i.kind === 'workout');
  const goalsList = activitiesList().filter(hasPace);
  const onTrack = goalsList.filter(onPace).length;

  const h = new Date().getHours();
  const greet = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = Store.settings.name || palette().hello || '';
  const head = `<div class="title-block">
    <h1>${greet}${name ? ', ' + esc(name) : ''}</h1>
    <p class="sub">${cap(fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
    ${palette().tagline ? `<p class="tagline">“${esc(palette().tagline)}”</p>` : ''}
  </div>`;

  const isEmpty = !Store.data.subjects.length && !Store.data.activities.length && !Store.data.events.length && !Store.data.deliverables.length;
  const onboarding = isEmpty ? `<section class="card card-pad" style="margin-bottom:16px">
    <div class="card-head"><h2>Primeiros passos</h2></div>
    <div class="list">
      <button class="step" data-action="edit-semester">${icon('calendar')}<span><b>1.</b> Defina as datas do semestre</span></button>
      <button class="step" data-action="new-subject">${icon('book')}<span><b>2.</b> Cadastre suas matérias</span></button>
      <button class="step" data-action="new-deliverable">${icon('briefcase')}<span><b>3.</b> Adicione as entregas do trabalho</span></button>
      <button class="step" data-action="new-activity">${icon('target')}<span><b>4.</b> Crie suas metas</span></button>
      <a class="step" href="#/ajustes">${icon('gear')}<span><b>5.</b> Escolha seu tema</span></a>
    </div>
  </section>` : '';

  const stats = `<div class="stats">
    <div class="card stat"><div class="n">${classesToday.length}</div><div class="l">${classesToday.length === 1 ? 'aula hoje' : 'aulas hoje'}</div></div>
    <div class="card stat ${overdue.length ? 'danger' : ''}"><div class="n">${overdue.length ? overdue.length : next7}</div><div class="l">${overdue.length ? (overdue.length === 1 ? 'prazo atrasado' : 'prazos atrasados') : 'prazos em 7 dias'}</div></div>
    <div class="card stat"><div class="n">${workoutsToday.length ? `${workoutsToday.filter(i => i.state === 'done').length}<small>/${workoutsToday.length}</small>` : '—'}</div><div class="l">treino hoje</div></div>
    <div class="card stat"><div class="n">${goalsList.length ? `${onTrack}<small>/${goalsList.length}</small>` : '—'}</div><div class="l">metas no ritmo</div></div>
  </div>`;

  const agenda = `<section class="card card-pad">
    <div class="card-head"><h2>Agenda de hoje</h2><button class="btn btn-sm" data-action="new-event" data-date="${t}">${icon('plus')}Compromisso</button></div>
    ${timeline.length ? `<div class="list">${timeline.map(itemRow).join('')}</div>` : '<p class="empty">Dia livre.</p>'}
    ${tomorrow.length ? `<h3 class="section-label" style="margin-top:16px">Amanhã</h3><div class="list">${tomorrow.map(itemRow).join('')}</div>` : ''}
  </section>`;

  const prazos = `<section class="card card-pad">
    <div class="card-head"><h2>Prazos</h2><a class="link" href="#/agenda">Ver agenda</a></div>
    ${overdue.length ? `<h3 class="section-label danger">Atrasados</h3><div class="list">${overdue.sort((a, b) => a.date.localeCompare(b.date)).map(i => deadlineRow(i)).join('')}</div>` : ''}
    ${upcoming.map(([d, items]) => `<h3 class="section-label">${relDay(d)} <span class="count">${untilLabel(d)}</span></h3><div class="list">${items.map(i => deadlineRow(i)).join('')}</div>`).join('')}
    ${!overdue.length && !upcoming.length ? '<p class="empty">Nada nas próximas duas semanas.</p>' : ''}
    <div class="panel-actions">
      <button class="btn btn-sm" data-action="new-assessment">${icon('plus')}Prazo da faculdade</button>
      <button class="btn btn-sm" data-action="new-deliverable">${icon('plus')}Entrega</button>
    </div>
  </section>`;

  const goals = `<section class="card card-pad">
    <div class="card-head"><h2>Metas</h2><a class="link" href="#/metas">Ver todas</a></div>
    ${goalsMini()}
  </section>`;

  const art = Store.illustration ? `<div class="mobile-art" style="background-image:url('${Store.illustration}')"></div>` : '';
  const body = `${art}${workPrompt()}${onboarding}${stats}
    <div class="home-grid">
      <div class="home-col">${agenda}${prazos}</div>
      <div class="home-col">${medsToday()}${finToday()}${goals}</div>
    </div>`;
  return { head, body };
};

/** Linha de prazo com o contexto (matéria ou projeto) e a distância em dias. Atrasado tem "Não fiz". */
function deadlineRow(it) {
  const late = it.date < today();
  const row = `<button class="ev-row" style="--c:${esc(it.color)}" ${itemAttrs(it)}>
    <span class="ev-bar"></span>
    <span class="ev-main">
      <span class="ev-title"><span>${esc(it.title)}</span></span>
      <span class="ev-meta">${it.label ? `<span>${esc(it.label)}</span>` : ''}<span class="${late ? 'late' : ''}">${late ? untilLabel(it.date) : relDay(it.date)}${it.start ? ' · até ' + it.start : ''}</span></span>
    </span>
    <span class="ev-side"><span class="badge k-${it.badge}">${BADGE_LABEL[it.badge]}</span></span>
  </button>`;
  return late ? `<div class="row-wrap">${row}<div class="ev-side"><button class="btn btn-sm" data-action="skip-deadline" data-kind="${it.kind}" data-id="${esc(it.id)}">Não fiz</button></div></div>` : row;
}
