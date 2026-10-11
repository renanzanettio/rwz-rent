import express from 'express';
import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE = 4 * 1024 * 1024; // a Vercel recusa corpos acima de 4,5 MB
const ON_VERCEL = !!process.env.VERCEL;

/* ---------- Banco (Turso / libSQL) ---------- */
let db;
let dbPromise;

function makeClient() {
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    if (ON_VERCEL) {
      throw Object.assign(new Error('config'), { userMessage: 'Faltam as variáveis TURSO_DATABASE_URL e TURSO_AUTH_TOKEN na Vercel.' });
    }
    // Desenvolvimento local: arquivo SQLite comum
    const dir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
    fs.mkdirSync(dir, { recursive: true });
    url = `file:${path.join(dir, 'alugueis.db')}`;
  } else if (url.startsWith('libsql://')) {
    url = `https://${url.slice('libsql://'.length)}`; // HTTP: melhor em funções serverless
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
  `CREATE TABLE IF NOT EXISTS houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', rent_cents INTEGER NOT NULL, due_day INTEGER NOT NULL DEFAULT 5, grp_agua TEXT NOT NULL DEFAULT '', grp_luz TEXT NOT NULL DEFAULT '',
    bill_payer TEXT NOT NULL DEFAULT '', start_month TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('agua','luz')), month TEXT NOT NULL,
    total_cents INTEGER NOT NULL, due_date TEXT, payer TEXT NOT NULL DEFAULT '', company_paid_at TEXT, company_receipt TEXT)`,
  `CREATE TABLE IF NOT EXISTS charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, house_id INTEGER NOT NULL REFERENCES houses(id),
    kind TEXT NOT NULL CHECK (kind IN ('aluguel','agua','luz')), month TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    due_date TEXT, bill_id INTEGER REFERENCES bills(id), note TEXT NOT NULL DEFAULT '')`,
  "CREATE UNIQUE INDEX IF NOT EXISTS charges_rent_uniq ON charges(house_id, month) WHERE kind = 'aluguel'",
  'CREATE INDEX IF NOT EXISTS charges_month ON charges(month)',
  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, charge_id INTEGER NOT NULL REFERENCES charges(id), amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL, paid_at TEXT NOT NULL, receipt TEXT, note TEXT NOT NULL DEFAULT '')`,
  'CREATE INDEX IF NOT EXISTS payments_charge ON payments(charge_id)',
  'CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS login_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)',
];

function init() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const client = makeClient();
      await client.batch(SCHEMA.map((sql) => ({ sql, args: [] })), 'write');
      // Bancos criados antes dos grupos por tipo de conta: acrescenta as colunas e copia o grupo antigo
      const cols = (await client.execute('PRAGMA table_info(houses)')).rows.map((r) => r[1]);
      if (!cols.includes('grp_luz')) {
        await client.batch([
          { sql: "ALTER TABLE houses ADD COLUMN grp_agua TEXT NOT NULL DEFAULT ''", args: [] },
          { sql: "ALTER TABLE houses ADD COLUMN grp_luz TEXT NOT NULL DEFAULT ''", args: [] },
          ...(cols.includes('grp') ? [{ sql: 'UPDATE houses SET grp_agua = grp, grp_luz = grp', args: [] }] : []),
        ], 'write');
      }
      db = client;
    })().catch((e) => {
      dbPromise = null; // tenta de novo na próxima requisição
      throw e;
    });
  }
  return dbPromise;
}

const rowsOf = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
const all = async (sql, args = []) => rowsOf(await db.execute({ sql, args }));
const get = async (sql, args = []) => (await all(sql, args))[0];
const run = (sql, args = []) => db.execute({ sql, args });
const batch = (stmts) => db.batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
const getSetting = async (k) => (await get('SELECT value FROM settings WHERE key = ?', [k]))?.value;
const setSetting = (k, v) =>
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);

/* ---------- Utilidades ---------- */
class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const bad = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const wrap = (fn) => (req, res) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((e) => {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Erro interno no servidor' });
    });
};

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => dateFmt.format(new Date()); // AAAA-MM-DD no fuso de São Paulo, mesmo com o servidor em UTC
const pad = (n) => String(n).padStart(2, '0');
const sum = (list, key) => list.reduce((s, r) => s + r[key], 0);
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const addMonth = (ym, n) => {
  let [y, m] = ym.split('-').map(Number);
  m += n - 1;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
};
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dueDate = (ym, day) => `${ym}-${pad(Math.min(day, lastDay(ym)))}`;
const cents = (v) => {
  if (!Number.isInteger(v) || v <= 0 || v > 1e9) bad('Valor inválido');
  return v;
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const KIND_LABEL = { aluguel: 'aluguel', agua: 'água', luz: 'luz' };
const METHODS = ['pix', 'dinheiro', 'transferencia', 'outro'];
const METHOD_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro' };
const fmtMonth = (ym) => `${ym.slice(5)}/${ym.slice(0, 4)}`;

const RENT_SQL = `INSERT OR IGNORE INTO charges(house_id, kind, month, amount_cents, due_date)
  SELECT id, 'aluguel', ?, rent_cents, ? || '-' || printf('%02d', MIN(due_day, ?)) FROM houses WHERE active = 1 AND start_month <= ?`;
const rentArgs = (m) => [m, m, lastDay(m), m];

async function ensureRent(months) {
  const limit = addMonth(today().slice(0, 7), 1);
  const list = months.filter((m) => m <= limit);
  if (list.length) await batch(list.map((m) => [RENT_SQL, rentArgs(m)]));
}

function decorate(c, t) {
  const remaining = Math.max(0, c.amount_cents - c.paid_cents);
  let status = 'pendente';
  if (c.paid_cents >= c.amount_cents) status = 'pago';
  else if (c.due_date && c.due_date < t) status = 'atrasado';
  else if (c.paid_cents > 0) status = 'parcial';
  const days_late = status === 'atrasado' ? Math.round((Date.parse(t) - Date.parse(c.due_date)) / 864e5) : 0;
  return { ...c, remaining_cents: remaining, status, days_late };
}

// Ciclo da conta: lançada (a pagar) -> paga na companhia (pelo pai, a receber de volta) -> recebida dos moradores.
// O pagamento da conta é só um status: não entra como saída nem diminui nenhum total.
function billView(b, cs, t) {
  const received = sum(cs, 'paid_cents');
  const remaining = Math.max(0, b.total_cents - received);
  let stage = 'lancada';
  if (b.company_paid_at) stage = received >= b.total_cents ? 'recebida' : 'paga';
  else if (b.due_date && b.due_date < t) stage = 'vencida';
  return {
    ...b,
    houses: cs.map((c) => c.house_name),
    received_cents: received,
    remaining_cents: remaining,
    advance_cents: b.company_paid_at ? remaining : 0, // já pago na companhia e ainda não recebido
    stage,
  };
}

const CHARGE_SELECT = `
  SELECT c.*, h.name AS house_name, h.tenant AS tenant,
    COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.charge_id = c.id), 0) AS paid_cents
  FROM charges c JOIN houses h ON h.id = c.house_id`;

async function removeFiles(names) {
  const list = names.filter(Boolean);
  if (list.length) await run(`DELETE FROM files WHERE id IN (${list.map(() => '?').join(',')})`, list);
}

/* ---------- Leitura do corpo (funciona local e na Vercel) ---------- */
async function readBody(req, limit) {
  const pre = req.body; // na Vercel o corpo pode já ter sido lido e convertido
  if (Buffer.isBuffer(pre)) {
    if (pre.length > limit) bad('Arquivo muito grande (máximo 4 MB)', 413);
    return pre;
  }
  if (typeof pre === 'string') return Buffer.from(pre);
  if (pre && typeof pre === 'object') return Buffer.from(JSON.stringify(pre));
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) bad('Arquivo muito grande (máximo 4 MB)', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req, res, next) {
  try {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return next();
    const pre = req.body;
    if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return next();
    const buf = await readBody(req, 100 * 1024);
    req.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
    next();
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    res.status(400).json({ error: 'Requisição inválida' });
  }
}

/* ---------- Autenticação por PIN ---------- */
const parseCookies = (req) => {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* cookie inválido */
    }
  }
  return out;
};
const safeEq = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
async function authState() {
  await run("INSERT OR IGNORE INTO settings(key, value) VALUES('secret', ?)", [crypto.randomBytes(32).toString('hex')]);
  const rows = await all("SELECT key, value FROM settings WHERE key IN ('secret', 'pin_hash')");
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    pinHash: s.pin_hash || null,
    token: s.pin_hash ? crypto.createHmac('sha256', s.secret).update(s.pin_hash).digest('hex') : null,
  };
}
const isAuthed = (req, st) => {
  const c = parseCookies(req).auth;
  return !!(st.token && c && safeEq(st.token, c));
};
const setAuthCookie = (req, res, value, maxAge) => {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `auth=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
};
const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
};
const checkPin = (pin, stored) => {
  if (!stored || typeof pin !== 'string') return false;
  const [salt, hash] = stored.split(':');
  return safeEq(crypto.scryptSync(pin, salt, 32).toString('hex'), hash);
};
const validPin = (pin) => {
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 32) bad('O PIN precisa ter de 4 a 32 caracteres');
  return pin;
};
const clientIp = (req) => {
  if (ON_VERCEL) return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const ra = req.socket.remoteAddress || 'x';
  const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  return (local && req.headers['cf-connecting-ip']) || ra;
};

