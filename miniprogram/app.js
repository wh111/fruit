App({
  globalData: {
    user: null,
    token: '',
  },
  onLaunch() {
    const token = wx.getStorageSync('token') || '';
    const user = wx.getStorageSync('user') || null;
    this.globalData.token = token;
    this.globalData.user = user;
    // 扫码冷启动尽早登录/发券，避免首页只拉商品不发券
    try {
      const { ensureLogin } = require('./utils/api');
      ensureLogin().catch(() => null);
    } catch (_) {
      /* ignore */
    }
  },
});
