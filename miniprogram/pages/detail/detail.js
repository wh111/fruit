const { request, mediaUrl, ensureLogin, rememberOrderId } = require('../../utils/api');

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
    slots: [],
    slotIndex: 0,
    hasDiscount: false,
    discountLabel: '',
    promoHint: '',
    canReserve: false,
    reserveDesc: '今日预定已结束',
  },

  onLoad(query) {
    this.productId = query.id;
    this.load();
  },

  onShow() {
    if (this.data.product) this.loadPromo();
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
      this.recalc();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async loadPromo(opts = {}) {
    try {
      const promo = await request('/api/promo');
      const slots = promo.slots || [];
      const discountIdx = slots.findIndex((s) => s.discount);
      const canReserve = slots.length > 0;
      let fulfillmentType = this.data.fulfillmentType || 'now';
      let slotIndex = this.data.slotIndex || 0;
      if (!canReserve) {
        fulfillmentType = 'now';
        slotIndex = 0;
      } else if (opts.initial) {
        // 上午优惠窗口默认帮用户选预定；下午仍默认现取，避免误订晚上
        if (promo.lunchOpen && discountIdx >= 0) {
          fulfillmentType = 'reserve';
          slotIndex = discountIdx;
        } else {
          fulfillmentType = 'now';
          slotIndex = discountIdx >= 0 ? discountIdx : 0;
        }
      }
      if (slotIndex >= slots.length) slotIndex = 0;
      this.setData({
        slots,
        slotIndex,
        canReserve,
        fulfillmentType,
        promoHint: promo.hint || '',
        reserveDesc: promo.reserveDesc || (canReserve ? '仅 12 点或 6 点取餐' : '今日预定已结束'),
      });
      this.recalc();
    } catch {
      this.setData({ slots: [], canReserve: false, fulfillmentType: 'now', reserveDesc: '今日预定已结束' });
      this.recalc();
    }
  },

  recalc() {
    const { product, specId, extras, quantity, fulfillmentType, slots, slotIndex } = this.data;
    if (!product) return;
    const spec = (product.specs || []).find((s) => s.id === specId);
    let unit = spec ? Number(spec.price) : 0;
    (product.extras || []).forEach((ex) => {
      if (extras.includes(ex.id)) unit += Number(ex.price);
    });
    const original = unit * quantity;
    const slot = fulfillmentType === 'reserve' ? slots[slotIndex] : null;
    const hasDiscount = !!(slot && slot.discount);
    const total = hasDiscount ? original * 0.8 : original;
    this.setData({
      unitPrice: unit.toFixed(2),
      originalTotal: original.toFixed(2),
      total: total.toFixed(2),
      hasDiscount,
      discountLabel: hasDiscount ? slot.discountLabel || '提前预定8折' : '',
    });
  },

  onSpec(e) {
    this.setData({ specId: e.currentTarget.dataset.id });
    this.recalc();
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
    this.recalc();
  },

  inc() {
    this.setData({ quantity: this.data.quantity + 1 });
    this.recalc();
  },

  dec() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
    this.recalc();
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
    let slotIndex = this.data.slotIndex;
    if (type === 'reserve') {
      const idx = this.data.slots.findIndex((s) => s.discount);
      if (idx >= 0) slotIndex = idx;
    }
    this.setData({ fulfillmentType: type, slotIndex });
    this.recalc();
  },

  onSlot(e) {
    this.setData({ slotIndex: Number(e.currentTarget.dataset.index) });
    this.recalc();
  },

  async submit() {
    try {
      const { fulfillmentType, slots, slotIndex, canReserve } = this.data;
      if (fulfillmentType === 'reserve' && (!canReserve || !slots[slotIndex])) {
        wx.showToast({ title: '请选择取餐时间', icon: 'none' });
        return;
      }
      wx.showLoading({ title: '下单中' });
      await ensureLogin();
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
        },
      });
      rememberOrderId(order.id);

      const pay = await request('/api/pay/create', {
        method: 'POST',
        data: { orderId: order.id },
      });

      if (pay.mode === 'mock' && pay.paid) {
        wx.hideLoading();
        wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
        return;
      }

      if (pay.mode === 'wechat' && pay.payment) {
        wx.hideLoading();
        try {
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
        } catch (err) {
          const msg = (err && (err.errMsg || err.message)) || '支付取消';
          wx.showToast({ title: msg.includes('cancel') ? '已取消支付' : msg, icon: 'none' });
          return;
        }
        wx.showLoading({ title: '确认订单' });
        await request('/api/pay/confirm', { method: 'POST', data: { orderId: order.id } });
        wx.hideLoading();
        wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
        return;
      }

      wx.hideLoading();
      wx.showToast({ title: '支付未完成', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '支付失败', icon: 'none' });
    }
  },
});
