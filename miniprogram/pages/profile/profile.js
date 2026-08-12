const { ensureLogin } = require('../../utils/api');

Page({
  data: { user: {} },

  onShow() {
    this.setData({ user: wx.getStorageSync('user') || {} });
    ensureLogin().then(() => {
      this.setData({ user: wx.getStorageSync('user') || {} });
    }).catch(() => {});
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  async reLogin() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    try {
      await ensureLogin();
      this.setData({ user: wx.getStorageSync('user') || {} });
      wx.showToast({ title: '已登录', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
