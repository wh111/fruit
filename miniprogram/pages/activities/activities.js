const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    loading: true,
    hint: '',
    weekLabel: '',
    weekLine: '',
    memberLabel: '',
    active: [],
    expired: [],
    list: [],
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      this.setData({ loading: true });
      await ensureLogin().catch(() => null);
      const data = await request('/api/activities');
      const loyalty = data.loyalty || {};
      const member = data.memberDiscount || {};
      let memberLabel = '';
      if (loyalty.isMember && loyalty.label) {
        memberLabel = `已享${loyalty.label}`;
      } else if (member.enabled) {
        memberLabel = `充值会员全场${member.zheLabel || '9折'}`;
      }
      const week = data.week || {};
      const weekLine = week.startDate && week.endDate ? `${week.startDate}～${week.endDate}` : '';
      this.setData({
        hint: data.hint || (weekLine ? `本周 ${weekLine}` : ''),
        weekLabel: week.label || '',
        weekLine,
        memberLabel,
        active: data.active || [],
        expired: data.expired || [],
        list: data.list || [],
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  onAction(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'wallet') {
      wx.navigateTo({ url: '/pages/wallet/wallet' });
      return;
    }
    if (action === 'claim' || action === 'order') {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
  },
});
