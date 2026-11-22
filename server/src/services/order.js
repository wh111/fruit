const crypto = require('crypto');
const { load, save } = require('../db');
const QR = require('./qrcode');
const {
  normalizeFulfillment,
  formatPickupLabel,
  round2,
  categoryAllowsReserve,
  isShopFriday,
  todayKey,
} = require('./promo');
const {
  findCoupon,
  canUseCoupon,
  pickBestCoupon,
  listAvailableForOrder,
  consumeCoupon,
  restoreCouponForOrder,
  hasRecharged,
} = require('./coupon');
const { getLoyaltyState, applyLoyaltyAndCoupon } = require('./loyalty');
const { normalizeDelivery, listDeliveryPoints, getDeliveryScopeNote } = require('./delivery');
const { resolveToppingItems, isFruitBowlOrder } = require('./toppings');
const { resolveSideMeal, categoryAllowsSideMeal } = require('./sideMeals');

/** 仅水果捞可加小料；解析并计价用 */
function resolveOrderToppings(db, product, toppingIds) {
  if (!product || !isFruitBowlOrder({ productCategory: product.category, productName: product.name })) {
    return [];
  }
  return resolveToppingItems(db.toppings, toppingIds || []);
}

const PICKUP_AUTO_DONE_MS = 2 * 60 * 60 * 1000;

function settlePickedOrders(db, now = Date.now()) {
  let changed = 0;
  for (const order of db.orders || []) {
    if (order.status !== 'ready') continue;
    const since = order.readyAt || order.paidAt || order.updatedAt || 0;
    if (!since || now - since < PICKUP_AUTO_DONE_MS) continue;
    order.status = 'done';
    order.doneAt = now;
    order.updatedAt = now;
    order.doneBy = 'auto';
    changed += 1;
  }
  return changed;
}

