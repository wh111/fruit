const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    balance: 0,
    enabled: false,
    tiers: [],
    tierId: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      await ensureLogin();
      const data = await request('/api/wallet/mine');
      const tiers = data.tiers || [];
      this.setData({
        balance: data.balance || 0,
        enabled: !!data.enabled,
        tiers,
        tierId: tiers[0] ? tiers[0].id : '',
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onPick(e) {
    this.setData({ tierId: e.currentTarget.dataset.id });
  },

  async submit() {
    const { tierId, enabled } = this.data;
    if (!enabled) return wx.showToast({ title: '储值未开启', icon: 'none' });
    if (!tierId) return wx.showToast({ title: '请选择档位', icon: 'none' });
    try {
      wx.showLoading({ title: '创建订单' });
      await ensureLogin();
      const { recharge } = await request('/api/wallet/recharge', {
        method: 'POST',
        data: { tierId },
      });
      const pay = await request('/api/pay/create', {
        method: 'POST',
        data: { rechargeId: recharge.id },
      });
      wx.hideLoading();

      if (!pay.payment) {
        wx.showToast({ title: '支付未完成', icon: 'none' });
        return;
      }

      if (pay.mode === 'mock') {
        const { confirm } = await new Promise((resolve) => {
          wx.showModal({
            title: '模拟充值支付',
            content: `实付 ¥${recharge.payAmount}\n到账 ¥${recharge.creditAmount}`,
            confirmText: '支付',
            cancelText: '取消',
            success: resolve,
            fail: () => resolve({ confirm: false }),
          });
        });
        if (!confirm) {
          wx.showToast({ title: '已取消', icon: 'none' });
          return;
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

      wx.showLoading({ title: '入账中' });
      const conf = await request('/api/pay/confirm', {
        method: 'POST',
        data: { rechargeId: recharge.id },
      });
      wx.hideLoading();
      if (conf.recharge && conf.recharge.status === 'paid') {
        const bal = conf.balance != null ? conf.balance : this.data.balance;
        this.setData({ balance: bal });
        wx.showToast({ title: '充值成功', icon: 'success' });
        // 从点单页进来则返回原页继续支付
        const stack = getCurrentPages();
        if (stack.length > 1) {
          setTimeout(() => {
            wx.navigateBack({ delta: 1 });
          }, 600);
        } else {
          this.load();
        }
      } else {
        wx.showToast({ title: '支付确认中，请稍后刷新', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      const msg = (e && (e.errMsg || e.message)) || '充值失败';
      wx.showToast({
        title: msg.includes('cancel') ? '已取消支付' : msg,
        icon: 'none',
      });
    }
  },
});