/* ---------- App ---------- */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!req.path.startsWith('/receipts/')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
    );
  }
  next();
});
app.use(async (req, res, next) => {
  try {
    await init();
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.userMessage || 'Banco de dados indisponível. Tente de novo em instantes.' });
  }
});
app.use(jsonBody);

app.get('/api/status', wrap(async (req, res) => {
  const st = await authState();
  res.json({ configured: !!st.pinHash, authed: isAuthed(req, st) });
}));

app.post('/api/setup', wrap(async (req, res) => {
  if ((await authState()).pinHash) bad('O PIN já foi definido', 409);
  await setSetting('pin_hash', hashPin(validPin(req.body?.pin)));
  setAuthCookie(req, res, (await authState()).token, 31536000);
  res.json({ ok: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  const ip = clientIp(req);
  const f = await get('SELECT n, until FROM login_fails WHERE ip = ?', [ip]);
  if (f && f.until > Date.now()) bad('Muitas tentativas. Aguarde alguns minutos e tente de novo.', 429);
  const st = await authState();
  if (!checkPin(req.body?.pin, st.pinHash)) {
    const n = (f?.n || 0) + 1;
    const lock = n >= 8;
    await run(
      'INSERT INTO login_fails(ip, n, until) VALUES(?, ?, ?) ON CONFLICT(ip) DO UPDATE SET n = excluded.n, until = excluded.until',
      [ip, lock ? 0 : n, lock ? Date.now() + 10 * 60 * 1000 : 0]
    );
    bad('PIN incorreto', 401);
  }
  if (f) await run('DELETE FROM login_fails WHERE ip = ?', [ip]);
  setAuthCookie(req, res, st.token, 31536000);
  res.json({ ok: true });
}));

app.post('/api/logout', wrap(async (req, res) => {
  setAuthCookie(req, res, '', 0);
  res.json({ ok: true });
}));

// Tudo daqui para baixo exige PIN
const requireAuth = async (req, res, next) => {
  try {
    if (isAuthed(req, await authState())) return next();
    res.status(401).json({ error: 'Faça login com o PIN' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};
app.use('/api', requireAuth);
app.use('/receipts', requireAuth);

app.post('/api/pin', wrap(async (req, res) => {
  const st = await authState();
  if (!checkPin(req.body?.current, st.pinHash)) bad('PIN atual incorreto', 401);
  await setSetting('pin_hash', hashPin(validPin(req.body?.pin)));
  setAuthCookie(req, res, (await authState()).token, 31536000);
  res.json({ ok: true });
}));

/* ----- Casas ----- */
function houseInput(b) {
  const name = str(b?.name, 60);
  if (!name) bad('Informe o nome da casa');
  const rent = b?.rent_cents;
  if (!Number.isInteger(rent) || rent <= 0 || rent > 1e9) bad('Informe o valor do aluguel');
  const due = b?.due_day;
  if (!Number.isInteger(due) || due < 1 || due > 31) bad('O dia do vencimento deve ser de 1 a 31');
  const start = b?.start_month ?? today().slice(0, 7);
  if (!isMonth(start)) bad('Mês inicial inválido');
  return {
    name, address: str(b.address, 150), tenant: str(b.tenant, 80), phone: str(b.phone, 30), rent_cents: rent, due_day: due,
    grp_agua: str(b.grp_agua, 30), grp_luz: str(b.grp_luz, 30), bill_payer: str(b.bill_payer, 60), start_month: start, active: b.active === 0 || b.active === false ? 0 : 1,
  };
}

app.get('/api/houses', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM houses ORDER BY active DESC, name'));
}));

app.post('/api/houses', wrap(async (req, res) => {
  const h = houseInput(req.body);
  const r = await run(
    'INSERT INTO houses(name, address, tenant, phone, rent_cents, due_day, grp_agua, grp_luz, bill_payer, start_month, active) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [h.name, h.address, h.tenant, h.phone, h.rent_cents, h.due_day, h.grp_agua, h.grp_luz, h.bill_payer, h.start_month, h.active]
  );
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/houses/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await get('SELECT 1 AS x FROM houses WHERE id = ?', [id]))) bad('Casa não encontrada', 404);
  const h = houseInput(req.body);
  // Aluguéis do mês atual em diante que ainda não têm pagamento seguem o novo valor/vencimento
  const open = await all(
    `SELECT c.id, c.month FROM charges c
     WHERE c.house_id = ? AND c.kind = 'aluguel' AND c.month >= ?
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.charge_id = c.id)`,
    [id, today().slice(0, 7)]
  );
  await batch([
    ['UPDATE houses SET name=?, address=?, tenant=?, phone=?, rent_cents=?, due_day=?, grp_agua=?, grp_luz=?, bill_payer=?, start_month=?, active=? WHERE id=?',
      [h.name, h.address, h.tenant, h.phone, h.rent_cents, h.due_day, h.grp_agua, h.grp_luz, h.bill_payer, h.start_month, h.active, id]],
    ...open.map((c) => ['UPDATE charges SET amount_cents = ?, due_date = ? WHERE id = ?', [h.rent_cents, dueDate(c.month, h.due_day), c.id]]),
  ]);
  res.json({ ok: true });
}));

/* ----- Mês ----- */
app.get('/api/month/:ym', wrap(async (req, res) => {
  const ym = req.params.ym;
  if (!isMonth(ym)) bad('Mês inválido');
  await ensureRent([ym]);
  const t = today();
  const [rows, pays, billRows, houses] = await Promise.all([
    all(`${CHARGE_SELECT} WHERE c.month = ? ORDER BY h.name, c.kind`, [ym]),
    all('SELECT p.* FROM payments p JOIN charges c ON c.id = p.charge_id WHERE c.month = ? ORDER BY p.paid_at, p.id', [ym]),
    all('SELECT * FROM bills WHERE month = ? ORDER BY kind, id', [ym]),
    all(
      `SELECT * FROM houses WHERE (active = 1 AND start_month <= ?) OR id IN (SELECT house_id FROM charges WHERE month = ?) ORDER BY name`,
      [ym, ym]
    ),
  ]);
  const byCharge = new Map();
  for (const p of pays) {
    if (!byCharge.has(p.charge_id)) byCharge.set(p.charge_id, []);
    byCharge.get(p.charge_id).push(p);
  }
  const billHouses = new Map();
  for (const r of rows) {
    if (!r.bill_id) continue;
    if (!billHouses.has(r.bill_id)) billHouses.set(r.bill_id, []);
    billHouses.get(r.bill_id).push(r.house_name);
  }
  const billTotals = new Map(billRows.map((b) => [b.id, b.total_cents]));
  const charges = rows.map((r) => ({
    ...decorate(r, t),
    payments: byCharge.get(r.id) || [],
    bill_total_cents: r.bill_id ? billTotals.get(r.bill_id) : null,
    bill_houses: r.bill_id ? billHouses.get(r.bill_id) : null,
  }));
  const bills = billRows.map((b) => billView(b, charges.filter((c) => c.bill_id === b.id), t));
  res.json({ month: ym, today: t, houses, charges, bills });
}));

/* ----- Contas de água e luz ----- */
app.post('/api/bills', wrap(async (req, res) => {
  const b = req.body || {};
  if (!['agua', 'luz'].includes(b.kind)) bad('Escolha água ou luz');
  if (!isMonth(b.month)) bad('Mês inválido');
  const total = cents(b.total_cents);
  const due = b.due_date ? b.due_date : null;
  if (due && !isDate(due)) bad('Vencimento inválido');
  const payer = str(b.payer, 60);
  const ids = [...new Set(Array.isArray(b.house_ids) ? b.house_ids.map(Number) : [])];
  if (!ids.length || ids.some((i) => !Number.isInteger(i))) bad('Escolha pelo menos uma casa');
  const marks = ids.map(() => '?').join(',');
  const found = await all(`SELECT id FROM houses WHERE id IN (${marks})`, ids);
  if (found.length !== ids.length) bad('Casa não encontrada', 404);
  const dup = await all(
    `SELECT h.name FROM charges c JOIN houses h ON h.id = c.house_id WHERE c.kind = ? AND c.month = ? AND c.house_id IN (${marks})`,
    [b.kind, b.month, ...ids]
  );
  if (dup.length) bad(`${dup.map((d) => d.name).join(', ')} já tem conta de ${KIND_LABEL[b.kind]} em ${fmtMonth(b.month)}`, 409);
  const base = Math.floor(total / ids.length);
  const extra = total - base * ids.length;
  // Tudo em uma transação; o id da conta é o maior id da tabela dentro dela
  const rs = await batch([
    ['INSERT INTO bills(kind, month, total_cents, due_date, payer) VALUES(?,?,?,?,?)', [b.kind, b.month, total, due, payer]],
    ...ids.map((hid, i) => [
      'INSERT INTO charges(house_id, kind, month, amount_cents, due_date, bill_id) VALUES(?,?,?,?,?,(SELECT MAX(id) FROM bills))',
      [hid, b.kind, b.month, base + (i < extra ? 1 : 0), due],
    ]),
  ]);
  res.json({ id: Number(rs[0].lastInsertRowid) });
}));

app.patch('/api/bills/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await get('SELECT 1 AS x FROM bills WHERE id = ?', [id]))) bad('Conta não encontrada', 404);
  await run('UPDATE bills SET payer = ? WHERE id = ?', [str(req.body?.payer, 60), id]);
  res.json({ ok: true });
}));