/** 取餐号全局累加，不按天清零；对齐历史最大号，避免重复 */
function ensurePickupSeq(db) {
  if (!db.seq || typeof db.seq !== 'object') db.seq = { orderDay: '', pickupNo: 0 };
  let max = Number(db.seq.pickupNo) || 0;
  for (const o of db.orders || []) {
    const m = String(o.pickupCode || '').match(/^A(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (max > (Number(db.seq.pickupNo) || 0)) db.seq.pickupNo = max;
  return db.seq;
}

function nextPickupCode(db) {
  const seq = ensurePickupSeq(db);
  seq.pickupNo = (Number(seq.pickupNo) || 0) + 1;
  const n = String(seq.pickupNo).padStart(3, '0');
  return `A${n}`;
}

/** 成品零售：已做好，支付后直接可取，不进果切排队 */
function isNoQueueCategory(category) {
  const c = String(category || '');
  return c === '免洗什锦' || c === '水果零售' || c === '零售什锦';
}

function isNoQueueOrder(order) {
  if (!order) return false;
  if (order.orderKind === 'bulk' || order.orderKind === 'retail') return true;
  if (order.skipQueue) return true;
  return isNoQueueCategory(order.productCategory);
}

/** 称重水果：充值会员 9 折。自定义金额整单按称重计，零售小盒不打折。 */
function isWeighedCategory(category) {
  return category === '称重水果';
}

/** 每位充值会员每周五只送一份，已取消的单不占名额。 */
function fridayGiftUsed(db, userId, now) {
  if (!userId) return false;
  const key = todayKey(now);
  return (db.orders || []).some((o) => {
    if (!o || o.userId !== userId || !o.fridayGift) return false;
    if (o.status === 'cancelled' || o.status === 'refunded') return false;
    return todayKey(o.createdAt || o.paidAt || now) === key;
  });
}

function applyMemberPerks(priced, { db, userId, lines, now, weighedAmount } = {}) {
  const member = !!(userId && hasRecharged(db, userId));
  const weighed =
    weighedAmount != null
      ? round2(weighedAmount)
      : round2(
          (lines || []).reduce(
            (s, l) => s + (isWeighedCategory(l.productCategory) ? Number(l.lineAmount) || 0 : 0),
            0
          )
        );
  let memberSave = member && weighed > 0 ? round2(weighed * 0.1) : 0;
  const before = round2(Number(priced.foodAmount) || 0);
  let foodAmount = round2(Math.max(0, before - memberSave));
  if (before > 0 && foodAmount < 0.01) {
    foodAmount = 0.01;
    memberSave = round2(before - foodAmount);
  }
  const amount = round2(foodAmount + (Number(priced.deliveryFee) || 0));
  const fridayGift =
    member && isShopFriday(now) && foodAmount > 0 && !fridayGiftUsed(db, userId, now)
      ? { name: '精美果切', qty: 1, note: '周五会员消费赠送' }
      : null;
  const canProcess = foodAmount + 0.001 >= 18;
  const memberLabel = memberSave > 0 ? '充值会员称重水果9折' : '';
  const discountLabel = [priced.discountLabel, memberSave > 0 ? `称重9折省¥${memberSave.toFixed(2)}` : '']
    .filter(Boolean)
    .join(' · ');
  return {
    ...priced,
    foodAmount,
    amount,
    memberSave,
    memberLabel,
    discountAmount: round2((Number(priced.discountAmount) || 0) + memberSave),
    discountLabel,
    fridayGift,
    canProcess,
    processNote: canProcess ? '消费满18元可加工' : '',
  };
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
  // 商品原价（不含小料）：折券「原价≤30」按此判断
  const baseUnitPrice = round2(unit);
  // 水果捞小料（独立目录 db.toppings）
  for (const t of promoOpts.toppingItems || []) {
    if (!t || !t.id) continue;
    unit += Number(t.price) || 0;
    extraItems.push({ id: t.id, name: t.name, price: t.price, kind: 'topping' });
  }
  // 健康代餐小食套餐：按单加购一次（不随果杯份数翻倍）
  const sideMeal = promoOpts.sideMeal || null;
  const sideMealPrice = sideMeal && Number(sideMeal.price) > 0 ? round2(sideMeal.price) : 0;
  if (sideMeal && sideMealPrice > 0) {
    extraItems.push({
      id: sideMeal.id,
      name: `小食套餐·${sideMeal.name}`,
      price: sideMealPrice,
      kind: 'sideMeal',
    });
  }
  const qty = Math.max(1, Number(quantity) || 1);
  const unitPrice = round2(unit);
  const originalAmount = round2(unitPrice * qty + sideMealPrice);
  const baseAmount = round2(baseUnitPrice * qty);
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
      baseAmount,
      fulfillmentType,
      now: promoOpts.now || Date.now(),
      product,
      unitPrice,
      baseUnitPrice,
      db: promoOpts.db || null,
    });
    if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });
  }

  // 先加小料得到应付原价，再算折扣（折在含小料总额上）
  const priced = applyLoyaltyAndCoupon(originalAmount, loyalty, coupon, {
    product,
    unitPrice,
  });
  const delivery = normalizeDelivery(promoOpts.deliveryPoint, promoOpts.settings);
  const foodAmount = priced.amount;
  const amount = round2(foodAmount + delivery.deliveryFee);

  return {
    spec,
    extraItems,
    quantity: qty,
    unitPrice,
    baseUnitPrice,
    baseAmount,
    fulfillmentType,
    pickupAt,
    pickupAtText: pickupAt ? formatPickupLabel(pickupAt) : '',
    ...priced,
    foodAmount,
    amount,
    sideMeal: sideMeal || null,
    sideMealPrice,
    ...delivery,
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

function resolveOrderSideMeal(db, products, sideMealSel) {
  if (!sideMealSel || !sideMealSel.proteinId) return null;
  const list = Array.isArray(products) ? products : products ? [products] : [];
  const ok = list.some((p) => p && categoryAllowsSideMeal(db, p.category));
  if (!ok) {
    throw Object.assign(new Error('该商品不可加购小食套餐'), { status: 400 });
  }
  return resolveSideMeal(db, sideMealSel);
}

/** 统一成 items[]；兼容旧单品入参 */
function normalizeOrderItemsInput(input = {}) {
  if (Array.isArray(input.items) && input.items.length) {
    return input.items.map((it) => ({
      productId: it.productId,
      specId: it.specId,
      quantity: Math.max(1, Number(it.quantity) || 1),
      extras: Array.isArray(it.extras) ? it.extras : [],
      toppingIds: Array.isArray(it.toppingIds) ? it.toppingIds : [],
    }));
  }
  if (!input.productId || !input.specId) {
    throw Object.assign(new Error('请选择商品和规格'), { status: 400 });
  }
  return [
    {
      productId: input.productId,
      specId: input.specId,
      quantity: Math.max(1, Number(input.quantity) || 1),
      extras: Array.isArray(input.extras) ? input.extras : [],
      toppingIds: Array.isArray(input.toppingIds) ? input.toppingIds : [],
    },
  ];
}

function assertExtraPick(product, extras) {
  const need = Math.max(0, Number(product && product.extraPick) || 0);
  if (!need) return;
  const allowed = new Set((product.extras || []).map((e) => e && e.id).filter(Boolean));
  const picked = [...new Set((extras || []).filter((id) => allowed.has(id)))];
  if (picked.length !== need) {
    throw Object.assign(new Error(`请自选 ${need} 种水果（已选 ${picked.length}）`), { status: 400 });
  }
}

/** 单行计价（不含小食套餐） */
function priceOrderLine(db, raw) {
  const product = db.products.find((p) => p.id === raw.productId && p.status === 1);
  if (!product) throw Object.assign(new Error('商品不存在'), { status: 404 });
  if (!raw.specId) throw Object.assign(new Error('请选择商品和规格'), { status: 400 });
  assertExtraPick(product, raw.extras || []);
  const toppingItems = resolveOrderToppings(db, product, raw.toppingIds);
  const line = calcAmount(product, raw.specId, raw.extras || [], raw.quantity, {
    toppingItems,
    sideMeal: null,
    settings: db.settings,
    deliveryPoint: 'shop',
    fulfillmentType: 'now',
    loyalty: { monthCount: 0, tier: 0, rate: 0, label: '' },
    coupon: null,
    db,
  });
  const lineExtras = (line.extraItems || []).filter((e) => e && e.kind !== 'sideMeal');
  return {
    productId: product.id,
    productName: product.name,
    productCategory: product.category || '',
    cover: product.cover || '',
    specId: line.spec.id,
    specName: line.spec.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    baseUnitPrice: line.baseUnitPrice,
    lineAmount: round2(line.unitPrice * line.quantity),
    baseAmount: line.baseAmount,
    extras: lineExtras,
    toppings: toppingItems,
    product,
  };
}

function summarizeCartLines(lines) {
  const categories = [...new Set(lines.map((l) => l.productCategory).filter(Boolean))];
  const allRetail = lines.every((l) => isNoQueueCategory(l.productCategory));
  const productName = lines
    .map((l) => `${l.productName}${l.quantity > 1 ? `×${l.quantity}` : ''}`)
    .join('、');
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const first = lines[0];
  return {
    productName: productName || first.productName,
    productCategory: categories.length === 1 ? categories[0] : '混合',
    cover: first.cover || '',
    productId: lines.length === 1 ? first.productId : 'cart',
    specId: lines.length === 1 ? first.specId : 'multi',
    specName:
      lines.length === 1
        ? first.specName
        : lines.map((l) => `${l.specName}×${l.quantity}`).join('、'),
    quantity: totalQty,
    unitPrice: lines.length === 1 ? first.unitPrice : round2(lines.reduce((s, l) => s + l.lineAmount, 0) / Math.max(1, totalQty)),
    skipQueue: allRetail,
    orderKind: allRetail ? 'retail' : 'normal',
    categories,
    primaryProduct: lines.find((l) => !isNoQueueCategory(l.productCategory))?.product || first.product,
  };
}

function calcCartAmount(lines, promoOpts = {}) {
  const summary = summarizeCartLines(lines);
  const foodLines = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const baseAmount = round2(lines.reduce((s, l) => s + l.baseAmount, 0));
  const sideMeal = promoOpts.sideMeal || null;
  const sideMealPrice = sideMeal && Number(sideMeal.price) > 0 ? round2(sideMeal.price) : 0;
  const originalAmount = round2(foodLines + sideMealPrice);

  const extraItems = [];
  for (const l of lines) {
    for (const e of l.extras || []) {
      if (!e) continue;
      extraItems.push({ ...e, productId: l.productId, productName: l.productName });
    }
  }
  if (sideMeal && sideMealPrice > 0) {
    extraItems.push({
      id: sideMeal.id,
      name: `小食套餐·${sideMeal.name}`,
      price: sideMealPrice,
      kind: 'sideMeal',
    });
  }

  const fulfillmentType = promoOpts.fulfillmentType === 'reserve' ? 'reserve' : 'now';
  const pickupAt = fulfillmentType === 'reserve' ? promoOpts.pickupAt || null : null;
  const loyalty = promoOpts.loyalty || { monthCount: 0, tier: 0, rate: 0, label: '' };
  const product = summary.primaryProduct;
  const unitPrice = summary.unitPrice;
  const baseUnitPrice = round2(baseAmount / Math.max(1, summary.quantity));

  let coupon = promoOpts.coupon || null;
  if (coupon) {
    const check = canUseCoupon(coupon, {
      originalAmount,
      baseAmount,
      fulfillmentType,
      now: promoOpts.now || Date.now(),
      product,
      unitPrice,
      baseUnitPrice,
      db: promoOpts.db || null,
    });
    if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });
  }

  const priced = applyLoyaltyAndCoupon(originalAmount, loyalty, coupon, {
    product,
    unitPrice,
  });
  const delivery = normalizeDelivery(promoOpts.deliveryPoint, promoOpts.settings);
  const foodAmount = priced.amount;
  const amount = round2(foodAmount + delivery.deliveryFee);

  return {
    items: lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      productCategory: l.productCategory,
      cover: l.cover,
      specId: l.specId,
      specName: l.specName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineAmount: l.lineAmount,
      extras: l.extras,
      toppings: l.toppings,
    })),
    extraItems,
    toppings: lines.flatMap((l) => l.toppings || []),
    quantity: summary.quantity,
    unitPrice: summary.unitPrice,
    baseUnitPrice,
    baseAmount,
    fulfillmentType,
    pickupAt,
    pickupAtText: pickupAt ? formatPickupLabel(pickupAt) : '',
    ...priced,
    foodAmount,
    amount,
    sideMeal: sideMeal || null,
    sideMealPrice,
    productId: summary.productId,
    productName: summary.productName,
    productCategory: summary.productCategory,
    cover: summary.cover,
    specId: summary.specId,
    specName: summary.specName,
    skipQueue: summary.skipQueue,
    orderKind: summary.orderKind,
    primaryProduct: product,
    ...delivery,
  };
}

