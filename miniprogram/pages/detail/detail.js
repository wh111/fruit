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
    total: '0.00',
  },

  onLoad(query) {
    this.productId = query.id;
    this.load();
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
      this.recalc();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  recalc() {
    const { product, specId, extras, quantity } = this.data;
    if (!product) return;
    const spec = (product.specs || []).find((s) => s.id === specId);
    let unit = spec ? Number(spec.price) : 0;
    (product.extras || []).forEach((ex) => {
      if (extras.includes(ex.id)) unit += Number(ex.price);
    });
    const total = (unit * quantity).toFixed(2);
    this.setData({ unitPrice: unit.toFixed(2), total });
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

  async submit() {
    try {
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
