/**
 * 新人券包 + 每月登录礼 + 下单用券
 * - 满15减3 ×3：现取/预定均可
 * - 预定立减 ×15（仅预定）；面额由开业阶段决定（对客只展示当前面额，不写阶段策略）
 * - 每月登录：无门槛减2元 ×2（现取/预定均可）
 * - 每单限 1 张
 */
const crypto = require('crypto');
const { round2, shopParts } = require('./promo');

const WELCOME_PACK = 'welcome';
const MONTHLY_PACK = 'monthly_login';
const VALID_DAYS = 30;

/** 内部策略：开业日起算前 N 个月预定券面额，之后切换。勿写入对客文案。 */
const SHOP_OPENING_AT = process.env.SHOP_OPENING_AT || '';
const OPENING_PROMO_MONTHS = 3;
const RESERVE_OFF_OPENING = 3;
const RESERVE_OFF_NORMAL = 1.8;

function isOpeningPromo(now = Date.now()) {
  if (!SHOP_OPENING_AT) return true;
  const start = new Date(`${SHOP_OPENING_AT}T00:00:00+08:00`).getTime();
  if (Number.isNaN(start)) return true;
  const end = new Date(start);
  end.setMonth(end.getMonth() + OPENING_PROMO_MONTHS);
  return now < end.getTime();
}

function reserveOffAmount(now = Date.now()) {
  return isOpeningPromo(now) ? RESERVE_OFF_OPENING : RESERVE_OFF_NORMAL;
}

function reserveOffTitle(amount = reserveOffAmount()) {
  const n = Number(amount);
  const label = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `预定立减${label}元`;
}

function welcomeTemplates(now = Date.now()) {
  const reserveAmt = reserveOffAmount(now);
  return [
    {
      templateId: 'welcome_off3',
      title: '满15减3',
      type: 'threshold',
      threshold: 15,
      amount: 3,
      fulfillment: 'any',
      count: 3,
    },
    {
      templateId: reserveAmt >= 3 ? 'welcome_reserve3' : 'welcome_reserve18',
      title: reserveOffTitle(reserveAmt),
      type: 'reserve_off',
      threshold: 0,
      amount: reserveAmt,
      fulfillment: 'reserve',
      count: 15,
    },
  ];
}

/** @deprecated 兼容旧引用：静态快照 */
const WELCOME_TEMPLATES = welcomeTemplates();

const MONTHLY_TEMPLATE = {
  templateId: 'monthly_flat2',
  title: '无门槛减2元',
  type: 'flat',
  threshold: 0,
  amount: 2,
  fulfillment: 'any',
  count: 2,
};

function monthKey(now = Date.now()) {
  const p = shopParts(now);
  return `${p.y}${String(p.m).padStart(2, '0')}`;
}

function ensureCoupons(db) {
  if (!Array.isArray(db.coupons)) db.coupons = [];
  return db.coupons;
}

function campaignInfo(now = Date.now()) {
  const templates = welcomeTemplates(now);
  const reserveAmt = reserveOffAmount(now);
  const faceValue = round2(
    templates.reduce((s, t) => s + t.amount * t.count, 0)
  );
  const reserveLabel = reserveOffTitle(reserveAmt);
  return {
    id: WELCOME_PACK,
    title: '新人见面礼',
    subtitle: '登录送券 · 下单立减',
    bannerTitle: '领券下单更划算',
    bannerSub: `新人礼包含${reserveLabel}×15 · 每月登录再送无门槛减2×2`,
    faceValue,
    validDays: VALID_DAYS,
    /** 当前预定券面额，供前端展示「现在能领什么」；不含阶段策略说明 */
    reserveOffAmount: reserveAmt,
    monthlyGift: {
      title: '每月登录礼',
      count: MONTHLY_TEMPLATE.count,
      amount: MONTHLY_TEMPLATE.amount,
      desc: '无门槛减2元 ×2，当月登录即送',
    },
    rules: [
      '首次登录自动发放新人券包，每人限领一次',
      '每月登录再送无门槛减2元券 2 张（当月限领一次）',
      '每单限用 1 张券，不可叠加多张券',
      '满减券 / 无门槛券：现作现取、预定均可',
      '预定立减券：仅提前预定可用',
      `优惠券有效期 ${VALID_DAYS} 天，过期作废`,
    ],
    packs: [
      ...templates.map((t) => ({
        title: t.title,
        count: t.count,
        threshold: t.threshold,
        amount: t.amount,
        fulfillment: t.fulfillment,
      })),
      {
        title: MONTHLY_TEMPLATE.title,
        count: MONTHLY_TEMPLATE.count,
        threshold: 0,
        amount: MONTHLY_TEMPLATE.amount,
        fulfillment: 'any',
        monthly: true,
      },
    ],
  };
}

