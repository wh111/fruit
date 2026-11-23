/**
 * 新人券包 + 周五会员日 + 下单用券
 * - 新人预定立减：2 元 ×5（仅预定）；对客只展示当前面额
 * - 每周五会员日：已充值会员登录送无门槛减1元 ×1（现取/预定均可），甜蜜迎周末
 * - 免洗什锦/水果零售活动券：弹框领取；对客文案「3.8元起」；非会员消费满 9.9 可参与，会员免费
 * - 冬日甘蔗券：后台开关开启后，首页弹框领取「减 7.92·限甘蔗」；规则同上
 * - 每单限 1 张
 * - 满15减3：仅限管理端配置的一款水果捞 + 一款果切（可改）
 */
const crypto = require('crypto');
const { round2, shopParts, todayKey, isShopFriday } = require('./promo');

const WELCOME_PACK = 'welcome';
/** @deprecated 旧「每月登录礼」pack，仅识别存量券 */
const MONTHLY_PACK = 'monthly_login';
const FRIDAY_PACK = 'friday_member';
/** 水果零售活动：人人送立减（仅限水果零售） */
const FRUIT_RETAIL_OFF_PACK = 'fruit_retail_off';
/** 冬日甘蔗活动：人人送满减券（仅限甘蔗商品） */
const CANE_PROMO_PACK = 'cane_promo';
const CANE_PRODUCT_ID = 'cut-sugarcane';
/** 正价 11.8 − 活动价 3.88 */
const CANE_OFF_AMOUNT = 7.92;
/** 晚到领取：满 9.9 可用（含自定义结账） */
const PROMO_LATE_THRESHOLD = 9.9;
/** @deprecated 兼容旧配置名，等同 PROMO_LATE_THRESHOLD */
const CANE_OFF_THRESHOLD = PROMO_LATE_THRESHOLD;
/** 每日前 N 位领取无门槛 */
const PROMO_DAILY_FREE_LIMIT = 20;

/** 对客文案：免洗 / 甘蔗分别说清楚 */
const FRUIT_PROMO_TITLE = '免洗什锦·3.8元起';
const FRUIT_PROMO_SUB = `非会员消费满¥${PROMO_LATE_THRESHOLD}可参与 · 会员免费`;
const FRUIT_PROMO_DETAIL =
  '鲜果小盒开袋即食；每天与甘蔗二选一弹框领券；会员免费参与，非会员消费满9.9可用';
const CANE_PROMO_TITLE = '去皮甘蔗·3.88元起';
const CANE_PROMO_SUB = `非会员消费满¥${PROMO_LATE_THRESHOLD}可参与 · 会员免费`;
const CANE_PROMO_DETAIL =
  '去皮去节现剥；每天与免洗什锦二选一弹框领券；会员免费参与，非会员消费满9.9可用';

function isLegacyFruitTitle(title) {
  const t = String(title || '').trim();
  return !t || /立减\d+(\.\d+)?元/.test(t) || /水果零售立减/.test(t) || t === '免洗什锦立减';
}

function isLegacyCaneTitle(title) {
  const t = String(title || '').trim();
  return !t || /立减\d+(\.\d+)?元/.test(t) || /^冬日甘蔗券/.test(t) || t === '甘蔗券';
}
/** 充值实付累计 ≥ 此金额：活动券用券无门槛 */
const PROMO_VIP_RECHARGE_MIN = 100;
/** 常态活动默认持续天数 */
const PROMO_CAMPAIGN_DAYS = 7;
/** 天天领的券默认当天有效 */
const PROMO_COUPON_VALID_DAYS = 1;
const VALID_DAYS = 30;

function isPromoPopupPack(pack) {
  return pack === FRUIT_RETAIL_OFF_PACK || pack === CANE_PROMO_PACK;
}

function shanghaiDateStr(now = Date.now(), offsetDays = 0) {
  const d = new Date(now + offsetDays * 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d); // YYYY-MM-DD
}

function dayStamp(dateStr, endOfDay = false) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = endOfDay ? `${s}T23:59:59+08:00` : `${s}T00:00:00+08:00`;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 活动档期窗口（未配日期则仅看 enabled） */
function promoActivityWindow(cfg, now = Date.now()) {
  if (!cfg || !cfg.enabled) {
    return { ok: false, reason: '活动未开启', code: 'disabled' };
  }
  const start = dayStamp(cfg.startDate, false);
  const end = dayStamp(cfg.endDate, true);
  if (start != null && now < start) {
    return { ok: false, reason: '活动尚未开始', code: 'not_started' };
  }
  if (end != null && now > end) {
    return { ok: false, reason: '活动已结束', code: 'ended' };
  }
  return { ok: true, startDate: cfg.startDate || '', endDate: cfg.endDate || '' };
}

function ensurePromoCampaignDates(cfg, now = Date.now()) {
  if (!cfg.startDate && !cfg.endDate) {
    cfg.startDate = shanghaiDateStr(now, 0);
    cfg.endDate = shanghaiDateStr(now, PROMO_CAMPAIGN_DAYS - 1);
  } else {
    if (cfg.startDate) cfg.startDate = String(cfg.startDate).trim().slice(0, 10);
    if (cfg.endDate) cfg.endDate = String(cfg.endDate).trim().slice(0, 10);
  }
  return cfg;
}

/** 用户累计充值实付（已支付） */
function userPaidRechargeTotal(db, userId) {
  if (!userId) return 0;
  let sum = 0;
  for (const r of db.recharges || []) {
    if (!r || r.userId !== userId || r.status !== 'paid') continue;
    sum = round2(sum + Number(r.payAmount || 0));
  }
  return sum;
}

