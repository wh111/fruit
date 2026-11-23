/**
 * 会员全场折扣（可配置，默认 9 折）
 * 会员判定：有过成功充值；与立减券互斥，不可同单叠加
 */
const { shopParts, shopStamp, round2 } = require('./promo');

const PAID_STATUSES = new Set(['paid', 'making', 'ready', 'done']);

function monthRange(now = Date.now()) {
  const p = shopParts(now);
  const start = shopStamp(p.y, p.m, 1, 0, 0);
  const nextM = p.m === 12 ? 1 : p.m + 1;
  const nextY = p.m === 12 ? p.y + 1 : p.y;
  const end = shopStamp(nextY, nextM, 1, 0, 0);
  const key = `${p.y}${String(p.m).padStart(2, '0')}`;
  return { start, end, key, year: p.y, month: p.m };
}

function isUserOrder(order, userId, openid) {
  if (!order) return false;
  if (userId && order.userId === userId) return true;
  if (openid && order.openid && order.openid === openid) return true;
  return false;
}

function countMonthPaidOrders(db, { userId, openid, now = Date.now() } = {}) {
  if (!userId && !openid) return 0;
  const { start, end } = monthRange(now);
  return (db.orders || []).filter((o) => {
    if (!PAID_STATUSES.has(o.status)) return false;
    if (!isUserOrder(o, userId, openid)) return false;
    const t = o.paidAt || o.createdAt || 0;
    return t >= start && t < end;
  }).length;
}

function factorToZhe(factor) {
  const f = Number(factor);
  if (!(f > 0) || f >= 1) return '无折扣';
  const zhe = Math.round(f * 100) / 10;
  return Number.isInteger(zhe) ? `${zhe}折` : `${zhe}折`;
}

/** settings.memberDiscount：会员全场折扣 */
function ensureMemberDiscount(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const cur = db.settings.memberDiscount;
  if (!cur || typeof cur !== 'object') {
    db.settings.memberDiscount = {
      enabled: true,
      /** 实付系数，0.9 = 9 折 */
      factor: 0.9,
      label: '会员9折',
      /** 需有过成功充值才算会员 */
      requireRecharge: true,
    };
  } else {
    let factor = Number(cur.factor);
    if (!(factor > 0) || factor > 1) factor = 0.9;
    // 兼容旧字段 rate（折扣力度 0.1 = 9折）
    if (cur.rate != null && cur.factor == null) {
      const rate = Number(cur.rate);
      if (rate > 0 && rate < 1) factor = round2(1 - rate);
    }
    const zhe = factorToZhe(factor);
    db.settings.memberDiscount = {
      enabled: cur.enabled !== false,
      factor: round2(factor),
      label: String(cur.label || '').trim() || `会员${zhe}`,
      requireRecharge: cur.requireRecharge !== false,
    };
  }
  return db.settings.memberDiscount;
}

function getMemberDiscountPublic(db) {
  const cfg = ensureMemberDiscount(db);
  return {
    ...cfg,
    zheLabel: factorToZhe(cfg.factor),
    rate: round2(1 - Number(cfg.factor || 1)),
    hint: cfg.enabled
      ? `已开启：全场 ${factorToZhe(cfg.factor)} · 周周活动免费参与 · 充值有礼`
      : '未开启会员折扣',
  };
}

function updateMemberDiscount(db, body = {}) {
  const cfg = ensureMemberDiscount(db);
  if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
  if (body.factor !== undefined) {
    const factor = Number(body.factor);
    if (!(factor > 0) || factor > 1) {
      throw Object.assign(new Error('折扣系数须在 0～1 之间，如 0.9 表示 9 折'), { status: 400 });
    }
    cfg.factor = round2(factor);
  } else if (body.zhe !== undefined) {
    // zhe=9 → 0.9；zhe=95 → 0.95
    const zhe = Number(body.zhe);
    if (!(zhe > 0) || zhe > 10) {
      throw Object.assign(new Error('请输入 1～10 的折数，如 9 表示 9 折'), { status: 400 });
    }
    cfg.factor = round2(zhe / 10);
  } else if (body.rate !== undefined) {
    const rate = Number(body.rate);
    if (!(rate >= 0) || rate >= 1) {
      throw Object.assign(new Error('折扣力度须在 0～1 之间，如 0.1 表示 9 折'), { status: 400 });
    }
    cfg.factor = round2(1 - rate);
  }
  if (body.label !== undefined) {
    cfg.label = String(body.label || '').trim() || `会员${factorToZhe(cfg.factor)}`;
  } else if (body.factor !== undefined || body.zhe !== undefined || body.rate !== undefined) {
    if (!cfg.label || /^会员[\d.]+折$/.test(cfg.label)) {
      cfg.label = `会员${factorToZhe(cfg.factor)}`;
    }
  }
  if (body.requireRecharge !== undefined) cfg.requireRecharge = !!body.requireRecharge;
  db.settings.memberDiscount = cfg;
  return getMemberDiscountPublic(db);
}

function isRechargeMember(db, userId) {
  if (!userId) return false;
  return (db.recharges || []).some((r) => r && r.userId === userId && r.status === 'paid');
}

