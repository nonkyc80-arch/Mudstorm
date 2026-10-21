// Telegram Stars backend — bağımlılık yok, Node 18+ yeterli.
// Çevre değişkenleri: BOT_TOKEN (zorunlu), WEBHOOK_SECRET (zorunlu), BOT_USERNAME (varsayılan: MUDSTORM_bot)
// WEBHOOK_SECRET (zorunlu, rastgele uzun bir metin), PORT (opsiyonel)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '8818108655:AAFUZey9Ho4maca0UOKulMhUWo3Dzctd7I0';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'be4fd5db53bd66ec1fd4d98a6ee2beeaee37fd93931a5100';
const PORT = process.env.PORT || 3000;
if (!BOT_TOKEN || !WEBHOOK_SECRET) { console.error('BOT_TOKEN ve WEBHOOK_SECRET gerekli'); process.exit(1); }

const PACKAGES = [25, 50, 100, 250, 500];
const API = 'https://api.telegram.org/bot' + BOT_TOKEN + '/';
let botUsername = (process.env.BOT_USERNAME || 'MUDSTORM_bot').replace(/^@/, '');

async function tg(method, body) {
  const r = await fetch(API + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!j.ok) throw new Error(method + ': ' + j.description);
  return j.result;
}
async function getBot() { if (!botUsername) botUsername = (await tg('getMe')).username; return botUsername; }

// Mini App initData doğrulaması (Telegram dokümantasyonundaki HMAC yöntemi)
function verifyInitData(initData, maxAgeSec = 86400) {
  const p = new URLSearchParams(initData || ''), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > maxAgeSec) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const invoiceFields = (userId, n) => ({
  title: '⭐ ' + n + ' Stars',
  description: n + ' Stars oyun bakiyesi',
  payload: 'stars:' + userId + ':' + n + ':' + Date.now(),
  provider_token: '',            // Stars için boş olmalı
  currency: 'XTR',
  prices: [{ label: n + ' Stars', amount: n }]
});

const readJson = req => new Promise((res, rej) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (e) { rej(e); } });
});
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };

async function handleUpdate(u) {
  if (u.pre_checkout_query) {                       // 10 sn içinde yanıtlanmazsa ödeme başarısız olur
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
  }
  const m = u.message;
  if (!m) return;
  if (m.successful_payment) {
    const sp = m.successful_payment;
    // BURADA bakiyeyi kendi veritabanında kalıcı olarak artır (sp.invoice_payload: stars:<userId>:<n>:<ts>)
    console.log('ÖDEME ALINDI', m.from.id, sp.total_amount, sp.currency, sp.telegram_payment_charge_id);
    return;
  }
  const t = /^\/start buy_stars_(\d+)$/.exec(m.text || '');   // t.me/BOT?start=buy_stars_N yedek yolu
  if (t && PACKAGES.includes(+t[1])) await tg('sendInvoice', { chat_id: m.chat.id, ...invoiceFields(m.from.id, +t[1]) });
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'POST' && req.url === '/api/invoice') {
      const { amount, initData } = await readJson(req), n = +amount, user = verifyInitData(initData);
      if (!user) return send(res, 401, { error: 'invalid initData' });
      if (!PACKAGES.includes(n)) return send(res, 400, { error: 'invalid package' });
      const link = await tg('createInvoiceLink', invoiceFields(user.id, n));
      return send(res, 200, { link, bot: await getBot() });
    }
    if (req.method === 'POST' && req.url === '/webhook/' + WEBHOOK_SECRET) {
      const u = await readJson(req); send(res, 200, { ok: true }); return handleUpdate(u).catch(e => console.error(e));
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // DÜZELTME: index.html ile server.js aynı klasörde olduğu için yol düzeltildi ('..' kaldırıldı)
      return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { console.error(e); send(res, 500, { error: String(e.message || 'server error') }); }
}).listen(PORT, () => console.log('Dinleniyor :' + PORT));