/** 充值满 100（含）会员：活动券用券无门槛 */
function isPromoVip(db, userId) {
  return userPaidRechargeTotal(db, userId) + 1e-9 >= PROMO_VIP_RECHARGE_MIN;
}

/** 今日已领过甘蔗/免洗什锦券的人数（按人去重） */
function todayPromoClaimUserCount(db, now = Date.now()) {
  const day = todayKey(now);
  const seen = new Set();
  for (const c of ensureCoupons(db)) {
    if (!c || !isPromoPopupPack(c.pack)) continue;
    if (!c.grantedAt || todayKey(c.grantedAt) !== day) continue;
    if (c.userId) seen.add(String(c.userId));
  }
  return seen.size;
}

function resolvePromoClaimThreshold(db, now = Date.now(), userId = null) {
  const used = todayPromoClaimUserCount(db, now);
  const freeLeft = Math.max(0, PROMO_DAILY_FREE_LIMIT - used);
  // 充值满 100 会员：领券即无门槛（不占前 20 名额）
  if (userId && isPromoVip(db, userId)) {
    return {
      threshold: 0,
      freeSlot: true,
      freeLeft,
      claimedToday: used,
      alreadyFree: true,
      vip: true,
    };
  }
  // 同一用户今日已拿过无门槛活动券，第二张也无门槛（不占额外名额）
  if (userId) {
    const day = todayKey(now);
    const alreadyFree = ensureCoupons(db).some(
      (c) =>
        c &&
        String(c.userId) === String(userId) &&
        isPromoPopupPack(c.pack) &&
        c.grantedAt &&
        todayKey(c.grantedAt) === day &&
        Number(c.threshold || 0) === 0
    );
    if (alreadyFree) {
      return {
        threshold: 0,
        freeSlot: true,
        freeLeft,
        claimedToday: used,
        alreadyFree: true,
        vip: false,
      };
    }
  }
  if (freeLeft > 0) {
    return {
      threshold: 0,
      freeSlot: true,
      freeLeft,
      claimedToday: used,
      alreadyFree: false,
      vip: false,
    };
  }
  return {
    threshold: PROMO_LATE_THRESHOLD,
    freeSlot: false,
    freeLeft: 0,
    claimedToday: used,
    alreadyFree: false,
    vip: false,
  };
}

/** 用户当日已支付金额（不含待支付） */
function userTodayPaidAmount(db, userId, now = Date.now()) {
  if (!userId) return 0;
  const day = todayKey(now);
  let sum = 0;
  for (const o of db.orders || []) {
    if (!o || o.userId !== userId) continue;
    if (!['paid', 'making', 'ready', 'done'].includes(o.status)) continue;
    const t = o.paidAt || o.createdAt;
    if (!t || todayKey(t) !== day) continue;
    sum = round2(sum + Number(o.amount || 0));
  }
  return sum;
}

function isFruitRetailProduct(product) {
  if (!product) return false;
  const name = String(product.name || '');
  const cat = String(product.category || '');
  if (cat === '水果零售' || cat === '零售什锦' || cat === '免洗什锦') return true;
  if (/什锦|零售|免洗/.test(name) && (/水果零售|零售什锦|免洗什锦|小盒|免洗/.test(cat) || /零售|免洗|什锦/.test(name))) {
    return true;
  }
  return false;
}

/** settings.fruitRetailOff：免洗什锦弹框天天领 */
function ensureFruitRetailOff(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.fruitRetailOff;
  if (!cur || typeof cur !== 'object') {
    db.settings.fruitRetailOff = {
      enabled: false,
      amount: 3,
      threshold: 0,
      title: FRUIT_PROMO_TITLE,
      validDays: PROMO_COUPON_VALID_DAYS,
      fulfillment: 'any',
      matchCategory: '水果零售',
      startDate: '',
      endDate: '',
    };
  } else {
    let amount = round2(Number(cur.amount) || 3);
    // 旧默认 4 元 → 改为 3 元（仅当仍是旧默认标题/面额时自动迁移）
    const oldTitle = String(cur.title || '').trim();
    const looksLegacy4 =
      Number(cur.amount) === 4 &&
      (!oldTitle || /水果零售立减4元|免洗什锦立减4元|立减4元/.test(oldTitle));
    if (looksLegacy4) amount = 3;
    let title = oldTitle;
    if (looksLegacy4 || isLegacyFruitTitle(title) || title === `水果零售立减${amount}元`) {
      title = FRUIT_PROMO_TITLE;
    }
    // 旧默认 30 天 → 天天领改为当天有效
    let validDays = Math.min(365, Math.max(1, Number(cur.validDays) || PROMO_COUPON_VALID_DAYS));
    if (Number(cur.validDays) === VALID_DAYS && !cur._promoDailyMigrated) {
      validDays = PROMO_COUPON_VALID_DAYS;
    }
    db.settings.fruitRetailOff = {
      enabled: !!cur.enabled,
      amount: amount > 0 ? amount : 3,
      title,
      threshold: round2(Number(cur.threshold) || 0),
      validDays,
      fulfillment: cur.fulfillment === 'reserve' ? 'reserve' : 'any',
      matchCategory: String(cur.matchCategory || '水果零售').trim() || '水果零售',
      startDate: String(cur.startDate || '').trim().slice(0, 10),
      endDate: String(cur.endDate || '').trim().slice(0, 10),
      _promoDailyMigrated: true,
    };
    // 未使用的旧「立减4」活动券随配置改成 3 元
    if (looksLegacy4 && Array.isArray(db.coupons)) {
      for (const c of db.coupons) {
        if (
          c &&
          c.pack === FRUIT_RETAIL_OFF_PACK &&
          c.status === 'unused' &&
          Number(c.amount) === 4
        ) {
          c.amount = 3;
          c.title = db.settings.fruitRetailOff.title;
          c.templateId = 'fruit_retail_off3';
        }
      }
    }
  }
  return db.settings.fruitRetailOff;
}

