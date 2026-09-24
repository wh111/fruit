const { ensureLogin, bindPhoneNumber, request } = require('../../utils/api');

Page({
  data: { user: {}, couponUnused: 0 },

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
        this.setData({ user: me.user });
      } else {
        this.setData({ user: wx.getStorageSync('user') || {} });
      }
      const mine = await request('/api/coupons/mine');
      this.setData({ couponUnused: (mine.summary && mine.summary.unused) || 0 });
    } catch (_) {
      /* ignore */
    }
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