app.delete('/api/bills/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = await get('SELECT company_receipt FROM bills WHERE id = ?', [id]);
  if (!b) bad('Conta não encontrada', 404);
  const files = (await all('SELECT p.receipt FROM payments p JOIN charges c ON c.id = p.charge_id WHERE c.bill_id = ?', [id])).map((r) => r.receipt);
  files.push(b.company_receipt);
  await batch([
    ['DELETE FROM payments WHERE charge_id IN (SELECT id FROM charges WHERE bill_id = ?)', [id]],
    ['DELETE FROM charges WHERE bill_id = ?', [id]],
    ['DELETE FROM bills WHERE id = ?', [id]],
  ]);
  await removeFiles(files);
  res.json({ ok: true });
}));

// Pagamento da conta na companhia (diferente do que os moradores pagam)
app.post('/api/bills/:id/company-payment', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await get('SELECT 1 AS x FROM bills WHERE id = ?', [id]))) bad('Conta não encontrada', 404);
  const paidAt = req.body?.paid_at || today();
  if (!isDate(paidAt)) bad('Data inválida');
  await run('UPDATE bills SET company_paid_at = ? WHERE id = ?', [paidAt, id]);
  res.json({ ok: true });
}));

app.delete('/api/bills/:id/company-payment', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = await get('SELECT company_receipt FROM bills WHERE id = ?', [id]);
  if (!b) bad('Conta não encontrada', 404);
  await run('UPDATE bills SET company_paid_at = NULL, company_receipt = NULL WHERE id = ?', [id]);
  await removeFiles([b.company_receipt]);
  res.json({ ok: true });
}));

