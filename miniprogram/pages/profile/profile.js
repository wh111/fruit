const { ensureLogin, bindPhoneNumber, request } = require('../../utils/api');

Page({
  data: { user: {}, couponUnused: 0, lotteryActive: false, lotteryHint: '', balance: 0 },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ user: wx.getStorageSync('user') || {} });
    try {
      await ensureLogin();
      const me = await request('/api/auth/me').catch(() => null);
      if (me && me.user) {
        wx.setStorageSync('user', me.user);
        this.setData({ user: me.user, balance: me.user.balance || 0 });
      } else {
        this.setData({ user: wx.getStorageSync('user') || {} });
      }
      const wallet = await request('/api/wallet/mine').catch(() => null);
      if (wallet) this.setData({ balance: wallet.balance || 0 });
      const mine = await request('/api/coupons/mine');
      this.setData({ couponUnused: (mine.summary && mine.summary.unused) || 0 });
      const lottery = await request('/api/lottery').catch(() => null);
      if (lottery) {
        this.setData({
          lotteryActive: !!(lottery.testMode ? lottery.enabled : lottery.active),
          lotteryHint: lottery.testMode
            ? '测试中'
            : lottery.active
              ? ''
              : lottery.participated
                ? '已抽过'
                : lottery.enabled
                  ? lottery.windowReason || ''
                  : '筹备中',
        });
      }
    } catch (_) {
      /* ignore */
    }
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/wallet' });
  },

  goLottery() {
    wx.navigateTo({ url: '/pages/lottery/lottery' });
  },

  goActivities() {
    wx.switchTab({ url: '/pages/activities/activities' });
  },

  goCoupons() {
    wx.navigateTo({ url: '/pages/coupons/coupons' });
  },

  goGroupBuy() {
    wx.navigateTo({ url: '/pages/groupbuy/groupbuy' });
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  async onGetPhone(e) {
    try {
      wx.showLoading({ title: '绑定中' });
      const data = await bindPhoneNumber(e.detail || {});
      wx.hideLoading();
      this.setData({ user: data.user || wx.getStorageSync('user') || {} });
      wx.showToast({
        title: data.merged ? '已同步到原账号' : '绑定成功',
        icon: 'success',
      });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '绑定失败', icon: 'none' });
    }
  },

  async reLogin() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    try {
      await ensureLogin({ force: true });
      this.setData({ user: wx.getStorageSync('user') || {} });
      wx.showToast({ title: '已登录', icon: 'success' });
      this.refresh();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
