const crypto = require('crypto');
const { load, save } = require('../db');
const QR = require('./qrcode');
const {
  todayKey,
  normalizeFulfillment,
  formatPickupLabel,
  round2,
} = require('./promo');
const {
  findCoupon,
  canUseCoupon,
  pickBestCoupon,
  listAvailableForOrder,
  consumeCoupon,
  restoreCouponForOrder,
} = require('./coupon');
const { getLoyaltyState, applyLoyaltyAndCoupon } = require('./loyalty');

function nextPickupCode(db) {
  const key = todayKey();
  if (db.seq.orderDay !== key) {
    db.seq.orderDay = key;
    db.seq.pickupNo = 0;
  }
  db.seq.pickupNo += 1;
  const n = String(db.seq.pickupNo).padStart(3, '0');
  return `A${n}`;
}

function calcAmount(product, specId, extras = [], quantity = 1, promoOpts = {}) {
  const spec = (product.specs || []).find((s) => s.id === specId);
  if (!spec) throw Object.assign(new Error('规格无效'), { status: 400 });
  let unit = Number(spec.price);
  const extraItems = [];
  for (const eid of extras) {
    const ex = (product.extras || []).find((e) => e.id === eid);
    if (ex) {
      unit += Number(ex.price);
      extraItems.push({ id: ex.id, name: ex.name, price: ex.price });
    }
  }
  const qty = Math.max(1, Number(quantity) || 1);
  const unitPrice = round2(unit);
  const originalAmount = round2(unitPrice * qty);
  const fulfillmentType = promoOpts.fulfillmentType === 'reserve' ? 'reserve' : 'now';
  const pickupAt = fulfillmentType === 'reserve' ? promoOpts.pickupAt || null : null;

  const loyalty = promoOpts.loyalty || {
    monthCount: 0,
    tier: 0,
    rate: 0,
    label: '',
  };

  let coupon = promoOpts.coupon || null;
  if (coupon) {
    const check = canUseCoupon(coupon, {
      originalAmount,
      fulfillmentType,
      now: promoOpts.now || Date.now(),
    });
    if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });
  }

  const priced = applyLoyaltyAndCoupon(originalAmount, loyalty, coupon);

  return {
    spec,
    extraItems,
    quantity: qty,
    unitPrice,
    fulfillmentType,
    pickupAt,
    pickupAtText: pickupAt ? formatPickupLabel(pickupAt) : '',
    ...priced,
  };
}

function resolveLoyalty(db, { userId, openid, now }) {
  if (!userId && !openid) {
    return {
      monthPaid: 0,
      monthCount: 1,
      tier: 0,
      rate: 0,
      label: '',
      shortLabel: '',
      nextHint: '登录后累计月单量可享 95/9 折',
      rules: [],
    };
  }
  return getLoyaltyState(db, { userId, openid, now, includeCurrent: true });
}

async function quoteOrder({
  productId,
  specId,
  extras,
  quantity,
  fulfillmentType,
  pickupAt,
  couponId,
  userId,
  openid,
  autoCoupon = true,
}) {
  const db = await load();
  const product = db.products.find((p) => p.id === productId && p.status === 1);
  if (!product) throw Object.assign(new Error('商品不存在'), { status: 404 });
  if (!productId || !specId) throw Object.assign(new Error('请选择商品和规格'), { status: 400 });
  const now = Date.now();
  const fulfillment = normalizeFulfillment({ fulfillmentType, pickupAt, now });
  const loyalty = resolveLoyalty(db, { userId, openid, now });

  const bare = calcAmount(product, specId, extras || [], quantity, {
    ...fulfillment,
    now,
    loyalty,
  });

  let coupon = null;
  if (couponId === '' || couponId === null) {
    coupon = null;
  } else if (couponId) {
    coupon = findCoupon(db, couponId, userId);
    if (!coupon) throw Object.assign(new Error('优惠券不存在'), { status: 400 });
  } else if (autoCoupon && userId) {
    coupon = pickBestCoupon(db, userId, {
      originalAmount: bare.originalAmount,
      fulfillmentType: fulfillment.fulfillmentType,
      now,
    });
  }

  const priced = calcAmount(product, specId, extras || [], quantity, {
    ...fulfillment,
    now,
    coupon,
    loyalty,
  });
  const availableCoupons = userId
    ? listAvailableForOrder(db, userId, {
        originalAmount: bare.originalAmount,
        fulfillmentType: fulfillment.fulfillmentType,
        now,
        afterLoyaltyAmount: round2(bare.originalAmount - (priced.loyaltySave || 0)),
      })
    : [];

  return {
    ...priced,
    availableCoupons,
    selectedCouponId: priced.couponId || null,
    loyalty: {
      monthPaid: loyalty.monthPaid,
      monthCount: loyalty.monthCount,
      tier: loyalty.tier,
      rate: loyalty.rate,
      label: loyalty.label,
      shortLabel: loyalty.shortLabel,
      nextHint: loyalty.nextHint || '',
      rules: loyalty.rules || [],
    },
  };
}

