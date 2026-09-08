/**
 * 月累计下单折扣（Asia/Shanghai 自然月）
 * - 本月 ≥3 单：95 折
 * - 本月 ≥10 单：9 折
 * 可与立减券叠加：先打折再减券
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

/** 本月已支付成功的单数（不含未支付/取消/退款） */
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

/**
 * @param {number} monthPaidCount 本月已完成支付单数（不含当前这笔）
 * @param {{ includeCurrent?: boolean }} opts 计价时默认把当前单算进去
 */
function loyaltyFromCount(monthPaidCount, { includeCurrent = true } = {}) {
  const n = Math.max(0, Number(monthPaidCount) || 0) + (includeCurrent ? 1 : 0);
  if (n >= 10) {
    return {
      monthCount: n,
      tier: 10,
      rate: 0.1,
      factor: 0.9,
      label: '本月满10单 · 9折',
      shortLabel: '月满10单9折',
    };
  }
  if (n >= 3) {
    return {
      monthCount: n,
      tier: 3,
      rate: 0.05,
      factor: 0.95,
      label: '本月满3单 · 95折',
      shortLabel: '月满3单95折',
    };
  }
  return {
    monthCount: n,
    tier: 0,
    rate: 0,
    factor: 1,
    label: '',
    shortLabel: '',
    nextHint:
      n >= 2
        ? `再下 ${3 - n} 单可享本月 95 折`
        : `本月再下 ${3 - n} 单可享 95 折`,
  };
}

function getLoyaltyState(db, { userId, openid, now = Date.now(), includeCurrent = true } = {}) {
  const paid = countMonthPaidOrders(db, { userId, openid, now });
  const loyalty = loyaltyFromCount(paid, { includeCurrent });
  const range = monthRange(now);
  return {
    monthKey: range.key,
    monthPaid: paid,
    ...loyalty,
    rules: [
      '自然月累计：满 3 单享 95 折，满 10 单享 9 折',
      '以支付成功订单为准，取消/未支付不计',
      '可与立减券叠加：先打折，再减券',
    ],
  };
}

/**
 * 先月折，再减券
 * coupon 门槛仍按原价判断（由 canUseCoupon 负责）
 */
function applyLoyaltyAndCoupon(originalAmount, loyalty, coupon) {
  const original = round2(originalAmount);
  const rate = loyalty && loyalty.rate ? Number(loyalty.rate) : 0;
  const loyaltySave = rate > 0 ? round2(original * rate) : 0;
  const afterLoyalty = round2(Math.max(0.01, original - loyaltySave));

  let couponSave = 0;
  let couponId = null;
  let couponLabel = '';
  let discountCode = '';
  if (coupon) {
    couponSave = round2(Math.min(Number(coupon.amount) || 0, afterLoyalty - 0.01));
    if (couponSave < 0) couponSave = 0;
    couponId = coupon.id;
    couponLabel = coupon.title || '优惠券';
    discountCode = coupon.templateId || 'coupon';
  }

  const amount = round2(Math.max(0.01, afterLoyalty - couponSave));
  const discountAmount = round2(original - amount);

  const parts = [];
  if (loyaltySave > 0 && loyalty && loyalty.label) parts.push(loyalty.label);
  if (couponSave > 0 && couponLabel) parts.push(couponLabel);

  return {
    originalAmount: original,
    amount,
    discountAmount,
    discountRate: rate,
    discountCode: discountCode || (rate ? `loyalty_${loyalty.tier}` : ''),
    discountLabel: parts.join(' + ') || '',
    couponId,
    loyaltyRate: rate,
    loyaltySave,
    loyaltyLabel: (loyalty && loyalty.label) || '',
    loyaltyTier: (loyalty && loyalty.tier) || 0,
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
  PAID_STATUSES,
};
