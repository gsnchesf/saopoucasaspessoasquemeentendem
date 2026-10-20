'use strict';
/* ==========================================================
   Expediente: horário de trabalho e deslocamento de cada pessoa.
   Entra sozinho na Agenda, em Hoje e em Essa semana.
   Store.settings.work:
     undefined → ainda não respondeu (Hoje pergunta)
     { off: true } → não trabalha
     { days: [1..5], start: 'HH:MM', end: 'HH:MM', commute: minutos de cada trecho, title: nome na agenda }
   ========================================================== */

const COMMUTE_COLOR = '#64748b';
const DEFAULT_WORK = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', commute: 0, title: 'Trabalho' };

/** Nome do expediente na agenda (ex.: Trabalho, Estágio). */
const workTitle = w => (w?.title || '').trim() || DEFAULT_WORK.title;

/** Expediente válido, ou null (não trabalha / não definido). */
function workSchedule() {
  const w = Store.settings.work;
  return w && !w.off && Array.isArray(w.days) && w.days.length && isTime(w.start) && isTime(w.end) && w.end > w.start ? w : null;
}

/** Itens da agenda (ida, trabalho, volta) entre duas datas. */
function workItems(from, to) {
  const w = workSchedule();
  const out = [];
  if (!w) return out;
  const s = toMin(w.start), e = toMin(w.end), c = Math.max(0, +w.commute || 0);
  const base = { allDay: false, deadline: false, label: '' };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!w.days.includes(weekday(d))) continue;
    if (c) out.push({ ...base, kind: 'commute', id: 'ida', date: d, title: 'Ida para o trabalho', start: fromMin(Math.max(0, s - c)), end: w.start, color: COMMUTE_COLOR });
    out.push({ ...base, kind: 'work', id: 'trabalho', date: d, title: workTitle(w), start: w.start, end: w.end, color: workColor() });
    if (c) out.push({ ...base, kind: 'commute', id: 'volta', date: d, title: 'Volta do trabalho', start: w.end, end: fromMin(Math.min(23 * 60 + 59, e + c)), color: COMMUTE_COLOR });
  }
  return out;
}

function daysLabel(days) {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sorted.join() === '1,2,3,4,5') return 'Seg a Sex';
  if (sorted.join() === '1,2,3,4,5,6') return 'Seg a Sáb';
  return sorted.map(d => WEEKDAYS[d]).join(', ');
}

function workSummary() {
  const w = Store.settings.work;
  if (w === undefined) return 'Ainda não definido';
  if (w.off) return 'Não trabalho';
  const sch = workSchedule();
  if (!sch) return 'Ainda não definido';
  return `${workTitle(sch)} · ${daysLabel(sch.days)} · ${sch.start}–${sch.end}${sch.commute ? ` · deslocamento de ${fmtDuration(sch.commute)} na ida e na volta` : ''}`;
}

/** Cartão de Hoje para quem ainda não respondeu se trabalha. */
function workPrompt() {
  if (Store.settings.work !== undefined) return '';
  return `<section class="card card-pad work-prompt">
    <span class="work-prompt-icon">${icon('briefcase')}</span>
    <div class="work-prompt-text"><h2>Você trabalha?</h2>
      <p class="desc">Coloque o horário de trabalho e o tempo de deslocamento. Eles entram sozinhos na agenda, em todos os dias de trabalho.</p></div>
    <div class="btn-row"><button class="btn btn-primary" data-action="edit-work">Colocar horário</button><button class="btn" data-action="no-work">Não trabalho</button></div>
  </section>`;
}

function workForm() {
  const cur = Store.settings.work;
  const w = { ...DEFAULT_WORK, ...(cur && !cur.off ? cur : {}) };
  const off = !!cur?.off;
  const c = Math.max(0, +w.commute || 0);
  openModal(`<form novalidate>
    ${modalHead('Horário de trabalho')}
    <div class="modal-body">
      <label class="check"><input type="checkbox" name="off" ${off ? 'checked' : ''}> Não trabalho</label>
      <div class="work-fields stack" ${off ? 'hidden' : ''}>
        <label class="field"><span>Nome na agenda</span><input name="title" maxlength="40" value="${esc(workTitle(w))}" placeholder="Ex.: Trabalho, Estágio"></label>
        <div><span class="fieldset-label">Dias de trabalho</span><div style="margin-top:6px">${dayToggles('days', w.days)}</div></div>
        <div class="row">
          <label class="field"><span>Começo</span><input type="time" name="start" value="${esc(w.start)}"></label>
          <label class="field"><span>Fim</span><input type="time" name="end" value="${esc(w.end)}"></label>
        </div>
        <div>
          <span class="fieldset-label">Deslocamento (cada trecho: ida e volta)</span>
          <div class="row" style="margin-top:6px">
            <label class="field xs"><span>Horas</span><input type="number" name="ch" min="0" max="5" value="${Math.floor(c / 60)}"></label>
            <label class="field xs"><span>Minutos</span><input type="number" name="cm" min="0" max="59" step="5" value="${c % 60}"></label>
          </div>
        </div>
      </div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false)}
  </form>`, {
    onMount(form) {
      form.elements.off.addEventListener('change', () => { $('.work-fields', form).hidden = form.elements.off.checked; });
    },
    onSubmit(form) {
      if (form.elements.off.checked) {
        Store.settings.work = { off: true };
      } else {
        const f = formData(form);
        const days = readDays(form, 'days');
        const commute = (+f.ch || 0) * 60 + (+f.cm || 0);
        if (!days.length) return formError(form, 'Escolha pelo menos um dia.');
        if (!f.start || !f.end || f.end <= f.start) return formError(form, 'Confira os horários: o fim precisa ser depois do começo.');
        if (commute < 0 || commute > 5 * 60) return formError(form, 'O deslocamento precisa ficar entre 0 e 5 horas.');
        Store.settings.work = { days, start: f.start, end: f.end, commute, title: f.title.trim() || DEFAULT_WORK.title };
      }
      Store.saveSettings();
      closeModal();
      render();
      toast(Store.settings.work.off ? 'Ok: sem horário de trabalho na agenda' : 'Horário de trabalho na agenda');
    },
  });
}

Object.assign(actions, {
  'edit-work': () => workForm(),
  'no-work': () => {
    Store.settings.work = { off: true };
    Store.saveSettings();
    render();
    toast('Ok! Se mudar, é só ir em Ajustes → Horário de trabalho.');
  },
});