/* ----- Cobranças e pagamentos ----- */
app.patch('/api/charges/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const c = await get('SELECT * FROM charges WHERE id = ?', [id]);
  if (!c) bad('Cobrança não encontrada', 404);
  const b = req.body || {};
  const amount = b.amount_cents === undefined ? c.amount_cents : cents(b.amount_cents);
  let due = c.due_date;
  if (b.due_date !== undefined) {
    due = b.due_date || null;
    if (due && !isDate(due)) bad('Vencimento inválido');
  }
  await run('UPDATE charges SET amount_cents = ?, due_date = ? WHERE id = ?', [amount, due, id]);
  res.json({ ok: true });
}));

app.post('/api/charges/:id/payments', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await get('SELECT 1 AS x FROM charges WHERE id = ?', [id]))) bad('Cobrança não encontrada', 404);
  const b = req.body || {};
  const amount = cents(b.amount_cents);
  if (!METHODS.includes(b.method)) bad('Forma de pagamento inválida');
  const paidAt = b.paid_at || today();
  if (!isDate(paidAt)) bad('Data inválida');
  const r = await run('INSERT INTO payments(charge_id, amount_cents, method, paid_at, note) VALUES(?,?,?,?,?)', [
    id, amount, b.method, paidAt, str(b.note, 200),
  ]);
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.delete('/api/payments/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await get('SELECT * FROM payments WHERE id = ?', [id]);
  if (!p) bad('Pagamento não encontrado', 404);
  await run('DELETE FROM payments WHERE id = ?', [id]);
  await removeFiles([p.receipt]);
  res.json({ ok: true });
}));