function getFruitRetailOffPublic(db) {
  const cfg = ensureFruitRetailOff(db);
  const window = promoActivityWindow(cfg);
  const retailCount = (db.products || []).filter((p) => p && isFruitRetailProduct(p)).length;
  return {
    ...cfg,
    pack: FRUIT_RETAIL_OFF_PACK,
    retailProductCount: retailCount,
    active: window.ok,
    windowReason: window.reason || '',
    hint: cfg.enabled
      ? `已开启（${cfg.startDate || '不限'}～${cfg.endDate || '不限'}）：「${cfg.title}」· ${FRUIT_PROMO_SUB}；仅限免洗什锦/水果零售；每天与甘蔗二选一`
      : '未开启。开启并保存后，用户打开小程序弹框天天领取（默认活动 1 周）。',
  };
}

function updateFruitRetailOff(db, body = {}) {
  const cfg = ensureFruitRetailOff(db);
  const wasEnabled = !!cfg.enabled;
  if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
  if (body.amount !== undefined) {
    const amount = round2(Number(body.amount));
    if (!(amount > 0)) throw Object.assign(new Error('面额须大于 0'), { status: 400 });
    cfg.amount = amount;
  }
  if (body.threshold !== undefined) {
    cfg.threshold = Math.max(0, round2(Number(body.threshold) || 0));
  }
  if (body.title !== undefined) {
    cfg.title = String(body.title || '').trim() || FRUIT_PROMO_TITLE;
  } else if (body.amount !== undefined && isLegacyFruitTitle(cfg.title)) {
    cfg.title = FRUIT_PROMO_TITLE;
  }
  if (body.validDays !== undefined) {
    cfg.validDays = Math.min(365, Math.max(1, Number(body.validDays) || PROMO_COUPON_VALID_DAYS));
  }
  if (body.fulfillment !== undefined) {
    cfg.fulfillment = body.fulfillment === 'reserve' ? 'reserve' : 'any';
  }
  if (body.matchCategory !== undefined) {
    cfg.matchCategory = String(body.matchCategory || '水果零售').trim() || '水果零售';
  }
  if (body.startDate !== undefined) cfg.startDate = String(body.startDate || '').trim().slice(0, 10);
  if (body.endDate !== undefined) cfg.endDate = String(body.endDate || '').trim().slice(0, 10);
  // 新开启且未配档期：默认 1 周
  if (cfg.enabled && (!wasEnabled || body.enabled === true) && !cfg.startDate && !cfg.endDate) {
    ensurePromoCampaignDates(cfg);
  }
  if (cfg.enabled && body.enabled === true && (body.startDate === undefined && body.endDate === undefined)) {
    if (!cfg.startDate || !cfg.endDate) ensurePromoCampaignDates(cfg);
  }
  db.settings.fruitRetailOff = cfg;
  return getFruitRetailOffPublic(db);
}

/** settings.canePromo：冬日甘蔗券弹框天天领 */
function ensureCanePromo(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.canePromo;
  if (!cur || typeof cur !== 'object') {
    db.settings.canePromo = {
      enabled: false,
      amount: CANE_OFF_AMOUNT,
      threshold: CANE_OFF_THRESHOLD,
      title: CANE_PROMO_TITLE,
      validDays: PROMO_COUPON_VALID_DAYS,
      fulfillment: 'any',
      productId: CANE_PRODUCT_ID,
      syncHomePoster: false,
      startDate: '',
      endDate: '',
    };
  } else {
    const amount = round2(Number(cur.amount) || CANE_OFF_AMOUNT);
    let validDays = Math.min(365, Math.max(1, Number(cur.validDays) || PROMO_COUPON_VALID_DAYS));
    if (Number(cur.validDays) === VALID_DAYS && !cur._promoDailyMigrated) {
      validDays = PROMO_COUPON_VALID_DAYS;
    }
    const rawTitle = String(cur.title || '').trim();
    db.settings.canePromo = {
      enabled: !!cur.enabled,
      amount: amount > 0 ? amount : CANE_OFF_AMOUNT,
      threshold: round2(
        cur.threshold != null && cur.threshold !== '' ? Number(cur.threshold) : CANE_OFF_THRESHOLD
      ),
      title: isLegacyCaneTitle(rawTitle) ? CANE_PROMO_TITLE : rawTitle,
      validDays,
      fulfillment: cur.fulfillment === 'reserve' ? 'reserve' : 'any',
      productId: String(cur.productId || CANE_PRODUCT_ID).trim() || CANE_PRODUCT_ID,
      syncHomePoster: !!cur.syncHomePoster,
      startDate: String(cur.startDate || '').trim().slice(0, 10),
      endDate: String(cur.endDate || '').trim().slice(0, 10),
      _promoDailyMigrated: true,
    };
  }
  return db.settings.canePromo;
}

function resolveCaneProduct(db, productId = CANE_PRODUCT_ID) {
  const id = String(productId || CANE_PRODUCT_ID);
  return (db.products || []).find((p) => p && String(p.id) === id) || null;
}

