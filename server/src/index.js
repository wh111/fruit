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
const {
  createOrder,
  quoteOrder,
  markPaid,
  orderQrDataUrl,
  getQueueInfo,
  restoreCouponForOrder,
} = require('./services/order');
const { getPromoState } = require('./services/promo');
const { listDeliveryPoints, applyDeliverySettings } = require('./services/delivery');
const { notifyOrderReady, subscribeClientConfig } = require('./services/subscribe');
const {
  grantLoginCoupons,
  listUserCoupons,
  campaignInfo,
  ensureCoupons,
} = require('./services/coupon');
const { getLoyaltyState } = require('./services/loyalty');
const { buildLabelHtml } = require('./services/label');

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
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
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

function readBuffer(req, limitBytes = 500 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('视频过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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

  if (pathname === '/api/shop' && method === 'GET') {
    const db = await load();
    const s = db.settings || {};
    return send(res, 200, {
      shopName: s.shopName || '四季果先',
      shopPhone: s.shopPhone || '18813017847',
      tagline: s.tagline || '',
      pickupHint: s.pickupHint || '',
      groupBuyHint:
        s.groupBuyHint ||
        '企业团购、部门下午茶、会议用果，电话沟通即可。10 份起订，可按 12:00 / 18:00 取餐。',
    });
  }

  if (pathname === '/api/auth/admin/login' && method === 'POST') {
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      return send(res, 200, { token: signToken({ role: 'admin', username: body.username }), username: body.username });
    }
    return send(res, 401, { error: '账号或密码错误' });
  }

  if (pathname === '/api/auth/wxlogin' && method === 'POST') {
    const db = await load();
    ensureCoupons(db);
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
    let isNew = false;
    if (!user) {
      isNew = true;
      user = {
        id: crypto.randomUUID(),
        openid,
        nickName: body.nickName || '果粉',
        avatarUrl: body.avatarUrl || '',
        createdAt: Date.now(),
      };
      db.users.push(user);
    } else if (body.nickName) {
      user.nickName = body.nickName;
      user.avatarUrl = body.avatarUrl || user.avatarUrl;
    }

    const grants = grantLoginCoupons(db, user);
    await save(db);

    const token = signToken({ role: 'user', userId: user.id, openid }, 30);
    const mine = listUserCoupons(db, user.id);
    return send(res, 200, {
      token,
      user: {
        id: user.id,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl,
        openid: openid.startsWith('dev_') ? undefined : openid,
      },
      isNew,
      welcomeGranted: !!grants.welcome.granted,
      welcomeCouponCount: grants.welcome.granted ? grants.welcome.coupons.length : 0,
      monthlyGranted: !!grants.monthly.granted,
      monthlyCouponCount: grants.monthly.granted ? grants.monthly.coupons.length : 0,
      couponSummary: mine.summary,
      campaign: campaignInfo(),
    });
  }

  if (pathname === '/api/coupons/campaign' && method === 'GET') {
    return send(res, 200, campaignInfo());
  }

  if (pathname === '/api/coupons/mine' && method === 'GET') {
    const user = auth(req);
    if (!user?.userId) return send(res, 401, { error: '请先登录' });
    const db = await load();
    ensureCoupons(db);
    const u = db.users.find((x) => x.id === user.userId);
    const grants = u ? grantLoginCoupons(db, u) : { welcome: { granted: false }, monthly: { granted: false }, changed: false };
    if (grants.changed) await save(db);
    const mine = listUserCoupons(db, user.userId);
    return send(res, 200, {
      ...mine,
      welcomeGranted: !!grants.welcome.granted,
      welcomeCouponCount: grants.welcome.granted ? grants.welcome.coupons.length : 0,
      monthlyGranted: !!grants.monthly.granted,
      monthlyCouponCount: grants.monthly.granted ? grants.monthly.coupons.length : 0,
    });
  }

  if (pathname === '/api/subscribe/config' && method === 'GET') {
    return send(res, 200, subscribeClientConfig());
  }

  if (pathname === '/api/promo' && method === 'GET') {
    const user = auth(req);
    const state = getPromoState();
    const db = await load();
    if (user?.userId) {
      state.loyalty = getLoyaltyState(db, {
        userId: user.userId,
        openid: user.openid,
        includeCurrent: false,
      });
    } else {
      state.loyalty = {
        monthPaid: 0,
        monthCount: 0,
        tier: 0,
        rate: 0,
        label: '',
        nextHint: '本月满3单95折，满10单9折；可与立减券同享',
        rules: [
          '自然月累计：满 3 单享 95 折，满 10 单享 9 折',
          '可与立减券叠加：先打折，再减券',
        ],
      };
    }
    return send(res, 200, { ...state, deliveryPoints: listDeliveryPoints(db.settings) });
  }

  if (pathname === '/api/loyalty/mine' && method === 'GET') {
    const user = auth(req);
    if (!user?.userId) return send(res, 401, { error: '请先登录' });
    const db = await load();
    return send(
      res,
      200,
      getLoyaltyState(db, {
        userId: user.userId,
        openid: user.openid,
        includeCurrent: false,
      })
    );
  }

  if (pathname === '/api/products' && method === 'GET') {
    const db = await load();
    return send(res, 200, { list: db.products.filter((p) => p.status === 1).sort((a, b) => a.sort - b.sort) });
  }

  if (pathname.startsWith('/api/products/') && method === 'GET') {
    const id = pathname.split('/').pop();
    const db = await load();
    const p = db.products.find((x) => x.id === id && x.status === 1);
    if (!p) return send(res, 404, { error: '商品不存在' });
    return send(res, 200, p);
  }

  if (pathname === '/api/orders/quote' && method === 'POST') {
    const user = auth(req);
    try {
      const quote = await quoteOrder({
        productId: body.productId,
        specId: body.specId,
        extras: body.extras || [],
        quantity: body.quantity || 1,
        fulfillmentType: body.fulfillmentType,
        pickupAt: body.pickupAt,
        deliveryPoint: body.deliveryPoint,
        couponId: body.couponId,
        userId: user?.userId,
        openid: user?.openid,
        autoCoupon: body.autoCoupon !== false,
      });
      return send(res, 200, { quote });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
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
        fulfillmentType: body.fulfillmentType,
        pickupAt: body.pickupAt,
        deliveryPoint: body.deliveryPoint,
        couponId: body.couponId,
        autoCoupon: body.autoCoupon !== false,
      });
      return send(res, 200, { order });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  if (pathname === '/api/orders/mine' && method === 'GET') {
    const user = auth(req);
    const db = await load();
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
                : queue.phase === 'reserved'
                  ? `预约 ${o.pickupAtText || '稍后'} 取餐`
                  : queue.title || '',
      };
    });
    return send(res, 200, { list });
  }

  if (pathname === '/api/orders/verify' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
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
    await save(db);
    return send(res, 200, { order });
  }

  /** 批量改状态：一人同时做多单 */
  if (pathname === '/api/orders/batch-status' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const status = body.status;
    const allow = ['making', 'ready', 'done', 'cancelled'];
    if (!ids.length) return send(res, 400, { error: '请选择订单' });
    if (!allow.includes(status)) return send(res, 400, { error: '状态无效' });

    const db = await load();
    const now = Date.now();
    const makeBatchId = status === 'making' ? `MB${now}` : null;
    const updated = [];

    for (const id of ids) {
      const order = db.orders.find((o) => o.id === id);
      if (!order) continue;
      order.status = status;
      order.updatedAt = now;
      if (status === 'making') {
        order.makingAt = now;
        order.makeBatchId = makeBatchId;
        // 同批单号列表，方便以后挂同一段制作视频
        order.makeBatchCodes = ids
          .map((oid) => db.orders.find((x) => x.id === oid)?.pickupCode)
          .filter(Boolean);
      }
      if (status === 'ready') {
        order.readyAt = now;
      }
      if (status === 'done') {
        order.doneAt = now;
      }
      updated.push(order);
    }
    await save(db);
    if (status === 'ready') {
      for (const o of updated) {
        notifyOrderReady(o).catch(() => {});
      }
    }
    return send(res, 200, {
      ok: true,
      count: updated.length,
      makeBatchId,
      orders: updated,
      tip:
        status === 'making' && updated.length > 1
          ? `已开始同时制作 ${updated.map((o) => o.pickupCode).join('、')}`
          : undefined,
    });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)(?:\/(status|cancel))?$/);
  if (orderMatch) {
    const orderId = orderMatch[1];
    const action = orderMatch[2];
    const db = await load();
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
      const prev = order.status;
      order.status = body.status;
      order.updatedAt = Date.now();
      if (body.status === 'making') {
        order.makingAt = Date.now();
        if (!order.makeBatchId) {
          order.makeBatchId = `MB${Date.now()}`;
          order.makeBatchCodes = [order.pickupCode].filter(Boolean);
        }
      }
      if (body.status === 'ready') {
        order.readyAt = Date.now();
      }
      if (body.status === 'done') {
        order.doneAt = Date.now();
      }
      await save(db);
      if (body.status === 'ready' && prev !== 'ready') {
        notifyOrderReady(order).catch(() => {});
      }
      return send(res, 200, { order });
    }
    if (method === 'POST' && action === 'cancel') {
      if (!order) return send(res, 404, { error: '订单不存在' });
      if (order.status !== 'pending_pay') return send(res, 400, { error: '仅未支付订单可取消' });
      restoreCouponForOrder(db, order);
      order.status = 'cancelled';
      order.updatedAt = Date.now();
      await save(db);
      return send(res, 200, { order });
    }
  }

  const printedMatch = pathname.match(/^\/api\/orders\/([^/]+)\/printed$/);
  if (printedMatch && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const order = db.orders.find((o) => o.id === printedMatch[1]);
    if (!order) return send(res, 404, { error: '订单不存在' });
    order.printed = true;
    order.printedAt = Date.now();
    order.updatedAt = Date.now();
    await save(db);
    return send(res, 200, { order });
  }

  if (pathname === '/api/pay/create' && method === 'POST') {
    const user = auth(req);
    const db = await load();
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
      // 按「个体户直连」真实链路模拟：下单预支付 → 前端收银台 → confirm 才入账
      // 不在此处 markPaid，与正式 wechat 行为一致
      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = require('crypto').randomBytes(8).toString('hex');
      const prepayId = `mock_${order.orderNo}`;
      order.prepayId = prepayId;
      order.updatedAt = Date.now();
      await save(db);
      return send(res, 200, {
        mode: 'mock',
        paid: false,
        merchantType: 'individual', // 目标方案：个体工商户直连
        order,
        payment: {
          timeStamp,
          nonceStr,
          package: `prepay_id=${prepayId}`,
          signType: 'MD5',
          paySign: 'MOCK_PAY_SIGN',
        },
        message: '模拟预支付成功，请走收银台确认（与正式支付同流程）',
      });
    }

    // 真实微信支付 JSAPI（个体工商户 / 普通商户直连；填了 WX_SUB_MCH_ID 则走服务商）
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
        await save(db);
      }
      const { payment, prepayId, mode: mchMode } = await wechat.createJsapiPrepay({
        orderNo: order.orderNo,
        amountYuan: order.amount,
        openid,
        description: `四季果先-${order.productName}`,
        clientIp: clientIp.replace('::ffff:', ''),
      });
      order.prepayId = prepayId;
      order.updatedAt = Date.now();
      await save(db);
      return send(res, 200, {
        mode: 'wechat',
        paid: false,
        merchantType: mchMode === 'partner' ? 'partner' : 'individual',
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
      const db = await load();
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
    const db = await load();
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
    order = (await load()).orders.find((o) => o.id === body.orderId) || order;
    const qrDataUrl = order.pickupCode ? await orderQrDataUrl(order) : null;
    return send(res, 200, { order, qrDataUrl });
  }

  if (pathname === '/api/admin/delivery' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, { points: listDeliveryPoints(db.settings) });
  }

  if (pathname === '/api/admin/delivery' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      db.settings = applyDeliverySettings(db.settings, body.points);
      await save(db);
      return send(res, 200, { ok: true, points: listDeliveryPoints(db.settings) });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
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
    const db = await load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    let list = db.orders;
    if (status) list = list.filter((o) => o.status === status);
    return send(res, 200, { list: list.slice(0, 200) });
  }

  if (pathname === '/api/admin/products' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, { list: (await load()).products });
  }

  /** 可选商品封面图（菜单素材库） */
  if (pathname === '/api/admin/product-covers' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const dirs = [
      path.join(ROOT, 'assets', 'products', 'menu'),
      path.join(ROOT, 'assets', 'products'),
      path.join(__dirname, '..', 'uploads'),
    ];
    const list = [];
    const seen = new Set();
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) continue;
        const full = path.join(dir, name);
        if (!fs.statSync(full).isFile()) continue;
        const rel = dir.includes(`${path.sep}uploads`)
          ? `/uploads/${name}`
          : `/assets/products/${dir.endsWith('menu') ? `menu/${name}` : name}`;
        if (seen.has(rel)) continue;
        seen.add(rel);
        list.push({ url: rel, name });
      }
    }
    return send(res, 200, { list });
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
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
    await save(db);
    return send(res, 200, { product });
  }

  const adminProduct = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (adminProduct) {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const idx = db.products.findIndex((p) => p.id === adminProduct[1]);
    if (idx < 0) return send(res, 404, { error: '商品不存在' });
    if (method === 'PUT') {
      db.products[idx] = { ...db.products[idx], ...body, id: db.products[idx].id };
      await save(db);
      return send(res, 200, { product: db.products[idx] });
    }
    if (method === 'DELETE') {
      db.products[idx].status = 0;
      await save(db);
      return send(res, 200, { ok: true });
    }
  }

  const labelMatch = pathname.match(/^\/api\/print\/label\/([^/]+)$/);
  if (labelMatch && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
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
      const db = await load();
      const order = db.orders.find((o) => o.id === body.orderId);
      if (!order) return send(res, 404, { error: '订单不存在' });
      const result = await pushFeie(order, db.settings.shopName);
      order.printed = true;
      order.printedAt = Date.now();
      await save(db);
      return send(res, 200, { ok: true, result });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  /** 录像助手：拉取应录/应结束的批次 */
  if (pathname === '/api/admin/record-jobs' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const video = require('./services/video');
    const db = await load();
    return send(res, 200, video.listRecordJobs(db));
  }

  /** 绑定已有视频 URL 到批次 */
  if (pathname === '/api/orders/batch-video' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { makeBatchId, videoUrl, duration, size } = body;
    if (!makeBatchId || !videoUrl) return send(res, 400, { error: '需要 makeBatchId 和 videoUrl' });
    const video = require('./services/video');
    const db = await load();
    const count = video.bindVideoToBatch(db, makeBatchId, videoUrl, { duration, size });
    if (!count) return send(res, 404, { error: '未找到该制作批次' });
    await save(db);
    return send(res, 200, { ok: true, count, makeBatchId, videoUrl });
  }

  return send(res, 404, { error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // 商品封面图上传
    if (pathname === '/api/admin/product-cover/upload' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      try {
        const buf = await readBuffer(req, 8 * 1024 * 1024);
        if (!buf.length) return send(res, 400, { error: '空文件' });
        const ct = (req.headers['content-type'] || '').toLowerCase();
        const ext = ct.includes('png')
          ? 'png'
          : ct.includes('webp')
            ? 'webp'
            : ct.includes('gif')
              ? 'gif'
              : 'jpg';
        const dir = path.join(ROOT, 'assets', 'products', 'menu');
        fs.mkdirSync(dir, { recursive: true });
        const filename = `upload-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
        fs.writeFileSync(path.join(dir, filename), buf);
        return send(res, 200, { ok: true, cover: `/assets/products/menu/${filename}` });
      } catch (e) {
        return send(res, e.status || 500, { error: e.message });
      }
    }

    // 视频二进制上传（勿走 JSON body）— 支持 makeBatchId 或 orderId（手机拍摄上传）
    if (pathname === '/api/admin/videos/upload' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const makeBatchId = url.searchParams.get('makeBatchId');
      const orderId = url.searchParams.get('orderId');
      if (!makeBatchId && !orderId) return send(res, 400, { error: '缺少 makeBatchId 或 orderId' });
      try {
        const buf = await readBuffer(req);
        if (!buf.length) return send(res, 400, { error: '空文件' });
        const video = require('./services/video');
        const key = makeBatchId || orderId;
        const saved = video.saveUploadedVideo(buf, key);
        const videoUrl = video.toPublicUrl(req, saved.filename);
        const db = await load();
        let count = 0;
        if (makeBatchId) {
          count = video.bindVideoToBatch(db, makeBatchId, videoUrl, {
            size: saved.size,
            filename: saved.filename,
            source: 'upload',
          });
        } else {
          count = video.bindVideoForOrder(db, orderId, videoUrl, {
            size: saved.size,
            filename: saved.filename,
            source: 'phone',
          });
        }
        if (!count) return send(res, 404, { error: '未找到对应订单' });
        await save(db);
        return send(res, 200, {
          ok: true,
          videoUrl,
          filename: saved.filename,
          size: saved.size,
          boundOrders: count,
          makeBatchId: makeBatchId || null,
          orderId: orderId || null,
        });
      } catch (e) {
        return send(res, e.status || 500, { error: e.message });
      }
    }

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

ensure()
  .then(() => {
server.listen(PORT, () => {
  console.log(`四季果先 API 已启动: http://localhost:${PORT}`);
  console.log(`管理端: http://localhost:${PORT}/admin/`);
  console.log(`账号: ${ADMIN_USER} / ${ADMIN_PASS}  支付模式: ${PAY_MODE}`);
});
  })
  .catch((e) => {
    console.error('数据库初始化失败:', e);
    process.exit(1);
  });