/* ----- Comprovantes (guardados no banco) ----- */
const RECEIPT_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' },
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 4).toString() === '%PDF' },
};

async function storeReceipt(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const spec = RECEIPT_TYPES[type];
  if (!spec) bad('Envie uma foto (JPG, PNG, WebP) ou um PDF');
  const buf = await readBody(req, MAX_FILE);
  if (buf.length < 8 || !spec.magic(buf)) bad('Arquivo inválido ou vazio');
  const name = `${crypto.randomUUID()}.${spec.ext}`;
  await run('INSERT INTO files(id, mime, data, created_at) VALUES(?,?,?,?)', [name, type, buf, new Date().toISOString()]);
  return name;
}

app.put('/api/payments/:id/receipt', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await get('SELECT * FROM payments WHERE id = ?', [id]);
  if (!p) bad('Pagamento não encontrado', 404);
  const name = await storeReceipt(req);
  await run('UPDATE payments SET receipt = ? WHERE id = ?', [name, id]);
  await removeFiles([p.receipt]);
  res.json({ receipt: name });
}));

app.put('/api/bills/:id/receipt', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = await get('SELECT company_receipt FROM bills WHERE id = ?', [id]);
  if (!b) bad('Conta não encontrada', 404);
  const name = await storeReceipt(req);
  await run('UPDATE bills SET company_receipt = ? WHERE id = ?', [name, id]);
  await removeFiles([b.company_receipt]);
  res.json({ receipt: name });
}));

