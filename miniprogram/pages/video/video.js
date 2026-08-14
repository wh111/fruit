const { request, mediaUrl } = require('../../utils/api');

Page({
  data: {
    order: null,
    videoUrl: '',
    batchText: '',
  },

  onLoad(q) {
    this.id = q.id;
    this.reload();
  },

  async reload() {
    try {
      wx.showNavigationBarLoading();
      const data = await request(`/api/orders/${this.id}`);
      const order = data.order;
      let videoUrl = order.videoUrl || '';
      if (videoUrl && videoUrl.startsWith('/')) {
        videoUrl = mediaUrl(videoUrl);
      }
      const batchText = (order.makeBatchCodes || []).join('、');
      this.setData({ order, videoUrl, batchText });
      if (!videoUrl) {
        wx.showToast({ title: '视频尚未就绪', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },
});
