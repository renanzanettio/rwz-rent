'use strict';
(() => {
  /* ---------- utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (c) => `<small>R$</small> ${num(c)}`;
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const KIND = { aluguel: 'Aluguel', agua: 'Água', luz: 'Luz' };
  const METHOD = { pix: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro' };
  const STATUS = { pago: 'Pago', atrasado: 'Atrasado', pendente: 'Pendente', parcial: 'Parcial' };
  const DOT = { pago: '✓', atrasado: '!', pendente: '…', parcial: '½' };
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curMonth = () => todayStr().slice(0, 7);
  const addMonth = (ym, n) => {
    let [y, m] = ym.split('-').map(Number);
    m += n - 1; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  };
  const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  const monthShort = (ym) => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)}/${ym.slice(2, 4)}`;
  const fmtDate = (d) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : '');
  const fmtFull = (d) => (d ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const centsInput = (c) => (c / 100).toFixed(2).replace('.', ',');
  const sum = (list, k) => list.reduce((s, x) => s + x[k], 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function parseMoney(s) {
    s = String(s).replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  const ICON = {
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  /* ---------- preferências (valem só para este aparelho) ---------- */
  const PREF_KEY = 'alugueis:prefs';
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { /* sem acesso */ }
    return {
      mode: p.mode === 'facil' || p.mode === 'completo' ? p.mode : (window.innerWidth >= 900 ? 'completo' : 'facil'),
      theme: p.theme === 'claro' || p.theme === 'escuro' ? p.theme : 'auto',
      font: [100, 115, 130, 150].includes(p.font) ? p.font : 100,
    };
  }
  const prefs = loadPrefs();
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* sem acesso */ }
  }
  function applyPrefs() {
    const r = document.documentElement;
    if (prefs.theme === 'auto') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', prefs.theme === 'claro' ? 'light' : 'dark');
    r.style.setProperty('--fscale', String(prefs.font / 100));
    r.setAttribute('data-mode', prefs.mode);
  }
  applyPrefs();
  const isFull = () => prefs.mode === 'completo';

  const app = $('#app');
  const sheetRoot = $('#sheet-root');
  const state = { month: curMonth(), data: null, houses: [], chargeId: null, billId: null, bill: null, report: { from: `${curMonth().slice(0, 4)}-01`, to: curMonth() } };

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), 4200);
  }

  async function api(method, path, body) {
    const r = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* sem corpo */ }
    if (r.status === 401 && !path.startsWith('/login') && !path.startsWith('/setup') && !path.startsWith('/pin')) {
      closeSheet(); boot(); throw new Error('Sua sessão expirou. Entre de novo com o PIN.');
    }
    if (!r.ok) throw new Error(data?.error || 'Algo deu errado. Tente de novo.');
    return data;
  }

  /* ---------- janela deslizante ---------- */
  function openSheet(html) {
    sheetRoot.innerHTML = `<div class="backdrop" data-backdrop><section class="sheet" role="dialog" aria-modal="true" tabindex="-1">${html}</section></div>`;
    document.body.style.overflow = 'hidden';
    $('.sheet', sheetRoot).focus();
  }
  function closeSheet() {
    sheetRoot.innerHTML = '';
    document.body.style.overflow = '';
  }
  const sheetHead = (title, sub) =>
    `<header><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div><button class="round" data-act="close" aria-label="Fechar">${ICON.x}</button></header>`;

  /* ---------- entrada: PIN ---------- */
  async function boot() {
    try {
      const s = await (await fetch('/api/status')).json();
      if (!s.configured) return renderAuth(true);
      if (!s.authed) return renderAuth(false);
      renderShell();
      route();
    } catch {
      app.innerHTML = '<div class="login"><h1>Sem conexão</h1><p class="muted">Não consegui falar com o servidor. Confira se ele está ligado e se o Wi-Fi está certo.</p><p></p><button class="btn primary" data-act="reload">Tentar de novo</button></div>';
    }
  }

  function renderAuth(setup) {
    app.innerHTML = `
      <div class="login">
        <div class="brand"><img src="icon-192.png" alt="">Aluguéis</div>
        <h1>${setup ? 'Crie um PIN' : 'Digite o PIN'}</h1>
        <p class="muted">${setup ? 'Ele protege o sistema. Use só números, de 4 a 8 dígitos, para ficar fácil de digitar.' : 'O PIN que foi criado no primeiro acesso.'}</p>
        <form id="auth-form" data-setup="${setup ? 1 : 0}">
          <label for="pin">PIN</label>
          <input id="pin" type="password" inputmode="numeric" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
          ${setup ? '<label for="pin2">Repita o PIN</label><input id="pin2" type="password" inputmode="numeric" autocomplete="new-password" required>' : ''}
          <p class="err" id="auth-err" role="alert"></p>
          <button class="btn primary block">${setup ? 'Salvar PIN e entrar' : 'Entrar'}</button>
        </form>
      </div>`;
    $('#pin').focus();
  }

  async function submitAuth(form) {
    const setup = form.dataset.setup === '1';
    const err = $('#auth-err');
    const pin = $('#pin').value;
    err.textContent = '';
    if (setup && pin !== $('#pin2').value) return (err.textContent = 'Os dois PINs não são iguais.');
    try {
      await api('POST', setup ? '/setup' : '/login', { pin });
      boot();
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------- estrutura e rotas ---------- */
  function renderShell() {
    const tab = (id, label, icon) => `<a href="#/${id}" data-tab="${id}">${icon}<span>${label}</span></a>`;
    app.innerHTML = `
      <div class="wrap">
        <div class="top"><div class="brand"><img src="icon-192.png" alt="">Aluguéis</div></div>
        <nav class="tabs" aria-label="Seções">${tab('mes', 'Mês', ICON.cal)}${tab('casas', 'Casas', ICON.home)}${isFull() ? tab('relatorio', 'Relatório', ICON.chart) : ''}${tab('ajustes', 'Ajustes', ICON.gear)}</nav>
        <main id="main"></main>
      </div>`;
  }

  async function route() {
    if (!$('#main')) return;
    let id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'mes';
    if (id === 'relatorio' && !isFull()) { id = 'mes'; history.replaceState(null, '', '#/mes'); }
    document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.tab === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $('#main').innerHTML = '<p class="muted">Carregando…</p>';
    try {
      if (id === 'casas') await viewHouses();
      else if (id === 'relatorio') await viewReport();
      else if (id === 'ajustes') viewSettings();
      else await viewMonth();
    } catch (e) {
      if ($('#main')) $('#main').innerHTML = `<div class="empty-state"><h3>Não deu para carregar</h3><p class="muted">${esc(e.message)}</p><button class="btn" data-act="reload">Tentar de novo</button></div>`;
    }
  }

  /* ---------- tela: mês ---------- */
  function statusText(c) {
    if (c.status === 'pago') {
      const last = c.payments[c.payments.length - 1];
      return last ? `Pago ${fmtDate(last.paid_at)}` : 'Pago';
    }
    if (c.status === 'atrasado') {
      const d = `Atrasado ${plural(c.days_late, 'dia', 'dias')}`;
      return c.paid_cents > 0 ? `${d}, faltam ${brl(c.remaining_cents)}` : d;
    }
    if (c.status === 'parcial') return `Faltam ${brl(c.remaining_cents)}`;
    return c.due_date ? `Vence ${fmtDate(c.due_date)}` : 'A pagar';
  }
  const findCharge = (hid, kind) => state.data.charges.find((x) => x.house_id === hid && x.kind === kind);
  // Ciclo da conta: lançada (a pagar) -> paga na companhia (a receber de volta) -> recebida dos moradores
  const STAGE = { lancada: ['pendente', 'A pagar'], vencida: ['atrasado', 'Vencida'], paga: ['parcial', 'Paga, a receber'], recebida: ['pago', 'Recebida'] };
  const billState = (b) => STAGE[b.stage] || STAGE.lancada;
  const grpOf = (h, kind) => (kind === 'luz' ? h.grp_luz : h.grp_agua) || '';
  const billTitle = (b) => `${KIND[b.kind]}, ${b.houses.map(esc).join(' e ')}`;

  async function viewMonth() {
    state.data = await api('GET', '/month/' + state.month);
    renderMonth();
  }

  function tile(h, kind) {
    const c = findCharge(h.id, kind);
    if (!c) {
      if (kind === 'aluguel') return '<div class="tile empty"><span class="k">Aluguel</span><span class="v">Sem cobrança</span></div>';
      return `<button class="tile empty" data-act="bill" data-house="${h.id}" data-kind="${kind}"><span class="k">${KIND[kind]}</span><span class="v">Sem conta</span><span class="s">+ Lançar</span></button>`;
    }
    return `<button class="tile st-${c.status}" data-act="charge" data-id="${c.id}">
      <span class="k"><span class="dot" aria-hidden="true">${DOT[c.status]}</span>${KIND[kind]}</span>
      <span class="v">${money(c.amount_cents)}</span>
      <span class="s">${c.status === 'pendente' || c.status === 'parcial' ? `<span class="sr">${STATUS[c.status]}: </span>` : ''}${esc(statusText(c))}</span>
    </button>`;
  }

  function cell(h, kind) {
    const c = findCharge(h.id, kind);
    if (!c) {
      if (kind === 'aluguel') return '<div class="tile cell empty"><span class="v">-</span></div>';
      return `<button class="tile cell empty" data-act="bill" data-house="${h.id}" data-kind="${kind}" aria-label="Lançar conta de ${KIND[kind].toLowerCase()} da ${esc(h.name)}"><span class="s">+ lançar</span></button>`;
    }
    return `<button class="tile cell st-${c.status}" data-act="charge" data-id="${c.id}"><span class="v">${num(c.amount_cents)}</span><span class="s">${c.status === 'pendente' || c.status === 'parcial' ? `<span class="sr">${STATUS[c.status]}: </span>` : ''}${esc(statusText(c))}</span></button>`;
  }

  function gridHtml() {
    const d = state.data;
    const kinds = ['aluguel', 'agua', 'luz'];
    const rows = d.houses.map((h) => `<div class="grid-row"><div class="gname"><b>${esc(h.name)}</b><small>${esc(h.tenant)}</small></div>${kinds.map((k) => cell(h, k)).join('')}</div>`).join('');
    const tot = kinds.map((k) => {
      const l = d.charges.filter((c) => c.kind === k);
      return `<div class="tile cell tot"><span class="v">${num(sum(l, 'paid_cents'))}</span><span class="s">de ${num(sum(l, 'amount_cents'))}</span></div>`;
    }).join('');
    return `<div class="scroll grid-wrap"><div class="grid">
      <div class="grid-row grid-head"><span>Casa</span><span>Aluguel</span><span>Água</span><span>Luz</span></div>
      ${rows}
      <div class="grid-row total"><div class="gname"><b>Total</b><small>recebido, em R$</small></div>${tot}</div>
    </div></div>`;
  }

  function billsSection() {
    const all = state.data.bills;
    const list = isFull() ? all : all.filter((b) => b.stage !== 'recebida');
    if (!list.length) return '';
    return `<section class="bills"><h3>${isFull() ? 'Contas de água e luz' : 'Contas de água e luz em andamento'}</h3>
      <ul class="rows">${list.map((b) => {
        const [st, label] = billState(b);
        const info = b.stage === 'paga' ? `Falta receber ${brl(b.remaining_cents)}` : b.stage === 'recebida' ? 'Tudo recebido' : b.due_date ? `Vence ${fmtDate(b.due_date)}` : 'Ainda não paga';
        return `<li class="btnrow"><button class="rowbtn" data-act="bill-open" data-id="${b.id}">
          <div><div class="name">${billTitle(b)}</div><div class="meta">Quem paga: ${esc(b.payer || 'não informado')}. ${info}</div></div>
          <div class="right"><b>${brl(b.total_cents)}</b><span class="pill st-${st}">${label}</span></div></button></li>`;
      }).join('')}</ul></section>`;
  }

  function renderMonth() {
    const d = state.data;
    const cs = d.charges;
    const expected = sum(cs, 'amount_cents');
    const received = sum(cs, 'paid_cents');
    const pct = expected ? Math.min(100, Math.round((received / expected) * 100)) : 0;
    const late = cs.filter((c) => c.status === 'atrasado').length;
    const wait = cs.filter((c) => c.status === 'pendente' || c.status === 'parcial').length;
    const toPay = d.bills.filter((b) => b.stage === 'lancada' || b.stage === 'vencida').length;
    const advance = sum(d.bills, 'advance_cents');
    const flags = [
      late ? `<span class="flag late">${plural(late, 'atrasado', 'atrasados')}</span>` : '',
      wait ? `<span class="flag wait">${wait} a receber</span>` : '',
      cs.length && !late && !wait ? '<span class="flag ok">Tudo recebido neste mês</span>' : '',
      toPay ? `<span class="flag wait">${plural(toPay, 'conta', 'contas')} para pagar</span>` : '',
      advance > 0 ? `<span class="flag wait">${brl(advance)} pagos na companhia, a receber</span>` : '',
    ].join('');
    const canNext = state.month < addMonth(curMonth(), 1);
    $('#main').innerHTML = `
      <div class="monthbar">
        <h2>${monthLabel(state.month)}</h2>
        <div class="nav"><button class="round" data-act="prev" aria-label="Mês anterior">${ICON.left}</button>
        <button class="round" data-act="next" aria-label="Próximo mês" ${canNext ? '' : 'disabled'}>${ICON.right}</button></div>
      </div>
      ${d.houses.length ? `
      <section class="summary" aria-label="Resumo do mês">
        <div class="amount">${brl(received)}</div>
        <div class="of">recebidos de ${brl(expected)}</div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <div class="flags">${flags}</div>
      </section>
      <div class="actions"><button class="btn block" data-act="bill">Lançar conta de água ou luz</button></div>
      ${isFull() ? gridHtml() : `<div class="houses">${d.houses.map((h) => `
        <section class="house"><h3>${esc(h.name)}</h3><p class="who">${esc(h.tenant || 'Sem inquilino cadastrado')}</p>
        <div class="tiles">${['aluguel', 'agua', 'luz'].map((k) => tile(h, k)).join('')}</div></section>`).join('')}</div>`}
      ${billsSection()}`
      : '<div class="empty-state"><h3>Nenhuma casa cadastrada</h3><p class="muted">Cadastre as casas para o sistema criar os aluguéis de cada mês.</p><a class="btn primary" href="#/casas">Cadastrar casas</a></div>'}`;
  }

  /* ---------- comprovante ---------- */
  const MAX_FILE = 4 * 1024 * 1024; // limite das funções da Vercel
  const TOO_BIG = 'O arquivo passa de 4 MB. Tire uma foto em vez do PDF ou reduza o arquivo.';
  async function prepareFile(f) {
    if (f.type === 'application/pdf') {
      if (f.size > MAX_FILE) throw new Error(TOO_BIG);
      return { blob: f, type: 'application/pdf' };
    }
    if (!f.type.startsWith('image/')) throw new Error('Envie uma foto ou um PDF.');
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
      if (!blob) throw new Error('falha');
      return { blob, type: 'image/jpeg' };
    } catch {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
        if (f.size > MAX_FILE) throw new Error(TOO_BIG);
        return { blob: f, type: f.type };
      }
      throw new Error('Esse formato de imagem não é aceito. Use JPG, PNG ou PDF.');
    }
  }

  async function uploadReceipt(url, file) {
    const { blob, type } = await prepareFile(file);
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
    if (r.status === 401) { boot(); throw new Error('Sua sessão expirou.'); }
    if (!r.ok) {
      let m = 'Não consegui enviar o comprovante.';
      try { m = (await r.json()).error || m; } catch { /* sem corpo */ }
      throw new Error(m);
    }
  }

  function pickReceipt(kind, id) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf';
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      toast('Enviando comprovante…');
      try {
        await uploadReceipt(kind === 'bill' ? `/api/bills/${id}/receipt` : `/api/payments/${id}/receipt`, inp.files[0]);
        toast('Comprovante salvo.');
        await viewMonth();
        if (kind === 'bill') openBillInfo(id); else openCharge(state.chargeId);
      } catch (e) { toast(e.message, true); }
    });
    inp.click();
  }

  /* ---------- janela: cobrança / pagamento ---------- */
  function openCharge(id) {
    const c = state.data.charges.find((x) => x.id === id);
    if (!c) return;
    state.chargeId = id;
    const bill = c.bill_id ? state.data.bills.find((b) => b.id === c.bill_id) : null;
    const pays = c.payments.map((p) => `
      <li><div class="row"><b>${brl(p.amount_cents)}</b><span>${METHOD[p.method] || p.method} em ${fmtFull(p.paid_at)}</span></div>
        <div class="acts">
          ${p.receipt ? `<a class="btn small" href="/receipts/${esc(p.receipt)}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}
          ${p.method === 'dinheiro' && !p.receipt ? '' : `<button class="btn small" data-act="attach" data-id="${p.id}">${p.receipt ? 'Trocar comprovante' : 'Anexar comprovante'}</button>`}
          <button class="btn small danger" data-act="del-pay" data-id="${p.id}">Remover</button>
        </div></li>`).join('');
    const shared = c.bill_houses && c.bill_houses.length > 1
      ? `<p class="hint">Conta de ${brl(c.bill_total_cents)} dividida igualmente entre ${c.bill_houses.map(esc).join(' e ')}.</p>` : '';
    const company = bill ? `<p class="line"><span>Conta na companhia: <b>${bill.company_paid_at ? `paga${bill.payer ? ` por ${esc(bill.payer)}` : ''} em ${fmtDate(bill.company_paid_at)}` : 'ainda não paga'}</b></span><button class="btn small" data-act="bill-open" data-id="${bill.id}">Ver conta</button></p>` : '';
    const partial = c.paid_cents > 0 && c.remaining_cents > 0
      ? `<p class="line"><span>Já recebido: <b>${brl(c.paid_cents)}</b></span><span>Falta: <b>${brl(c.remaining_cents)}</b></span></p>` : '';
    const today = todayStr();
    const payForm = c.remaining_cents > 0 ? `
      <h3>Registrar pagamento</h3>
      <form id="pay-form">
        <label for="p-amount">Valor recebido (R$)</label>
        <input id="p-amount" type="text" inputmode="decimal" value="${centsInput(c.remaining_cents)}" required>
        <fieldset><legend>Como foi pago?</legend>
          <div class="seg">
            <label><input type="radio" name="method" value="pix" checked><span>Pix</span></label>
            <label><input type="radio" name="method" value="dinheiro"><span>Dinheiro</span></label>
            <label><input type="radio" name="method" value="outro"><span>Outro</span></label>
          </div>
        </fieldset>
        <label for="p-date">Data do pagamento</label>
        <input id="p-date" type="date" value="${today}" max="${today}" required>
        <div id="p-receipt"><label for="p-file">Comprovante (foto ou PDF)</label><input id="p-file" type="file" accept="image/*,application/pdf"></div>
        <p class="hint hidden" id="p-cash">Dinheiro não precisa de comprovante. Confira o valor recebido antes de confirmar.</p>
        <p class="err" id="p-err" role="alert"></p>
        <button class="btn primary block" id="p-save">Confirmar pagamento</button>
      </form>` : '';
    const fullTools = isFull() ? `
      <details>
        <summary>Corrigir valor ou vencimento</summary>
        <form id="edit-form">
          <label for="e-amount">Valor (R$)</label><input id="e-amount" type="text" inputmode="decimal" value="${centsInput(c.amount_cents)}" required>
          <label for="e-due">Vencimento</label><input id="e-due" type="date" value="${c.due_date || ''}">
          <p class="err" id="e-err" role="alert"></p>
          <button class="btn block">Salvar correção</button>
        </form>
      </details>
      ${c.bill_id ? `<div class="row-actions"><button class="btn danger" data-act="del-bill" data-id="${c.bill_id}">Excluir esta conta de todas as casas</button></div>` : ''}` : '';
    openSheet(`
      ${sheetHead(`${KIND[c.kind]}, ${esc(c.house_name)}`, monthLabel(c.month))}
      <div class="line"><span class="big">${brl(c.amount_cents)}</span><span class="pill st-${c.status}">${STATUS[c.status]}</span></div>
      ${c.due_date ? `<p class="muted">Vencimento: ${fmtFull(c.due_date)}${c.status === 'atrasado' ? `, ${plural(c.days_late, 'dia', 'dias')} de atraso` : ''}</p>` : ''}
      ${shared}${partial}${company}
      ${pays ? `<ul class="pays">${pays}</ul>` : ''}
      ${payForm}
      ${fullTools}
    `);
  }

  async function submitPay(form) {
    const c = state.data.charges.find((x) => x.id === state.chargeId);
    const err = $('#p-err');
    const btn = $('#p-save');
    err.textContent = '';
    const cents = parseMoney($('#p-amount').value);
    if (!(cents > 0)) return (err.textContent = 'Digite o valor recebido, por exemplo 800,00.');
    const method = form.elements.method.value;
    const date = $('#p-date').value;
    if (!date) return (err.textContent = 'Escolha a data do pagamento.');
    if (cents > c.remaining_cents && !confirm(`O valor (${brl(cents)}) é maior do que falta receber (${brl(c.remaining_cents)}). Registrar mesmo assim?`)) return;
    const file = method !== 'dinheiro' ? $('#p-file').files[0] : null;
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const r = await api('POST', `/charges/${c.id}/payments`, { amount_cents: cents, method, paid_at: date });
      let msg = 'Pagamento registrado.';
      let bad = false;
      if (file) {
        try { await uploadReceipt(`/api/payments/${r.id}/receipt`, file); msg = 'Pagamento e comprovante salvos.'; }
        catch (e) { msg = `Pagamento registrado, mas o comprovante não foi enviado: ${e.message}`; bad = true; }
      }
      closeSheet(); toast(msg, bad);
      await viewMonth();
    } catch (e) {
      err.textContent = e.message; btn.disabled = false; btn.textContent = 'Confirmar pagamento';
    }
  }

  async function submitEdit() {
    const err = $('#e-err');
    const cents = parseMoney($('#e-amount').value);
    if (!(cents > 0)) return (err.textContent = 'Digite um valor válido.');
    try {
      await api('PATCH', `/charges/${state.chargeId}`, { amount_cents: cents, due_date: $('#e-due').value || null });
      closeSheet(); toast('Correção salva.'); await viewMonth();
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------- janela: a conta na companhia (quem paga, comprovante) ---------- */
  function openBillInfo(id) {
    const b = state.data.bills.find((x) => x.id === id);
    if (!b) return;
    state.billId = id;
    const [st, label] = billState(b);
    const shares = state.data.charges.filter((c) => c.bill_id === id).map((c) => `
      <li class="btnrow"><button class="rowbtn" data-act="charge" data-id="${c.id}">
        <div><div class="name">${esc(c.house_name)}</div><div class="meta">${esc(statusText(c))}</div></div>
        <div class="right"><b>${brl(c.amount_cents)}</b><span class="pill st-${c.status}">${STATUS[c.status]}</span></div></button></li>`).join('');
    const today = todayStr();
    const company = b.company_paid_at
      ? `<p>Paga em <b>${fmtFull(b.company_paid_at)}</b>.</p>
         <div class="row-actions">
           ${b.company_receipt ? `<a class="btn small" href="/receipts/${esc(b.company_receipt)}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}
           <button class="btn small" data-act="bill-attach" data-id="${b.id}">${b.company_receipt ? 'Trocar comprovante' : 'Anexar comprovante'}</button>
           <button class="btn small danger" data-act="co-undo" data-id="${b.id}">Desfazer</button>
         </div>`
      : `<form id="co-form">
           <label for="co-date">Data em que a conta foi paga</label>
           <input id="co-date" type="date" value="${today}" max="${today}" required>
           <label for="co-file">Comprovante (foto ou PDF, opcional)</label>
           <input id="co-file" type="file" accept="image/*,application/pdf">
           <p class="err" id="co-err" role="alert"></p>
           <button class="btn primary block" id="co-save">Marcar como paga na companhia</button>
         </form>`;
    const who = esc(b.payer || 'não informado');
    const steps = `<ol class="steps">
      <li class="done"><span class="n">✓</span><div><b>Lançada</b><small>${brl(b.total_cents)} em ${monthLabel(b.month)}${b.due_date ? `, vence ${fmtFull(b.due_date)}` : ''}</small></div></li>
      <li class="${b.company_paid_at ? 'done' : 'todo'}"><span class="n">${b.company_paid_at ? '✓' : '2'}</span><div><b>Paga na companhia</b><small>${b.company_paid_at ? `Por ${who} em ${fmtFull(b.company_paid_at)}` : `Ainda não paga. Quem paga: ${who}`}</small></div></li>
      <li class="${b.stage === 'recebida' ? 'done' : 'todo'}"><span class="n">${b.stage === 'recebida' ? '✓' : '3'}</span><div><b>Recebida dos moradores</b><small>${brl(b.received_cents)} de ${brl(b.total_cents)}${b.stage === 'paga' ? `, falta ${brl(b.remaining_cents)}` : ''}</small></div></li>
    </ol>`;
    openSheet(`
      ${sheetHead(billTitle(b), monthLabel(b.month))}
      <div class="line"><span class="big">${brl(b.total_cents)}</span><span class="pill st-${st}">${label}</span></div>
      ${steps}
      <p class="hint">O pagamento da conta não conta como gasto: os totais do mês mostram só o que os moradores pagaram.</p>
      <h3>Parte de cada casa</h3>
      <ul class="rows" style="margin-top:8px">${shares}</ul>
      <h3>Pagamento da conta</h3>
      ${company}
      <details>
        <summary>Trocar quem paga</summary>
        <form id="payer-form">
          <label for="bp-payer">Quem paga esta conta</label>
          <input id="bp-payer" type="text" value="${esc(b.payer)}" maxlength="60" placeholder="Ex.: Pai, Seu José">
          <button class="btn block" style="margin-top:12px">Salvar</button>
        </form>
      </details>
      ${isFull() ? `<div class="row-actions"><button class="btn danger" data-act="del-bill" data-id="${b.id}">Excluir esta conta de todas as casas</button></div>` : ''}
    `);
  }

  async function submitCompany() {
    const id = state.billId;
    const err = $('#co-err');
    const btn = $('#co-save');
    err.textContent = '';
    const date = $('#co-date').value;
    if (!date) return (err.textContent = 'Escolha a data do pagamento.');
    const file = $('#co-file').files[0];
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      await api('POST', `/bills/${id}/company-payment`, { paid_at: date });
      let msg = 'Conta marcada como paga.';
      let bad = false;
      if (file) {
        try { await uploadReceipt(`/api/bills/${id}/receipt`, file); msg = 'Conta paga e comprovante salvo.'; }
        catch (e) { msg = `Conta marcada como paga, mas o comprovante não foi enviado: ${e.message}`; bad = true; }
      }
      closeSheet(); toast(msg, bad); await viewMonth();
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Marcar como paga na companhia'; }
  }

  async function submitPayer() {
    try {
      await api('PATCH', `/bills/${state.billId}`, { payer: $('#bp-payer').value });
      toast('Salvo.'); await viewMonth(); openBillInfo(state.billId);
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- janela: lançar conta de água / luz ---------- */
  function splitCents(total, n) {
    const base = Math.floor(total / n), extra = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  }
  const billTaken = (hid, kind) => state.data.charges.some((c) => c.house_id === hid && c.kind === kind);

  function openBill(pre = {}) {
    const houses = state.data.houses.filter((h) => h.active);
    if (!houses.length) return toast('Cadastre as casas primeiro.', true);
    const kind = pre.kind && pre.kind !== 'aluguel' ? pre.kind : 'agua';
    const sel = new Set();
    const seed = houses.find((h) => h.id === Number(pre.house));
    if (seed) houses.filter((h) => h.id === seed.id || (grpOf(seed, kind) && grpOf(h, kind) === grpOf(seed, kind))).forEach((h) => !billTaken(h.id, kind) && sel.add(h.id));
    state.bill = { kind, sel, houses, seed: seed ? seed.id : null, payerTouched: false };
    const payers = [...new Set([...houses.map((h) => h.bill_payer), ...state.data.bills.map((b) => b.payer)].filter(Boolean))];
    openSheet(`
      ${sheetHead('Lançar conta', `Conta de ${monthLabel(state.month)}`)}
      <form id="bill-form">
        <fieldset><legend>Qual conta?</legend>
          <div class="seg">
            <label><input type="radio" name="kind" value="agua" ${kind === 'agua' ? 'checked' : ''}><span>Água</span></label>
            <label><input type="radio" name="kind" value="luz" ${kind === 'luz' ? 'checked' : ''}><span>Luz</span></label>
          </div>
        </fieldset>
        <label for="b-total">Valor total da conta (R$)</label>
        <input id="b-total" type="text" inputmode="decimal" placeholder="0,00" required>
        <label for="b-due">Vencimento da conta (opcional)</label>
        <input id="b-due" type="date">
        <fieldset><legend>Quem mora e divide esta conta?</legend>
          <div class="checks" id="b-houses"></div>
          <p class="hint">Se marcar mais de uma casa, o valor é dividido igualmente. Casas que dividem esta conta (grupo de luz ou de água no cadastro) são marcadas juntas.</p>
        </fieldset>
        <div class="preview hidden" id="b-preview"></div>
        <label for="b-payer">Quem vai pagar a conta na companhia?</label>
        <input id="b-payer" type="text" list="payer-list" maxlength="60" placeholder="Ex.: Pai, Seu José" autocomplete="off">
        <datalist id="payer-list">${payers.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
        <p class="err" id="b-err" role="alert"></p>
        <button class="btn primary block" id="b-save">Lançar conta</button>
      </form>`);
    renderBillHouses();
  }

  function syncPayer() {
    const b = state.bill;
    const inp = $('#b-payer');
    if (!inp || b.payerTouched) return;
    const first = b.houses.find((h) => b.sel.has(h.id) && h.bill_payer);
    if (first) inp.value = first.bill_payer;
  }

  function renderBillHouses() {
    const b = state.bill;
    $('#b-houses').innerHTML = b.houses.map((h) => {
      const taken = billTaken(h.id, b.kind);
      if (taken) b.sel.delete(h.id);
      return `<label class="check ${taken ? 'disabled' : ''}"><input type="checkbox" value="${h.id}" ${b.sel.has(h.id) ? 'checked' : ''} ${taken ? 'disabled' : ''}>
        <span>${esc(h.name)}<small>${taken ? `Já tem conta de ${KIND[b.kind].toLowerCase()} neste mês` : esc(h.tenant || '')}</small></span></label>`;
    }).join('');
    syncPayer();
    updateBillPreview();
  }

  function updateBillPreview() {
    const b = state.bill;
    const box = $('#b-preview');
    const total = parseMoney($('#b-total').value);
    const ids = b.houses.filter((h) => b.sel.has(h.id));
    if (!(total > 0) || !ids.length) return box.classList.add('hidden');
    const parts = splitCents(total, ids.length);
    box.classList.remove('hidden');
    box.textContent = ids.length === 1 ? `${ids[0].name} paga ${brl(total)}` : ids.map((h, i) => `${h.name}: ${brl(parts[i])}`).join(', ');
  }

  async function submitBill() {
    const b = state.bill;
    const err = $('#b-err');
    err.textContent = '';
    const total = parseMoney($('#b-total').value);
    if (!(total > 0)) return (err.textContent = 'Digite o valor total da conta, por exemplo 180,50.');
    const ids = b.houses.filter((h) => b.sel.has(h.id)).map((h) => h.id);
    if (!ids.length) return (err.textContent = 'Marque pelo menos uma casa.');
    const btn = $('#b-save');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      await api('POST', '/bills', { kind: b.kind, month: state.month, total_cents: total, due_date: $('#b-due').value || null, house_ids: ids, payer: $('#b-payer').value });
      closeSheet(); toast('Conta lançada.'); await viewMonth();
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Lançar conta'; }
  }

  /* ---------- tela: casas ---------- */
  async function viewHouses() {
    const hs = await api('GET', '/houses');
    state.houses = hs;
    const full = isFull();
    $('#main').innerHTML = `
      <div class="sectionbar"><h2>Casas</h2><button class="btn primary" data-act="house-new">Nova casa</button></div>
      ${hs.length ? `<ul class="rows">${hs.map((h) => `
        <li class="${h.active ? '' : 'off'}"><div><div class="name">${esc(h.name)}${h.active ? '' : ' (inativa)'}</div>
          <div class="meta">${esc(h.tenant || 'Sem inquilino')}, aluguel de ${brl(h.rent_cents)} no dia ${h.due_day}</div>
          ${full ? `<div class="meta">${[h.phone && `Tel. ${esc(h.phone)}`, h.address && esc(h.address)].filter(Boolean).join('. ')}</div>` : ''}
          ${h.grp_luz || h.grp_agua || h.bill_payer ? `<div class="meta">${[h.grp_luz && `Divide a luz: ${esc(h.grp_luz)}`, h.grp_agua && `Divide a água: ${esc(h.grp_agua)}`, h.bill_payer && `Conta paga por ${esc(h.bill_payer)}`].filter(Boolean).join('. ')}</div>` : ''}</div>
          <button class="btn small" data-act="house-edit" data-id="${h.id}">Editar</button></li>`).join('')}</ul>`
        : '<div class="empty-state"><h3>Nenhuma casa ainda</h3><p class="muted">Toque em “Nova casa” para começar. O aluguel de cada mês é criado sozinho.</p></div>'}`;
  }

  function monthOptions(selected, from, to) {
    let a = from, out = '';
    if (selected < a) a = selected;
    for (let m = a; m <= to; m = addMonth(m, 1)) out += `<option value="${m}" ${m === selected ? 'selected' : ''}>${monthLabel(m)}</option>`;
    return out;
  }

  function openHouse(id) {
    const h = id ? state.houses.find((x) => x.id === id) : null;
    const start = h ? h.start_month : curMonth();
    openSheet(`
      ${sheetHead(h ? 'Editar casa' : 'Nova casa')}
      <form id="house-form" data-id="${h ? h.id : ''}">
        <label for="h-name">Nome da casa</label><input id="h-name" type="text" value="${esc(h?.name)}" placeholder="Ex.: Casa 1" required maxlength="60">
        <label for="h-tenant">Inquilino</label><input id="h-tenant" type="text" value="${esc(h?.tenant)}" maxlength="80">
        <label for="h-phone">Telefone</label><input id="h-phone" type="tel" value="${esc(h?.phone)}" maxlength="30">
        <label for="h-address">Endereço</label><input id="h-address" type="text" value="${esc(h?.address)}" maxlength="150">
        <label for="h-rent">Valor do aluguel (R$)</label><input id="h-rent" type="text" inputmode="decimal" value="${h ? centsInput(h.rent_cents) : ''}" required>
        <label for="h-due">Dia do vencimento</label><input id="h-due" type="number" min="1" max="31" value="${h ? h.due_day : 5}" required>
        <label for="h-grp-luz">Divide a conta de luz com outra casa? (grupo)</label>
        <input id="h-grp-luz" type="text" value="${esc(h?.grp_luz)}" maxlength="30" placeholder="Deixe vazio se não divide">
        <label for="h-grp-agua">Divide a conta de água com outra casa? (grupo)</label>
        <input id="h-grp-agua" type="text" value="${esc(h?.grp_agua)}" maxlength="30" placeholder="Deixe vazio se não divide">
        <p class="hint">Casas que dividem a mesma conta usam o mesmo nome de grupo, por exemplo “Fundos”. Luz e água têm grupos separados: dá para dividir só uma delas.</p>
        <label for="h-payer">Quem paga a água e a luz na companhia?</label>
        <input id="h-payer" type="text" value="${esc(h?.bill_payer)}" maxlength="60" placeholder="Ex.: Pai, Seu José">
        <p class="hint">Quem paga a conta primeiro e depois recebe dos moradores (seu pai, por exemplo). Já vem preenchido quando você lança uma conta.</p>
        <label for="h-start">Cobrar aluguel a partir de</label>
        <select id="h-start">${monthOptions(start, addMonth(curMonth(), -24), addMonth(curMonth(), 1))}</select>
        <p class="hint">Meses anteriores a este não geram cobrança.</p>
        ${h ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="h-active" ${h.active ? 'checked' : ''}><span>Casa ativa<small>Desmarque se a casa não está mais alugada. O histórico continua salvo.</small></span></label>` : ''}
        <p class="err" id="h-err" role="alert"></p>
        <button class="btn primary block">Salvar casa</button>
      </form>`);
  }

  async function submitHouse(form) {
    const err = $('#h-err');
    err.textContent = '';
    const rent = parseMoney($('#h-rent').value);
    if (!(rent > 0)) return (err.textContent = 'Digite o valor do aluguel, por exemplo 800,00.');
    const body = {
      name: $('#h-name').value, tenant: $('#h-tenant').value, phone: $('#h-phone').value, address: $('#h-address').value,
      rent_cents: rent, due_day: Number($('#h-due').value), grp_agua: $('#h-grp-agua').value, grp_luz: $('#h-grp-luz').value, bill_payer: $('#h-payer').value, start_month: $('#h-start').value,
      active: $('#h-active') ? $('#h-active').checked : true,
    };
    try {
      if (form.dataset.id) await api('PUT', '/houses/' + form.dataset.id, body);
      else await api('POST', '/houses', body);
      closeSheet(); toast('Casa salva.'); await viewHouses();
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------- tela: ajustes ---------- */
  function viewSettings() {
    const seg = (name, opts, cur, cls = '') => `<div class="seg ${cls}" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${String(cur) === String(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
    $('#main').innerHTML = `
      <div class="sectionbar"><h2>Ajustes</h2></div>
      <section class="setting"><h3>Modo de uso</h3>
        ${seg('pref-mode', [['facil', 'Fácil'], ['completo', 'Completo']], prefs.mode)}
        <p class="hint">Fácil: quadros grandes e só o essencial para o dia a dia. Completo: tabela com todas as casas, relatórios, correções e mais detalhes.</p>
      </section>
      <section class="setting"><h3>Tema</h3>
        ${seg('pref-theme', [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']], prefs.theme)}
        <p class="hint">Automático acompanha o tema do celular.</p>
      </section>
      <section class="setting"><h3>Tamanho da letra</h3>
        ${seg('pref-font', [[100, 'Normal'], [115, 'Grande'], [130, 'Maior'], [150, 'Gigante']], prefs.font, 'compact')}
        <div class="sample">Exemplo: <b>R$ 800,00</b> recebidos</div>
        <p class="hint">Estas escolhas valem só para este aparelho ou navegador.</p>
      </section>
      ${isFull() ? `<section class="setting"><h3>Dados</h3>
        <div class="row-actions"><a class="btn" href="/api/backup">Baixar cópia dos dados (JSON)</a></div>
        <p class="hint">Guarda casas, contas e pagamentos. As fotos dos comprovantes não entram nessa cópia.</p>
      </section>` : ''}
      <section class="setting"><h3>Segurança</h3>
        <div class="row-actions"><button class="btn" data-act="pin">Trocar PIN</button><button class="btn" data-act="logout">Sair</button></div>
      </section>`;
  }

  function openPin() {
    openSheet(`
      ${sheetHead('Trocar PIN')}
      <form id="pin-form">
        <label for="n-cur">PIN atual</label><input id="n-cur" type="password" inputmode="numeric" autocomplete="current-password" required>
        <label for="n-new">Novo PIN</label><input id="n-new" type="password" inputmode="numeric" autocomplete="new-password" required>
        <label for="n-new2">Repita o novo PIN</label><input id="n-new2" type="password" inputmode="numeric" autocomplete="new-password" required>
        <p class="err" id="n-err" role="alert"></p>
        <button class="btn primary block">Salvar novo PIN</button>
      </form>`);
  }

  async function submitPin() {
    const err = $('#n-err');
    if ($('#n-new').value !== $('#n-new2').value) return (err.textContent = 'Os dois PINs novos não são iguais.');
    try {
      await api('POST', '/pin', { current: $('#n-cur').value, pin: $('#n-new').value });
      closeSheet(); toast('PIN alterado.');
    } catch (e) { err.textContent = e.message; }
  }

  /* ---------- tela: relatório (modo completo) ---------- */
  async function viewReport() {
    const { from, to } = state.report;
    const r = await api('GET', `/report?from=${from}&to=${to}`);
    const opts = (sel) => monthOptions(sel, addMonth(curMonth(), -35), addMonth(curMonth(), 1));
    const t = r.totals;
    const pct = t.expected_cents ? Math.round((t.received_cents / t.expected_cents) * 100) : 0;
    const money3 = (x) => `<td>${brl(x.expected_cents)}</td><td>${brl(x.received_cents)}</td><td>${brl(x.open_cents)}</td>`;
    const head3 = '<th>Esperado</th><th>Recebido</th><th>Em aberto</th>';
    const months = r.byMonth.filter((m) => m.expected_cents > 0);
    const methods = r.byMethod.length
      ? `<div class="report-block"><h3>Como foi recebido</h3><table><thead><tr><th>Forma</th><th>Valor</th></tr></thead><tbody>${r.byMethod.map((m) => `<tr><td>${METHOD[m.method] || esc(m.method)}</td><td>${brl(m.cents)}</td></tr>`).join('')}</tbody></table></div>` : '';
    const bills = r.bills.count
      ? `<div class="report-block"><h3>Contas de água e luz</h3>
          <p class="muted">${plural(r.bills.count, 'conta', 'contas')} no período: ${brl(r.bills.total_cents)} em contas, ${brl(r.bills.paid_cents)} já pagas na companhia e ${brl(r.bills.received_cents)} recebidos dos moradores.</p>
          ${r.bills.advance_cents > 0 ? `<p>Pagas na companhia e ainda a receber dos moradores: <b>${brl(r.bills.advance_cents)}</b></p>` : ''}
          ${r.bills.pending.length ? `<div class="scroll"><table><thead><tr><th>Conta</th><th>Mês</th><th>Casas</th><th>Quem paga</th><th>Valor</th><th>Situação</th><th>Falta receber</th></tr></thead><tbody>
            ${r.bills.pending.map((b) => `<tr><td>${KIND[b.kind]}</td><td>${monthShort(b.month)}</td><td>${b.houses.map(esc).join(', ')}</td><td>${esc(b.payer || '-')}</td><td>${brl(b.total_cents)}</td><td>${(STAGE[b.stage] || STAGE.lancada)[1]}</td><td>${b.stage === 'paga' ? brl(b.advance_cents) : '-'}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Todas as contas foram pagas e recebidas.</p>'}</div>` : '';
    $('#main').innerHTML = `
      <div class="sectionbar"><h2>Relatório</h2></div>
      <div class="filters no-print">
        <div><label for="r-from">De</label><select id="r-from">${opts(from)}</select></div>
        <div><label for="r-to">Até</label><select id="r-to">${opts(to)}</select></div>
      </div>
      <div class="print-only"><h1>Relatório de aluguéis</h1><p>${monthLabel(from)} a ${monthLabel(to)}. Gerado em ${fmtFull(todayStr())}.</p></div>
      <div class="kpis">
        <div>Esperado<b>${brl(t.expected_cents)}</b></div>
        <div>Recebido<b>${brl(t.received_cents)}</b><span class="muted">${pct}% do esperado</span></div>
        <div>Em aberto<b>${brl(t.open_cents)}</b></div>
      </div>
      <div class="row-actions no-print">
        <button class="btn primary" data-act="print">Imprimir ou salvar em PDF</button>
        <a class="btn" href="/api/export.csv?from=${from}&to=${to}">Baixar planilha (CSV)</a>
      </div>
      <div class="report-block"><h3>Mês a mês</h3>${months.length ? `<div class="scroll"><table><thead><tr><th>Mês</th>${head3}<th></th></tr></thead><tbody>
        ${months.map((m) => `<tr><td>${monthShort(m.month)}</td>${money3(m)}<td><span class="mini"><i style="width:${Math.min(100, Math.round((m.received_cents / m.expected_cents) * 100))}%"></i></span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nenhuma cobrança neste período.</p>'}</div>
      <div class="report-block"><h3>Por casa</h3><div class="scroll"><table><thead><tr><th>Casa</th>${head3}</tr></thead><tbody>
        ${r.byHouse.map((h) => `<tr><td>${esc(h.house)}</td>${money3(h)}</tr>`).join('')}
      </tbody></table></div></div>
      <div class="report-block"><h3>Por tipo</h3><div class="scroll"><table><thead><tr><th>Tipo</th>${head3}</tr></thead><tbody>
        ${r.byKind.map((k) => `<tr><td>${KIND[k.kind]}</td>${money3(k)}</tr>`).join('')}
      </tbody></table></div></div>
      ${methods}
      <div class="report-block"><h3>Em aberto (moradores)</h3>
        ${r.open.length ? `<div class="scroll"><table><thead><tr><th>Casa</th><th>Tipo</th><th>Mês</th><th>Vence</th><th>Falta</th><th>Situação</th></tr></thead><tbody>
          ${r.open.map((o) => `<tr><td>${esc(o.house)}</td><td>${KIND[o.kind]}</td><td>${monthShort(o.month)}</td><td>${fmtDate(o.due_date) || '-'}</td><td>${brl(o.remaining_cents)}</td><td>${STATUS[o.status]}${o.days_late ? ` (${o.days_late} d)` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nada em aberto neste período.</p>'}
      </div>
      ${bills}`;
  }

  /* ---------- eventos ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.matches('[data-backdrop]')) return closeSheet();
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = Number(el.dataset.id);
    try {
      if (act === 'close') closeSheet();
      else if (act === 'reload') location.reload();
      else if (act === 'logout') { await api('POST', '/logout'); boot(); }
      else if (act === 'prev') { state.month = addMonth(state.month, -1); await viewMonth(); }
      else if (act === 'next') { state.month = addMonth(state.month, 1); await viewMonth(); }
      else if (act === 'charge') openCharge(id);
      else if (act === 'bill') openBill({ house: el.dataset.house, kind: el.dataset.kind });
      else if (act === 'bill-open') openBillInfo(id);
      else if (act === 'attach') pickReceipt('payment', id);
      else if (act === 'bill-attach') pickReceipt('bill', id);
      else if (act === 'co-undo') {
        if (!confirm('Desfazer o pagamento desta conta na companhia? O comprovante anexado também será apagado.')) return;
        await api('DELETE', `/bills/${id}/company-payment`);
        toast('Pagamento da conta desfeito.'); await viewMonth(); openBillInfo(id);
      } else if (act === 'del-pay') {
        if (!confirm('Remover este pagamento? O comprovante anexado também será apagado.')) return;
        await api('DELETE', '/payments/' + id);
        toast('Pagamento removido.'); await viewMonth(); openCharge(state.chargeId);
      } else if (act === 'del-bill') {
        if (!confirm('Excluir esta conta de TODAS as casas, com os pagamentos e comprovantes dela?')) return;
        await api('DELETE', '/bills/' + id);
        closeSheet(); toast('Conta excluída.'); await viewMonth();
      } else if (act === 'house-new') openHouse(null);
      else if (act === 'house-edit') openHouse(id);
      else if (act === 'pin') openPin();
      else if (act === 'print') window.print();
    } catch (err) { toast(err.message, true); }
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'auth-form') submitAuth(f);
    else if (f.id === 'pay-form') submitPay(f);
    else if (f.id === 'edit-form') submitEdit();
    else if (f.id === 'bill-form') submitBill();
    else if (f.id === 'co-form') submitCompany();
    else if (f.id === 'payer-form') submitPayer();
    else if (f.id === 'house-form') submitHouse(f);
    else if (f.id === 'pin-form') submitPin();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'method') {
      const cash = t.value === 'dinheiro';
      $('#p-receipt').classList.toggle('hidden', cash);
      $('#p-cash').classList.toggle('hidden', !cash);
    } else if (t.name === 'kind' && state.bill) {
      const b = state.bill;
      b.kind = t.value;
      const seed = b.houses.find((x) => x.id === b.seed);
      if (seed) {
        b.sel = new Set();
        const g = grpOf(seed, b.kind);
        b.houses.filter((x) => x.id === seed.id || (g && grpOf(x, b.kind) === g)).forEach((x) => !billTaken(x.id, b.kind) && b.sel.add(x.id));
      }
      renderBillHouses();
    } else if (t.closest('#b-houses') && t.type === 'checkbox') {
      const b = state.bill;
      const h = b.houses.find((x) => x.id === Number(t.value));
      const g = grpOf(h, b.kind);
      const mates = g ? b.houses.filter((x) => grpOf(x, b.kind) === g) : [h];
      mates.forEach((m) => {
        if (billTaken(m.id, b.kind)) return;
        if (t.checked) b.sel.add(m.id); else b.sel.delete(m.id);
      });
      renderBillHouses();
    } else if (t.id === 'r-from' || t.id === 'r-to') {
      const from = $('#r-from').value, to = $('#r-to').value;
      if (from > to) return toast('O mês inicial deve vir antes do final.', true);
      state.report = { from, to };
      viewReport().catch((err) => toast(err.message, true));
    } else if (t.name === 'pref-mode') {
      prefs.mode = t.value; savePrefs(); applyPrefs(); renderShell(); route();
    } else if (t.name === 'pref-theme') {
      prefs.theme = t.value; savePrefs(); applyPrefs();
    } else if (t.name === 'pref-font') {
      prefs.font = Number(t.value); savePrefs(); applyPrefs();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'b-total') updateBillPreview();
    else if (e.target.id === 'b-payer' && state.bill) state.bill.payerTouched = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetRoot.firstChild) closeSheet();
  });
  window.addEventListener('hashchange', route);

  boot();
})();
