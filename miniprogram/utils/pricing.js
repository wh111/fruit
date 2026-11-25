/** 客户端展示用计价（划线价 / 优惠价）；下单仍以服务端为准 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatPrice(n) {
  const v = round2(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function memberFactorFromPromo(promo) {
  const loyalty = (promo && promo.loyalty) || {};
  const md = (promo && promo.memberDiscount) || {};
  const isMember = !!(loyalty.isMember || loyalty.memberDiscount);
  let factor = 1;
  if (isMember) {
    if (loyalty.factor > 0 && loyalty.factor < 1) factor = Number(loyalty.factor);
    else if (md.factor > 0 && md.factor < 1) factor = Number(md.factor);
    else if (loyalty.rate > 0 && loyalty.rate < 1) factor = round2(1 - Number(loyalty.rate));
    else factor = 0.9;
  }
  return {
    isMember,
    factor: round2(factor),
    label: loyalty.label || md.label || (isMember ? '会员价' : ''),
  };
}

function applyFactor(amount, factor) {
  const origin = round2(amount);
  const f = Number(factor);
  if (!(f > 0) || f >= 1) {
    return { origin, sale: origin, save: 0, discounted: false };
  }
  let sale = round2(origin * f);
  if (origin > 0 && sale < 0.01) sale = 0.01;
  const save = round2(origin - sale);
  return { origin, sale, save, discounted: save > 0 };
}

/**
 * 从「我的券」里挑对本商品最省的一张（仅 unused）
 * coupon 需含 amount / allowedProductIds / matchCategory / status
 */
function bestCouponSave(coupons, { productId, category, originAmount }) {
  const origin = round2(originAmount);
  let best = null;
  for (const c of coupons || []) {
    if (!c || c.status !== 'unused') continue;
    if (c.fulfillment === 'reserve') continue;
    const threshold = Number(c.threshold) || 0;
    const ids = c.allowedProductIds || [];
    const pack = String(c.pack || '');
    const isPromoPack = pack === 'cane_promo' || pack === 'fruit_retail_off';
    // 活动券满额需另购其他商品：单品页本身是优惠商品时，不按「3.8/3.88」展示
    if (isPromoPack && threshold > 0) {
      if (ids.length && ids.map(String).includes(String(productId))) continue;
      if (c.matchCategory) {
        const cat = String(category || '');
        const want = String(c.matchCategory);
        const retailLike =
          want === '水果零售' || want === '免洗什锦' || want === '零售什锦';
        if (retailLike && (cat === '水果零售' || cat === '免洗什锦' || cat === '零售什锦')) {
          continue;
        }
      }
    } else if (origin + 1e-9 < threshold) {
      continue;
    }
    if (ids.length) {
      if (!ids.map(String).includes(String(productId))) continue;
    } else if (c.matchCategory) {
      const cat = String(category || '');
      const want = String(c.matchCategory);
      const retailLike =
        want === '水果零售' || want === '免洗什锦' || want === '零售什锦';
      if (retailLike) {
        if (!(cat === '水果零售' || cat === '免洗什锦' || cat === '零售什锦')) continue;
      } else if (cat !== want) continue;
    }
    let save = 0;
    if (c.type === 'flat' || c.amount != null) {
      save = Math.min(origin - 0.01, round2(Number(c.amount) || 0));
    } else if (c.type === 'percent' && c.discountFactor > 0 && c.discountFactor < 1) {
      save = round2(origin * (1 - Number(c.discountFactor)));
    }
    if (!(save > 0)) continue;
    if (!best || save > best.save) {
      best = { save, title: c.title || '优惠券', couponId: c.id };
    }
  }
  return best;
}

/** 展示价：券与会员折互斥，取更省 */
function displayDeal(originAmount, { isMember, factor, coupons, productId, category }) {
  const origin = round2(originAmount);
  const member = applyFactor(origin, isMember ? factor : 1);
  const coupon = bestCouponSave(coupons, { productId, category, originAmount: origin });
  const couponSave = coupon ? coupon.save : 0;
  const memberSave = member.save || 0;
  if (couponSave > memberSave + 1e-9) {
    const sale = round2(Math.max(0.01, origin - couponSave));
    return {
      origin,
      sale,
      save: round2(origin - sale),
      discounted: true,
      tag: '券后价',
      tip: coupon.title || '优惠券',
      via: 'coupon',
    };
  }
  if (member.discounted) {
    return {
      origin,
      sale: member.sale,
      save: member.save,
      discounted: true,
      tag: '会员价',
      tip: '会员折',
      via: 'member',
    };
  }
  return {
    origin,
    sale: origin,
    save: 0,
    discounted: false,
    tag: '',
    tip: '',
    via: '',
  };
}

module.exports = {
  round2,
  formatPrice,
  memberFactorFromPromo,
  applyFactor,
  bestCouponSave,
  displayDeal,
};
