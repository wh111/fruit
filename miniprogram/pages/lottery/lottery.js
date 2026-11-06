const { request, ensureLogin } = require('../../utils/api');

function rateText(weight, total) {
  if (!(total > 0)) return '';
  const pct = Math.round((Number(weight) / total) * 1000) / 10;
  return `中奖率 ${pct}%`;
}

Page({
  data: {
    campaign: {},
    prizes: [],
    rules: [],
    myPrize: null,
    canDraw: false,
    drawing: false,
    drawBtnText: '立即抽奖',
    statusText: '',
    dateText: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      await ensureLogin();
      const data = await request('/api/lottery');
      this.applyCampaign(data);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  applyCampaign(data) {
    const campaign = data || {};
    const prizesRaw = campaign.prizes || [];
    const total = prizesRaw.reduce((s, p) => s + (Number(p.weight) || 0), 0);
    const prizes = prizesRaw.map((p) => ({
      ...p,
      rateText: rateText(p.weight, total),
    }));
    let dateText = '';
    if (campaign.startDate || campaign.endDate) {
      dateText = `${campaign.startDate || '即日起'} 至 ${campaign.endDate || '另行通知'}`;
    }
    let statusText = '';
    let drawBtnText = '立即抽奖';
    // 测试模式：不卡日期/次数/手机号，只要服务端允许就显示可抽
    if (campaign.testMode) {
      statusText = '测试模式：可反复抽奖';
      drawBtnText = '立即抽奖';
      dateText = '';
    } else if (!campaign.enabled) {
      statusText = '活动筹备中，开业后开放';
      drawBtnText = '暂未开放';
    } else if (!campaign.active) {
      statusText = campaign.windowReason || '不在活动期内';
      drawBtnText = '不在活动期';
    } else if (campaign.participated) {
      statusText = '您已抽过奖';
      drawBtnText = '已参与';
    } else {
      drawBtnText = '立即抽奖';
    }
    this.setData({
      campaign,
      prizes,
      rules: campaign.rules || [],
      myPrize: campaign.myPrize || null,
      canDraw: !!campaign.canDraw,
      drawBtnText,
      statusText,
      dateText,
    });
  },

  async onDraw() {
    if (!this.data.canDraw || this.data.drawing) return;
    this.setData({ drawing: true });
    try {
      await ensureLogin({ force: true });
      wx.showLoading({ title: '抽奖中' });
      const data = await request('/api/lottery/draw', { method: 'POST' });
      wx.hideLoading();
      const prize = (data && data.prize) || {};
      if (data && data.campaign) this.applyCampaign(data.campaign);
      else await this.load();
      wx.showModal({
        title: prize.type === 'none' ? '谢谢参与' : '恭喜中奖',
        content: prize.title || '已完成抽奖',
        showCancel: prize.type !== 'none',
        confirmText: prize.type === 'none' ? '好的' : '去看券',
        success: (res) => {
          if (res.confirm && prize.type !== 'none') this.goCoupons();
        },
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '抽奖失败', icon: 'none' });
      this.load();
    } finally {
      this.setData({ drawing: false });
    }
  },

  goCoupons() {
    wx.navigateTo({ url: '/pages/coupons/coupons' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
