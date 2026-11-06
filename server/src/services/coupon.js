/**
 * 新人券包 + 周五会员日 + 下单用券
 * - 预定立减 ×15（仅预定）；面额由开业阶段决定（对客只展示当前面额，不写阶段策略）
 * - 每周五会员日：已充值会员登录送无门槛减1元 ×1（现取/预定均可），甜蜜迎周末
 * - 每单限 1 张
 * - 满15减3：仅限管理端配置的一款水果捞 + 一款果切（可改）
 */
const crypto = require('crypto');
const { round2, shopParts, todayKey, isShopFriday } = require('./promo');

const WELCOME_PACK = 'welcome';
/** @deprecated 旧「每月登录礼」pack，仅识别存量券 */
const MONTHLY_PACK = 'monthly_login';
const FRIDAY_PACK = 'friday_member';
const VALID_DAYS = 30;

/** settings.couponOff15_3：满15减3 可用商品（各选一款） */
function ensureOff15_3Scope(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.couponOff15_3;
  if (!cur || typeof cur !== 'object') {
    db.settings.couponOff15_3 = {
      fruitBowlProductId: '',
      cutFruitProductId: '',
    };
  } else {
    db.settings.couponOff15_3 = {
      fruitBowlProductId: String(cur.fruitBowlProductId || ''),
      cutFruitProductId: String(cur.cutFruitProductId || ''),
    };
  }
  return db.settings.couponOff15_3;
}

function getOff15_3Scope(db) {
  return { ...ensureOff15_3Scope(db) };
}

function updateOff15_3Scope(db, body = {}) {
  const scope = ensureOff15_3Scope(db);
  const products = db.products || [];
  const pick = (id, expectCat) => {
    const sid = String(id || '').trim();
    if (!sid) return '';
    const p = products.find((x) => x && x.id === sid);
    if (!p) throw Object.assign(new Error(`商品不存在：${sid}`), { status: 400 });
    if (expectCat && p.category !== expectCat) {
      throw Object.assign(new Error(`请选择「${expectCat}」商品`), { status: 400 });
    }
    return p.id;
  };
  if (body.fruitBowlProductId !== undefined) {
    scope.fruitBowlProductId = pick(body.fruitBowlProductId, '水果捞');
  }
  if (body.cutFruitProductId !== undefined) {
    scope.cutFruitProductId = pick(body.cutFruitProductId, '果切系列');
  }
  db.settings.couponOff15_3 = scope;
  return getOff15_3ScopePublic(db);
}

function getOff15_3ScopePublic(db) {
  const scope = ensureOff15_3Scope(db);
  const products = db.products || [];
  const resolve = (id) => {
    const p = products.find((x) => x && x.id === id);
    return p ? { id: p.id, name: p.name, category: p.category } : null;
  };
  const fruitBowl = resolve(scope.fruitBowlProductId);
  const cutFruit = resolve(scope.cutFruitProductId);
  const allowedProductIds = [scope.fruitBowlProductId, scope.cutFruitProductId].filter(Boolean);
  return {
    fruitBowlProductId: scope.fruitBowlProductId || '',
    cutFruitProductId: scope.cutFruitProductId || '',
    fruitBowl,
    cutFruit,
    allowedProductIds,
    configured: allowedProductIds.length > 0,
    hint: configuredHint(fruitBowl, cutFruit),
  };
}

function configuredHint(fruitBowl, cutFruit) {
  const parts = [];
  if (fruitBowl) parts.push(`水果捞「${fruitBowl.name}」`);
  if (cutFruit) parts.push(`果切「${cutFruit.name}」`);
  if (!parts.length) return '未限定商品（配置后满15减3仅限指定两款）';
  return `满15减3仅限：${parts.join('、')}`;
}

/** 是否为满15减3类券 */
function isOff15Minus3Coupon(coupon) {
  if (!coupon) return false;
  if (coupon.templateId === 'welcome_off3' || coupon.templateId === 'admin_any_3_15') return true;
  const th = Number(coupon.threshold);
  const am = Number(coupon.amount);
  if (th === 15 && am === 3) return true;
  return /满\s*15\s*减\s*3/.test(String(coupon.title || ''));
}