app.get('/receipts/:name', wrap(async (req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(name)) return res.status(404).send('Não encontrado');
  const f = await get('SELECT mime, data FROM files WHERE id = ?', [name]);
  if (!f) return res.status(404).send('Não encontrado');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(f.data));
}));

/* ----- Relatórios ----- */
function rangeFrom(req) {
  const cm = today().slice(0, 7);
  const to = req.query.to || cm;
  const from = req.query.from || `${cm.slice(0, 4)}-01`;
  if (!isMonth(from) || !isMonth(to)) bad('Período inválido');
  if (from > to) bad('O mês inicial deve vir antes do final');
  const months = [];
  for (let m = from; m <= to; m = addMonth(m, 1)) {
    months.push(m);
    if (months.length > 36) bad('Escolha no máximo 36 meses');
  }
  return { from, to, months };
}

async function reportRows(from, to, months) {
  await ensureRent(months);
  const t = today();
  const rows = await all(`${CHARGE_SELECT} WHERE c.month BETWEEN ? AND ? ORDER BY c.month, h.name, c.kind`, [from, to]);
  return rows.map((r) => decorate(r, t));
}

app.get('/api/report', wrap(async (req, res) => {
  const { from, to, months } = rangeFrom(req);
  const rows = await reportRows(from, to, months);
  const [byMethod, billRows] = await Promise.all([
    all(
      `SELECT p.method, SUM(p.amount_cents) AS cents FROM payments p JOIN charges c ON c.id = p.charge_id
       WHERE c.month BETWEEN ? AND ? GROUP BY p.method ORDER BY cents DESC`,
      [from, to]
    ),
    all('SELECT * FROM bills WHERE month BETWEEN ? AND ? ORDER BY month, kind, id', [from, to]),
  ]);
  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const totals = (list) => ({
    expected_cents: sum(list, 'amount_cents'),
    received_cents: sum(list, 'paid_cents'),
    open_cents: sum(list, 'remaining_cents'),
  });
  const byMonth = months.map((m) => ({ month: m, ...totals(rows.filter((r) => r.month === m)) }));
  const byHouse = [...group((r) => r.house_id)].map(([, list]) => ({ house: list[0].house_name, tenant: list[0].tenant, ...totals(list) }));
  const byKind = ['aluguel', 'agua', 'luz'].map((k) => ({ kind: k, ...totals(rows.filter((r) => r.kind === k)) }));
  const open = rows
    .filter((r) => r.status !== 'pago')
    .map((r) => ({
      house: r.house_name, tenant: r.tenant, kind: r.kind, month: r.month, due_date: r.due_date,
      amount_cents: r.amount_cents, remaining_cents: r.remaining_cents, status: r.status, days_late: r.days_late,
    }))
    .sort((a, b) => (a.due_date || a.month).localeCompare(b.due_date || b.month));
  const t = today();
  const bv = billRows.map((b) => billView(b, rows.filter((r) => r.bill_id === b.id), t));
  const bills = {
    count: bv.length,
    total_cents: sum(bv, 'total_cents'),
    paid_cents: sum(bv.filter((b) => b.company_paid_at), 'total_cents'),
    received_cents: sum(bv, 'received_cents'),
    advance_cents: sum(bv, 'advance_cents'),
    pending: bv.filter((b) => b.stage !== 'recebida').map((b) => ({
      kind: b.kind, month: b.month, total_cents: b.total_cents, payer: b.payer, due_date: b.due_date, houses: b.houses,
      stage: b.stage, received_cents: b.received_cents, advance_cents: b.advance_cents,
    })),
  };
  res.json({ from, to, totals: totals(rows), byMonth, byHouse, byKind, byMethod, open, bills });
}));