function assertReserveAllowed(db, lines, fulfillment) {
  if (fulfillment.fulfillmentType !== 'reserve') return;
  const bad = lines.find((l) => !categoryAllowsReserve(db, l.productCategory));
  if (bad) {
    throw Object.assign(new Error(`「${bad.productName}」不支持预定，请改为现作现取`), { status: 400 });
  }
}

async function quoteOrder(input = {}) {
  const db = await load();
  const rawItems = normalizeOrderItemsInput(input);
  const lines = rawItems.map((it) => priceOrderLine(db, it));
  const now = Date.now();
  const fulfillment = normalizeFulfillment({
    fulfillmentType: input.fulfillmentType,
    pickupAt: input.pickupAt,
    now,
  });
  assertReserveAllowed(db, lines, fulfillment);

  const loyalty = resolveLoyalty(db, { userId: input.userId, openid: input.openid, now });
  const products = lines.map((l) => l.product);
  const sideMeal = resolveOrderSideMeal(db, products, input.sideMeal);

  const bare = calcCartAmount(lines, {
    ...fulfillment,
    deliveryPoint: input.deliveryPoint,
    now,
    loyalty,
    settings: db.settings,
    sideMeal,
    db,
  });

  let coupon = null;
  if (input.couponId === '' || input.couponId === null) {
    coupon = null;
  } else if (input.couponId) {
    coupon = findCoupon(db, input.couponId, input.userId);
    if (!coupon) throw Object.assign(new Error('优惠券不存在'), { status: 400 });
  } else if (input.autoCoupon !== false && input.userId) {
    coupon = pickBestCoupon(db, input.userId, {
      originalAmount: bare.originalAmount,
      baseAmount: bare.baseAmount,
      fulfillmentType: fulfillment.fulfillmentType,
      now,
      product: bare.primaryProduct,
      unitPrice: bare.unitPrice,
      baseUnitPrice: bare.baseUnitPrice,
      db,
    });
  }

  const priced = applyMemberPerks(
    calcCartAmount(lines, {
      ...fulfillment,
      deliveryPoint: input.deliveryPoint,
      now,
      coupon,
      loyalty,
      settings: db.settings,
      sideMeal,
      db,
    }),
    { db, userId: input.userId, lines, now }
  );
  const availableCoupons = input.userId
    ? listAvailableForOrder(db, input.userId, {
        originalAmount: bare.originalAmount,
        baseAmount: bare.baseAmount,
        fulfillmentType: fulfillment.fulfillmentType,
        now,
        afterLoyaltyAmount: round2(bare.originalAmount - (priced.loyaltySave || 0)),
        product: bare.primaryProduct,
        unitPrice: bare.unitPrice,
        baseUnitPrice: bare.baseUnitPrice,
        db,
      })
    : [];

  return {
    ...priced,
    deliveryPoints: listDeliveryPoints(db.settings),
    deliveryScopeNote: getDeliveryScopeNote(db.settings),
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

async function createOrder(input = {}) {
  const db = await load();
  const rawItems = normalizeOrderItemsInput(input);
  const lines = rawItems.map((it) => priceOrderLine(db, it));
  const now = Date.now();
  const fulfillment = normalizeFulfillment({
    fulfillmentType: input.fulfillmentType,
    pickupAt: input.pickupAt,
    now,
  });
  assertReserveAllowed(db, lines, fulfillment);

  const loyalty = resolveLoyalty(db, { userId: input.userId, openid: input.openid, now });
  const products = lines.map((l) => l.product);
  const sideMeal = resolveOrderSideMeal(db, products, input.sideMeal);

  const bare = calcCartAmount(lines, {
    ...fulfillment,
    deliveryPoint: input.deliveryPoint,
    now,
    loyalty,
    settings: db.settings,
    sideMeal,
    db,
  });

  let coupon = null;
  if (input.couponId === '' || input.couponId === null) {
    coupon = null;
  } else if (input.couponId) {
    coupon = findCoupon(db, input.couponId, input.userId);
    if (!coupon) throw Object.assign(new Error('优惠券不存在'), { status: 400 });
  } else if (input.autoCoupon !== false && input.userId) {
    coupon = pickBestCoupon(db, input.userId, {
      originalAmount: bare.originalAmount,
      baseAmount: bare.baseAmount,
      fulfillmentType: fulfillment.fulfillmentType,
      now,
      product: bare.primaryProduct,
      unitPrice: bare.unitPrice,
      baseUnitPrice: bare.baseUnitPrice,
      db,
    });
  }

  const priced = applyMemberPerks(
    calcCartAmount(lines, {
      ...fulfillment,
      deliveryPoint: input.deliveryPoint,
      now,
      coupon,
      loyalty,
      settings: db.settings,
      sideMeal,
      db,
    }),
    { db, userId: input.userId, lines, now }
  );

  const order = {
    id: crypto.randomUUID(),
    orderNo: `SG${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
    userId: input.userId || null,
    openid: input.openid || null,
    orderKind: priced.orderKind,
    productCategory: priced.productCategory,
    skipQueue: priced.skipQueue,
    productId: priced.productId,
    productName: priced.productName,
    cover: priced.cover,
    specId: priced.specId,
    specName: priced.specName,
    items: priced.items,
    extras: priced.extraItems,
    toppings: priced.toppings,
    sideMeal: priced.sideMeal || null,
    quantity: priced.quantity,
    unitPrice: priced.unitPrice,
    originalAmount: priced.originalAmount,
    foodAmount: priced.foodAmount,
    amount: priced.amount,
    deliveryFee: priced.deliveryFee,
    deliveryPoint: priced.deliveryPoint,
    deliveryPointName: priced.deliveryPointName,
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
    memberSave: priced.memberSave || 0,
    memberLabel: priced.memberLabel || '',
    fridayGift: priced.fridayGift || null,
    canProcess: !!priced.canProcess,
    processNote: priced.processNote || '',
    fulfillmentType: priced.fulfillmentType,
    pickupAt: priced.pickupAt,
    pickupAtText: priced.pickupAtText,
    remark: input.remark || '',
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
    consumeCoupon(db, priced.couponId, order.id, input.userId);
  }

  db.orders.unshift(order);
  await save(db);
  return order;
}

/** 自定义金额：散装称重。充值会员 9 折；周五会员消费赠果切；满 18 元可加工。 */
async function createBulkOrder({ userId, openid, amount, remark }) {
  const yuan = round2(Number(amount));
  if (!Number.isFinite(yuan) || yuan < 0.01) {
    throw Object.assign(new Error('请输入有效金额（最少 0.01 元）'), { status: 400 });
  }
  if (yuan > 999.99) {
    throw Object.assign(new Error('单笔金额不能超过 999.99 元'), { status: 400 });
  }

  const db = await load();
  const now = Date.now();
  const delivery = normalizeDelivery('shop', db.settings);
  const note = String(remark || '').trim().slice(0, 80);
  const priced = applyMemberPerks(
    {
      foodAmount: yuan,
      amount: yuan,
      deliveryFee: 0,
      discountAmount: 0,
      discountLabel: '',
      originalAmount: yuan,
    },
    { db, userId, lines: [], now, weighedAmount: yuan }
  );

  const order = {
    id: crypto.randomUUID(),
    orderNo: `SG${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
    userId: userId || null,
    openid: openid || null,
    orderKind: 'bulk',
    productId: 'bulk',
    productName: '自定义金额',
    cover: '',
    specId: 'bulk',
    specName: '自定义',
    extras: [],
    quantity: 1,
    unitPrice: yuan,
    originalAmount: yuan,
    foodAmount: priced.foodAmount,
    amount: priced.amount,
    deliveryFee: 0,
    deliveryPoint: delivery.deliveryPoint,
    deliveryPointName: delivery.deliveryPointName,
    discountAmount: priced.discountAmount || 0,
    discountRate: priced.memberSave > 0 ? 0.9 : 1,
    discountCode: priced.memberSave > 0 ? 'member_weigh_9' : null,
    discountLabel: priced.discountLabel || '',
    couponId: null,
    couponSave: 0,
    loyaltyRate: 0,
    loyaltySave: 0,
    loyaltyLabel: '',
    loyaltyTier: 0,
    monthOrderCount: 0,
    memberSave: priced.memberSave || 0,
    memberLabel: priced.memberLabel || '',
    fridayGift: priced.fridayGift || null,
    canProcess: !!priced.canProcess,
    processNote: priced.processNote || '',
    fulfillmentType: 'now',
    pickupAt: null,
    pickupAtText: '',
    remark: note,
    status: 'pending_pay',
    pickupCode: null,
    qrPayload: null,
    payMode: null,
    transactionId: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };

  db.orders.unshift(order);
  await save(db);
  return order;
}

async function markPaid(orderId, { transactionId, payMode, payChannel, balancePaid } = {}) {
  const db = await load();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
  if (['paid', 'making', 'ready', 'done'].includes(order.status)) return order;
  if (order.status !== 'pending_pay') {
    throw Object.assign(new Error('订单状态不可支付'), { status: 400 });
  }

  const pickupCode = nextPickupCode(db);
  // 自定义金额 / 水果零售成品：支付后直接可取，不进果切排队
  order.status = isNoQueueOrder(order) ? 'ready' : 'paid';
  order.pickupCode = pickupCode;
  order.qrPayload = JSON.stringify({ t: 'sijiguoxian', orderNo: order.orderNo, pickupCode });
  order.transactionId = transactionId || `MOCK${Date.now()}`;
  order.payMode = payMode || process.env.PAY_MODE || 'mock';
  if (payChannel) order.payChannel = payChannel;
  if (balancePaid != null) order.balancePaid = Number(balancePaid) || 0;
  order.paidAt = Date.now();
  order.printed = false;
  order.updatedAt = Date.now();
  try {
    const { touchOrderPaid } = require('./users');
    touchOrderPaid(db, order, order.paidAt);
  } catch {
    /* ignore */
  }
  // 支付成功占用现烤剩余；请取餐/取消后再释放
  if (order.sideMeal) {
    try {
      const { consumeSideMealStock } = require('./sideMeals');
      consumeSideMealStock(db, order);
    } catch (e) {
      if (e && e.status === 400) throw e;
    }
  }
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
  try {
    const { restoreSideMealStock } = require('./sideMeals');
    restoreSideMealStock(db, order);
  } catch {
    /* ignore */
  }
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
    const noQueue = isNoQueueOrder(order);
    return {
      phase: 'pending_pay',
      title: '待支付',
      tip: noQueue ? '支付后即可取货，无需排队制作' : '请完成支付后进入排队',
      ahead: null,
      position: null,
      steps: [
        { key: 'pay', label: '下单支付', done: false, current: true },
        { key: 'queue', label: noQueue ? '成品备货' : '排队制作', done: false, current: false },
        { key: 'ready', label: noQueue ? '取货' : '取餐', done: false, current: false },
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
    const code = order.pickupCode || '';
    if (order.orderKind === 'bulk') {
      return {
        phase: 'ready',
        title: '已支付',
        tip: `取货号 ${code}，到柜台报号即可`,
        ahead: 0,
        position: 0,
        steps: [
          { key: 'pay', label: '下单支付', done: true, current: false },
          { key: 'queue', label: '称重计价', done: true, current: false },
          { key: 'ready', label: '取货', done: false, current: true },
        ],
      };
    }
    if (isNoQueueOrder(order)) {
      return {
        phase: 'ready',
        title: '请取货',
        tip: `成品已备好，取货号 ${code}，到柜台报号对一下即可`,
        ahead: 0,
        position: 0,
        steps: [
          { key: 'pay', label: '下单支付', done: true, current: false },
          { key: 'queue', label: '成品备货', done: true, current: false },
          { key: 'ready', label: '取货', done: false, current: true },
        ],
      };
    }
    const locker =
      order.deliveryPoint && order.deliveryPoint !== 'shop'
        ? order.deliveryPointName || '外卖柜'
        : null;
    return {
      phase: 'ready',
      title: locker ? '已投柜，请取餐' : '请取餐',
      tip: locker
        ? `已放入「${locker}」，取餐号 ${code}。取餐时请核对取餐号。`
        : `取餐号 ${code}，到柜台报号，店员对一下即可`,
      ahead: 0,
      position: 0,
      steps: [
        { key: 'pay', label: '下单支付', done: true, current: false },
        { key: 'queue', label: '排队制作', done: true, current: false },
        { key: 'ready', label: locker ? '投柜取餐' : '取餐', done: false, current: true },
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
        ? `已排入 ${when} 批次，取餐前40分钟内现切（取餐号 ${order.pickupCode || ''}）`
        : `已预约，取餐前40分钟内现切（取餐号 ${order.pickupCode || ''}）`,
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
    if (isNoQueueOrder(o)) return false;
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
      ? `师傅正在制作您的果切（取餐号 ${order.pickupCode}）${batchTip}`
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
  createBulkOrder,
  quoteOrder,
  markPaid,
  cancelPendingOrder,
  orderQrDataUrl,
  calcAmount,
  nextPickupCode,
  settlePickedOrders,
  getQueueInfo,
  isNoQueueCategory,
  isNoQueueOrder,
  restoreCouponForOrder,
};
