/**
 * 四季果先 · 零依赖后端（仅需 Node.js 18+）
 * 启动：node src/index.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// 加载 .env
(() => {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  } catch {
    /* ignore */
  }
})();

const { load, save, ensure } = require('./db');
const { createOrder, markPaid, orderQrDataUrl, getQueueInfo } = require('./services/order');
const { buildLabelHtml } = require('./services/label');

ensure();

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sijiguoxian_dev_secret_change_me';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const PAY_MODE = process.env.PAY_MODE || 'mock';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signToken(payload, days = 7) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + days * 86400000 }));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    ...headers,
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, { error: '文件不存在' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
    req.on('error', reject);
  });
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return verifyToken(token);
}

function requireAdmin(req, res) {
  const u = auth(req);
  if (!u || u.role !== 'admin') {
    send(res, 401, { error: '未登录或无权限' });
    return null;
  }
  return u;
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {};

  if (pathname === '/api/health') return send(res, 200, { ok: true, name: '四季果先', time: Date.now() });

  if (pathname === '/api/auth/admin/login' && method === 'POST') {
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      return send(res, 200, { token: signToken({ role: 'admin', username: body.username }), username: body.username });
    }
    return send(res, 401, { error: '账号或密码错误' });
  }

  if (pathname === '/api/auth/wxlogin' && method === 'POST') {
    const db = load();
    let openid = '';
    const wechat = require('./services/wechat');
    if (process.env.WX_APPID && process.env.WX_SECRET && body.code && !String(body.code).startsWith('dev')) {
      try {
        const session = await wechat.code2Session(body.code);
        openid = session.openid;
      } catch (e) {
        console.warn('code2session fail, fallback mock:', e.message);
      }
    }
    if (!openid) openid = `dev_${body.code || 'guest'}`;

    let user = db.users.find((u) => u.openid === openid);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        openid,
        nickName: body.nickName || '果粉',
        avatarUrl: body.avatarUrl || '',
        createdAt: Date.now(),
      };
      db.users.push(user);
      save(db);
    } else if (body.nickName) {
      user.nickName = body.nickName;
      user.avatarUrl = body.avatarUrl || user.avatarUrl;
      save(db);
    }
    const token = signToken({ role: 'user', userId: user.id, openid }, 30);
    return send(res, 200, {
      token,
      user: { id: user.id, nickName: user.nickName, avatarUrl: user.avatarUrl, openid: openid.startsWith('dev_') ? undefined : openid },
    });
  }

  if (pathname === '/api/products' && method === 'GET') {
    const db = load();
    return send(res, 200, { list: db.products.filter((p) => p.status === 1).sort((a, b) => a.sort - b.sort) });
  }

  if (pathname.startsWith('/api/products/') && method === 'GET') {
    const id = pathname.split('/').pop();
    const db = load();
    const p = db.products.find((x) => x.id === id && x.status === 1);
    if (!p) return send(res, 404, { error: '商品不存在' });
    return send(res, 200, p);
  }

  if (pathname === '/api/orders' && method === 'POST') {
    const user = auth(req);
    try {
      const order = await createOrder({
        userId: user?.userId,
        openid: user?.openid,
        productId: body.productId,
        specId: body.specId,
        extras: body.extras || [],
        quantity: body.quantity || 1,
        remark: body.remark,
      });
      return send(res, 200, { order });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  if (pathname === '/api/orders/mine' && method === 'GET') {
    const user = auth(req);
    const db = load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    let list = db.orders;
    if (user?.userId) {
      list = list.filter((o) => o.userId === user.userId || o.openid === user.openid);
    } else {
      const ids = String(url.searchParams.get('ids') || '')
        .split(',')
        .filter(Boolean);
      list = list.filter((o) => ids.includes(o.id));
    }
    list = list.slice(0, 50).map((o) => {
      const queue = getQueueInfo(o, db);
      return {
        ...o,
        queueTip:
          queue.phase === 'queued'
            ? `排队第 ${queue.position} 位（前面 ${queue.ahead} 单）`
            : queue.phase === 'making'
              ? '正在制作'
              : queue.phase === 'ready'
                ? '请取餐'
                : queue.title || '',
      };
    });
    return send(res, 200, { list });
  }

  if (pathname === '/api/orders/verify' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    let order = null;
    if (body.payload) {
      try {
        const data = typeof body.payload === 'string' ? JSON.parse(body.payload) : body.payload;
        order = db.orders.find((o) => o.orderNo === data.orderNo);
      } catch {
        order = db.orders.find((o) => o.orderNo === body.payload);
      }
    } else if (body.pickupCode) {
      order = db.orders.find((o) => o.pickupCode === String(body.pickupCode).toUpperCase());
    } else if (body.orderNo) {
      order = db.orders.find((o) => o.orderNo === body.orderNo);
    }
    if (!order) return send(res, 404, { error: '未找到订单' });
    if (!['paid', 'making', 'ready'].includes(order.status)) {
      return send(res, 400, { error: `当前状态不可核销：${order.status}` });
    }
    order.status = 'done';
    order.updatedAt = Date.now();
    save(db);
    return send(res, 200, { order });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)(?:\/(status|cancel))?$/);
  if (orderMatch) {
    const orderId = orderMatch[1];
    const action = orderMatch[2];
    const db = load();
    const order = db.orders.find((o) => o.id === orderId || o.orderNo === orderId);

    if (method === 'GET' && !action) {
      if (!order) return send(res, 404, { error: '订单不存在' });
      const qrDataUrl = order.pickupCode ? await orderQrDataUrl(order) : null;
      const queue = getQueueInfo(order, db);
      return send(res, 200, { order, qrDataUrl, queue });
    }
    if (method === 'PATCH' && action === 'status') {
      if (!requireAdmin(req, res)) return;
      if (!order) return send(res, 404, { error: '订单不存在' });
      order.status = body.status;
      order.updatedAt = Date.now();
      save(db);
      return send(res, 200, { order });
    }
    if (method === 'POST' && action === 'cancel') {
      if (!order) return send(res, 404, { error: '订单不存在' });
      if (order.status !== 'pending_pay') return send(res, 400, { error: '仅未支付订单可取消' });
      order.status = 'cancelled';
      order.updatedAt = Date.now();
      save(db);
      return send(res, 200, { order });
    }
  }

  const printedMatch = pathname.match(/^\/api\/orders\/([^/]+)\/printed$/);
  if (printedMatch && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const order = db.orders.find((o) => o.id === printedMatch[1]);
    if (!order) return send(res, 404, { error: '订单不存在' });
    order.printed = true;
    order.printedAt = Date.now();
    order.updatedAt = Date.now();
    save(db);
    return send(res, 200, { order });
  }

  if (pathname === '/api/pay/create' && method === 'POST') {
    const user = auth(req);
    const db = load();
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return send(res, 404, { error: '订单不存在' });
    if (order.status !== 'pending_pay') return send(res, 400, { error: '订单不可支付' });

    const clientIp =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    if (PAY_MODE === 'mock') {
      const paid = await markPaid(order.id, { payMode: 'mock' });
      const { onOrderPaid } = require('./services/afterPay');
      const print = await onOrderPaid(paid);
      const qrDataUrl = await orderQrDataUrl(paid);
      return send(res, 200, {
        mode: 'mock',
        paid: true,
        order: paid,
        qrDataUrl,
        print,
        message: '模拟支付成功',
      });
    }

    // 真实微信支付 JSAPI
    try {
      const wechat = require('./services/wechat');
      const openid = order.openid || user?.openid;
      if (!openid || String(openid).startsWith('dev_')) {
        return send(res, 400, {
          error: '当前用户没有真实 openid。请配置 WX_APPID/WX_SECRET，并用真机/开发者工具重新登录后再支付',
        });
      }
      // 若订单尚未绑定 openid，补写
      if (!order.openid) {
        order.openid = openid;
        save(db);
      }
      const { payment, prepayId } = await wechat.createJsapiPrepay({
        orderNo: order.orderNo,
        amountYuan: order.amount,
        openid,
        description: `四季果先-${order.productName}`,
        clientIp: clientIp.replace('::ffff:', ''),
      });
      order.prepayId = prepayId;
      order.updatedAt = Date.now();
      save(db);
      return send(res, 200, {
        mode: 'wechat',
        paid: false,
        order,
        payment,
      });
    } catch (e) {
      console.error('pay/create', e);
      return send(res, e.status || 500, { error: e.message, raw: e.raw });
    }
  }

  /** 微信支付异步通知（XML） */
  if (pathname === '/api/pay/notify' && method === 'POST') {
    const wechat = require('./services/wechat');
    const xml = body.raw || '';
    try {
      const data = wechat.fromXml(xml);
      if (!wechat.verifyNotifySign(data)) {
        return send(res, 200, wechat.notifyFailXml('SIGN'), { 'Content-Type': 'text/xml' });
      }
      if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
        return send(res, 200, wechat.notifySuccessXml(), { 'Content-Type': 'text/xml' });
      }
      const db = load();
      const order = db.orders.find((o) => o.orderNo === data.out_trade_no);
      if (!order) {
        return send(res, 200, wechat.notifyFailXml('ORDER'), { 'Content-Type': 'text/xml' });
      }
      if (order.status === 'pending_pay') {
        const paid = await markPaid(order.id, {
          transactionId: data.transaction_id,
          payMode: 'wechat',
        });
        const { onOrderPaid } = require('./services/afterPay');
        await onOrderPaid(paid);
      }
      return send(res, 200, wechat.notifySuccessXml(), { 'Content-Type': 'text/xml' });
    } catch (e) {
      console.error('pay/notify', e);
      return send(res, 200, wechat.notifyFailXml('ERR'), { 'Content-Type': 'text/xml' });
    }
  }

  if (pathname === '/api/pay/confirm' && method === 'POST') {
    const db = load();
    let order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return send(res, 404, { error: '订单不存在' });

    if (order.status === 'pending_pay' && PAY_MODE === 'mock') {
      order = await markPaid(order.id, { payMode: 'mock' });
      const { onOrderPaid } = require('./services/afterPay');
      await onOrderPaid(order);
    }

    // 真实支付：查单兜底（回调可能延迟）
    if (order.status === 'pending_pay' && PAY_MODE === 'wechat') {
      try {
        const wechat = require('./services/wechat');
        const q = await wechat.queryOrder(order.orderNo);
        if (q.return_code === 'SUCCESS' && q.result_code === 'SUCCESS' && q.trade_state === 'SUCCESS') {
          order = await markPaid(order.id, {
            transactionId: q.transaction_id,
            payMode: 'wechat',
          });
          const { onOrderPaid } = require('./services/afterPay');
          await onOrderPaid(order);
        }
      } catch (e) {
        console.warn('pay/confirm query', e.message);
      }
    }

    // 重新读取最新订单
    order = load().orders.find((o) => o.id === body.orderId) || order;
    const qrDataUrl = order.pickupCode ? await orderQrDataUrl(order) : null;
    return send(res, 200, { order, qrDataUrl });
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime();
    const todays = db.orders.filter((o) => (o.paidAt || o.createdAt) >= start && o.status !== 'cancelled');
    const paid = todays.filter((o) => !['pending_pay', 'cancelled'].includes(o.status));
    const revenue = paid.reduce((s, o) => s + Number(o.amount || 0), 0);
    return send(res, 200, {
      todayOrders: paid.length,
      todayRevenue: Math.round(revenue * 100) / 100,
      pendingMake: db.orders.filter((o) => ['paid', 'making'].includes(o.status)).length,
      productCount: db.products.filter((p) => p.status === 1).length,
    });
  }

  if (pathname === '/api/admin/orders' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    let list = db.orders;
    if (status) list = list.filter((o) => o.status === status);
    return send(res, 200, { list: list.slice(0, 200) });
  }

  if (pathname === '/api/admin/products' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, { list: load().products });
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const product = {
      id: crypto.randomUUID(),
      name: body.name || '未命名果切',
      desc: body.desc || '',
      cover: body.cover || '/uploads/demo-mix.svg',
      category: body.category || '经典果切',
      status: body.status == null ? 1 : Number(body.status),
      sort: Number(body.sort) || db.products.length + 1,
      specs: body.specs || [{ id: 'm', name: '中杯', price: 18.9, stock: 999 }],
      extras: body.extras || [],
      createdAt: Date.now(),
    };
    db.products.push(product);
    save(db);
    return send(res, 200, { product });
  }

  const adminProduct = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (adminProduct) {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const idx = db.products.findIndex((p) => p.id === adminProduct[1]);
    if (idx < 0) return send(res, 404, { error: '商品不存在' });
    if (method === 'PUT') {
      db.products[idx] = { ...db.products[idx], ...body, id: db.products[idx].id };
      save(db);
      return send(res, 200, { product: db.products[idx] });
    }
    if (method === 'DELETE') {
      db.products[idx].status = 0;
      save(db);
      return send(res, 200, { ok: true });
    }
  }

  const labelMatch = pathname.match(/^\/api\/print\/label\/([^/]+)$/);
  if (labelMatch && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = load();
    const order = db.orders.find((o) => o.id === labelMatch[1]);
    if (!order) return send(res, 404, { error: '订单不存在' });
    if (!order.pickupCode) return send(res, 400, { error: '订单尚未支付，无取餐码' });
    const qrDataUrl = await orderQrDataUrl(order);
    const html = buildLabelHtml({ order, qrDataUrl, shopName: db.settings.shopName });
    return send(res, 200, { order, qrDataUrl, html, shopName: db.settings.shopName });
  }

  if (pathname === '/api/print/cloud' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    if (process.env.CLOUD_PRINT_ENABLED !== 'true') {
      return send(res, 400, {
        error: '未开启云打印。购买飞鹅云打印机后，在 .env 设置 CLOUD_PRINT_ENABLED=true 及 USER/UKEY/SN',
      });
    }
    try {
      const { pushFeie } = require('./services/cloudPrint');
      const db = load();
      const order = db.orders.find((o) => o.id === body.orderId);
      if (!order) return send(res, 404, { error: '订单不存在' });
      const result = await pushFeie(order, db.settings.shopName);
      order.printed = true;
      order.printedAt = Date.now();
      save(db);
      return send(res, 200, { ok: true, result });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  return send(res, 404, { error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);

    if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
      return sendFile(res, path.join(ROOT, 'admin', 'index.html'));
    }
    if (pathname.startsWith('/admin/')) {
      return sendFile(res, path.join(ROOT, pathname.replace(/^\//, '')));
    }
    if (pathname.startsWith('/assets/')) {
      return sendFile(res, path.join(ROOT, pathname.replace(/^\//, '')));
    }
    if (pathname.startsWith('/uploads/')) {
      return sendFile(res, path.join(__dirname, '..', pathname.replace(/^\//, '')));
    }

    send(res, 404, { error: 'Not Found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message || '服务器错误' });
  }
});

server.listen(PORT, () => {
  console.log(`四季果先 API 已启动: http://localhost:${PORT}`);
  console.log(`管理端: http://localhost:${PORT}/admin/`);
  console.log(`账号: ${ADMIN_USER} / ${ADMIN_PASS}  支付模式: ${PAY_MODE}`);
});