/** @deprecated 旧月累计档位，保留导出兼容 */
function loyaltyFromCount(monthPaidCount, { includeCurrent = true } = {}) {
  const n = Math.max(0, Number(monthPaidCount) || 0) + (includeCurrent ? 1 : 0);
  return {
    monthCount: n,
    tier: 0,
    rate: 0,
    factor: 1,
    label: '',
    shortLabel: '',
    nextHint: '',
  };
}

function getLoyaltyState(db, { userId, openid, now = Date.now(), includeCurrent = true } = {}) {
  const paid = countMonthPaidOrders(db, { userId, openid, now });
  const range = monthRange(now);
  const cfg = ensureMemberDiscount(db);
  const member = isRechargeMember(db, userId);
  const eligible = !!(cfg.enabled && member && (!cfg.requireRecharge || member));

  if (eligible) {
    const factor = Number(cfg.factor) || 0.9;
    const rate = round2(1 - factor);
    const label = cfg.label || `会员${factorToZhe(factor)}`;
    return {
      monthKey: range.key,
      monthPaid: paid,
      monthCount: paid + (includeCurrent ? 1 : 0),
      tier: 1,
      rate,
      factor: round2(factor),
      label,
      shortLabel: label,
      nextHint: '',
      enabled: true,
      isMember: true,
      memberDiscount: true,
      rules: [
        `全场 ${factorToZhe(factor)}：果切、果汁、零食与自定义称重都能用`,
        '周周线上活动免费参与，弹框领券、主题活动不错过',
        '充值有礼，余额可整单付款，结账更省心',
        '立减券与会员折同单任选其一，自动取更省的一方',
      ],
    };
  }

  return {
    monthKey: range.key,
    monthPaid: paid,
    monthCount: paid + (includeCurrent ? 1 : 0),
    tier: 0,
    rate: 0,
    factor: 1,
    label: '',
    shortLabel: '',
    nextHint: cfg.enabled
      ? member
        ? ''
        : `充值成为会员：全场${factorToZhe(cfg.factor)} · 周周活动免费参与`
      : '',
    enabled: !!cfg.enabled,
    isMember: member,
    memberDiscount: false,
    rules: cfg.enabled
      ? [
          `充值即享全场 ${factorToZhe(cfg.factor)}，果切果汁零食通吃`,
          '周周线上活动免费参与，天天弹框领券不错过',
          '充值有礼，余额可整单付款；自定义称重同样享会员价',
          '立减券与会员折同单任选其一，系统自动算更省',
        ]
      : [],
  };
}

/**
 * 会员折 与 立减券互斥（不可同单叠加）
 * - 有可用券：只用券
 * - 无券：用会员折
 * coupon 门槛按原价判断（由 canUseCoupon 负责）
 */
function applyLoyaltyAndCoupon(originalAmount, loyalty, coupon, ctx = {}) {
  const { computeCouponSave } = require('./coupon');
  const original = round2(originalAmount);
  const rate = loyalty && loyalty.rate ? Number(loyalty.rate) : 0;
  const loyaltyOnlySave = rate > 0 ? round2(original * rate) : 0;

  let couponSave = 0;
  let couponId = null;
  let couponLabel = '';
  let discountCode = '';
  if (coupon) {
    couponSave = computeCouponSave(coupon, {
      originalAmount: original,
      unitPrice: ctx.unitPrice,
      product: ctx.product,
    });
    if (couponSave < 0) couponSave = 0;
    if (couponSave > 0) {
      couponId = coupon.id;
      couponLabel = coupon.title || '优惠券';
      discountCode = coupon.templateId || 'coupon';
    }
  }

  // 互斥：用券则不用会员折
  let loyaltySave = 0;
  let appliedRate = 0;
  let loyaltyLabel = '';
  let loyaltyTier = 0;
  if (couponSave > 0) {
    loyaltySave = 0;
  } else {
    loyaltySave = loyaltyOnlySave;
    appliedRate = loyaltySave > 0 ? rate : 0;
    loyaltyLabel = loyaltySave > 0 ? (loyalty && loyalty.label) || '' : '';
    loyaltyTier = loyaltySave > 0 ? (loyalty && loyalty.tier) || 0 : 0;
    couponId = null;
    couponSave = 0;
    couponLabel = '';
    discountCode = appliedRate ? `loyalty_${loyaltyTier}` : '';
  }

  const amount = round2(Math.max(0.01, original - loyaltySave - couponSave));
  const discountAmount = round2(original - amount);
  const discountLabel = couponLabel || loyaltyLabel || '';

  return {
    originalAmount: original,
    amount,
    discountAmount,
    discountRate: appliedRate,
    discountCode,
    discountLabel,
    couponId,
    loyaltyRate: appliedRate,
    loyaltySave,
    loyaltyLabel,
    loyaltyTier,
    monthOrderCount: (loyalty && loyalty.monthCount) || 0,
    couponSave,
  };
}

module.exports = {
  monthRange,
  countMonthPaidOrders,
  loyaltyFromCount,
  getLoyaltyState,
  applyLoyaltyAndCoupon,
  ensureMemberDiscount,
  getMemberDiscountPublic,
  updateMemberDiscount,
  isRechargeMember,
  factorToZhe,
  PAID_STATUSES,
  /** @deprecated 旧开关，现由 settings.memberDiscount.enabled 控制 */
  LOYALTY_ENABLED: true,
};