app.get('/api/export.csv', wrap(async (req, res) => {
  const { from, to, months } = rangeFrom(req);
  const rows = await reportRows(from, to, months);
  const pays = await all(
    `SELECT p.* FROM payments p JOIN charges c ON c.id = p.charge_id WHERE c.month BETWEEN ? AND ? ORDER BY p.paid_at, p.id`,
    [from, to]
  );
  const byCharge = new Map();
  for (const p of pays) {
    if (!byCharge.has(p.charge_id)) byCharge.set(p.charge_id, []);
    byCharge.get(p.charge_id).push(p);
  }
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const br = (d) => (d ? d.split('-').reverse().join('/') : '');
  const cell = (v) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Mês', 'Casa', 'Inquilino', 'Tipo', 'Valor', 'Vencimento', 'Pago', 'Em aberto', 'Situação', 'Forma(s)', 'Data(s) do pagamento', 'Comprovante'];
  const lines = [head.join(';')];
  for (const r of rows) {
    const ps = byCharge.get(r.id) || [];
    lines.push([
      fmtMonth(r.month), r.house_name, r.tenant, KIND_LABEL[r.kind], money(r.amount_cents), br(r.due_date),
      money(r.paid_cents), money(r.remaining_cents), r.status,
      [...new Set(ps.map((p) => METHOD_LABEL[p.method]))].join(' + '),
      ps.map((p) => br(p.paid_at)).join(' + '),
      ps.some((p) => p.receipt) ? 'sim' : ps.length ? 'não' : '',
    ].map(cell).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="alugueis_${from}_a_${to}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
}));

// Cópia dos dados em JSON (sem as fotos dos comprovantes; para cópia completa use o dump do Turso)
app.get('/api/backup', wrap(async (req, res) => {
  const [houses, bills, charges, payments] = await Promise.all(['houses', 'bills', 'charges', 'payments'].map((t) => all(`SELECT * FROM ${t}`)));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="alugueis-backup-${today()}.json"`);
  res.send(JSON.stringify({ version: 1, exported_at: new Date().toISOString(), houses, bills, charges, payments }, null, 1));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado' }));
// Na Vercel os arquivos de public/ são servidos pela própria plataforma; localmente, pelo Express
if (!ON_VERCEL) app.use(express.static(path.join(ROOT, 'public')));

export async function resetPin() {
  await init();
  await run("DELETE FROM settings WHERE key = 'pin_hash'");
}

export default app;
