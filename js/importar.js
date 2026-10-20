'use strict';
/* ==========================================================
   Importar grade do JupiterWeb (USP).
   - Favorito: roda na página da Grade Horária, junta as tabelas
     da grade e as páginas públicas de cada disciplina (nome,
     professor, sala, início/fim da turma) e abre o organizador
     com os dados no endereço (depois do #, que não vai a servidor).
   - Colar: o texto/HTML copiado da grade também funciona.
   Toda a interpretação fica aqui no app; o favorito só coleta.
   ========================================================== */

const JUPITER = 'https://uspdigital.usp.br/jupiterweb/';
const CLASS_CODE = /\b([A-Z]{3}\d{4})-(\d{7})\b/g;
const DAY_COLS = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, dom: 0 };

let pendingImport = null;

/* ---------- Favorito (roda no JupiterWeb, não no app) ----------
   Sem comentários de linha aqui dentro: o código vira um endereço javascript:. */

function jupiterBookmarklet(APP, JUPITER) {
  const w = window.open('', '_blank'); /* abre já, senão o bloqueador de pop-up barra */
  const tables = d => [...d.querySelectorAll('table')].filter(t => !t.querySelector('table'))
    .map(t => [...t.rows].map(r => [...r.cells].map(c => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim())));
  const docs = [document];
  for (const f of document.querySelectorAll('iframe, frame')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {} }
  const grade = docs.flatMap(tables);
  const codes = {};
  for (const m of JSON.stringify(grade).matchAll(/\b([A-Z]{3}\d{4})-(\d{7})\b/g)) codes[m[1]] = m[2];
  if (!Object.keys(codes).length) {
    if (w) w.close();
    alert('Não encontrei a grade. Abra a Grade Horária no JupiterWeb e clique no favorito de novo.');
    return;
  }
  const load = async url => {
    const r = await fetch(url, { credentials: 'include' });
    const cs = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1] || 'iso-8859-1';
    return new DOMParser().parseFromString(new TextDecoder(cs).decode(await r.arrayBuffer()), 'text/html');
  };
  const disc = {};
  Promise.all(Object.keys(codes).map(async c => {
    disc[c] = { turma: codes[c] };
    try { disc[c].nameLine = ((await load(JUPITER + 'obterDisciplina?sgldis=' + c)).body.textContent.match(/Disciplina:[^\n]*/) || [''])[0].replace(/\s+/g, ' ').trim(); } catch (e) {}
    try { disc[c].tables = tables(await load(JUPITER + 'obterTurma?sgldis=' + c)); } catch (e) {}
  })).then(() => {
    const url = APP + '#/importar/' + encodeURIComponent(JSON.stringify({ v: 1, grade, disc }));
    if (w) w.location.href = url; else location.href = url;
  });
}

function bookmarkletHref() {
  const app = location.origin + location.pathname;
  return 'javascript:' + encodeURIComponent(`(${jupiterBookmarklet})(${JSON.stringify(app)},${JSON.stringify(JUPITER)})`);
}

/* ---------- Interpretação ---------- */

const cleanCell = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const isClock = s => /^\d{1,2}:\d{2}$/.test(s);
const clock = s => s.padStart(5, '0');
const dayKey = s => norm(s).slice(0, 3);
const brDate = s => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

/** Aulas de um horário: 1 aula = 50 min (19:30–21:10 = 2; 19:30–23:00 = 4). */
const classesIn = (start, end) => Math.max(1, Math.round((toMin(end) - toMin(start)) / 50));

/** Lê a grade (tabelas como listas de linhas de células) e devolve as turmas com horários. */
function parseGrade(tables) {
  const found = {};
  for (const rows of tables) {
    const h = rows.findIndex(r => r.some(c => dayKey(c) === 'seg') && r.some(c => dayKey(c) === 'dom'));
    if (h < 0) continue;
    const head = rows[h].map(cleanCell);
    const days = head.map(c => DAY_COLS[dayKey(c)] ?? null);
    for (const row of rows.slice(h + 1)) {
      const cells = row.map(cleanCell);
      const times = cells.filter(isClock);
      if (times.length < 2) continue;
      const iStart = cells.findIndex(isClock);
      const start = clock(cells[iStart]), end = clock(cells[iStart + 1]);
      if (end <= start) continue;
      cells.forEach((c, i) => {
        if (days[i] == null) return;
        for (const m of c.matchAll(CLASS_CODE)) {
          const s = (found[m[1]] ||= { code: m[1], turma: m[2], slots: [] });
          s.slots.push({ weekday: days[i], start, end, weight: classesIn(start, end) });
        }
      });
    }
  }
  const order = x => (x.weekday + 6) % 7; // segunda primeiro
  for (const s of Object.values(found)) s.slots.sort((a, b) => order(a) - order(b) || a.start.localeCompare(b.start));
  return Object.values(found);
}