function hasWelcomePack(db, userId) {
  return ensureCoupons(db).some((c) => c.userId === userId && c.pack === WELCOME_PACK);
}

function hasMonthlyPack(db, userId, key) {
  return ensureCoupons(db).some(
    (c) => c.userId === userId && c.pack === MONTHLY_PACK && c.monthKey === key
  );
}

function grantWelcomePack(db, user, now = Date.now()) {
  if (!user || !user.id) return { granted: false, coupons: [] };
  ensureCoupons(db);
  if (hasWelcomePack(db, user.id)) {
    return { granted: false, coupons: [], reason: 'already' };
  }
  const expireAt = now + VALID_DAYS * 24 * 60 * 60 * 1000;
  const created = [];
  for (const t of welcomeTemplates(now)) {
    for (let i = 0; i < t.count; i += 1) {
      const coupon = {
        id: crypto.randomUUID(),
        userId: user.id,
        openid: user.openid || null,
        pack: WELCOME_PACK,
        templateId: t.templateId,
        title: t.title,
        type: t.type,
        threshold: t.threshold,
        amount: t.amount,
        fulfillment: t.fulfillment,
        status: 'unused',
        orderId: null,
        grantedAt: now,
        expireAt,
        usedAt: null,
      };
      db.coupons.push(coupon);
      created.push(coupon);
    }
  }
  user.welcomeGrantedAt = now;
  return { granted: true, coupons: created, campaign: campaignInfo(now) };
}

/** 自然月登录礼：无门槛减2 ×2，当月只发一次 */
function grantMonthlyLoginPack(db, user, now = Date.now()) {
  if (!user || !user.id) return { granted: false, coupons: [] };
  ensureCoupons(db);
  const key = monthKey(now);
  if (hasMonthlyPack(db, user.id, key)) {
    return { granted: false, coupons: [], reason: 'already', monthKey: key };
  }
  const expireAt = now + VALID_DAYS * 24 * 60 * 60 * 1000;
  const created = [];
  const t = MONTHLY_TEMPLATE;
  for (let i = 0; i < t.count; i += 1) {
    const coupon = {
      id: crypto.randomUUID(),
      userId: user.id,
      openid: user.openid || null,
      pack: MONTHLY_PACK,
      monthKey: key,
      templateId: t.templateId,
      title: t.title,
      type: t.type,
      threshold: t.threshold,
      amount: t.amount,
      fulfillment: t.fulfillment,
      status: 'unused',
      orderId: null,
      grantedAt: now,
      expireAt,
      usedAt: null,
    };
    db.coupons.push(coupon);
    created.push(coupon);
  }
  user.monthlyGrantedMonth = key;
  return { granted: true, coupons: created, monthKey: key, count: created.length };
}

/** 登录/进店时统一发券：新人礼 + 当月登录礼 */
function grantLoginCoupons(db, user, now = Date.now()) {
  const welcome = grantWelcomePack(db, user, now);
  const monthly = grantMonthlyLoginPack(db, user, now);
  return {
    welcome,
    monthly,
    granted: welcome.granted || monthly.granted,
    changed: welcome.granted || monthly.granted,
  };
}

function expireCoupons(db, now = Date.now()) {
  for (const c of ensureCoupons(db)) {
    if (c.status === 'unused' && c.expireAt && c.expireAt < now) {
      c.status = 'expired';
    }
  }
}

