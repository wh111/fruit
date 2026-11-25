const {
  request,
  ensureLogin,
  rememberOrderId,
  requestReadySubscribe,
  bindPhoneNumber,
} = require('../../utils/api');
const cartUtil = require('../../utils/cart');

const STORAGE_DELIVERY = 'sg_last_delivery_point';

function readSavedDelivery() {
  try {
    return wx.getStorageSync(STORAGE_DELIVERY) || '';
  } catch (_) {
    return '';
  }
}

function saveDelivery(id) {
  try {
    if (id) wx.setStorageSync(STORAGE_DELIVERY, id);
  } catch (_) {
    /* ignore */
  }
}

function isRetailCat(cat) {
  return cat === '免洗什锦' || cat === '水果零售' || cat === '零售什锦';
}

function decorateItems(items) {
  return (items || []).map((it) => {
    const unit = Number(it.unitPrice) || 0;
    const qty = Math.max(1, Number(it.quantity) || 1);
    return {
      ...it,
      toppingText: [
        ...((it.extraNames || []).length ? [(it.extraNames || []).join('、')] : []),
        ...((it.toppingNames || []).length ? [(it.toppingNames || []).join('、')] : []),
      ].join(' · '),
      lineDisplay: (unit * qty).toFixed(2),
    };
  });
}