/** Texto colado: linhas separadas por quebra, células por tabulação. */
const textToTables = text => [text.split(/\r?\n/).map(l => l.split('\t'))];

function htmlToTables(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('table')].filter(t => !t.querySelector('table'))
    .map(t => [...t.rows].map(r => [...r.cells].map(c => cleanCell(c.textContent))));
}

/** Página pública da turma: início/fim, observações (sala) e professores. */
function parseTurma(tables, turma) {
  const i = (tables || []).findIndex(rows => rows.some(r => /c[oó]digo da turma/i.test(r[0] || '') && cleanCell(r[1]) === turma));
  if (i < 0) return null;
  const info = Object.fromEntries(tables[i].map(r => [norm(cleanCell(r[0]).replace(/:$/, '')), cleanCell(r[1])]));
  const obs = info['observacoes'] || '';
  const room = (/\bsala\s+([^(]+)/i.exec(obs)?.[1] || '').trim().replace(/[.,;]$/, '');
  const sched = tables.slice(i + 1).find(rows => /hor[aá]rio/i.test(rows[0]?.[0] || ''));
  const profs = [...new Set((sched || []).slice(1).map(r => cleanCell(r[3]).replace(/^\([A-Z]\)\s*/, '')).filter(Boolean))];
  return { start: brDate(info['inicio']), end: brDate(info['fim']), notes: obs, room: room.slice(0, 60), professor: profs.join(' / ') };
}

/** Junta grade + páginas das disciplinas numa lista pronta para revisar. */
function buildImport(payload) {
  const list = parseGrade(payload.grade || []);
  for (const s of list) {
    const d = payload.disc?.[s.code] || {};
    s.name = (new RegExp(`Disciplina:\\s*${s.code}\\s*-\\s*(.+)`).exec(d.nameLine || '')?.[1] || '').trim();
    Object.assign(s, parseTurma(d.tables, s.turma) || {});
  }
  return list.sort((a, b) => a.code.localeCompare(b.code));
}

/* ---------- Telas ---------- */

function importForm() {
  openModal(`<form novalidate>
    ${modalHead('Importar grade do JupiterWeb')}
    <div class="modal-body">
      <h3 class="section-label" style="padding:0;margin:0">No computador: favorito</h3>
      <ol class="steps-list">
        <li>Arraste o botão abaixo para a barra de favoritos (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> mostra a barra).</li>
        <li>No JupiterWeb, abra a sua <b>Grade Horária</b>.</li>
        <li>Clique no favorito. O organizador abre numa aba nova com nomes, professores, salas e o semestre para você conferir.</li>
      </ol>
      <div class="btn-row">
        <a class="btn btn-primary bookmarklet" href="${esc(bookmarkletHref())}" draggable="true" title="Arraste para a barra de favoritos">${icon('upload')}Grade → Organizador</a>
        <button type="button" class="btn" data-copy-bookmarklet>Copiar código do favorito</button>
      </div>
      <p class="desc" style="margin:0">No iPhone: salve qualquer página nos favoritos, edite esse favorito e cole o código copiado no lugar do endereço.</p>
      <h3 class="section-label" style="padding:0;margin:8px 0 0">Ou cole a grade</h3>
      <div class="paste-box" contenteditable="true" role="textbox" aria-label="Cole aqui a grade copiada do JupiterWeb" data-placeholder="No JupiterWeb, selecione a Grade Horária (Ctrl + A), copie (Ctrl + C) e cole aqui (Ctrl + V)."></div>
      <p class="desc" style="margin:0">Colando, só vêm os códigos e horários; você completa os nomes na revisão.</p>
      <p class="form-error" hidden></p>
    </div>
  </form>`, {
    onMount(form) {
      $('.bookmarklet', form).addEventListener('click', e => { e.preventDefault(); toast('Esse botão funciona na página do JupiterWeb: arraste-o para a barra de favoritos.'); });
      $('[data-copy-bookmarklet]', form).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(decodeURIComponent(bookmarkletHref())); toast('Código do favorito copiado'); }
        catch { toast('Não foi possível copiar. Arraste o botão para os favoritos.'); }
      });
      $('.paste-box', form).addEventListener('paste', e => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        let list = html ? buildImport({ grade: htmlToTables(html) }) : [];
        if (!list.length && text) list = buildImport({ grade: textToTables(text) });
        if (!list.length) return formError(form, 'Não reconheci uma grade no que foi colado. Copie a tabela da Grade Horária inteira, com a linha “Início Fim Seg Ter…”.');
        importReview(list);
      });
    },
  });
}