function getCanePromoPublic(db) {
  const cfg = ensureCanePromo(db);
  const window = promoActivityWindow(cfg);
  const product = resolveCaneProduct(db, cfg.productId);
  return {
    ...cfg,
    pack: CANE_PROMO_PACK,
    productName: product ? product.name : '',
    productFound: !!product,
    active: window.ok,
    windowReason: window.reason || '',
    hint: cfg.enabled
      ? `已开启（${cfg.startDate || '不限'}～${cfg.endDate || '不限'}）：「${cfg.title}」· ${CANE_PROMO_SUB}；仅限${
          product ? product.name : cfg.productId
        }；每天与免洗什锦二选一`
      : '未开启。开启并保存后，用户打开小程序弹框天天领取（默认活动 1 周）。',
  };
}

function syncCaneHomePoster(db, cfg) {
  if (!cfg || !cfg.syncHomePoster) return;
  try {
    const { updateConfig } = require('./homePoster');
    updateConfig(db, {
      enabled: !!cfg.enabled,
      tag: '冬日应季',
      title: CANE_PROMO_TITLE,
      sub: CANE_PROMO_SUB,
      btnText: cfg.enabled ? '去领券' : '去看看',
      linkType: 'coupons',
      productId: cfg.productId || CANE_PRODUCT_ID,
      category: '新鲜现剥',
      theme: 'winter',
      imageUrl: '',
    });
  } catch {
    /* ignore */
  }
}

function updateCanePromo(db, body = {}) {
  const cfg = ensureCanePromo(db);
  const wasEnabled = !!cfg.enabled;
  if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
  if (body.amount !== undefined) {
    const amount = round2(Number(body.amount));
    if (!(amount > 0)) throw Object.assign(new Error('面额须大于 0'), { status: 400 });
    cfg.amount = amount;
  }
  if (body.threshold !== undefined) {
    cfg.threshold = Math.max(0, round2(Number(body.threshold) || 0));
  }
  if (body.title !== undefined) {
    cfg.title = String(body.title || '').trim() || CANE_PROMO_TITLE;
  }
  if (body.validDays !== undefined) {
    cfg.validDays = Math.min(365, Math.max(1, Number(body.validDays) || PROMO_COUPON_VALID_DAYS));
  }
  if (body.fulfillment !== undefined) {
    cfg.fulfillment = body.fulfillment === 'reserve' ? 'reserve' : 'any';
  }
  if (body.productId !== undefined) {
    cfg.productId = String(body.productId || CANE_PRODUCT_ID).trim() || CANE_PRODUCT_ID;
  }
  if (body.syncHomePoster !== undefined) cfg.syncHomePoster = !!body.syncHomePoster;
  if (body.startDate !== undefined) cfg.startDate = String(body.startDate || '').trim().slice(0, 10);
  if (body.endDate !== undefined) cfg.endDate = String(body.endDate || '').trim().slice(0, 10);
  if (cfg.enabled && (!wasEnabled || body.enabled === true)) {
    if (!cfg.startDate || !cfg.endDate) ensurePromoCampaignDates(cfg);
  }
  db.settings.canePromo = cfg;
  if (body.syncHomePoster !== false && (body.enabled !== undefined || body.syncHomePoster)) {
    syncCaneHomePoster(db, cfg);
  }
  return getCanePromoPublic(db);
}

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

function productAllowedForCoupon(db, coupon, product, products = null) {
  const ids = resolveAllowedProductIds(db, coupon);
  if (!ids.length) return { ok: true, allowedProductIds: [] };
  const list =
    Array.isArray(products) && products.length
      ? products.filter(Boolean)
      : product
        ? [product]
        : [];
  if (!list.length) {
    return { ok: false, reason: '请选择商品后再用券', allowedProductIds: ids };
  }
  const hit = list.find((p) => p && ids.includes(String(p.id)));
  if (!hit) {
    const names = (db.products || [])
      .filter((p) => ids.includes(String(p.id)))
      .map((p) => p.name)
      .filter(Boolean);
    const tip = names.length ? names.join('、') : '指定商品';
    return { ok: false, reason: `该券仅限：${tip}`, allowedProductIds: ids };
  }
  return { ok: true, allowedProductIds: ids, matchedProduct: hit };
}

/** 线上新人礼：预定立减固定 2 元 ×5 */
const WELCOME_RESERVE_AMOUNT = 2;
const WELCOME_RESERVE_COUNT = 5;
/** @deprecated 兼容旧导出；新人礼已固定为 WELCOME_RESERVE_AMOUNT */
const RESERVE_OFF_OPENING = WELCOME_RESERVE_AMOUNT;
const RESERVE_OFF_NORMAL = WELCOME_RESERVE_AMOUNT;

function reserveOffAmount() {
  return WELCOME_RESERVE_AMOUNT;
}

function reserveOffTitle(amount = reserveOffAmount()) {
  const n = Number(amount);
  const label = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `预定立减${label}元`;
}