Page({
  data: {
    items: [],
    fromCart: false,
    remark: '',
    originalTotal: '0.00',
    total: '0.00',
    fulfillmentType: 'now',
    deliveryPoint: 'shop',
    deliveryPoints: [
      { id: 'shop', name: '到店取', fee: 0, tip: '做好后来店取餐（店址：机器人产业园）' },
      { id: 'a1', name: 'A座1号外卖柜', fee: 0.5, tip: '仅限园区内 · 做好后放入外卖柜' },
      { id: 'b2', name: 'B座2号外卖柜', fee: 0.5, tip: '仅限园区内 · 做好后放入外卖柜' },
    ],
    deliveryScopeNote: '仅配送机器人产业园园区内，园区外暂不支持',
    deliveryFee: 0,
    slots: [],
    slotIndex: 0,
    hasDiscount: false,
    discountLabel: '',
    memberLabel: '',
    fridayGift: '',
    canProcess: false,
    promoHint: '',
    allowReserveCategory: false,
    canReserve: false,
    reserveDesc: '今日预定已结束',
    coupons: [],
    couponId: '',
    couponLabel: '不使用优惠券',
    loyaltyLabel: '',
    loyaltyHint: '',
    hasPhone: false,
    willQueue: true,
    hasRetail: false,
    sideMealAllowed: false,
    sideMealTitle: '加一份现烤小食',
    sideMealSubtitle: '现烤鸡胸 / 罗非鱼排 + 蜜薯，出炉现热 · 配果切刚好',
    sideMealStockTip: '',
    sideMealPickText: '',
    sideProteins: [],
    sideCarbs: [],
    sideProteinId: '',
    sideCarbId: '',
    walletEnabled: false,
    balance: 0,
    payChannel: 'balance',
    balanceEnough: false,
    shopClosed: false,
    shopClosedMessage: '',
  },

  onLoad() {
    this._couponTouched = false;
    const saved = readSavedDelivery();
    if (saved) this.setData({ deliveryPoint: saved });
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
    this.bootstrap();
  },

  onShow() {
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
    this.loadWallet();
    ensureLogin()
      .then(() => request('/api/auth/me'))
      .then((me) => {
        if (me && me.user) {
          wx.setStorageSync('user', me.user);
          this.setData({ hasPhone: !!(me.user.hasPhone || me.user.phone) });
        }
      })
      .catch(() => {});
  },

  async bootstrap() {
    const packed = cartUtil.readCheckout();
    if (!packed || !packed.items.length) {
      wx.showToast({ title: '没有待结算商品', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 500);
      return;
    }
    const items = decorateItems(packed.items);
    const cats = items.map((x) => x.productCategory);
    const hasRetail = cats.some(isRetailCat);
    const allRetail = cats.every(isRetailCat);
    this.setData({
      items,
      fromCart: !!packed.fromCart,
      hasRetail,
      willQueue: !allRetail,
    });
    await this.loadSideMeal(cats);
    await this.loadPromo({ initial: true });
    await this.refreshQuote();
    this.loadWallet();
  },

  async loadSideMeal(categories) {
    let cats = [...new Set((categories || []).map((c) => String(c || '').trim()).filter(Boolean))];
    const items0 = this.data.items || [];
    // 始终按商品 id 回填分类，避免旧购物车缺字段导致加购不出现
    try {
      const res = await request('/api/products');
      const list = res.list || res.products || [];
      const map = {};
      list.forEach((p) => {
        if (p && p.id != null) map[String(p.id)] = String(p.category || '').trim();
      });
      const items = items0.map((it) => ({
        ...it,
        productCategory: String(it.productCategory || map[String(it.productId)] || '').trim(),
      }));
      this.setData({ items });
      cats = [...new Set(items.map((x) => x.productCategory).filter(Boolean))];
    } catch (_) {
      /* ignore */
    }
    const clear = () =>
      this.setData({
        sideMealAllowed: false,
        sideMealStockTip: '',
        sideMealPickText: '',
        sideProteins: [],
        sideCarbs: [],
        sideProteinId: '',
        sideCarbId: '',
      });
    const stockTip = (data) => {
      if (data.soldOut) return '现烤小食暂时售罄，烤好后会上架';
      if (data.stock == null) return '';
      const n = Number(data.stock);
      if (!Number.isFinite(n)) return '';
      return n > 0 ? `当前剩余 ${n} 份` : '现烤小食暂时售罄，烤好后会上架';
    };
    const apply = (data) => {
      if (data.soldOut) return false;
      const proteins = data.proteins || [];
      const carbs = data.carbs || [];
      if (!proteins.length || !carbs.length) return false;
      const carbId = carbs[0] ? carbs[0].id : '';
      this.setData({
        sideMealAllowed: true,
        sideMealTitle: data.title || '加一份现烤小食',
        sideMealSubtitle: data.subtitle || '现烤鸡胸 / 罗非鱼排 + 蜜薯，出炉现热 · 配果切刚好',
        sideMealStockTip: stockTip(data),
        sideMealPickText: '',
        sideProteins: proteins,
        sideCarbs: carbs,
        sideProteinId: '',
        sideCarbId: carbId,
      });
      return true;
    };
    try {
      const data = await request('/api/side-meal');
      if (!data || !data.enabled) {
        clear();
        return;
      }
      const allowSet = new Set((data.categories || []).map((c) => String(c || '').trim()));
      const hit = cats.some((c) => allowSet.has(c));
      // 分类未配时：只要不是纯零售，也给加购（避免后台漏勾分类）
      const onlyRetail = cats.length > 0 && cats.every(isRetailCat);
      const fallback = !allowSet.size && !onlyRetail && cats.length > 0;
      if ((hit || fallback) && apply(data)) return;
      // 仍无命中时按单品分类再试一次（兼容旧接口）
      for (const cat of cats) {
        try {
          const d = await request(`/api/side-meal?category=${encodeURIComponent(cat)}`);
          if (d && d.enabled !== false && (d.allowed || d.enabled) && apply(d)) return;
        } catch (_) {
          /* try next */
        }
      }
      clear();
    } catch (_) {
      clear();
    }
  },

  sideMealPayload() {
    const { sideProteinId, sideCarbId, sideMealAllowed } = this.data;
    if (!sideMealAllowed || !sideProteinId) return null;
    return { proteinId: sideProteinId, carbId: sideCarbId || undefined };
  },

  async loadPromo(opts = {}) {
    try {
      const promo = await request('/api/promo');
      const slots = promo.slots || [];
      const reserveCategories = promo.reserveCategories || [];
      const cats = (this.data.items || []).map((x) => x.productCategory);
      const allowReserveCategory =
        cats.length > 0 && cats.every((c) => reserveCategories.includes(c));
      const canReserve = allowReserveCategory && slots.length > 0;
      let fulfillmentType = this.data.fulfillmentType || 'now';
      let slotIndex = this.data.slotIndex || 0;
      if (!canReserve || opts.initial) {
        fulfillmentType = 'now';
        slotIndex = 0;
      }
      if (slotIndex >= slots.length) slotIndex = 0;
      const points = promo.deliveryPoints || this.data.deliveryPoints;
      let deliveryPoint = this.data.deliveryPoint || 'shop';
      if (!points.some((p) => p.id === deliveryPoint)) deliveryPoint = 'shop';
      let reserveDesc = promo.reserveDesc || '今日预定已结束';
      if (canReserve) {
        reserveDesc =
          promo.reserveDesc || '可选 11:40 / 12:00 / 17:40 / 18:00 取餐，可用预定券';
      }
      else if (!allowReserveCategory) {
        const onlyRetail =
          cats.length > 0 &&
          cats.every((c) => c === '免洗什锦' || c === '水果零售' || c === '零售什锦');
        reserveDesc = onlyRetail ? '免洗什锦仅支持现取' : '本单有商品不支持预定';
      }
      const shopOpen = promo.shopOpen || {};
      const shopClosed = shopOpen.enabled !== false && shopOpen.isOpen === false;
      const shopClosedMessage =
        shopOpen.closedMessage ||
        `门店营业时间 ${shopOpen.label || '09:30–20:00'}，当前暂停下单`;
      this.setData({
        slots,
        slotIndex,
        allowReserveCategory,
        canReserve,
        fulfillmentType,
        promoHint: promo.hint || '',
        reserveDesc,
        deliveryPoints: points,
        deliveryPoint,
        deliveryScopeNote:
          promo.deliveryScopeNote ||
          this.data.deliveryScopeNote ||
          '仅配送机器人产业园园区内，园区外暂不支持',
        shopClosed,
        shopClosedMessage,
      });
    } catch {
      this.setData({
        slots: [],
        allowReserveCategory: false,
        canReserve: false,
        fulfillmentType: 'now',
        reserveDesc: '今日预定已结束',
      });
    }
  },

  async refreshQuote(overrides = {}) {
    const items = this.data.items || [];
    if (!items.length) return;
    const fulfillmentType =
      overrides.fulfillmentType != null ? overrides.fulfillmentType : this.data.fulfillmentType;
    const deliveryPoint =
      overrides.deliveryPoint != null ? overrides.deliveryPoint : this.data.deliveryPoint;
    const sideMeal =
      overrides.sideMeal !== undefined ? overrides.sideMeal : this.sideMealPayload();
    const couponId = this._couponTouched ? this.data.couponId || '' : undefined;
    try {
      const { quote } = await request('/api/orders/quote', {
        method: 'POST',
        data: {
          items: cartUtil.toOrderPayloadItems(items),
          sideMeal,
          fulfillmentType,
          pickupAt:
            fulfillmentType === 'reserve' && this.data.slots[this.data.slotIndex]
              ? this.data.slots[this.data.slotIndex].pickupAt
              : null,
          deliveryPoint,
          couponId,
          autoCoupon: !this._couponTouched,
        },
      });
      const coupons = quote.availableCoupons || [];
      let couponLabel = this.data.couponLabel;
      let selectedId = quote.selectedCouponId || '';
      if (!this._couponTouched) {
        if (selectedId) {
          const c = coupons.find((x) => x.id === selectedId);
          couponLabel = c ? `${c.title} · 省¥${c.save}` : '已选优惠券';
        } else {
          couponLabel = '不使用优惠券';
        }
      }
      const total = Number(quote.amount) || 0;
      const balance = Number(this.data.balance) || 0;
      this.setData({
        originalTotal: Number(quote.originalAmount || 0).toFixed(2),
        total: total.toFixed(2),
        deliveryFee: Number(quote.deliveryFee) || 0,
        hasDiscount: Number(quote.discountAmount) > 0,
        discountLabel: quote.discountLabel || '',
        memberLabel: quote.memberLabel || '',
        fridayGift: quote.fridayGift && quote.fridayGift.name ? `赠送${quote.fridayGift.name}一份` : '',
        canProcess: !!quote.canProcess,
        coupons,
        couponId: this._couponTouched ? this.data.couponId : selectedId,
        couponLabel,
        loyaltyLabel:
          Number(quote.loyaltySave) > 0
            ? quote.loyaltyLabel || (quote.loyalty && quote.loyalty.label) || ''
            : '',
        loyaltyHint:
          Number(quote.loyaltySave) > 0
            ? ''
            : quote.loyalty && quote.loyalty.label && (quote.couponId || selectedId)
              ? `${quote.loyalty.label}与立减券同单任选其一（当前用券）`
              : (quote.loyalty && quote.loyalty.nextHint) || '',
        balanceEnough: this.data.walletEnabled && balance + 0.001 >= total,
        deliveryPoints: quote.deliveryPoints || this.data.deliveryPoints,
        deliveryScopeNote:
          quote.deliveryScopeNote ||
          this.data.deliveryScopeNote ||
          '仅配送机器人产业园园区内，园区外暂不支持',
      });
    } catch (e) {
      const est = items.reduce(
        (s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 1),
        0
      );
      this.setData({
        originalTotal: est.toFixed(2),
        total: est.toFixed(2),
        hasDiscount: false,
        discountLabel: '',
        memberLabel: '',
        fridayGift: '',
        canProcess: false,
      });
      if (e && e.message) wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  syncSideMealPickText(proteinId, carbId) {
    const protein = (this.data.sideProteins || []).find((p) => p.id === proteinId);
    const carb = (this.data.sideCarbs || []).find((c) => c.id === carbId);
    if (!protein) {
      this.setData({ sideMealPickText: '' });
      return;
    }
    const left = `${protein.name}${protein.weight || ''}`;
    const right = carb ? `${carb.name}${carb.weight || ''}` : '主食';
    this.setData({ sideMealPickText: `${left} + ${right}` });
  },

  onSideProtein(e) {
    const id = e.currentTarget.dataset.id || '';
    const next = this.data.sideProteinId === id ? '' : id;
    const sideCarbId =
      next && !this.data.sideCarbId && this.data.sideCarbs[0]
        ? this.data.sideCarbs[0].id
        : this.data.sideCarbId;
    this.setData({ sideProteinId: next, sideCarbId: next ? sideCarbId : this.data.sideCarbId });
    this.syncSideMealPickText(next, next ? sideCarbId : '');
    this.refreshQuote({
      sideMeal: next ? { proteinId: next, carbId: sideCarbId || undefined } : null,
    });
  },

  onSideCarb(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ sideCarbId: id });
    this.syncSideMealPickText(this.data.sideProteinId, id);
    if (!this.data.sideProteinId) {
      wx.showToast({ title: '请先选现烤蛋白', icon: 'none' });
      return;
    }
    this.refreshQuote({
      sideMeal: { proteinId: this.data.sideProteinId, carbId: id },
    });
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  onFulfillment(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'reserve' && !this.data.canReserve) {
      wx.showToast({ title: '今日预定已结束，请选现作现取', icon: 'none' });
      return;
    }
    this._couponTouched = false;
    this.setData({ fulfillmentType: type });
    this.refreshQuote({ fulfillmentType: type });
  },

  onDelivery(e) {
    const id = e.currentTarget.dataset.id || 'shop';
    saveDelivery(id);
    this.setData({ deliveryPoint: id }, () => this.refreshQuote({ deliveryPoint: id }));
  },

  onSlot(e) {
    this.setData({ slotIndex: Number(e.currentTarget.dataset.index) });
    this.refreshQuote();
  },

  onPickCoupon() {
    const coupons = this.data.coupons || [];
    const available = coupons.filter((c) => c.available).sort((a, b) => b.save - a.save);
    const unavailable = coupons.filter((c) => !c.available);
    const ordered = [...available, ...unavailable].slice(0, 5);
    const items = [
      '不使用优惠券',
      ...ordered.map((c) =>
        c.available ? `${c.title} · 省¥${c.save}` : `${c.title}（${c.reason}）`
      ),
    ];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        this._couponTouched = true;
        if (res.tapIndex === 0) {
          this.setData({ couponId: '', couponLabel: '不使用优惠券' });
        } else {
          const c = ordered[res.tapIndex - 1];
          if (!c || !c.available) {
            wx.showToast({ title: (c && c.reason) || '该券不可用', icon: 'none' });
            return;
          }
          this.setData({
            couponId: c.id,
            couponLabel: `${c.title} · 省¥${c.save}`,
          });
        }
        this.refreshQuote();
      },
    });
  },

  async onPhoneThenPay(e) {
    try {
      wx.showLoading({ title: '授权中' });
      await ensureLogin();
      const data = await bindPhoneNumber(e.detail || {});
      wx.hideLoading();
      this.setData({ hasPhone: true });
      if (data.merged) {
        wx.showToast({ title: '已同步优惠到本号', icon: 'none' });
        await new Promise((r) => setTimeout(r, 400));
      }
      await this.submit();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '请先完成手机号快捷登录', icon: 'none' });
    }
  },

  async loadWallet() {
    try {
      await ensureLogin();
      const data = await request('/api/wallet/mine');
      const balance = Number(data.balance) || 0;
      const total = Number(this.data.total) || 0;
      const enabled = !!data.enabled;
      const patch = {
        walletEnabled: enabled,
        balance,
        balanceEnough: enabled && balance + 0.001 >= total,
      };
      if (enabled && !this._payChannelTouched) patch.payChannel = 'balance';
      else if (!enabled) patch.payChannel = 'wechat';
      this.setData(patch);
    } catch (_) {
      /* ignore */
    }
  },

  onPayChannel(e) {
    const channel = e.currentTarget.dataset.channel;
    this._payChannelTouched = true;
    if (channel === 'balance' && !this.data.balanceEnough) {
      this.setData({ payChannel: 'balance' });
      wx.showModal({
        title: '余额不足',
        content: `当前余额 ¥${Number(this.data.balance || 0).toFixed(2)}，请先充值后再用会员支付`,
        confirmText: '去充值',
        cancelText: '改用在线支付',
        success: (res) => {
          if (res.confirm) this.goRecharge();
          else this.setData({ payChannel: 'wechat' });
        },
      });
      return;
    }
    this.setData({ payChannel: channel });
  },

  goRecharge() {
    wx.navigateTo({ url: '/pages/wallet/wallet' });
  },

  async submit() {
    try {
      const { fulfillmentType, slots, slotIndex, canReserve, couponId, deliveryPoint, payChannel, items, fromCart } =
        this.data;
      if (this.data.shopClosed) {
        wx.showToast({
          title: this.data.shopClosedMessage || '非营业时间，暂停下单',
          icon: 'none',
        });
        return;
      }
      if (fulfillmentType === 'reserve' && (!canReserve || !slots[slotIndex])) {
        wx.showToast({ title: '请选择取餐时间', icon: 'none' });
        return;
      }
      if (payChannel === 'balance' && !this.data.balanceEnough) {
        this.goRecharge();
        return;
      }
      wx.showLoading({ title: '下单中' });
      await ensureLogin();
      const user = wx.getStorageSync('user') || {};
      if (!(user.hasPhone || user.phone)) {
        wx.hideLoading();
        this.setData({ hasPhone: false });
        wx.showToast({ title: '请先完成手机号快捷登录', icon: 'none' });
        return;
      }
      this.setData({ hasPhone: true });
      const { order } = await request('/api/orders', {
        method: 'POST',
        data: {
          items: cartUtil.toOrderPayloadItems(items),
          sideMeal: this.sideMealPayload(),
          remark: this.data.remark,
          fulfillmentType,
          pickupAt: fulfillmentType === 'reserve' ? slots[slotIndex].pickupAt : null,
          deliveryPoint: deliveryPoint || 'shop',
          couponId: this._couponTouched ? couponId || '' : undefined,
          autoCoupon: !this._couponTouched,
        },
      });
      rememberOrderId(order.id);
      saveDelivery(deliveryPoint || 'shop');
      if (fromCart) cartUtil.clearCart();
      cartUtil.clearCheckout();

      const pay = await request('/api/pay/create', {
        method: 'POST',
        data: { orderId: order.id, payChannel: payChannel || 'wechat' },
      });

      if (pay.paid || pay.mode === 'balance') {
        wx.hideLoading();
        await requestReadySubscribe();
        wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
        return;
      }

      wx.hideLoading();
      await requestReadySubscribe();
      wx.showLoading({ title: '支付中' });

      if (!pay.payment || pay.paid) {
        wx.hideLoading();
        if (pay.paid) {
          wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
          return;
        }
        wx.showToast({ title: '支付未完成', icon: 'none' });
        return;
      }

      wx.hideLoading();
      try {
        if (pay.mode === 'mock') {
          const amount =
            (pay.order && pay.order.amount != null ? pay.order.amount : null) != null
              ? pay.order.amount
              : order.amount;
          const { confirm } = await new Promise((resolve) => {
            wx.showModal({
              title: '模拟支付（企业商户直连）',
              content: `应付 ¥${amount}\n正式环境将调起微信支付`,
              confirmText: '支付',
              cancelText: '取消',
              success: resolve,
              fail: () => resolve({ confirm: false }),
            });
          });
          if (!confirm) {
            const err = new Error('cancel');
            err.errMsg = 'requestPayment:fail cancel';
            throw err;
          }
        } else {
          await new Promise((resolve, reject) => {
            wx.requestPayment({
              timeStamp: pay.payment.timeStamp,
              nonceStr: pay.payment.nonceStr,
              package: pay.payment.package,
              signType: pay.payment.signType || 'MD5',
              paySign: pay.payment.paySign,
              success: resolve,
              fail: reject,
            });
          });
        }
        await request('/api/pay/confirm', {
          method: 'POST',
          data: { orderId: order.id },
        });
        wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
      } catch (payErr) {
        const msg = (payErr && payErr.errMsg) || '';
        if (/cancel/i.test(msg)) {
          wx.showToast({ title: '已取消支付', icon: 'none' });
        } else {
          wx.showToast({ title: (payErr && payErr.message) || '支付失败', icon: 'none' });
        }
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '下单失败', icon: 'none' });
    }
  },
});