function importReview(list) {
  if (!list.length) return toast('Nenhuma disciplina encontrada na grade.');
  const st = Store.settings;
  const sem = list.filter(s => s.start && s.end);
  const semStart = sem.length ? sem.map(s => s.start).sort()[0] : '';
  const semEnd = sem.length ? sem.map(s => s.end).sort().pop() : '';
  const semChanged = semStart && (semStart !== st.semesterStart || semEnd !== st.semesterEnd);
  const existing = s => Store.data.subjects.find(x => x.code === s.code) || Store.data.subjects.find(x => norm(x.name) === norm(s.name || s.code));
  const slotsLabel = s => s.slots.map(x => `${WEEKDAYS[x.weekday]} ${x.start}–${x.end}`).join(' · ');
  const perWeek = s => s.slots.reduce((n, x) => n + x.weight, 0);

  openModal(`<form novalidate>
    ${modalHead('Conferir importação')}
    <div class="modal-body">
      ${semStart ? `<label class="check"><input type="checkbox" name="semester" ${semChanged ? 'checked' : ''}> Usar o semestre da turma: ${esc(fmt(semStart, { day: 'numeric', month: 'short' }))} – ${esc(fmt(semEnd, { day: 'numeric', month: 'short', year: 'numeric' }))}</label>` : ''}
      <div class="import-list">${list.map((s, i) => {
        const ex = existing(s);
        return `<div class="import-row">
          <label class="check"><input type="checkbox" name="use-${i}" checked aria-label="Importar ${esc(s.code)}"></label>
          <div class="import-main">
            <div class="row">
              <label class="field"><span>${esc(s.code)} · turma ${esc(s.turma)}</span><input name="name-${i}" maxlength="120" value="${esc(s.name || ex?.name || '')}" placeholder="Nome da disciplina"></label>
            </div>
            <p class="desc">${icon('clock')}${esc(slotsLabel(s))} · ${plural(perWeek(s), 'aula', 'aulas')} por semana</p>
            ${s.professor || s.room ? `<p class="desc">${[s.professor && `Prof. ${esc(s.professor)}`, s.room && `Sala ${esc(s.room)}`].filter(Boolean).join(' · ')}</p>` : ''}
            <span class="badge ${ex ? 'warn' : 'ok'}">${ex ? `Já existe (“${esc(ex.name)}”): horários serão atualizados` : 'Nova matéria'}</span>
          </div>
        </div>`;
      }).join('')}</div>
      <p class="form-error" hidden></p>
    </div>
    ${modalFoot(false, 'Importar')}
  </form>`, {
    onSubmit(form) {
      const f = formData(form);
      const chosen = list.map((s, i) => ({ s, i })).filter(({ i }) => f[`use-${i}`]);
      if (!chosen.length) return formError(form, 'Marque pelo menos uma disciplina.');
      if (chosen.some(({ i }) => !f[`name-${i}`].trim())) return formError(form, 'Dê um nome a cada disciplina marcada.');
      let created = 0;
      for (const { s, i } of chosen) {
        const ex = existing(s);
        const subj = ex ? structuredClone(ex) : { id: uid(), color: SWATCHES[(Store.data.subjects.length + created++) % SWATCHES.length], professor: '', room: '', notes: '' };
        Object.assign(subj, {
          name: f[`name-${i}`].trim(), code: s.code, turma: s.turma,
          slots: s.slots.map(x => ({ id: uid(), ...x, room: '' })),
          professor: s.professor || subj.professor, room: s.room || subj.room,
          notes: subj.notes || s.notes || '',
        });
        Store.upsert('subjects', subj);
      }
      if (f.semester) {
        Store.settings.semesterStart = semStart;
        Store.settings.semesterEnd = semEnd;
        Store.saveSettings();
      }
      closeModal();
      state.facTab = 'materias';
      location.hash = '#/faculdade';
      render();
      toast(`${plural(chosen.length, 'disciplina importada', 'disciplinas importadas')}`);
    },
  });
}

/** Chamado na abertura: guarda os dados vindos do favorito e limpa o endereço. */
function captureImportFromURL() {
  const m = /^#\/importar\/(.+)$/.exec(location.hash);
  if (!m) return;
  try { pendingImport = JSON.parse(decodeURIComponent(m[1])); } catch { pendingImport = null; }
  history.replaceState(null, '', location.pathname + location.search + '#/faculdade');
}

function runPendingImport() {
  if (!pendingImport) return;
  const list = buildImport(pendingImport);
  pendingImport = null;
  if (list.length) importReview(list);
  else toast('Não encontrei disciplinas na grade enviada pelo JupiterWeb.');
}

Object.assign(actions, {
  'import-jupiter': () => importForm(),
});
