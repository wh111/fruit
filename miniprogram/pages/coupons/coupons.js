const { request, ensureLogin } = require('../../utils/api');

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    tab: 'unused',
    list: [],
    shown: [],
    summary: { unused: 0 },
    campaign: null,
    rules: [],
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      await ensureLogin();
      if (!wx.getStorageSync('token')) await ensureLogin({ force: true });
      const data = await request('/api/coupons/mine');
      const list = (data.list || []).map((c) => ({
        ...c,
        expireText: fmtDate(c.expireAt),
        statusText:
          c.status === 'unused' ? '可使用' : c.status === 'used' ? '已使用' : '已过期',
      }));
      this.setData({
        list,
        summary: data.summary || { unused: 0 },
        campaign: data.campaign || null,
        rules: (data.campaign && data.campaign.rules) || [],
      });
      this.applyTab(this.data.tab);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (/请先登录|未登录|401/.test(msg)) {
        try {
          await ensureLogin({ force: true });
          return this.load();
        } catch (_) {
          /* fallthrough */
        }
      }
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onTab(e) {
    this.applyTab(e.currentTarget.dataset.tab);
  },

  applyTab(tab) {
    const shown = this.data.list.filter((c) => c.status === tab);
    this.setData({ tab, shown });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
