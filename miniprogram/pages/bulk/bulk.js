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
  return Number(n).toFixed(2);
}

Page({
  data: {
    amountText: '',
    displayAmount: '0.00',
    payAmount: '0.00',
    canPay: false,
    remark: '',
    hasPhone: false,
    paying: false,
    walletEnabled: false,
    member: false,
    memberSave: '0.00',
    fridayGift: false,
    canProcess: false,
    balance: 0,
    payChannel: 'wechat',
    balanceEnough: false,
    couponOptions: [],
    couponId: '',
    couponHint: '',
    shopClosed: false,
    shopClosedMessage: '',
  },

  _couponTouched: false,
  _quoteTimer: null,

  onShow() {
    const user = wx.getStorageSync('user') || {};
    this.setData({ hasPhone: !!(user.hasPhone || user.phone) });
    this.loadShopOpen();
    this.loadWallet();
    this.refreshQuote();
  },

  async loadShopOpen() {
    try {
      const shop = await request('/api/shop');
      const shopOpen = (shop && shop.shopOpen) || {};
      const shopClosed = shopOpen.enabled !== false && shopOpen.isOpen === false;
      const shopClosedMessage =
        shopOpen.closedMessage ||
        `门店营业时间 ${shopOpen.label || '09:30–20:00'}，当前暂停下单`;
      this.setData({ shopClosed, shopClosedMessage });
    } catch (_) {
      /* ignore */
    }
  },

  async loadWallet() {
    try {
      await ensureLogin();
      const data = await request('/api/wallet/mine');
      const balance = Number(data.balance) || 0;
      const amount = parseAmount(this.data.amountText);
      const pay = Number(this.data.payAmount) || this.payAmount(amount, !!data.member);
      const enabled = !!data.enabled;
      const patch = {
        walletEnabled: enabled,
        member: !!data.member,
        balance,
        ...this.perkPatch(amount, !!data.member),
        balanceEnough: enabled && pay != null && balance + 0.001 >= pay,
      };
      if (enabled && !this._payChannelTouched) patch.payChannel = 'balance';
      else if (!enabled) patch.payChannel = 'wechat';
      this.setData(patch);
    } catch (_) {
      /* ignore */
    }
  },

  payAmount(amount, member) {
    if (amount == null) return null;
    if (!member) return amount;
    const save = Math.round(amount * 10) / 100;
    const pay = Math.round((amount - save) * 100) / 100;
    return pay < 0.01 ? 0.01 : pay;
  },

  perkPatch(amount, member) {
    const isMember = member != null ? member : this.data.member;
    const pay = this.payAmount(amount, isMember);
    const save = amount != null && pay != null ? Math.round((amount - pay) * 100) / 100 : 0;
    const friday = new Date().getDay() === 5;
    return {
      displayAmount: formatDisplay(pay),
      memberSave: save.toFixed(2),
      fridayGift: !!(isMember && friday && pay > 0),
      canProcess: pay != null && pay + 0.001 >= 18,
    };
  },

  refreshBalanceEnough() {
    const amount = parseAmount(this.data.amountText);
    const pay = Number(this.data.payAmount) || this.payAmount(amount, this.data.member);
    const balance = Number(this.data.balance) || 0;
    this.setData({
      ...this.perkPatch(amount),
      balanceEnough: this.data.walletEnabled && pay != null && balance + 0.001 >= pay,
    });
  },

  onAmount(e) {
    const amountText = e.detail.value;
    const amount = parseAmount(amountText);
    this._couponTouched = false;
    const pay = this.payAmount(amount, this.data.member);
    const balance = Number(this.data.balance) || 0;
    this.setData({
      amountText,
      displayAmount: formatDisplay(pay != null ? pay : amount),
      payAmount: formatDisplay(pay != null ? pay : amount),
      canPay: amount != null,
      couponId: '',
      couponOptions: [],
      couponHint: '',
      ...this.perkPatch(amount),
      balanceEnough: this.data.walletEnabled && pay != null && balance + 0.001 >= pay,
    });
    this.refreshBalanceEnough();
    if (this._quoteTimer) clearTimeout(this._quoteTimer);
    this._quoteTimer = setTimeout(() => this.refreshQuote(), 280);
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  onPickCoupon(e) {
    const id = e.currentTarget.dataset.id || '';
    this._couponTouched = true;
    const amount = parseAmount(this.data.amountText);
    let pay = amount;
    if (id) {
      const hit = (this.data.couponOptions || []).find((c) => c.id === id);
      if (hit) pay = Number(hit.payAmount);
    }
    this.setData({
      couponId: id,
      payAmount: formatDisplay(pay),
    });
    this.refreshBalanceEnough();
  },

  async refreshQuote() {
    const amount = parseAmount(this.data.amountText);
    if (amount == null) {
      this.setData({
        couponOptions: [],
        couponId: '',
        couponHint: '',
        payAmount: '0.00',
      });
      return;
    }
    try {
      if (!wx.getStorageSync('token')) await ensureLogin().catch(() => null);
      if (!wx.getStorageSync('token')) return;
      const quote = await request('/api/orders/bulk/quote', {
        method: 'POST',
        data: { amount },
      });
      let pay = Number(quote.amount);
      if (!(pay > 0)) pay = amount;
      const loyaltyTip =
        Number(quote.loyaltySave) > 0 ? `已享${quote.loyaltyLabel || '会员折'}` : '';
      const save = Math.max(0, Math.round((amount - pay) * 100) / 100);
      this.setData({
        couponOptions: [],
        couponId: '',
        couponHint: loyaltyTip || '自定义金额不支持优惠券，仅可享会员折',
        payAmount: formatDisplay(pay),
        displayAmount: formatDisplay(pay),
        memberSave: save.toFixed(2),
        canProcess: pay + 0.001 >= 18,
        fridayGift: !!(this.data.member && new Date().getDay() === 5 && pay > 0),
      });
      this.refreshBalanceEnough();
    } catch (_) {
      /* ignore quote errors while typing */
    }
  },

  onPayChannel(e) {
    const channel = e.currentTarget.dataset.channel;
    this._payChannelTouched = true;
    if (channel === 'balance' && this.data.canPay && !this.data.balanceEnough) {
      this.setData({ payChannel: 'balance' });
      wx.showModal({
        title: '请充值',
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

  async onPhoneThenPay(e) {
    try {
      wx.showLoading({ title: '登录中' });
      await ensureLogin();
      const data = await bindPhoneNumber(e.detail || {});
      wx.hideLoading();
      this.setData({ hasPhone: true });
      if (data.merged) {
        wx.showToast({ title: '已同步优惠到本号', icon: 'none' });
        await new Promise((r) => setTimeout(r, 400));
      }
      await this.loadWallet();
      await this.refreshQuote();
      await this.submit();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '请先完成手机号快捷登录', icon: 'none' });
    }
  },

  async submit() {
    if (this.data.paying) return;
    if (this.data.shopClosed) {
      wx.showToast({
        title: this.data.shopClosedMessage || '非营业时间，暂停下单',
        icon: 'none',
      });
      return;
    }
    const amount = parseAmount(this.data.amountText);
    if (amount == null) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    const payChannel = this.data.payChannel || 'wechat';
    if (payChannel === 'balance' && !this.data.balanceEnough) {
      this.goRecharge();
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
        wx.showToast({ title: '请先完成手机号快捷登录', icon: 'none' });
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
        data: { orderId: order.id, payChannel },
      });

      if (pay.paid || pay.mode === 'balance') {
        wx.hideLoading();
        this.setData({ paying: false });
        wx.redirectTo({ url: `/pages/order/order?id=${order.id}` });
        return;
      }

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
          const payAmount =
            (pay.order && pay.order.amount != null ? pay.order.amount : null) != null
              ? pay.order.amount
              : order.amount;
          const { confirm } = await new Promise((resolve) => {
            wx.showModal({
              title: '模拟支付',
              content: `自定义金额应付 ¥${payAmount}`,
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
