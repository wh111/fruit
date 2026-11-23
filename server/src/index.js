/**
 * 四季果先 · 零依赖后端（仅需 Node.js 18+）
 * 启动：node src/index.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// 加载 .env（文件优先，避免 pm2 旧环境变量盖住支付密钥）
(() => {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2];
    });
  } catch {
    /* ignore */
  }
})();

const { load, save, ensure } = require('./db');
const { writeHexPages } = require('./usbPrint');
const { printReceipt } = require('./receiptPrint');
const {
  createOrder,
  createBulkOrder,
  quoteBulkOrder,
  quoteOrder,
  markPaid,
  orderQrDataUrl,
  getQueueInfo,
  settlePickedOrders,
  restoreCouponForOrder,
} = require('./services/order');
const {
  getPromoState,
  getReserveCategories,
  setReserveCategories,
  ALL_PRODUCT_CATEGORIES,
} = require('./services/promo');
const {
  listDeliveryPoints,
  applyDeliverySettings,
  getDeliveryScopeNote,
} = require('./services/delivery');
const { notifyOrderReady, subscribeClientConfig } = require('./services/subscribe');
const { bindPhoneForUser, publicUser } = require('./services/phone');
const {
  grantLoginCoupons,
  grantManualCoupons,
  grantFruitRetailOffToUsers,
  grantCanePromoToUsers,
  claimPromoCoupon,
  getPromoPopupPublic,
  listUserCoupons,
  campaignInfo,
  ensureCoupons,
  getOff15_3ScopePublic,
  updateOff15_3Scope,
  getFruitRetailOffPublic,
  updateFruitRetailOff,
  getCanePromoPublic,
  updateCanePromo,
} = require('./services/coupon');
const {
  ensureLottery,
  campaignPublic: lotteryCampaign,
  drawLottery,
  updateLottery,
  adminStats: lotteryAdminStats,
} = require('./services/lottery');
const {
  normalizeToppings,
  listActiveToppings,
  listPublicToppings,
  resolveToppingItems,
  isFruitBowlOrder,
} = require('./services/toppings');
const {
  getLoyaltyState,
  getMemberDiscountPublic,
  updateMemberDiscount,
} = require('./services/loyalty');
const {
  listActivities,
  getWeeklyActivitiesAdmin,
  updateWeeklyActivities,
  archiveWeeklyActivities,
} = require('./services/activities');
const {
  getConfig: getHomePosterConfig,
  publicConfig: publicHomePoster,
  updateConfig: updateHomePoster,
} = require('./services/homePoster');
const {
  touchLogin,
  listUsersWithActivity,
  getUserAdminDetail,
  updateUserAdmin,
  adjustUserBalance,
} = require('./services/users');
const { buildLabelHtml } = require('./services/label');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sijiguoxian_dev_secret_change_me';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const PAY_MODE = process.env.PAY_MODE || 'mock';
/** 管理端 token 有效期（天），默认 1 天 */
const ADMIN_TOKEN_DAYS = Math.max(0.04, Number(process.env.ADMIN_TOKEN_DAYS || 1));
/** 登录失败：窗口内最多 N 次，超限锁定 LOCK_MS */
const ADMIN_LOGIN_MAX_FAILS = Math.max(3, Number(process.env.ADMIN_LOGIN_MAX_FAILS || 5));
const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number(process.env.ADMIN_LOGIN_WINDOW_MS || 10 * 60 * 1000));
const ADMIN_LOGIN_LOCK_MS = Math.max(60_000, Number(process.env.ADMIN_LOGIN_LOCK_MS || 10 * 60 * 1000));

/** ip -> { fails: number[], lockedUntil: number } */
const adminLoginAttempts = new Map();

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (xff) return xff;
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  return req.socket?.remoteAddress || 'unknown';
}

function checkAdminLoginRate(ip) {
  const now = Date.now();
  let row = adminLoginAttempts.get(ip);
  if (!row) {
    row = { fails: [], lockedUntil: 0 };
    adminLoginAttempts.set(ip, row);
  }
  if (row.lockedUntil > now) {
    const waitSec = Math.ceil((row.lockedUntil - now) / 1000);
    return { ok: false, waitSec, error: `登录尝试过多，请 ${waitSec} 秒后再试` };
  }
  if (row.lockedUntil && row.lockedUntil <= now) {
    row.lockedUntil = 0;
    row.fails = [];
  }
  row.fails = (row.fails || []).filter((t) => now - t < ADMIN_LOGIN_WINDOW_MS);
  return { ok: true, row };
}

function recordAdminLoginFail(ip) {
  const now = Date.now();
  let row = adminLoginAttempts.get(ip);
  if (!row) {
    row = { fails: [], lockedUntil: 0 };
    adminLoginAttempts.set(ip, row);
  }
  row.fails = (row.fails || []).filter((t) => now - t < ADMIN_LOGIN_WINDOW_MS);
  row.fails.push(now);
  if (row.fails.length >= ADMIN_LOGIN_MAX_FAILS) {
    row.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;
    row.fails = [];
  }
}