function welcomeTemplates() {
  const reserveAmt = WELCOME_RESERVE_AMOUNT;
  return [
    {
      templateId: 'welcome_reserve2',
      title: reserveOffTitle(reserveAmt),
      type: 'reserve_off',
      threshold: 0,
      amount: reserveAmt,
      fulfillment: 'reserve',
      count: WELCOME_RESERVE_COUNT,
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

/** 新人礼已下线：活动页展示已过期，不再发券 */
const WELCOME_ENABLED = false;

function campaignInfo(now = Date.now()) {
  const templates = welcomeTemplates();
  const reserveAmt = WELCOME_RESERVE_AMOUNT;
  const reserveCount = WELCOME_RESERVE_COUNT;
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
    bannerSub: `新人礼：${reserveLabel}×${reserveCount}`,
    faceValue,
    validDays: VALID_DAYS,
    reserveOffAmount: reserveAmt,
    reserveOffCount: reserveCount,
    memberDayGift,
    monthlyGift: memberDayGift,
    /** 下线后活动页展示 */
    enabled: WELCOME_ENABLED,
    status: WELCOME_ENABLED ? 'active' : 'expired',
    statusText: WELCOME_ENABLED ? '进行中' : '已过期',
    rules: [
      '本活动已结束，不再发放新人礼券',
      '历史已领券仍可在有效期内使用',
      '每单限用 1 张券，不可叠加多张券',
    ],
    packs: templates.map((t) => ({
      title: t.title,
      count: t.count,
      threshold: t.threshold,
      amount: t.amount,
      fulfillment: t.fulfillment,
    })),
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
  if (!WELCOME_ENABLED) {
    return { granted: false, coupons: [], reason: 'ended' };
  }
  ensureCoupons(db);
  if (hasWelcomePack(db, user.id)) {
    return { granted: false, coupons: [], reason: 'already' };
  }
  const expireAt = now + VALID_DAYS * 24 * 60 * 60 * 1000;
  const created = [];
  for (const t of welcomeTemplates()) {
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

function hasFruitRetailOffPack(db, userId) {
  return ensureCoupons(db).some((c) => c.userId === userId && c.pack === FRUIT_RETAIL_OFF_PACK);
}

/** 今日是否已领过该活动券（天天可领） */
function hasPromoPackToday(db, userId, pack, now = Date.now()) {
  if (!userId || !pack) return false;
  const day = todayKey(now);
  return ensureCoupons(db).some(
    (c) =>
      c &&
      c.userId === userId &&
      c.pack === pack &&
      c.grantedAt &&
      todayKey(c.grantedAt) === day
  );
}

function hasFruitRetailOffToday(db, userId, now = Date.now()) {
  return hasPromoPackToday(db, userId, FRUIT_RETAIL_OFF_PACK, now);
}

function hasCanePromoToday(db, userId, now = Date.now()) {
  return hasPromoPackToday(db, userId, CANE_PROMO_PACK, now);
}

/** 弹框两张活动券：每天只能选领一张 */
function hasAnyPromoClaimToday(db, userId, now = Date.now()) {
  return hasFruitRetailOffToday(db, userId, now) || hasCanePromoToday(db, userId, now);
}

/**
 * 免洗什锦活动券：弹框天天领（默认 3 元）
 * 每日前 20 人无门槛；其余满 9.9；充值满 100 会员用券无门槛
 */
function grantFruitRetailOffPack(db, user, now = Date.now(), opts = {}) {
  if (!user || !user.id) return { granted: false, coupons: [] };
  const cfg = ensureFruitRetailOff(db);
  const window = promoActivityWindow(cfg, now);
  if (!window.ok) {
    return { granted: false, coupons: [], reason: window.code || 'disabled' };
  }
  ensureCoupons(db);
  if (hasFruitRetailOffToday(db, user.id, now)) {
    return { granted: false, coupons: [], reason: 'already' };
  }
  if (opts.viaClaim && hasCanePromoToday(db, user.id, now)) {
    return { granted: false, coupons: [], reason: 'daily_one' };
  }
  // 弹框领取走每日前 20 无门槛；后台补发走满 9.9
  const slot = opts.viaClaim
    ? resolvePromoClaimThreshold(db, now, user.id)
    : {
        threshold: PROMO_LATE_THRESHOLD,
        freeSlot: false,
        freeLeft: resolvePromoClaimThreshold(db, now).freeLeft,
        claimedToday: 0,
        alreadyFree: false,
      };
  const days = Math.min(365, Math.max(1, Number(cfg.validDays) || PROMO_COUPON_VALID_DAYS));
  const expireAt = now + days * 24 * 60 * 60 * 1000;
  const amount = round2(Number(cfg.amount) || 3);
  const threshold = round2(slot.threshold);
  const titleBase = isLegacyFruitTitle(cfg.title) ? FRUIT_PROMO_TITLE : cfg.title || FRUIT_PROMO_TITLE;
  const title =
    threshold > 0
      ? `${titleBase}·满¥${threshold}`
      : `${titleBase}·会员免费/无门槛`;
  const coupon = {
    id: crypto.randomUUID(),
    userId: user.id,
    openid: user.openid || null,
    pack: FRUIT_RETAIL_OFF_PACK,
    templateId: threshold > 0 ? 'fruit_retail_off3_t99' : 'fruit_retail_off3_free',
    title,
    type: threshold > 0 ? 'threshold' : 'flat',
    threshold,
    amount,
    fulfillment: cfg.fulfillment === 'reserve' ? 'reserve' : 'any',
    matchCategory: cfg.matchCategory || '水果零售',
    allowBulk: true,
    status: 'unused',
    orderId: null,
    grantedAt: now,
    expireAt,
    usedAt: null,
  };
  db.coupons.push(coupon);
  user.fruitRetailOffGrantedAt = now;
  const freeLeftAfter =
    slot.freeSlot && !slot.alreadyFree
      ? Math.max(0, slot.freeLeft - 1)
      : slot.freeLeft;
  return {
    granted: true,
    coupons: [coupon],
    count: 1,
    freeSlot: slot.freeSlot,
    freeLeft: freeLeftAfter,
    threshold,
    vip: !!slot.vip,
    alreadyFree: !!slot.alreadyFree,
  };
}

/**
 * 给存量用户一次性补发（仅尚未领过活动券的人）；需后台手动点。
 */
function grantFruitRetailOffToUsers(db, users, now = Date.now()) {
  const cfg = ensureFruitRetailOff(db);
  if (!cfg.enabled) {
    throw Object.assign(new Error('请先开启「免洗什锦人人送券」并保存'), { status: 400 });
  }
  const created = [];
  let skipped = 0;
  for (const user of users || []) {
    const r = grantFruitRetailOffPack(db, user, now);
    if (r.granted) created.push(...r.coupons);
    else skipped += 1;
  }
  return {
    granted: created.length,
    userCount: created.length ? new Set(created.map((c) => c.userId)).size : 0,
    skipped,
    title: cfg.title,
    amount: cfg.amount,
    matchCategory: cfg.matchCategory,
    coupons: created,
  };
}

function hasCanePromoPack(db, userId) {
  return ensureCoupons(db).some((c) => c.userId === userId && c.pack === CANE_PROMO_PACK);
}

/**
 * 冬日甘蔗券：弹框天天领（减 7.92 ≈ 250g 实付 3.88）
 * 每日前 20 人无门槛；其余满 9.9；充值满 100 会员用券无门槛
 */
function grantCanePromoPack(db, user, now = Date.now(), opts = {}) {
  if (!user || !user.id) return { granted: false, coupons: [] };
  const cfg = ensureCanePromo(db);
  const window = promoActivityWindow(cfg, now);
  if (!window.ok) {
    return { granted: false, coupons: [], reason: window.code || 'disabled' };
  }
  ensureCoupons(db);
  if (hasCanePromoToday(db, user.id, now)) {
    return { granted: false, coupons: [], reason: 'already' };
  }
  if (opts.viaClaim && hasFruitRetailOffToday(db, user.id, now)) {
    return { granted: false, coupons: [], reason: 'daily_one' };
  }
  const slot = opts.viaClaim
    ? resolvePromoClaimThreshold(db, now, user.id)
    : {
        threshold: PROMO_LATE_THRESHOLD,
        freeSlot: false,
        freeLeft: resolvePromoClaimThreshold(db, now).freeLeft,
        claimedToday: 0,
        alreadyFree: false,
      };
  const days = Math.min(365, Math.max(1, Number(cfg.validDays) || PROMO_COUPON_VALID_DAYS));
  const expireAt = now + days * 24 * 60 * 60 * 1000;
  const amount = round2(Number(cfg.amount) || CANE_OFF_AMOUNT);
  const threshold = round2(slot.threshold);
  const productId = String(cfg.productId || CANE_PRODUCT_ID).trim() || CANE_PRODUCT_ID;
  const titleBase = isLegacyCaneTitle(cfg.title) ? CANE_PROMO_TITLE : cfg.title || CANE_PROMO_TITLE;
  const title =
    threshold > 0
      ? `${titleBase}·满¥${threshold}`
      : `${titleBase}·会员免费/无门槛`;
  const coupon = {
    id: crypto.randomUUID(),
    userId: user.id,
    openid: user.openid || null,
    pack: CANE_PROMO_PACK,
    templateId: threshold > 0 ? 'cane_promo_t99' : 'cane_promo_free',
    title,
    type: threshold > 0 ? 'threshold' : 'flat',
    threshold,
    amount,
    fulfillment: cfg.fulfillment === 'reserve' ? 'reserve' : 'any',
    allowedProductIds: [productId],
    allowBulk: true,
    status: 'unused',
    orderId: null,
    grantedAt: now,
    expireAt,
    usedAt: null,
  };
  db.coupons.push(coupon);
  user.canePromoGrantedAt = now;
  const freeLeftAfter =
    slot.freeSlot && !slot.alreadyFree
      ? Math.max(0, slot.freeLeft - 1)
      : slot.freeLeft;
  return {
    granted: true,
    coupons: [coupon],
    count: 1,
    freeSlot: slot.freeSlot,
    freeLeft: freeLeftAfter,
    threshold,
    vip: !!slot.vip,
    alreadyFree: !!slot.alreadyFree,
  };
}

function promoClaimFailMessage(packLabel, reason) {
  if (reason === 'already') return `今日已领过${packLabel}，明天再来`;
  if (reason === 'daily_one') return '每天只能选领一张活动券';
  if (reason === 'disabled') return `${packLabel}活动未开启`;
  if (reason === 'not_started') return `${packLabel}活动尚未开始`;
  if (reason === 'ended') return `${packLabel}活动已结束`;
  return '领取失败';
}

/** 弹框领取：pack = fruit_retail_off | cane_promo */
function claimPromoCoupon(db, user, pack, now = Date.now()) {
  if (!user || !user.id) {
    throw Object.assign(new Error('请先登录'), { status: 401 });
  }
  const p = String(pack || '');
  if (p === FRUIT_RETAIL_OFF_PACK || p === 'fruit' || p === 'mix') {
    const r = grantFruitRetailOffPack(db, user, now, { viaClaim: true });
    if (!r.granted) {
      throw Object.assign(new Error(promoClaimFailMessage('免洗什锦券', r.reason)), {
        status: 400,
      });
    }
    return { ...r, pack: FRUIT_RETAIL_OFF_PACK };
  }
  if (p === CANE_PROMO_PACK || p === 'cane' || p === 'sugarcane') {
    const r = grantCanePromoPack(db, user, now, { viaClaim: true });
    if (!r.granted) {
      throw Object.assign(new Error(promoClaimFailMessage('甘蔗券', r.reason)), { status: 400 });
    }
    return { ...r, pack: CANE_PROMO_PACK };
  }
  throw Object.assign(new Error('未知活动'), { status: 400 });
}

/** 首页弹框公开信息 */
function getPromoPopupPublic(db, userId = null, now = Date.now()) {
  const fruit = ensureFruitRetailOff(db);
  const cane = ensureCanePromo(db);
  const fruitActive = promoActivityWindow(fruit, now).ok;
  const caneActive = promoActivityWindow(cane, now).ok;
  const slot = resolvePromoClaimThreshold(db, now, userId);
  const vip = !!(userId && isPromoVip(db, userId));
  const hasFruit = userId ? hasFruitRetailOffToday(db, userId, now) : false;
  const hasCane = userId ? hasCanePromoToday(db, userId, now) : false;
  const claimedAny = hasFruit || hasCane;
  const items = [];
  if (fruitActive) {
    items.push({
      pack: FRUIT_RETAIL_OFF_PACK,
      tag: '免洗什锦',
      title: isLegacyFruitTitle(fruit.title) ? FRUIT_PROMO_TITLE : fruit.title,
      sub: FRUIT_PROMO_SUB,
      detail: FRUIT_PROMO_DETAIL,
      amount: round2(fruit.amount || 3),
      claimed: hasFruit,
      locked: claimedAny && !hasFruit,
      theme: 'warm',
    });
  }
  if (caneActive) {
    items.push({
      pack: CANE_PROMO_PACK,
      tag: '去皮甘蔗',
      title: isLegacyCaneTitle(cane.title) ? CANE_PROMO_TITLE : cane.title,
      sub: CANE_PROMO_SUB,
      detail: CANE_PROMO_DETAIL,
      amount: round2(cane.amount || CANE_OFF_AMOUNT),
      claimed: hasCane,
      locked: claimedAny && !hasCane,
      theme: 'winter',
      productId: cane.productId || CANE_PRODUCT_ID,
    });
  }
  const claimable = items.some((x) => !x.claimed && !x.locked);
  let hint;
  if (claimedAny) {
    hint = '今日已领过活动券，每天只能选一张，明天再来';
  } else if (vip) {
    hint = '会员免费参与 · 每天二选一领券';
  } else if (slot.freeSlot) {
    hint = `非会员消费满¥${PROMO_LATE_THRESHOLD}可参与 · 会员免费 · 每天二选一`;
  } else {
    hint = `非会员消费满¥${PROMO_LATE_THRESHOLD}可用 · 会员免费 · 每天二选一`;
  }
  const endDates = [fruitActive && fruit.endDate, caneActive && cane.endDate].filter(Boolean);
  return {
    enabled: items.length > 0,
    claimable,
    dailyFreeLimit: PROMO_DAILY_FREE_LIMIT,
    freeLeft: slot.freeLeft,
    claimedToday: slot.claimedToday,
    lateThreshold: PROMO_LATE_THRESHOLD,
    vipRechargeMin: PROMO_VIP_RECHARGE_MIN,
    vip,
    nextIsFree: slot.freeSlot,
    endDate: endDates.sort().slice(-1)[0] || '',
    hint,
    items,
  };
}

function grantCanePromoToUsers(db, users, now = Date.now()) {
  const cfg = ensureCanePromo(db);
  if (!cfg.enabled) {
    throw Object.assign(new Error('请先开启「冬日甘蔗券」并保存'), { status: 400 });
  }
  const created = [];
  let skipped = 0;
  for (const user of users || []) {
    const r = grantCanePromoPack(db, user, now);
    if (r.granted) created.push(...r.coupons);
    else skipped += 1;
  }
  return {
    granted: created.length,
    userCount: created.length ? new Set(created.map((c) => c.userId)).size : 0,
    skipped,
    title: cfg.title,
    amount: cfg.amount,
    threshold: cfg.threshold,
    productId: cfg.productId,
    coupons: created,
  };
}

/** 登录/进店时统一发券：新人礼 + 周五会员日（甘蔗/免洗什锦改弹框领取，不自动发） */
function grantLoginCoupons(db, user, now = Date.now()) {
  const welcome = grantWelcomePack(db, user, now);
  const monthly = grantFridayMemberPack(db, user, now);
  const fruitRetail = { granted: false, coupons: [], reason: 'popup' };
  const canePromo = { granted: false, coupons: [], reason: 'popup' };
  return {
    welcome,
    monthly,
    fruitRetail,
    canePromo,
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

function productMatchesCategory(coupon, product) {
  if (!coupon || !coupon.matchCategory || !product) return true;
  if (
    coupon.matchCategory === '水果零售' ||
    coupon.matchCategory === '免洗什锦' ||
    coupon.matchCategory === '零售什锦'
  ) {
    return isFruitRetailProduct(product);
  }
  return String(product.category || '') === String(coupon.matchCategory);
}

function productMatchesCoupon(coupon, product) {
  if (!coupon || coupon.type !== 'free_item' || !product) return false;
  if (Array.isArray(coupon.productIds) && coupon.productIds.length) {
    return coupon.productIds.includes(product.id);
  }
  if (coupon.matchCategory) return productMatchesCategory(coupon, product);
  if (coupon.matchNameIncludes && String(product.name || '').includes(coupon.matchNameIncludes)) {
    return true;
  }
  return isFruitRetailProduct(product);
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
  } else if (c.matchCategory) {
    const catLabel = c.matchCategory === '水果零售' ? '水果零售' : c.matchCategory;
    usableHint =
      c.threshold > 0 ? `满¥${c.threshold} · 仅限${catLabel}` : `仅限${catLabel}`;
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
    /** 购物车多商品时传入，用于限定商品券判断 */
    products = null,
    unitPrice = 0,
    baseUnitPrice = null,
    db = null,
    userId = null,
    /** bulk = 自定义金额结账 */
    orderKind = null,
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
  const isBulk = orderKind === 'bulk' || (product && product.id === 'bulk');
  const promoAllowBulk = coupon.allowBulk && isPromoPopupPack(coupon.pack);
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
  // 自定义结账：甘蔗/免洗什锦活动券可跳过商品限定，只看门槛
  if (!(isBulk && promoAllowBulk)) {
    // 满15减3 / 带 allowedProductIds 的满减券：限指定商品（购物车任一件命中即可）
    if (db) {
      const scope = productAllowedForCoupon(db, coupon, product, products);
      if (!scope.ok) return { ok: false, reason: scope.reason };
    }
    // 品类限制（如免洗什锦立减 · 仅限水果零售）
    if (coupon.matchCategory) {
      if (!product) return { ok: false, reason: '请选择商品后再用券' };
      if (!productMatchesCategory(coupon, product)) {
        const catLabel = coupon.matchCategory === '水果零售' ? '免洗什锦/水果零售' : coupon.matchCategory;
        return { ok: false, reason: `仅限${catLabel}商品使用` };
      }
    }
  }
  if (coupon.threshold > 0) {
    // 充值满 100 会员：活动券用券无门槛
    const vipSkip =
      isPromoPopupPack(coupon.pack) && db && userId && isPromoVip(db, userId);
    if (!vipSkip) {
      const todayPaid = db && userId ? userTodayPaidAmount(db, userId, now) : 0;
      const metByOrder = original + 1e-9 >= coupon.threshold;
      const metByToday = todayPaid + 1e-9 >= coupon.threshold;
      if (!metByOrder && !metByToday) {
        return {
          ok: false,
          reason: `满¥${coupon.threshold}可用（本单或当日已付；充值满¥${PROMO_VIP_RECHARGE_MIN}会员无门槛）`,
        };
      }
    }
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
    products = null,
    unitPrice = 0,
    baseUnitPrice = null,
    orderKind = null,
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
      products,
      unitPrice,
      baseUnitPrice,
      db,
      userId,
      orderKind,
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
    products = null,
    unitPrice = 0,
    baseUnitPrice = null,
    orderKind = null,
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
      products,
      unitPrice,
      baseUnitPrice,
      db,
      userId,
      orderKind,
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
      if (tpl.matchCategory) {
        coupon.matchCategory = String(tpl.matchCategory);
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
    matchCategory: tpl.matchCategory || null,
    expireAt,
    coupons: created,
  };
}

module.exports = {
  WELCOME_TEMPLATES,
  MONTHLY_TEMPLATE,
  FRIDAY_TEMPLATE,
  FRIDAY_PACK,
  FRUIT_RETAIL_OFF_PACK,
  CANE_PROMO_PACK,
  CANE_PRODUCT_ID,
  CANE_OFF_AMOUNT,
  CANE_OFF_THRESHOLD,
  PROMO_LATE_THRESHOLD,
  PROMO_DAILY_FREE_LIMIT,
  PROMO_VIP_RECHARGE_MIN,
  FRUIT_PROMO_TITLE,
  FRUIT_PROMO_SUB,
  FRUIT_PROMO_DETAIL,
  CANE_PROMO_TITLE,
  CANE_PROMO_SUB,
  CANE_PROMO_DETAIL,
  PROMO_CAMPAIGN_DAYS,
  PROMO_COUPON_VALID_DAYS,
  isPromoVip,
  userPaidRechargeTotal,
  hasFruitRetailOffToday,
  hasCanePromoToday,
  WELCOME_RESERVE_AMOUNT,
  WELCOME_RESERVE_COUNT,
  RESERVE_OFF_OPENING,
  RESERVE_OFF_NORMAL,
  VALID_DAYS,
  reserveOffAmount,
  welcomeTemplates,
  campaignInfo,
  grantWelcomePack,
  grantFridayMemberPack,
  grantMonthlyLoginPack,
  grantFruitRetailOffPack,
  grantFruitRetailOffToUsers,
  grantCanePromoPack,
  grantCanePromoToUsers,
  claimPromoCoupon,
  getPromoPopupPublic,
  promoActivityWindow,
  resolvePromoClaimThreshold,
  userTodayPaidAmount,
  grantLoginCoupons,
  grantManualCoupons,
  hasWelcomePack,
  hasFruitRetailOffPack,
  hasCanePromoPack,
  hasRecharged,
  isFruitRetailProduct,
  listUserCoupons,
  findCoupon,
  canUseCoupon,
  applyCouponAmount,
  computeCouponSave,
  productMatchesCoupon,
  productMatchesCategory,
  productAllowedForCoupon,
  isOff15Minus3Coupon,
  getOff15_3Scope,
  getOff15_3ScopePublic,
  updateOff15_3Scope,
  ensureOff15_3Scope,
  getFruitRetailOffPublic,
  updateFruitRetailOff,
  ensureFruitRetailOff,
  getCanePromoPublic,
  updateCanePromo,
  ensureCanePromo,
  pickBestCoupon,
  listAvailableForOrder,
  consumeCoupon,
  restoreCouponForOrder,
  ensureCoupons,
  expireCoupons,
  monthKey,
};
