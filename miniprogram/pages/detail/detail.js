const {
  request,
  mediaUrl,
  ensureLogin,
  rememberOrderId,
  requestReadySubscribe,
  bindPhoneNumber,
} = require('../../utils/api');

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

Page({
  data: {
    product: null,
    coverUrl: '',
    specId: '',
    extras: [],
    extraMap: {},
    quantity: 1,
    remark: '',
    unitPrice: '0.00',
    originalTotal: '0.00',
    total: '0.00',
    fulfillmentType: 'now',
    deliveryPoint: 'shop',
    deliveryPoints: [
      { id: 'shop', name: '到店取', fee: 0, tip: '做好后来店取餐' },
      { id: 'a1', name: 'A座1号外卖柜', fee: 0.5, tip: '做好后放入外卖柜' },
      { id: 'b2', name: 'B座2号外卖柜', fee: 0.5, tip: '做好后放入外卖柜' },
    ],
    deliveryFee: 0,
    slots: [],
    slotIndex: 0,
    hasDiscount: false,
    discountLabel: '',
    promoHint: '',
    canReserve: false,
    reserveDesc: '今日预定已结束',
    coupons: [],
    couponId: '',
    couponLabel: '不使用优惠券',
    quoting: false,
    loyaltyLabel: '',
    loyaltyHint: '',
    loyaltyTier: 0,
    monthPaid: 0,
    hasPhone: false,
  },

  onLoad(query) {
    this.productId = query.id;
    this._couponTouched = false;
    const saved = readSavedDelivery();
    if (saved) this.setData({ deliveryPoint: saved });
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
    this.load();
  },

  onShow() {
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
    if (this.data.product) {
      this.loadPromo().then(() => this.refreshQuote());
    }
    // 以服务端为准刷新是否已绑手机
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

  async load() {
    try {
      const p = await request(`/api/products/${this.productId}`);
      const specId = (p.specs && p.specs[0] && p.specs[0].id) || '';
      this.setData({
        product: p,
        coverUrl: mediaUrl(p.cover),
        specId,
      });
      await this.loadPromo({ initial: true });
      await this.refreshQuote();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async loadPromo(opts = {}) {
    try {
      const promo = await request('/api/promo');
      const slots = promo.slots || [];
      const canReserve = slots.length > 0;
      let fulfillmentType = this.data.fulfillmentType || 'now';
      let slotIndex = this.data.slotIndex || 0;
      if (!canReserve) {
        fulfillmentType = 'now';
        slotIndex = 0;
      } else if (opts.initial) {
        // 预售为主：有批次时默认选预定
        fulfillmentType = 'reserve';
        slotIndex = 0;
      }
      if (slotIndex >= slots.length) slotIndex = 0;
      const points = promo.deliveryPoints || this.data.deliveryPoints;
      let deliveryPoint = this.data.deliveryPoint || 'shop';
      if (!points.some((p) => p.id === deliveryPoint)) {
        deliveryPoint = 'shop';
      }
      this.setData({
        slots,
        slotIndex,
        canReserve,
        fulfillmentType,
        promoHint: promo.hint || '',
        reserveDesc: promo.reserveDesc || (canReserve ? '仅 12 点或 6 点取餐，可用预定券' : '今日预定已结束'),
        deliveryPoints: points,
        deliveryPoint,
      });
    } catch {
      this.setData({ slots: [], canReserve: false, fulfillmentType: 'now', reserveDesc: '今日预定已结束' });
    }
  },

  pickupPayload() {
    const { fulfillmentType, slots, slotIndex, deliveryPoint } = this.data;
    return {
      fulfillmentType,
      pickupAt: fulfillmentType === 'reserve' && slots[slotIndex] ? slots[slotIndex].pickupAt : null,
      deliveryPoint: deliveryPoint || 'shop',
    };
  },

  async refreshQuote() {
    const { product, specId, extras, quantity, couponId } = this.data;
    if (!product || !specId) return;
    if (this._quoteSeq == null) this._quoteSeq = 0;
    const seq = ++this._quoteSeq;
    try {
      await ensureLogin().catch(() => null);
      const { fulfillmentType, pickupAt, deliveryPoint } = this.pickupPayload();
      const body = {
        productId: product.id,
        specId,
        extras,
        quantity,
        fulfillmentType,
        pickupAt,
        deliveryPoint,
        autoCoupon: !this._couponTouched,
      };
      if (this._couponTouched) {
        body.couponId = couponId || '';
        body.autoCoupon = false;
      }
      const { quote } = await request('/api/orders/quote', { method: 'POST', data: body });
      if (seq !== this._quoteSeq) return;

      const coupons = (quote.availableCoupons || []).filter((c) => c.status === 'unused');
      const selectedId = quote.selectedCouponId || '';
      const selected = coupons.find((c) => c.id === selectedId);
      const hasDiscount = Number(quote.discountAmount) > 0;
      const loyalty = quote.loyalty || {};
      const deliveryFee = Number(quote.deliveryFee || 0);
      const originalFood = Number(quote.originalAmount);
      this.setData({
        unitPrice: Number(quote.unitPrice).toFixed(2),
        originalTotal: (originalFood + deliveryFee).toFixed(2),
        total: Number(quote.amount).toFixed(2),
        deliveryFee,
        hasDiscount,
        discountLabel: hasDiscount ? quote.discountLabel || '优惠' : '',
        coupons,
        couponId: selectedId,
        couponLabel: selected
          ? `${selected.title} · 省¥${selected.save}`
          : coupons.some((c) => c.available)
            ? '有可用券，点击选择'
            : '暂无可用券',
        loyaltyLabel: loyalty.label || '',
        loyaltyHint: loyalty.nextHint || '',
        loyaltyTier: loyalty.tier || 0,
        monthPaid: loyalty.monthPaid || 0,
        deliveryPoints: quote.deliveryPoints || this.data.deliveryPoints,
      });
      if (!this._couponTouched && selectedId) {
        this._couponTouched = true;
      }
    } catch (e) {
      // 未登录时本地显示原价
      const { product: p, specId: sid, extras: ex, quantity: qty, deliveryPoint } = this.data;
      const spec = (p.specs || []).find((s) => s.id === sid);
      let unit = spec ? Number(spec.price) : 0;
      (p.extras || []).forEach((item) => {
        if (ex.includes(item.id)) unit += Number(item.price);
      });
      const point = (this.data.deliveryPoints || []).find((d) => d.id === deliveryPoint);
      const fee = point ? Number(point.fee) || 0 : 0;
      const original = unit * qty;
      this.setData({
        unitPrice: unit.toFixed(2),
        originalTotal: original.toFixed(2),
        total: (original + fee).toFixed(2),
        deliveryFee: fee,
        hasDiscount: false,
        discountLabel: '',
      });
    }
  },

  onSpec(e) {
    this.setData({ specId: e.currentTarget.dataset.id });
    this.refreshQuote();
  },

  onExtra(e) {
    const id = e.currentTarget.dataset.id;
    let extras = [...this.data.extras];
    const extraMap = { ...this.data.extraMap };
    if (extraMap[id]) {
      extras = extras.filter((x) => x !== id);
      delete extraMap[id];
    } else {
      extras.push(id);
      extraMap[id] = true;
    }
    this.setData({ extras, extraMap });
    this.refreshQuote();
  },

  inc() {
    this.setData({ quantity: this.data.quantity + 1 });
    this.refreshQuote();
  },

  dec() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
    this.refreshQuote();
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
    this.setData({ fulfillmentType: type, slotIndex: this.data.slotIndex || 0 });
    this.refreshQuote();
  },

  onDelivery(e) {
    const id = e.currentTarget.dataset.id || 'shop';
    saveDelivery(id);
    this.setData({ deliveryPoint: id }, () => this.refreshQuote());
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
      wx.showToast({ title: (err && err.message) || '请先授权手机号', icon: 'none' });
    }
  },

  async submit() {
    try {
      const { fulfillmentType, slots, slotIndex, canReserve, couponId, deliveryPoint } = this.data;
      if (fulfillmentType === 'reserve' && (!canReserve || !slots[slotIndex])) {
        wx.showToast({ title: '请选择取餐时间', icon: 'none' });
        return;
      }
      wx.showLoading({ title: '下单中' });
      await ensureLogin();
      const user = wx.getStorageSync('user') || {};
      if (!(user.hasPhone || user.phone)) {
        wx.hideLoading();
        this.setData({ hasPhone: false });
        wx.showToast({ title: '请先授权手机号', icon: 'none' });
        return;
      }
      this.setData({ hasPhone: true });
      const { order } = await request('/api/orders', {
        method: 'POST',
        data: {
          productId: this.data.product.id,
          specId: this.data.specId,
          extras: this.data.extras,
          quantity: this.data.quantity,
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

      const pay = await request('/api/pay/create', {
        method: 'POST',
        data: { orderId: order.id },
      });

      // 一次性订阅：做好/投柜后服务端可推送（用户可拒绝，不挡支付）
      wx.hideLoading();
      await requestReadySubscribe();
      wx.showLoading({ title: '支付中' });

      // mock / wechat 统一：预支付 → 收银台 → confirm（个体户直连真实链路）
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
          const amount = pay.order?.amount ?? order.amount;
          const { confirm } = await new Promise((resolve) => {
            wx.showModal({
              title: '模拟支付（个体户直连）',
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
      } catch (err) {
        const msg = (err && (err.errMsg || err.message)) || '支付取消';
        try {
          await request(`/api/orders/${order.id}/cancel`, { method: 'POST' });
        } catch (_) {
          /* ignore */
        }
        wx.showToast({ title: msg.includes('cancel') ? '已取消支付' : msg, icon: 'none' });
        return;
      }
      wx.showLoading({ title: '确认订单' });
      await request('/api/pay/confirm', { method: 'POST', data: { orderId: order.id } });
      wx.hideLoading();
      wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '支付失败', icon: 'none' });
    }
  },
});