function clearAdminLoginFails(ip) {
  adminLoginAttempts.delete(ip);
}

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
    'Access-Control-Allow-Private-Network': 'true',
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
      shopPhone: s.shopPhone || '15701511086',
      tagline: s.tagline || '',
      pickupHint: s.pickupHint || '',
      groupBuyHint:
        s.groupBuyHint ||
        '企业团购、部门下午茶、会议用果，电话沟通即可。10 份起订。',
    });
  }

  if (pathname === '/api/auth/admin/login' && method === 'POST') {
    const ip = clientIp(req);
    const rate = checkAdminLoginRate(ip);
    if (!rate.ok) {
      return send(res, 429, { error: rate.error, waitSec: rate.waitSec });
    }
    const userOk = String(body.username || '') === ADMIN_USER;
    const passOk = String(body.password || '') === ADMIN_PASS;
    if (userOk && passOk) {
      clearAdminLoginFails(ip);
      return send(res, 200, {
        token: signToken({ role: 'admin', username: ADMIN_USER }, ADMIN_TOKEN_DAYS),
        username: ADMIN_USER,
        expiresInDays: ADMIN_TOKEN_DAYS,
      });
    }
    recordAdminLoginFail(ip);
    return send(res, 401, { error: '账号或密码错误' });
  }

  if (pathname === '/api/auth/wxlogin' && method === 'POST') {
    const db = await load();
    ensureCoupons(db);
    let openid = '';
    let sessionKey = '';
    const wechat = require('./services/wechat');
    if (process.env.WX_APPID && process.env.WX_SECRET && body.code && !String(body.code).startsWith('dev')) {
      try {
        const session = await wechat.code2Session(body.code);
        openid = session.openid;
        sessionKey = session.session_key || '';
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
    if (sessionKey) user.sessionKey = sessionKey;
    touchLogin(user);

    const grants = grantLoginCoupons(db, user);
    await save(db);

    const token = signToken({ role: 'user', userId: user.id, openid }, 30);
    const mine = listUserCoupons(db, user.id);
    return send(res, 200, {
      token,
      user: {
        ...publicUser(user),
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

  /** 微信手机号快速验证 → 绑定；同号合并用户，保证券/月累计一致 */
  if (pathname === '/api/auth/bindPhone' && method === 'POST') {
    const u = auth(req);
    if (!u?.userId) return send(res, 401, { error: '请先登录' });
    try {
      const db = await load();
      const current = db.users.find((x) => x.id === u.userId);
      if (!current) return send(res, 401, { error: '用户不存在，请重新登录' });
      const { user, merged } = await bindPhoneForUser(db, current, {
        code: body.code,
        encryptedData: body.encryptedData,
        iv: body.iv,
        mockPhone: body.mockPhone,
      });
      await save(db);
      const token = signToken({ role: 'user', userId: user.id, openid: user.openid }, 30);
      const mine = listUserCoupons(db, user.id);
      return send(res, 200, {
        ok: true,
        merged,
        token,
        user: {
          ...publicUser(user),
          openid: String(user.openid || '').startsWith('dev_') ? undefined : user.openid,
        },
        couponSummary: mine.summary,
      });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message || '绑定失败' });
    }
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const u = auth(req);
    if (!u?.userId) return send(res, 401, { error: '请先登录' });
    const db = await load();
    const user = db.users.find((x) => x.id === u.userId);
    if (!user) return send(res, 401, { error: '用户不存在' });
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/coupons/campaign' && method === 'GET') {
    return send(res, 200, campaignInfo());
  }

  if (pathname === '/api/activities' && method === 'GET') {
    const user = auth(req);
    const db = await load();
    return send(res, 200, listActivities(db, user && user.userId));
  }

  if (pathname === '/api/admin/weekly-activities' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, getWeeklyActivitiesAdmin(db));
  }

  if (pathname === '/api/admin/weekly-activities' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const cfg = updateWeeklyActivities(db, body || {});
      await save(db);
      return send(res, 200, cfg);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/weekly-activities/archive' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const cfg = archiveWeeklyActivities(db, body || {});
      await save(db);
      return send(res, 200, cfg);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '归档失败' });
    }
  }

  if (pathname === '/api/admin/member-discount' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, getMemberDiscountPublic(db));
  }

  if (pathname === '/api/admin/member-discount' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const cfg = updateMemberDiscount(db, body || {});
      await save(db);
      return send(res, 200, cfg);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/lottery' && method === 'GET') {
    const db = await load();
    ensureLottery(db);
    const user = auth(req);
    return send(res, 200, lotteryCampaign(db, user && user.userId));
  }

  if (pathname === '/api/lottery/draw' && method === 'POST') {
    const user = auth(req);
    if (!user?.userId) return send(res, 401, { error: '请先登录' });
    try {
      const db = await load();
      ensureLottery(db);
      const full = (db.users || []).find((u) => u.id === user.userId);
      if (!full) return send(res, 401, { error: '用户不存在' });
      const result = drawLottery(db, full);
      await save(db);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '抽奖失败' });
    }
  }

  if (pathname === '/api/coupons/mine' && method === 'GET') {
    const user = auth(req);
    if (!user?.userId) return send(res, 401, { error: '请先登录' });
    const db = await load();
    ensureCoupons(db);
    const u = db.users.find((x) => x.id === user.userId);
    if (u) touchLogin(u);
    const grants = u ? grantLoginCoupons(db, u) : { welcome: { granted: false }, monthly: { granted: false }, changed: false };
    if (grants.changed || u) await save(db);
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
    const db = await load();
    const state = getPromoState(Date.now(), db);
    const memberDiscount = getMemberDiscountPublic(db);
    if (user?.userId) {
      state.loyalty = getLoyaltyState(db, {
        userId: user.userId,
        openid: user.openid,
        includeCurrent: false,
      });
    } else {
      state.loyalty = getLoyaltyState(db, {
        userId: null,
        openid: null,
        includeCurrent: false,
      });
    }
    return send(res, 200, {
      ...state,
      memberDiscount,
      deliveryPoints: listDeliveryPoints(db.settings),
      deliveryScopeNote: getDeliveryScopeNote(db.settings),
      homePoster: publicHomePoster(db),
    });
  }

  if (pathname === '/api/admin/home-poster' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, { poster: getHomePosterConfig(db) });
  }

  if (pathname === '/api/admin/home-poster' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const poster = updateHomePoster(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, poster });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/wallet/mine' && method === 'GET') {
    const u = auth(req);
    if (!u?.userId) return send(res, 401, { error: '请先登录' });
    const db = await load();
    const { minePayload } = require('./services/wallet');
    return send(res, 200, minePayload(db, u.userId));
  }

  if (pathname === '/api/wallet/recharge' && method === 'POST') {
    const u = auth(req);
    if (!u?.userId) return send(res, 401, { error: '请先登录' });
    try {
      const db = await load();
      const user = db.users.find((x) => x.id === u.userId);
      if (!user) return send(res, 401, { error: '用户不存在' });
      const { createRecharge } = require('./services/wallet');
      const recharge = createRecharge(db, user, body.tierId);
      await save(db);
      return send(res, 200, { recharge });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '创建充值单失败' });
    }
  }

  if (pathname === '/api/admin/wallet' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const { getConfig } = require('./services/wallet');
    return send(res, 200, { wallet: getConfig(db) });
  }

  if (pathname === '/api/admin/wallet' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const { updateConfig } = require('./services/wallet');
      const wallet = updateConfig(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, wallet });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
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
    const { listPublicProducts } = require('./services/products');
    return send(res, 200, { list: listPublicProducts(db) });
  }

  if (pathname.startsWith('/api/products/') && method === 'GET') {
    const id = pathname.split('/').pop();
    const db = await load();
    const p = db.products.find((x) => x.id === id && x.status === 1);
    if (!p) return send(res, 404, { error: '商品不存在' });
    const { withCoverVariants, computeProductSales, withSales } = require('./services/products');
    return send(res, 200, withCoverVariants(withSales(p, computeProductSales(db))));
  }

  if (pathname === '/api/orders/quote' && method === 'POST') {
    const user = auth(req);
    try {
      const quote = await quoteOrder({
        items: body.items,
        productId: body.productId,
        specId: body.specId,
        extras: body.extras || [],
        toppingIds: body.toppingIds || [],
        sideMeal: body.sideMeal || null,
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
        items: body.items,
        productId: body.productId,
        specId: body.specId,
        extras: body.extras || [],
        toppingIds: body.toppingIds || [],
        sideMeal: body.sideMeal || null,
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

  if (pathname === '/api/orders/bulk/quote' && method === 'POST') {
    const user = auth(req);
    if (!user?.userId) return send(res, 401, { error: '请先登录' });
    try {
      const quote = await quoteBulkOrder({
        userId: user.userId,
        amount: body.amount,
      });
      return send(res, 200, quote);
    } catch (e) {
      return send(res, e.status || 400, { error: e.message });
    }
  }

  if (pathname === '/api/orders/bulk' && method === 'POST') {
    const user = auth(req);
    try {
      const order = await createBulkOrder({
        userId: user?.userId,
        openid: user?.openid,
        amount: body.amount,
        remark: body.remark,
        couponId: body.couponId,
      });
      return send(res, 200, { order });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }

  if (pathname === '/api/coupons/promo-popup' && method === 'GET') {
    const u = auth(req);
    const db = await load();
    return send(res, 200, getPromoPopupPublic(db, u?.userId || null));
  }

  if (pathname === '/api/coupons/promo-claim' && method === 'POST') {
    const u = auth(req);
    if (!u?.userId) return send(res, 401, { error: '请先登录' });
    try {
      const db = await load();
      const user = db.users.find((x) => x.id === u.userId);
      if (!user) return send(res, 401, { error: '用户不存在' });
      const result = claimPromoCoupon(db, user, body.pack);
      await save(db);
      const coupon = result.coupons && result.coupons[0];
      return send(res, 200, {
        ok: true,
        pack: result.pack,
        freeSlot: !!result.freeSlot,
        threshold: result.threshold,
        freeLeft: result.freeLeft,
        coupon: coupon
          ? {
              id: coupon.id,
              title: coupon.title,
              amount: coupon.amount,
              threshold: coupon.threshold,
            }
          : null,
        popup: getPromoPopupPublic(db, user.id),
        note:
          result.threshold === 0
            ? result.vip || (result.freeSlot && result.alreadyFree)
              ? '已领取（会员/无门槛）'
              : '已领取（今日前 20 名无门槛）'
            : `已领取（满 ¥${result.threshold} 可用，含自定义结账）`,
      });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '领取失败' });
    }
  }

  if (pathname === '/api/orders/mine' && method === 'GET') {
    const user = auth(req);
    const db = await load();
    if (settlePickedOrders(db)) await save(db);
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
                ? o.orderKind === 'retail' || o.skipQueue
                  ? '成品可取，无需排队'
                  : '请取餐'
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
    const toppingIds = Array.isArray(body.toppingIds) ? body.toppingIds : null;
    const makeToppings =
      toppingIds != null ? resolveToppingItems(db.toppings, toppingIds) : null;
    const updated = [];

    const { restoreSideMealStock } = require('./services/sideMeals');
    for (const id of ids) {
      const order = db.orders.find((o) => o.id === id);
      if (!order) continue;
      const prev = order.status;
      order.status = status;
      order.updatedAt = now;
      if (status === 'making') {
        order.makingAt = now;
        order.makeBatchId = makeBatchId;
        // 同批单号列表，方便以后挂同一段制作视频
        order.makeBatchCodes = ids
          .map((oid) => db.orders.find((x) => x.id === oid)?.pickupCode)
          .filter(Boolean);
        // 水果捞制作时可多选小料，记到订单上
        if (makeToppings && isFruitBowlOrder(order)) {
          order.makeToppings = makeToppings;
        }
      }
      if (status === 'ready') {
        order.readyAt = now;
        if (makeToppings && isFruitBowlOrder(order)) {
          order.makeToppings = makeToppings;
        }
        // 请取餐：释放现烤占用，烤盘可再做
        if (['paid', 'making'].includes(prev)) {
          try {
            restoreSideMealStock(db, order);
          } catch {
            /* ignore */
          }
        }
      }
      if (status === 'cancelled' && prev !== 'cancelled') {
        try {
          restoreSideMealStock(db, order);
        } catch {
          /* ignore */
        }
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
      if (settlePickedOrders(db)) await save(db);
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
        if (['paid', 'making'].includes(prev)) {
          try {
            const { restoreSideMealStock } = require('./services/sideMeals');
            restoreSideMealStock(db, order);
          } catch {
            /* ignore */
          }
        }
      }
      if (body.status === 'cancelled' && prev !== 'cancelled') {
        try {
          const { restoreSideMealStock } = require('./services/sideMeals');
          restoreSideMealStock(db, order);
        } catch {
          /* ignore */
        }
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
      try {
        const { restoreSideMealStock } = require('./services/sideMeals');
        restoreSideMealStock(db, order);
      } catch {
        /* ignore */
      }
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
    const payChannel = body.payChannel === 'balance' ? 'balance' : 'wechat';
    const clientIp =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    // —— 储值充值单（仅微信，不可余额）——
    if (body.rechargeId) {
      const recharge = (db.recharges || []).find((r) => r.id === body.rechargeId);
      if (!recharge) return send(res, 404, { error: '充值单不存在' });
      if (recharge.status !== 'pending_pay') return send(res, 400, { error: '充值单不可支付' });
      if (user?.userId && recharge.userId !== user.userId) {
        return send(res, 403, { error: '无权支付该充值单' });
      }

      if (PAY_MODE === 'mock') {
        const timeStamp = String(Math.floor(Date.now() / 1000));
        const nonceStr = require('crypto').randomBytes(8).toString('hex');
        const prepayId = `mock_${recharge.orderNo}`;
        recharge.prepayId = prepayId;
        recharge.updatedAt = Date.now();
        await save(db);
        return send(res, 200, {
          mode: 'mock',
          paid: false,
          kind: 'recharge',
          recharge,
          payment: {
            timeStamp,
            nonceStr,
            package: `prepay_id=${prepayId}`,
            signType: 'MD5',
            paySign: 'MOCK_PAY_SIGN',
          },
          message: '模拟充值预支付成功',
        });
      }

      try {
        const wechat = require('./services/wechat');
        const openid = recharge.openid || user?.openid;
        if (!openid || String(openid).startsWith('dev_')) {
          return send(res, 400, {
            error: '当前用户没有真实 openid，请用真机微信登录后再充值',
          });
        }
        if (!recharge.openid) recharge.openid = openid;
        const { payment, prepayId, mode: mchMode } = await wechat.createJsapiPrepay({
          orderNo: recharge.orderNo,
          amountYuan: recharge.payAmount,
          openid,
          description: `四季果先-储值${recharge.title}`,
          clientIp: clientIp.replace('::ffff:', ''),
        });
        recharge.prepayId = prepayId;
        recharge.updatedAt = Date.now();
        await save(db);
        return send(res, 200, {
          mode: 'wechat',
          paid: false,
          kind: 'recharge',
          merchantType: mchMode === 'partner' ? 'partner' : 'enterprise',
          recharge,
          payment,
        });
      } catch (e) {
        console.error('pay/create recharge', e);
        return send(res, e.status || 500, { error: e.message, raw: e.raw });
      }
    }

    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return send(res, 404, { error: '订单不存在' });
    if (order.status !== 'pending_pay') return send(res, 400, { error: '订单不可支付' });

    // —— 整单余额支付（不可与微信混付）——
    if (payChannel === 'balance') {
      try {
        const { getBalance, debit, ensureWallet } = require('./services/wallet');
        ensureWallet(db);
        if (!db.settings.wallet.enabled) {
          return send(res, 400, { error: '储值未开启，请使用微信支付' });
        }
        const uid = order.userId || user?.userId;
        if (!uid) return send(res, 401, { error: '请先登录' });
        const amount = Number(order.amount) || 0;
        const bal = getBalance(db, uid);
        if (bal + 0.001 < amount) {
          return send(res, 400, {
            error: `余额不足（¥${bal.toFixed(2)}），请先充值或改用微信支付`,
            balance: bal,
          });
        }
        debit(db, uid, amount, {
          type: 'order_pay',
          orderId: order.id,
          note: `订单 ${order.orderNo}`,
        });
        await save(db);
        const paid = await markPaid(order.id, {
          transactionId: `BAL${Date.now()}`,
          payMode: 'balance',
          payChannel: 'balance',
          balancePaid: amount,
        });
        const { onOrderPaid } = require('./services/afterPay');
        await onOrderPaid(paid);
        return send(res, 200, {
          mode: 'balance',
          paid: true,
          payChannel: 'balance',
          order: paid,
          message: '余额支付成功',
        });
      } catch (e) {
        return send(res, e.status || 400, { error: e.message || '余额支付失败' });
      }
    }

    if (PAY_MODE === 'mock') {
      // 按「企业商户直连」真实链路模拟：下单预支付 → 前端收银台 → confirm 才入账
      // 不在此处 markPaid，与正式 wechat 行为一致
      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = require('crypto').randomBytes(8).toString('hex');
      const prepayId = `mock_${order.orderNo}`;
      order.prepayId = prepayId;
      order.payChannel = 'wechat';
      order.updatedAt = Date.now();
      await save(db);
      return send(res, 200, {
        mode: 'mock',
        paid: false,
        payChannel: 'wechat',
        merchantType: 'enterprise', // 目标方案：企业商户直连
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

    // 真实微信支付 JSAPI（企业商户直连；填了 WX_SUB_MCH_ID 则走服务商）
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
      order.payChannel = 'wechat';
      order.updatedAt = Date.now();
      await save(db);
      return send(res, 200, {
        mode: 'wechat',
        paid: false,
        payChannel: 'wechat',
        merchantType: mchMode === 'partner' ? 'partner' : 'enterprise',
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
      const outTradeNo = data.out_trade_no;
      const recharge = (db.recharges || []).find((r) => r.orderNo === outTradeNo);
      if (recharge) {
        if (recharge.status === 'pending_pay') {
          const { markRechargePaid } = require('./services/wallet');
          markRechargePaid(db, recharge.id, {
            transactionId: data.transaction_id,
            payMode: 'wechat',
          });
          await save(db);
        }
        return send(res, 200, wechat.notifySuccessXml(), { 'Content-Type': 'text/xml' });
      }
      const order = db.orders.find((o) => o.orderNo === outTradeNo);
      if (!order) {
        return send(res, 200, wechat.notifyFailXml('ORDER'), { 'Content-Type': 'text/xml' });
      }
      if (order.status === 'pending_pay') {
        const paid = await markPaid(order.id, {
          transactionId: data.transaction_id,
          payMode: 'wechat',
          payChannel: 'wechat',
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

    // 充值确认
    if (body.rechargeId) {
      let recharge = (db.recharges || []).find((r) => r.id === body.rechargeId);
      if (!recharge) return send(res, 404, { error: '充值单不存在' });
      if (recharge.status === 'pending_pay' && PAY_MODE === 'mock') {
        const { markRechargePaid } = require('./services/wallet');
        markRechargePaid(db, recharge.id, { payMode: 'mock' });
        await save(db);
      }
      if (recharge.status === 'pending_pay' && PAY_MODE === 'wechat') {
        try {
          const wechat = require('./services/wechat');
          const q = await wechat.queryOrder(recharge.orderNo);
          if (q.return_code === 'SUCCESS' && q.result_code === 'SUCCESS' && q.trade_state === 'SUCCESS') {
            const { markRechargePaid } = require('./services/wallet');
            markRechargePaid(db, recharge.id, {
              transactionId: q.transaction_id,
              payMode: 'wechat',
            });
            await save(db);
          }
        } catch (e) {
          console.warn('pay/confirm recharge query', e.message);
        }
      }
      recharge = (await load()).recharges.find((r) => r.id === body.rechargeId) || recharge;
      const { getBalance } = require('./services/wallet');
      const balance = getBalance(await load(), recharge.userId);
      return send(res, 200, { recharge, balance });
    }

    let order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return send(res, 404, { error: '订单不存在' });

    if (order.status === 'pending_pay' && PAY_MODE === 'mock') {
      order = await markPaid(order.id, { payMode: 'mock', payChannel: 'wechat' });
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
            payChannel: 'wechat',
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
    return send(res, 200, {
      points: listDeliveryPoints(db.settings),
      scopeNote: getDeliveryScopeNote(db.settings),
    });
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

  if (pathname === '/api/admin/reserve-categories' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, {
      categories: ALL_PRODUCT_CATEGORIES,
      enabled: getReserveCategories(db),
    });
  }

  if (pathname === '/api/admin/reserve-categories' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const enabled = setReserveCategories(db, body?.enabled || body?.categories || []);
      await save(db);
      return send(res, 200, { ok: true, categories: ALL_PRODUCT_CATEGORIES, enabled });
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
    const users = listUsersWithActivity(db);
    return send(res, 200, {
      todayOrders: paid.length,
      todayRevenue: Math.round(revenue * 100) / 100,
      pendingMake: db.orders.filter((o) => ['paid', 'making'].includes(o.status)).length,
      productCount: db.products.filter((p) => p.status === 1).length,
      userTotal: users.summary.total,
      userActive: users.summary.active,
      userInactive: users.summary.inactive,
      userActiveDays: users.summary.activeDays,
    });
  }

  if (pathname === '/api/admin/reports/sales' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { salesReport } = require('./services/reports');
    const groupBy = url.searchParams.get('groupBy') === 'month' ? 'month' : 'day';
    return send(
      res,
      200,
      salesReport(db, {
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        month: url.searchParams.get('month') || undefined,
        groupBy,
      })
    );
  }

  if (pathname === '/api/admin/purchases' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const { listPurchases } = require('./services/purchases');
    return send(res, 200, { list: listPurchases(db) });
  }

  if (pathname === '/api/admin/purchases' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const { createPurchase } = require('./services/purchases');
      const purchase = createPurchase(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, purchase });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  {
    const m = pathname.match(/^\/api\/admin\/purchases\/([^/]+)$/);
    if (m && method === 'PUT') {
      if (!requireAdmin(req, res)) return;
      try {
        const db = await load();
        const { updatePurchase } = require('./services/purchases');
        const purchase = updatePurchase(db, decodeURIComponent(m[1]), body || {});
        await save(db);
        return send(res, 200, { ok: true, purchase });
      } catch (e) {
        return send(res, e.status || 400, { error: e.message || '更新失败' });
      }
    }
    if (m && method === 'DELETE') {
      if (!requireAdmin(req, res)) return;
      try {
        const db = await load();
        const { removePurchase } = require('./services/purchases');
        removePurchase(db, decodeURIComponent(m[1]));
        await save(db);
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, e.status || 400, { error: e.message || '删除失败' });
      }
    }
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const segment = url.searchParams.get('segment') || 'all';
    const activeDays = Number(url.searchParams.get('activeDays') || 0) || undefined;
    const q = url.searchParams.get('q') || '';
    const page = url.searchParams.get('page');
    const pageSize = url.searchParams.get('pageSize');
    return send(
      res,
      200,
      listUsersWithActivity(db, {
        segment,
        activeDays,
        q,
        page: page != null && page !== '' ? Number(page) : undefined,
        pageSize: pageSize != null && pageSize !== '' ? Number(pageSize) : undefined,
      })
    );
  }

  {
    const m = pathname.match(/^\/api\/admin\/users\/([^/]+)(?:\/(balance))?$/);
    if (m) {
      const userId = decodeURIComponent(m[1]);
      const action = m[2] || '';
      if (method === 'GET' && !action) {
        if (!requireAdmin(req, res)) return;
        try {
          const db = await load();
          return send(res, 200, getUserAdminDetail(db, userId));
        } catch (e) {
          return send(res, e.status || 400, { error: e.message || '查询失败' });
        }
      }
      if (method === 'PUT' && !action) {
        if (!requireAdmin(req, res)) return;
        try {
          const db = await load();
          const detail = updateUserAdmin(db, userId, body || {});
          await save(db);
          return send(res, 200, { ok: true, ...detail });
        } catch (e) {
          return send(res, e.status || 400, { error: e.message || '保存失败' });
        }
      }
      if (method === 'POST' && action === 'balance') {
        if (!requireAdmin(req, res)) return;
        // 安全策略：禁止后台手工调余额，余额仅允许顾客充值/消费入账
        return send(res, 403, {
          error: '已禁止后台调整会员余额。余额仅可通过顾客充值或消费变动；如需纠错请走线下登记后由技术处理。',
        });
      }
    }
  }

  if (pathname === '/api/admin/coupons/off15-3-scope' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, getOff15_3ScopePublic(db));
  }

  if (pathname === '/api/admin/coupons/off15-3-scope' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const scope = updateOff15_3Scope(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, ...scope });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/coupons/fruit-retail-off' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, getFruitRetailOffPublic(db));
  }

  if (pathname === '/api/admin/coupons/fruit-retail-off' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const cfg = updateFruitRetailOff(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, ...cfg });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/coupons/cane-promo' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, getCanePromoPublic(db));
  }

  if (pathname === '/api/admin/coupons/cane-promo' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const cfg = updateCanePromo(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, ...cfg });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/coupons/cane-promo/grant-all' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const result = grantCanePromoToUsers(db, db.users || []);
      await save(db);
      return send(res, 200, {
        ok: true,
        ...result,
        note: '已给尚未领过的用户补发；已领过的跳过。用户打开小程序「我的优惠券」可见。',
      });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '补发失败' });
    }
  }

  if (pathname === '/api/admin/coupons/fruit-retail-off/grant-all' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      ensureCoupons(db);
      const result = grantFruitRetailOffToUsers(db, db.users || []);
      await save(db);
      return send(res, 200, {
        ok: true,
        ...result,
        note: '已给尚未领过的用户补发；已领过的跳过。用户打开小程序「我的优惠券」可见，无需小程序发版。',
      });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '补发失败' });
    }
  }

  if (pathname === '/api/admin/coupons/grant' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      ensureCoupons(db);
      const segment = body.segment || 'inactive';
      const activeDays = Number(body.activeDays || 0) || undefined;
      const { list } = listUsersWithActivity(db, { segment, activeDays });
      let targets = list;
      if (Array.isArray(body.userIds) && body.userIds.length) {
        const set = new Set(body.userIds);
        targets = list.filter((u) => set.has(u.id));
      }
      if (!targets.length) return send(res, 400, { error: '没有符合条件的用户' });
      const fullUsers = targets
        .map((t) => db.users.find((u) => u.id === t.id))
        .filter(Boolean);
      const result = grantManualCoupons(db, fullUsers, {
        title: body.title,
        amount: body.amount,
        threshold: body.threshold,
        fulfillment: body.fulfillment,
        count: body.count,
        allowedProductIds: body.allowedProductIds,
        matchCategory: body.matchCategory,
      });
      await save(db);
      return send(res, 200, {
        ok: true,
        ...result,
        segment,
        note: '券已写入用户小程序券包；不会自动推到微信卡包。用户打开小程序「我的优惠券」可见。',
      });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '发券失败' });
    }
  }

  if (pathname === '/api/admin/lottery' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, lotteryAdminStats(db));
  }

  if (pathname === '/api/admin/lottery' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      ensureLottery(db);
      const lottery = updateLottery(db, body || {});
      await save(db);
      return send(res, 200, { ok: true, lottery, stats: lotteryAdminStats(db) });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/admin/toppings' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    return send(res, 200, {
      list: Array.isArray(db.toppings) ? db.toppings : [],
      active: listActiveToppings(db.toppings),
    });
  }

  if (pathname === '/api/admin/toppings' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      db.toppings = normalizeToppings(body.list || body.toppings || []);
      await save(db);
      return send(res, 200, { ok: true, list: db.toppings });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/toppings' && method === 'GET') {
    const db = await load();
    return send(res, 200, { list: listPublicToppings(db.toppings) });
  }

  if (pathname === '/api/side-meal' && method === 'GET') {
    const db = await load();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const category = url.searchParams.get('category') || '';
    const { publicSideMeal, ensureSideMeal } = require('./services/sideMeals');
    ensureSideMeal(db);
    return send(res, 200, publicSideMeal(db, category));
  }

  if (pathname === '/api/admin/orders' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    if (settlePickedOrders(db)) await save(db);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    let list = db.orders;
    if (status) list = list.filter((o) => o.status === status);
    const usersById = new Map((db.users || []).map((u) => [u.id, u]));
    const usersByOpenid = new Map(
      (db.users || []).filter((u) => u && u.openid).map((u) => [u.openid, u])
    );
    const enriched = list.slice(0, 200).map((o) => {
      const u =
        (o.userId && usersById.get(o.userId)) ||
        (o.openid && usersByOpenid.get(o.openid)) ||
        null;
      const phone = String((u && u.phone) || o.contactPhone || o.phone || '').trim();
      return {
        ...o,
        userPhone: phone || '',
        userNickName: (u && (u.nickName || u.nickname)) || '',
      };
    });
    return send(res, 200, { list: enriched });
  }

  if (pathname === '/api/admin/products' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const { listAdminProducts, getProductOrderMap } = require('./services/products');
    return send(res, 200, {
      list: listAdminProducts(db),
      productOrder: getProductOrderMap(db),
    });
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
    const sortNum = Number(body.sort);
    const product = {
      id: crypto.randomUUID(),
      name: body.name || '未命名果切',
      desc: body.desc || '',
      cover: body.cover || '/uploads/demo-mix.svg',
      category: body.category || '经典果切',
      status: body.status == null ? 1 : Number(body.status),
      sort: Number.isFinite(sortNum) ? sortNum : 100,
      specs: body.specs || [{ id: 'm', name: '中杯', price: 18.9, stock: 999 }],
      extras: body.extras || [],
      createdAt: Date.now(),
    };
    db.products.push(product);
    // 若该分类已有手动顺序，新商品追加到末尾
    try {
      const { getProductOrderMap } = require('./services/products');
      const orderMap = getProductOrderMap(db);
      const cat = product.category;
      if (Array.isArray(orderMap[cat]) && orderMap[cat].length) {
        if (!db.settings.productOrder) db.settings.productOrder = {};
        db.settings.productOrder[cat] = [...orderMap[cat].filter((id) => id !== product.id), product.id];
        product.sort = db.settings.productOrder[cat].length * 10;
      }
    } catch {
      /* ignore */
    }
    await save(db);
    return send(res, 200, { product });
  }

  if (pathname === '/api/admin/products/reorder' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const { saveCategoryProductOrder, listAdminProducts, getProductOrderMap } = require('./services/products');
      const category = String(body.category || '').trim();
      if (!category) return send(res, 400, { error: '请指定分类后再保存顺序' });
      const mode = body.mode === 'sales' ? 'sales' : 'manual';
      const result =
        mode === 'sales'
          ? saveCategoryProductOrder(db, category, null)
          : saveCategoryProductOrder(db, category, Array.isArray(body.ids) ? body.ids : []);
      await save(db);
      return send(res, 200, {
        ok: true,
        ...result,
        list: listAdminProducts(db),
        productOrder: getProductOrderMap(db),
      });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存顺序失败' });
    }
  }

  if (pathname === '/api/admin/products/batch-status' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
    const status = Number(body.status) === 1 ? 1 : 0;
    if (!ids.length) return send(res, 400, { error: '请先勾选商品' });
    const db = await load();
    const idSet = new Set(ids);
    let count = 0;
    for (const p of db.products || []) {
      if (!p || !idSet.has(p.id)) continue;
      if (p.status === status) continue;
      p.status = status;
      p.updatedAt = Date.now();
      count += 1;
    }
    await save(db);
    const { listAdminProducts, getProductOrderMap } = require('./services/products');
    return send(res, 200, {
      ok: true,
      count,
      status,
      list: listAdminProducts(db),
      productOrder: getProductOrderMap(db),
    });
  }

  if (pathname === '/api/admin/products/batch-delete' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
    if (!ids.length) return send(res, 400, { error: '请先勾选商品' });
    const db = await load();
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    const idSet = new Set(ids);
    const knownCuts = new Set(db.settings.knownCutProductIds || []);
    const knownRetail = new Set(db.settings.knownRetailPeeledIds || []);
    let count = 0;
    db.products = (db.products || []).filter((p) => {
      if (!p || !idSet.has(p.id)) return true;
      const id = String(p.id || '');
      if (id.startsWith('cut-')) knownCuts.add(id);
      if (id.startsWith('retail-peeled-')) knownRetail.add(id);
      count += 1;
      return false;
    });
    db.settings.knownCutProductIds = [...knownCuts];
    db.settings.knownRetailPeeledIds = [...knownRetail];
    const orderMap = db.settings.productOrder || {};
    for (const cat of Object.keys(orderMap)) {
      if (!Array.isArray(orderMap[cat])) continue;
      orderMap[cat] = orderMap[cat].filter((x) => !idSet.has(x));
    }
    await save(db);
    const { listAdminProducts, getProductOrderMap } = require('./services/products');
    return send(res, 200, {
      ok: true,
      count,
      list: listAdminProducts(db),
      productOrder: getProductOrderMap(db),
    });
  }

  const adminProduct = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (adminProduct) {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const idx = db.products.findIndex((p) => p.id === adminProduct[1]);
    if (idx < 0) return send(res, 404, { error: '商品不存在' });
    if (method === 'PUT') {
      const prev = db.products[idx];
      const next = { ...prev, ...body, id: prev.id };
      if (body.sort != null && body.sort !== '') {
        const s = Number(body.sort);
        next.sort = Number.isFinite(s) ? s : prev.sort;
      }
      // 销量由订单统计，不允许手改覆盖
      delete next.sales;
      db.products[idx] = next;
      await save(db);
      return send(res, 200, { product: db.products[idx] });
    }
    if (method === 'DELETE') {
      const removed = db.products[idx];
      const id = String(removed.id || '');
      db.products.splice(idx, 1);
      // 记入 known，避免 ensure 菜单把稳定 SKU 再自动加回
      if (!db.settings || typeof db.settings !== 'object') db.settings = {};
      if (id.startsWith('cut-')) {
        const known = new Set(db.settings.knownCutProductIds || []);
        known.add(id);
        db.settings.knownCutProductIds = [...known];
      }
      if (id.startsWith('retail-peeled-')) {
        const known = new Set(db.settings.knownRetailPeeledIds || []);
        known.add(id);
        db.settings.knownRetailPeeledIds = [...known];
      }
      // 从分类手动顺序里去掉
      const orderMap = db.settings.productOrder || {};
      for (const cat of Object.keys(orderMap)) {
        if (!Array.isArray(orderMap[cat])) continue;
        orderMap[cat] = orderMap[cat].filter((x) => x !== id);
      }
      await save(db);
      return send(res, 200, { ok: true, deleted: true, id });
    }
  }

  if (pathname === '/api/admin/side-meal' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const { ensureSideMeal, DEFAULT_SIDE_MEAL } = require('./services/sideMeals');
    const { ALL_PRODUCT_CATEGORIES } = require('./services/promo');
    return send(res, 200, {
      sideMeal: ensureSideMeal(db),
      defaults: DEFAULT_SIDE_MEAL,
      categories: ALL_PRODUCT_CATEGORIES,
    });
  }

  if (pathname === '/api/admin/side-meal' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const db = await load();
      const { saveSideMealConfig } = require('./services/sideMeals');
      const sideMeal = saveSideMealConfig(db, body.sideMeal || body);
      await save(db);
      return send(res, 200, { ok: true, sideMeal });
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || '保存失败' });
    }
  }

  const labelMatch = pathname.match(/^\/api\/print\/label\/([^/]+)$/);
  if (labelMatch && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = await load();
    const order = db.orders.find((o) => o.id === labelMatch[1]);
    if (!order) return send(res, 404, { error: '订单不存在' });
    if (!order.pickupCode) return send(res, 400, { error: '订单尚未支付，无取餐码' });
    const u =
      (order.userId && (db.users || []).find((x) => x.id === order.userId)) ||
      (order.openid && (db.users || []).find((x) => x.openid === order.openid)) ||
      null;
    const enriched = {
      ...order,
      userPhone: String((u && u.phone) || order.contactPhone || order.phone || '').trim(),
      userNickName: (u && (u.nickName || u.nickname)) || '',
    };
    const qrDataUrl = await orderQrDataUrl(enriched);
    const html = buildLabelHtml({ order: enriched, qrDataUrl, shopName: db.settings.shopName });
    return send(res, 200, { order: enriched, qrDataUrl, html, shopName: db.settings.shopName });
  }

  if (pathname === '/api/admin/print/usb' && method === 'POST') {
    const ip = String(req.socket?.remoteAddress || '');
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
    if (!loopback && !requireAdmin(req, res)) return;
    try {
      const result = await writeHexPages(body.pages);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 500, { error: e.message || 'USB 打印失败' });
    }
  }

  if (pathname === '/api/admin/print/receipt' && method === 'POST') {
    const ip = String(req.socket?.remoteAddress || '');
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
    if (!loopback && !requireAdmin(req, res)) return;
    try {
      const result = await printReceipt(body);
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 500, { error: e.message || '热敏打印失败' });
    }
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

    // 进货发票上传 + OCR 预填
    if (pathname === '/api/admin/purchases/invoice-upload' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      try {
        const buf = await readBuffer(req, 12 * 1024 * 1024);
        if (!buf.length) return send(res, 400, { error: '空文件' });
        const { uploadAndParseInvoice } = require('./services/purchases');
        const result = await uploadAndParseInvoice(buf, req.headers['content-type']);
        return send(res, 200, { ok: true, ...result });
      } catch (e) {
        return send(res, e.status || 500, { error: e.message || '上传失败' });
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

    if (pathname === '/admin') {
      res.writeHead(302, { Location: '/admin/' });
      res.end();
      return;
    }
    if (pathname === '/' || pathname === '/admin/') {
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
  console.log(
    `管理账号: ${ADMIN_USER}（密码已隐藏）· token ${ADMIN_TOKEN_DAYS} 天 · 登录失败 ${ADMIN_LOGIN_MAX_FAILS} 次 / ${Math.round(ADMIN_LOGIN_WINDOW_MS / 60000)} 分钟锁定 · 支付: ${PAY_MODE}`
  );
});
  })
  .catch((e) => {
    console.error('数据库初始化失败:', e);
    process.exit(1);
  });
