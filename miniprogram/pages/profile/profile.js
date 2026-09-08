const { ensureLogin } = require('../../utils/api');

Page({
  data: { user: {}, couponUnused: 0 },

  onShow() {
    this.setData({ user: wx.getStorageSync('user') || {} });
    ensureLogin()
      .then(async () => {
        this.setData({ user: wx.getStorageSync('user') || {} });
        try {
          const { request } = require('../../utils/api');
          const mine = await request('/api/coupons/mine');
          this.setData({ couponUnused: (mine.summary && mine.summary.unused) || 0 });
        } catch (_) {
          /* ignore */
        }
      })
      .catch(() => {});
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

  async reLogin() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    try {
      await ensureLogin({ force: true });
      this.setData({ user: wx.getStorageSync('user') || {} });
      wx.showToast({ title: '已登录', icon: 'success' });
      this.onShow();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