/** 解析券可用商品 ID 列表；空数组表示不限商品 */
function resolveAllowedProductIds(db, coupon) {
  if (!coupon) return [];
  if (Array.isArray(coupon.allowedProductIds) && coupon.allowedProductIds.length) {
    return coupon.allowedProductIds.map(String);
  }
  if (Array.isArray(coupon.productIds) && coupon.productIds.length && coupon.type !== 'free_item') {
    return coupon.productIds.map(String);
  }
  if (isOff15Minus3Coupon(coupon)) {
    const scope = ensureOff15_3Scope(db);
    return [scope.fruitBowlProductId, scope.cutFruitProductId].filter(Boolean);
  }
  return [];
}

function productAllowedForCoupon(db, coupon, product) {
  const ids = resolveAllowedProductIds(db, coupon);
  if (!ids.length) return { ok: true, allowedProductIds: [] };
  if (!product || !product.id) {
    return { ok: false, reason: '请选择商品后再用券', allowedProductIds: ids };
  }
  if (!ids.includes(String(product.id))) {
    const names = (db.products || [])
      .filter((p) => ids.includes(String(p.id)))
      .map((p) => p.name)
      .filter(Boolean);
    const tip = names.length ? names.join('、') : '指定水果捞/果切';
    return { ok: false, reason: `该券仅限：${tip}`, allowedProductIds: ids };
  }
  return { ok: true, allowedProductIds: ids };
}

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

/** 周五会员日：1 元无门槛 ×1 */
const FRIDAY_TEMPLATE = {
  templateId: 'friday_flat1',
  title: '会员日甜蜜券',
  type: 'flat',
  threshold: 0,
  amount: 1,
  fulfillment: 'any',
  count: 1,
};

/** @deprecated 兼容旧引用 */
const MONTHLY_TEMPLATE = FRIDAY_TEMPLATE;

function monthKey(now = Date.now()) {
  const p = shopParts(now);
  return `${p.y}${String(p.m).padStart(2, '0')}`;
}

function hasRecharged(db, userId) {
  if (!userId) return false;
  return (db.recharges || []).some((r) => r.userId === userId && r.status === 'paid');
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
  const memberDayGift = {
    title: '周五会员日 · 甜蜜迎周末',
    count: FRIDAY_TEMPLATE.count,
    amount: FRIDAY_TEMPLATE.amount,
    desc: '已充值会员每周五登录送无门槛减1元 ×1',
    weekday: 'friday',
  };
  return {
    id: WELCOME_PACK,
    title: '新人见面礼',
    subtitle: '登录送预定立减券',
    bannerTitle: '预定立减更划算',
    bannerSub: `新人礼：${reserveLabel}×15 · 每周五会员日送无门槛减1元`,
    faceValue,
    validDays: VALID_DAYS,
    /** 当前预定券面额，供前端展示「现在能领什么」；不含阶段策略说明 */
    reserveOffAmount: reserveAmt,
    memberDayGift,
    /** @deprecated 同 memberDayGift，兼容旧前端 */
    monthlyGift: memberDayGift,
    rules: [
      '首次登录自动发放预定立减券，每人限领一次',
      '每周五为会员日：已充值会员登录即送无门槛减1元券 1 张（当日限领一次），甜蜜迎周末',
      '每单限用 1 张券，不可叠加多张券',
      '无门槛券：现作现取、预定均可',
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
        title: FRIDAY_TEMPLATE.title,
        count: FRIDAY_TEMPLATE.count,
        threshold: 0,
        amount: FRIDAY_TEMPLATE.amount,
        fulfillment: 'any',
        monthly: true,
        memberDay: true,
      },
    ],
  };
}

function hasWelcomePack(db, userId) {
  return ensureCoupons(db).some((c) => c.userId === userId && c.pack === WELCOME_PACK);
}

function hasFridayPack(db, userId, day) {
  return ensureCoupons(db).some(
    (c) => c.userId === userId && c.pack === FRIDAY_PACK && c.dayKey === day
  );
}

/** @deprecated 旧每月礼去重 */
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

/**
 * 周五会员日：已充值会员登录送无门槛减1 ×1，当日只发一次
 * （API 仍挂在 monthly 字段上，兼容小程序旧逻辑）
 */