function couponPublic(c) {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    threshold: c.threshold,
    amount: c.amount,
    fulfillment: c.fulfillment,
    status: c.status,
    pack: c.pack,
    templateId: c.templateId,
    grantedAt: c.grantedAt,
    expireAt: c.expireAt,
    usedAt: c.usedAt,
    orderId: c.orderId || null,
    usableHint:
      c.fulfillment === 'reserve'
        ? '仅预定可用'
        : c.threshold > 0
          ? `满¥${c.threshold}可用`
          : '无门槛',
  };
}

function listUserCoupons(db, userId, { includeUsed = true, now = Date.now() } = {}) {
  expireCoupons(db, now);
  let list = ensureCoupons(db).filter((c) => c.userId === userId);
  if (!includeUsed) list = list.filter((c) => c.status === 'unused');
  list.sort((a, b) => {
    const rank = { unused: 0, used: 1, expired: 2 };
    const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (d) return d;
    return (a.expireAt || 0) - (b.expireAt || 0);
  });
  const unused = list.filter((c) => c.status === 'unused');
  return {
    list: list.map(couponPublic),
    summary: {
      unused: unused.length,
      off3: unused.filter(
        (c) => c.templateId === 'welcome_off3' || c.templateId === 'welcome_off5'
      ).length,
      reserve3: unused.filter(
        (c) => c.type === 'reserve_off' || String(c.templateId || '').startsWith('welcome_reserve')
      ).length,
      flat2: unused.filter(
        (c) => c.templateId === 'monthly_flat2' || c.templateId === 'monthly_flat3'
      ).length,
    },
    campaign: campaignInfo(now),
  };
}

function findCoupon(db, couponId, userId) {
  return ensureCoupons(db).find((c) => c.id === couponId && (!userId || c.userId === userId));
}

function canUseCoupon(coupon, { originalAmount, fulfillmentType, now = Date.now() }) {
  if (!coupon) return { ok: false, reason: '优惠券不存在' };
  if (coupon.status === 'expired' || (coupon.expireAt && coupon.expireAt < now)) {
    return { ok: false, reason: '优惠券已过期' };
  }
  if (coupon.status !== 'unused') return { ok: false, reason: '优惠券已使用' };
  if (coupon.fulfillment === 'reserve' && fulfillmentType !== 'reserve') {
    return { ok: false, reason: '该券仅限提前预定使用' };
  }
  const original = round2(originalAmount);
  if (coupon.threshold > 0 && original + 1e-9 < coupon.threshold) {
    return { ok: false, reason: `满¥${coupon.threshold}可用` };
  }
  if (round2(coupon.amount) >= original) {
    return { ok: false, reason: '优惠金额不能大于等于订单金额' };
  }
  return { ok: true };
}

function applyCouponAmount(originalAmount, coupon) {
  const original = round2(originalAmount);
  if (!coupon) {
    return {
      originalAmount: original,
      amount: original,
      discountAmount: 0,
      discountRate: 0,
      discountCode: '',
      discountLabel: '',
      couponId: null,
    };
  }
  const cut = round2(Math.min(Number(coupon.amount) || 0, original - 0.01));
  const amount = round2(Math.max(0.01, original - cut));
  return {
    originalAmount: original,
    amount,
    discountAmount: round2(original - amount),
    discountRate: 0,
    discountCode: coupon.templateId || 'coupon',
    discountLabel: coupon.title || '优惠券',
    couponId: coupon.id,
  };
}

/** 选出当前订单可用的最优券（省得最多，同额优先到期近的） */
function pickBestCoupon(db, userId, { originalAmount, fulfillmentType, now = Date.now() }) {
  expireCoupons(db, now);
  const unused = ensureCoupons(db).filter((c) => c.userId === userId && c.status === 'unused');
  let best = null;
  let bestSave = -1;
  for (const c of unused) {
    const check = canUseCoupon(c, { originalAmount, fulfillmentType, now });
    if (!check.ok) continue;
    const priced = applyCouponAmount(originalAmount, c);
    if (
      priced.discountAmount > bestSave ||
      (priced.discountAmount === bestSave && best && c.expireAt < best.expireAt)
    ) {
      best = c;
      bestSave = priced.discountAmount;
    }
  }
  return best;
}

