const {
  request,
  ensureLogin,
  rememberOrderId,
  bindPhoneNumber,
} = require('../../utils/api');

function parseAmount(text) {
  const s = String(text || '')
    .replace(/[^\d.]/g, '')
    .replace(/(\..*)\./g, '$1');
  if (!s || s === '.') return null;
  const n = Math.round(Number(s) * 100) / 100;
  if (!Number.isFinite(n) || n < 0.01 || n > 999.99) return null;
  return n;
}

function formatDisplay(n) {
  if (n == null) return '0.00';
  return n.toFixed(2);
}

Page({
  data: {
    amountText: '',
    displayAmount: '0.00',
    canPay: false,
    remark: '',
    hasPhone: false,
    paying: false,
  },

  onShow() {
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
  },

  onAmount(e) {
    const amountText = e.detail.value;
    const amount = parseAmount(amountText);
    this.setData({
      amountText,
      displayAmount: formatDisplay(amount),
      canPay: amount != null,
    });
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
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
    if (this.data.paying) return;
    const amount = parseAmount(this.data.amountText);
    if (amount == null) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    try {
      this.setData({ paying: true });
      wx.showLoading({ title: '下单中' });
      await ensureLogin();
      const user = wx.getStorageSync('user') || {};
      if (!(user.hasPhone || user.phone)) {
        wx.hideLoading();
        this.setData({ hasPhone: false, paying: false });
        wx.showToast({ title: '请先授权手机号', icon: 'none' });
        return;
      }
      this.setData({ hasPhone: true });

      const { order } = await request('/api/orders/bulk', {
        method: 'POST',
        data: {
          amount,
          remark: this.data.remark,
        },
      });
      rememberOrderId(order.id);

      const pay = await request('/api/pay/create', {
        method: 'POST',
        data: { orderId: order.id },
      });

      wx.hideLoading();
      wx.showLoading({ title: '支付中' });

      if (!pay.payment || pay.paid) {
        wx.hideLoading();
        this.setData({ paying: false });
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
          const payAmount = pay.order?.amount ?? order.amount;
          const { confirm } = await new Promise((resolve) => {
            wx.showModal({
              title: '模拟支付',
              content: `散装水果应付 ¥${payAmount}`,
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
        this.setData({ paying: false });
        wx.showToast({ title: msg.includes('cancel') ? '已取消支付' : msg, icon: 'none' });
        return;
      }

      wx.showLoading({ title: '确认订单' });
      await request('/api/pay/confirm', { method: 'POST', data: { orderId: order.id } });
      wx.hideLoading();
      this.setData({ paying: false });
      wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
    } catch (e) {
      wx.hideLoading();
      this.setData({ paying: false });
      wx.showToast({ title: e.message || '支付失败', icon: 'none' });
    }
  },
});