function grantFridayMemberPack(db, user, now = Date.now()) {
  if (!user || !user.id) return { granted: false, coupons: [] };
  ensureCoupons(db);
  if (!isShopFriday(now)) {
    return { granted: false, coupons: [], reason: 'not_friday' };
  }
  if (!hasRecharged(db, user.id)) {
    return { granted: false, coupons: [], reason: 'not_recharged' };
  }
  const day = todayKey(now);
  if (hasFridayPack(db, user.id, day)) {
    return { granted: false, coupons: [], reason: 'already', dayKey: day };
  }
  const expireAt = now + VALID_DAYS * 24 * 60 * 60 * 1000;
  const created = [];
  const t = FRIDAY_TEMPLATE;
  for (let i = 0; i < t.count; i += 1) {
    const coupon = {
      id: crypto.randomUUID(),
      userId: user.id,
      openid: user.openid || null,
      pack: FRIDAY_PACK,
      dayKey: day,
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
  user.fridayGrantedDay = day;
  return { granted: true, coupons: created, dayKey: day, count: created.length };
}

/** @deprecated 改为周五会员日 */
function grantMonthlyLoginPack(db, user, now = Date.now()) {
  return grantFridayMemberPack(db, user, now);
}

/** 登录/进店时统一发券：新人礼 + 周五会员日 */
function grantLoginCoupons(db, user, now = Date.now()) {
  const welcome = grantWelcomePack(db, user, now);
  const monthly = grantFridayMemberPack(db, user, now);
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

function productMatchesCoupon(coupon, product) {
  if (!coupon || coupon.type !== 'free_item' || !product) return false;
  if (Array.isArray(coupon.productIds) && coupon.productIds.length) {
    return coupon.productIds.includes(product.id);
  }
  const name = String(product.name || '');
  const cat = String(product.category || '');
  if (coupon.matchCategory && cat === coupon.matchCategory) return true;
  if (coupon.matchNameIncludes && name.includes(coupon.matchNameIncludes)) return true;
  if (cat === '水果零售' || cat === '零售什锦') return true;
  if (/什锦|零售/.test(name) && (/水果零售|零售什锦|小盒|免洗/.test(cat) || /零售|免洗|什锦/.test(name))) {
    return true;
  }
  return false;
}

function displayAmountText(c) {
  if (c.type === 'percent') {
    const f = Number(c.discountFactor);
    if (f > 0 && f < 1) {
      const zhe = Math.round(f * 10);
      return `${zhe}折`;
    }
    return '折扣';
  }
  if (c.type === 'free_item') return '免单';
  return null;
}

function couponPublic(c, db = null) {
  const amountText = displayAmountText(c);
  let usableHint =
    c.fulfillment === 'reserve'
      ? '仅预定可用'
      : c.threshold > 0
        ? `满¥${c.threshold}可用`
        : '无门槛';
  if (c.type === 'percent') {
    const max = Number(c.maxOriginal) || 30;
    usableHint = `原价≤¥${max}可用`;
  } else if (c.type === 'free_item') {
    usableHint = '水果零售免1份';
  }
  const allowedProductIds = db ? resolveAllowedProductIds(db, c) : (c.allowedProductIds || []);
  if (allowedProductIds.length && db) {
    const names = (db.products || [])
      .filter((p) => allowedProductIds.includes(String(p.id)))
      .map((p) => p.name);
    usableHint = names.length
      ? `满¥${c.threshold || 0} · 限${names.join('/')}`
      : `${usableHint} · 限指定商品`;
  } else if (isOff15Minus3Coupon(c) && !allowedProductIds.length) {
    usableHint = `满¥${c.threshold || 15}可用（待配置限定商品）`;
  }
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    threshold: c.threshold,
    amount: c.amount,
    amountText: amountText || `¥${c.amount}`,
    discountFactor: c.discountFactor != null ? Number(c.discountFactor) : null,
    maxOriginal: c.maxOriginal != null ? Number(c.maxOriginal) : null,
    matchCategory: c.matchCategory || null,
    allowedProductIds: allowedProductIds.length ? allowedProductIds : null,
    fulfillment: c.fulfillment,
    status: c.status,
    pack: c.pack,
    templateId: c.templateId,
    grantedAt: c.grantedAt,
    expireAt: c.expireAt,
    usedAt: c.usedAt,
    orderId: c.orderId || null,
    usableHint,
  };
}

/** 计算一张券在当前订单上能省多少（不含配送费） */
function computeCouponSave(coupon, { originalAmount, unitPrice = 0, product = null } = {}) {
  const original = round2(originalAmount);
  if (!coupon || !(original > 0)) return 0;
  if (coupon.type === 'percent') {
    const factor = Number(coupon.discountFactor);
    if (!(factor > 0 && factor < 1)) return 0;
    return round2(Math.min(original * (1 - factor), Math.max(0, original - 0.01)));
  }
  if (coupon.type === 'free_item') {
    if (!productMatchesCoupon(coupon, product)) return 0;
    const free = round2(Number(unitPrice) || 0);
    return round2(Math.min(free, Math.max(0, original - 0.01)));
  }
  return round2(Math.min(Number(coupon.amount) || 0, Math.max(0, original - 0.01)));
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
    list: list.map((c) => couponPublic(c, db)),
    summary: {
      unused: unused.length,
      off3: unused.filter(
        (c) =>
          c.templateId === 'welcome_off3' ||
          c.templateId === 'welcome_off5' ||
          isOff15Minus3Coupon(c)
      ).length,
      reserve3: unused.filter(
        (c) => c.type === 'reserve_off' || String(c.templateId || '').startsWith('welcome_reserve')
      ).length,
      flat1: unused.filter(
        (c) =>
          c.templateId === 'friday_flat1' ||
          c.templateId === 'monthly_flat2' ||
          c.templateId === 'monthly_flat3'
      ).length,
      /** @deprecated 同 flat1，兼容旧前端「无门槛减2」统计位 */
      flat2: unused.filter(
        (c) =>
          c.templateId === 'friday_flat1' ||
          c.templateId === 'monthly_flat2' ||
          c.templateId === 'monthly_flat3'
      ).length,
    },
    campaign: campaignInfo(now),
    couponOff15_3: getOff15_3ScopePublic(db),
  };
}

function findCoupon(db, couponId, userId) {
  return ensureCoupons(db).find((c) => c.id === couponId && (!userId || c.userId === userId));
}

function canUseCoupon(
  coupon,
  {
    originalAmount,
    /** 不含小料的商品金额；折券门槛按此判断，折扣仍按 originalAmount（含小料）计算 */
    baseAmount = null,
    fulfillmentType,
    now = Date.now(),
    product = null,
    unitPrice = 0,
    baseUnitPrice = null,
    db = null,
  } = {}
) {
  if (!coupon) return { ok: false, reason: '优惠券不存在' };
  if (coupon.status === 'expired' || (coupon.expireAt && coupon.expireAt < now)) {
    return { ok: false, reason: '优惠券已过期' };
  }
  if (coupon.status !== 'unused') return { ok: false, reason: '优惠券已使用' };
  if (coupon.fulfillment === 'reserve' && fulfillmentType !== 'reserve') {
    return { ok: false, reason: '该券仅限提前预定使用' };
  }
  if (coupon.fulfillment === 'reserve' || coupon.type === 'reserve_off') {
    try {
      const { categoryAllowsReserve } = require('./promo');
      if (product && db && !categoryAllowsReserve(db, product.category)) {
        return { ok: false, reason: '该商品不支持预定，预定券不可用' };
      }
    } catch {
      /* ignore */
    }
  }
  const original = round2(originalAmount);
  if (coupon.type === 'percent') {
    const max = Number(coupon.maxOriginal) || 30;
    // 小料另计：用商品原价（不含小料）判断是否≤上限，避免加鸡胸后折券失效
    const gate =
      baseAmount != null && Number.isFinite(Number(baseAmount))
        ? round2(baseAmount)
        : baseUnitPrice != null && Number.isFinite(Number(baseUnitPrice))
          ? round2(Number(baseUnitPrice))
          : original;
    if (gate - 1e-9 > max) {
      return { ok: false, reason: `仅限原价¥${max}及以下商品` };
    }
    const save = computeCouponSave(coupon, { originalAmount: original });
    if (!(save > 0)) return { ok: false, reason: '优惠券不可用' };
    return { ok: true };
  }
  if (coupon.type === 'free_item') {
    if (!productMatchesCoupon(coupon, product)) {
      return { ok: false, reason: '仅限水果零售商品使用' };
    }
    const save = computeCouponSave(coupon, { originalAmount: original, unitPrice, product });
    if (!(save > 0)) return { ok: false, reason: '优惠券不可用' };
    return { ok: true };
  }
  // 满15减3 / 带 allowedProductIds 的满减券：限指定商品
  if (db) {
    const scope = productAllowedForCoupon(db, coupon, product);
    if (!scope.ok) return { ok: false, reason: scope.reason };
  }
  if (coupon.threshold > 0 && original + 1e-9 < coupon.threshold) {
    return { ok: false, reason: `满¥${coupon.threshold}可用` };
  }
  if (round2(coupon.amount) >= original) {
    return { ok: false, reason: '优惠金额不能大于等于订单金额' };
  }
  return { ok: true };
}

function applyCouponAmount(originalAmount, coupon, ctx = {}) {
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
  const cut = computeCouponSave(coupon, {
    originalAmount: original,
    unitPrice: ctx.unitPrice,
    product: ctx.product,
  });
  const amount = round2(Math.max(0.01, original - cut));
  return {
    originalAmount: original,
    amount,
    discountAmount: round2(original - amount),
    discountRate: coupon.type === 'percent' ? round2(1 - Number(coupon.discountFactor || 1)) : 0,
    discountCode: coupon.templateId || 'coupon',
    discountLabel: coupon.title || '优惠券',
    couponId: coupon.id,
  };
}

/** 选出当前订单可用的最优券（省得最多，同额优先到期近的） */
function pickBestCoupon(
  db,
  userId,
  {
    originalAmount,
    baseAmount = null,
    fulfillmentType,
    now = Date.now(),
    product = null,
    unitPrice = 0,
    baseUnitPrice = null,
  } = {}
) {
  expireCoupons(db, now);
  const unused = ensureCoupons(db).filter((c) => c.userId === userId && c.status === 'unused');
  let best = null;
  let bestSave = -1;
  for (const c of unused) {
    const check = canUseCoupon(c, {
      originalAmount,
      baseAmount,
      fulfillmentType,
      now,
      product,
      unitPrice,
      baseUnitPrice,
      db,
    });
    if (!check.ok) continue;
    const priced = applyCouponAmount(originalAmount, c, { product, unitPrice });
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
  {
    originalAmount,
    baseAmount = null,
    fulfillmentType,
    now = Date.now(),
    afterLoyaltyAmount = null,
    product = null,
    unitPrice = 0,
    baseUnitPrice = null,
  } = {}
) {
  expireCoupons(db, now);
  const unused = ensureCoupons(db).filter((c) => c.userId === userId && c.status === 'unused');
  const baseForCoupon =
    afterLoyaltyAmount != null ? round2(afterLoyaltyAmount) : round2(originalAmount);
  return unused.map((c) => {
    const check = canUseCoupon(c, {
      originalAmount,
      baseAmount,
      fulfillmentType,
      now,
      product,
      unitPrice,
      baseUnitPrice,
      db,
    });
    let save = 0;
    let payAmount = null;
    if (check.ok) {
      save = computeCouponSave(c, {
        originalAmount: baseForCoupon,
        unitPrice,
        product,
      });
      payAmount = round2(Math.max(0.01, baseForCoupon - save));
    }
    return {
      ...couponPublic(c, db),
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
 * @param {{ title?: string, amount: number, threshold?: number, fulfillment?: string, count?: number, templateId?: string, allowedProductIds?: string[] }} tpl
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

  // 满15减3：写入当前配置的限定商品；也可显式传 allowedProductIds
  let allowedProductIds = Array.isArray(tpl.allowedProductIds)
    ? tpl.allowedProductIds.map(String).filter(Boolean)
    : [];
  if (!allowedProductIds.length && threshold === 15 && amount === 3) {
    allowedProductIds = resolveAllowedProductIds(db, {
      threshold,
      amount,
      title,
      templateId: 'welcome_off3',
    });
  }

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
      if (allowedProductIds.length) {
        coupon.allowedProductIds = allowedProductIds;
      }
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
    allowedProductIds: allowedProductIds.length ? allowedProductIds : null,
    expireAt,
    coupons: created,
  };
}

module.exports = {
  WELCOME_TEMPLATES,
  MONTHLY_TEMPLATE,
  FRIDAY_TEMPLATE,
  FRIDAY_PACK,
  SHOP_OPENING_AT,
  RESERVE_OFF_OPENING,
  RESERVE_OFF_NORMAL,
  VALID_DAYS,
  isOpeningPromo,
  reserveOffAmount,
  welcomeTemplates,
  campaignInfo,
  grantWelcomePack,
  grantFridayMemberPack,
  grantMonthlyLoginPack,
  grantLoginCoupons,
  grantManualCoupons,
  hasWelcomePack,
  hasRecharged,
  listUserCoupons,
  findCoupon,
  canUseCoupon,
  applyCouponAmount,
  computeCouponSave,
  productMatchesCoupon,
  productAllowedForCoupon,
  isOff15Minus3Coupon,
  getOff15_3Scope,
  getOff15_3ScopePublic,
  updateOff15_3Scope,
  ensureOff15_3Scope,
  pickBestCoupon,
  listAvailableForOrder,
  consumeCoupon,
  restoreCouponForOrder,
  ensureCoupons,
  expireCoupons,
  monthKey,
};
