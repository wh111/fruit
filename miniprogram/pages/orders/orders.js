const { request, ensureLogin } = require('../../utils/api');

const STATUS = {
  pending_pay: '待支付',
  paid: '排队中',
  making: '制作中',
  ready: '请取餐',
  done: '已完成',
  cancelled: '已取消',
};

Page({
  data: { list: [] },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      await ensureLogin().catch(() => null);
      const ids = (wx.getStorageSync('localOrderIds') || []).join(',');
      const { list } = await request(`/api/orders/mine?ids=${ids}`);
      this.setData({
        list: list.map((o) => ({
          ...o,
          statusText:
            o.fulfillmentType === 'reserve' && o.status === 'paid'
              ? '已预约'
              : STATUS[o.status] || o.status,
          queueTip: o.queueTip || '',
        })),
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/order/order?id=${e.currentTarget.dataset.id}` });
  },
});