function listAvailableForOrder(
  db,
  userId,
  { originalAmount, fulfillmentType, now = Date.now(), afterLoyaltyAmount = null } = {}
) {
  expireCoupons(db, now);
  const unused = ensureCoupons(db).filter((c) => c.userId === userId && c.status === 'unused');
  const baseForCoupon =
    afterLoyaltyAmount != null ? round2(afterLoyaltyAmount) : round2(originalAmount);
  return unused.map((c) => {
    const check = canUseCoupon(c, { originalAmount, fulfillmentType, now });
    let save = 0;
    let payAmount = null;
    if (check.ok) {
      save = round2(Math.min(Number(c.amount) || 0, Math.max(0, baseForCoupon - 0.01)));
      payAmount = round2(Math.max(0.01, baseForCoupon - save));
    }
    return {
      ...couponPublic(c),
      available: check.ok,
      reason: check.ok ? '' : check.reason,
      save,
      payAmount,
    };
  });
}

function consumeCoupon(db, couponId, orderId, userId) {
  const c = findCoupon(db, couponId, userId);
  if (!c) throw Object.assign(new Error('优惠券不存在'), { status: 400 });
  if (c.status !== 'unused') throw Object.assign(new Error('优惠券不可用'), { status: 400 });
  c.status = 'used';
  c.orderId = orderId;
  c.usedAt = Date.now();
  return c;
}

function restoreCouponForOrder(db, order) {
  if (!order || !order.couponId) return false;
  const c = findCoupon(db, order.couponId);
  if (!c) return false;
  if (c.status === 'used' && c.orderId === order.id) {
    c.status = 'unused';
    c.orderId = null;
    c.usedAt = null;
    return true;
  }
  return false;
}

/**
 * 管理端定向发券（写入用户券包，不下发微信卡包）
 * @param {{ title?: string, amount: number, threshold?: number, fulfillment?: string, count?: number, templateId?: string }} tpl
 */
function grantManualCoupons(db, users, tpl, now = Date.now()) {
  ensureCoupons(db);
  const amount = round2(Number(tpl.amount) || 0);
  if (!(amount > 0)) throw Object.assign(new Error('面额须大于 0'), { status: 400 });
  const threshold = round2(Number(tpl.threshold) || 0);
  const count = Math.min(20, Math.max(1, Number(tpl.count) || 1));
  const fulfillment = tpl.fulfillment === 'reserve' ? 'reserve' : 'any';
  const title =
    tpl.title ||
    (threshold > 0 ? `满${threshold}减${amount}` : `无门槛减${amount}元`);
  const templateId = tpl.templateId || `admin_${fulfillment}_${amount}_${threshold || 0}`;
  const expireAt = now + VALID_DAYS * 24 * 60 * 60 * 1000;
  const created = [];
  const targets = Array.isArray(users) ? users.filter(Boolean) : [];

  for (const user of targets) {
    for (let i = 0; i < count; i += 1) {
      const coupon = {
        id: crypto.randomUUID(),
        userId: user.id,
        openid: user.openid || null,
        pack: 'admin',
        templateId,
        title,
        type: threshold > 0 ? 'threshold' : 'flat',
        threshold,
        amount,
        fulfillment,
        status: 'unused',
        grantedAt: now,
        expireAt,
        orderId: null,
        usedAt: null,
      };
      db.coupons.push(coupon);
      created.push(coupon);
    }
  }

  return {
    granted: created.length,
    userCount: targets.length,
    perUser: count,
    title,
    amount,
    threshold,
    fulfillment,
    expireAt,
    coupons: created,
  };
}

module.exports = {
  WELCOME_TEMPLATES,
  MONTHLY_TEMPLATE,
  SHOP_OPENING_AT,
  RESERVE_OFF_OPENING,
  RESERVE_OFF_NORMAL,
  VALID_DAYS,
  isOpeningPromo,
  reserveOffAmount,
  welcomeTemplates,
  campaignInfo,
  grantWelcomePack,
  grantMonthlyLoginPack,
  grantLoginCoupons,
  grantManualCoupons,
  hasWelcomePack,
  listUserCoupons,
  findCoupon,
  canUseCoupon,
  applyCouponAmount,
  pickBestCoupon,
  listAvailableForOrder,
  consumeCoupon,
  restoreCouponForOrder,
  ensureCoupons,
  expireCoupons,
  monthKey,
};