async function createOrder({
  userId,
  openid,
  productId,
  specId,
  extras,
  quantity,
  remark,
  fulfillmentType,
  pickupAt,
  couponId,
  autoCoupon = true,
}) {
  const db = await load();
  const product = db.products.find((p) => p.id === productId && p.status === 1);
  if (!product) throw Object.assign(new Error('商品不存在'), { status: 404 });
  if (!productId || !specId) throw Object.assign(new Error('请选择商品和规格'), { status: 400 });

  const now = Date.now();
  const fulfillment = normalizeFulfillment({ fulfillmentType, pickupAt, now });
  const loyalty = resolveLoyalty(db, { userId, openid, now });
  const bare = calcAmount(product, specId, extras || [], quantity, {
    ...fulfillment,
    now,
    loyalty,
  });

  let coupon = null;
  if (couponId === '' || couponId === null) {
    coupon = null;
  } else if (couponId) {
    coupon = findCoupon(db, couponId, userId);
    if (!coupon) throw Object.assign(new Error('优惠券不存在'), { status: 400 });
  } else if (autoCoupon && userId) {
    coupon = pickBestCoupon(db, userId, {
      originalAmount: bare.originalAmount,
      fulfillmentType: fulfillment.fulfillmentType,
      now,
    });
  }

  const priced = calcAmount(product, specId, extras || [], quantity, {
    ...fulfillment,
    now,
    coupon,
    loyalty,
  });

  const order = {
    id: crypto.randomUUID(),
    orderNo: `SG${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
    userId: userId || null,
    openid: openid || null,
    productId: product.id,
    productName: product.name,
    cover: product.cover,
    specId: priced.spec.id,
    specName: priced.spec.name,
    extras: priced.extraItems,
    quantity: priced.quantity,
    unitPrice: priced.unitPrice,
    originalAmount: priced.originalAmount,
    amount: priced.amount,
    discountAmount: priced.discountAmount,
    discountRate: priced.discountRate,
    discountCode: priced.discountCode,
    discountLabel: priced.discountLabel,
    couponId: priced.couponId || null,
    couponSave: priced.couponSave || 0,
    loyaltyRate: priced.loyaltyRate || 0,
    loyaltySave: priced.loyaltySave || 0,
    loyaltyLabel: priced.loyaltyLabel || '',
    loyaltyTier: priced.loyaltyTier || 0,
    monthOrderCount: priced.monthOrderCount || 0,
    fulfillmentType: priced.fulfillmentType,
    pickupAt: priced.pickupAt,
    pickupAtText: priced.pickupAtText,
    remark: remark || '',
    status: 'pending_pay',
    pickupCode: null,
    qrPayload: null,
    payMode: null,
    transactionId: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (priced.couponId) {
    consumeCoupon(db, priced.couponId, order.id, userId);
  }

  db.orders.unshift(order);
  await save(db);
  return order;
}

async function markPaid(orderId, { transactionId, payMode } = {}) {
  const db = await load();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (['paid', 'making', 'ready', 'done'].includes(order.status)) return order;
  if (order.status !== 'pending_pay') {
    throw Object.assign(new Error('订单状态不可支付'), { status: 400 });
  }

  const pickupCode = nextPickupCode(db);
  order.status = 'paid';
  order.pickupCode = pickupCode;
  order.qrPayload = JSON.stringify({ t: 'sijiguoxian', orderNo: order.orderNo, pickupCode });
  order.transactionId = transactionId || `MOCK${Date.now()}`;
  order.payMode = payMode || process.env.PAY_MODE || 'mock';
  order.paidAt = Date.now();
  order.printed = false;
  order.updatedAt = Date.now();
  await save(db);
  return order;
}

async function cancelPendingOrder(orderId, user) {
  const db = await load();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (order.status !== 'pending_pay') {
    throw Object.assign(new Error('仅未支付订单可取消'), { status: 400 });
  }
  if (user?.userId && order.userId && order.userId !== user.userId) {
    throw Object.assign(new Error('无权取消该订单'), { status: 403 });
  }
  restoreCouponForOrder(db, order);
  order.status = 'cancelled';
  order.updatedAt = Date.now();
  await save(db);
  return order;
}

async function orderQrDataUrl(order) {
  return QR.toDataURL(order.qrPayload || order.orderNo || order.pickupCode);
}

/**
 * 顾客端排队进度
 * ahead: 前面还有几单（不含自己）
 * position: 当前排第几（1=正在做/下一位）
 */
function getQueueInfo(order, db) {
  if (!order) return null;
  const status = order.status;

  if (status === 'pending_pay') {
    return {
      phase: 'pending_pay',
      title: '待支付',
      tip: '请完成支付后进入排队',
      ahead: null,
      position: null,
      steps: [
        { key: 'pay', label: '下单支付', done: false, current: true },
        { key: 'queue', label: '排队制作', done: false, current: false },
        { key: 'ready', label: '取餐', done: false, current: false },
      ],
    };
  }

  if (status === 'cancelled' || status === 'refunded') {
    return {
      phase: status,
      title: status === 'cancelled' ? '已取消' : '已退款',
      tip: '',
      ahead: null,
      position: null,
      steps: [],
    };
  }

  if (status === 'done') {
    return {
      phase: 'done',
      title: '已取餐',
      tip: '感谢光临，欢迎再来',
      ahead: 0,
      position: 0,
      steps: [
        { key: 'pay', label: '下单支付', done: true, current: false },
        { key: 'queue', label: '排队制作', done: true, current: false },
        { key: 'ready', label: '取餐', done: true, current: false },
      ],
    };
  }

  if (status === 'ready') {
    return {
      phase: 'ready',
      title: '请取餐',
      tip: `取餐码 ${order.pickupCode}，请到柜台出示`,
      ahead: 0,
      position: 0,
      steps: [
        { key: 'pay', label: '下单支付', done: true, current: false },
        { key: 'queue', label: '排队制作', done: true, current: false },
        { key: 'ready', label: '取餐', done: false, current: true },
      ],
    };
  }

  const isReserveWaiting = order.fulfillmentType === 'reserve' && status === 'paid';
  if (isReserveWaiting) {
    const when = order.pickupAtText || formatPickupLabel(order.pickupAt);
    return {
      phase: 'reserved',
      title: '已预约',
      tip: when
        ? `已排入 ${when} 批次，取餐前 1 小时内现切（取餐码 ${order.pickupCode || ''}）`
        : `已预约，取餐前 1 小时内现切（取餐码 ${order.pickupCode || ''}）`,
      ahead: null,
      position: null,
      pickupAt: order.pickupAt || null,
      pickupAtText: when,
      steps: [
        { key: 'pay', label: '下单支付', done: true, current: false },
        { key: 'queue', label: '预约制作', done: false, current: true },
        { key: 'ready', label: '取餐', done: false, current: false },
      ],
    };
  }

  const paidAt = order.paidAt || order.createdAt || 0;
  const active = (db.orders || []).filter((o) => {
    if (o.status === 'making') return true;
    if (o.status !== 'paid') return false;
    return o.fulfillmentType !== 'reserve';
  });
  const aheadList = active.filter((o) => {
    if (o.id === order.id) return false;
    const t = o.paidAt || o.createdAt || 0;
    return t < paidAt || (t === paidAt && String(o.orderNo) < String(order.orderNo));
  });
  const ahead = aheadList.length;
  const position = ahead + 1;
  const making = status === 'making';
  const batchCodes = (order.makeBatchCodes || []).filter((c) => c && c !== order.pickupCode);
  const batchTip =
    making && batchCodes.length
      ? `（与 ${batchCodes.join('、')} 一同制作）`
      : '';

  return {
    phase: making ? 'making' : 'queued',
    title: making ? '正在制作' : '排队中',
    tip: making
      ? `师傅正在制作您的果切（取餐码 ${order.pickupCode}）${batchTip}`
      : ahead === 0
        ? '马上轮到您，请稍候'
        : `前面还有 ${ahead} 单，您排第 ${position} 位`,
    ahead,
    position,
    queueTotal: active.length,
    makeBatchId: order.makeBatchId || null,
    makeBatchCodes: order.makeBatchCodes || [],
    steps: [
      { key: 'pay', label: '下单支付', done: true, current: false },
      { key: 'queue', label: making ? '制作中' : '排队制作', done: false, current: true },
      { key: 'ready', label: '取餐', done: false, current: false },
    ],
  };
}

module.exports = {
  createOrder,
  quoteOrder,
  markPaid,
  cancelPendingOrder,
  orderQrDataUrl,
  calcAmount,
  nextPickupCode,
  getQueueInfo,
  restoreCouponForOrder,
};
