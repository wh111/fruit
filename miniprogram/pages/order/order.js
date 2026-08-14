const { request } = require('../../utils/api');

const STATUS = {
  pending_pay: '待支付',
  paid: '排队中',
  making: '制作中',
  ready: '请取餐',
  done: '已完成',
  cancelled: '已取消',
};

Page({
  data: {
    order: null,
    qrDataUrl: '',
    extraText: '',
    statusText: '',
    queue: {},
  },

  onLoad(q) {
    this.id = q.id;
    this.load();
  },

  onShow() {
    if (this.id) this.load();
    this.startPoll();
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopPoll();
  },

  startPoll() {
    this.stopPoll();
    this._timer = setInterval(() => {
      const phase = this.data.queue && this.data.queue.phase;
      if (['queued', 'making', 'ready', 'paid'].includes(phase) || ['paid', 'making', 'ready'].includes(this.data.order && this.data.order.status)) {
        if (this.data.order && this.data.order.status === 'done') {
          this.stopPoll();
          return;
        }
        this.load(true);
      }
    }, 4000);
  },

  stopPoll() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  async load(silent) {
    try {
      const data = await request(`/api/orders/${this.id}`);
      const extras = (data.order.extras || []).map((e) => e.name).join('、');
      const queue = data.queue || {};
      this.setData({
        order: data.order,
        qrDataUrl: data.qrDataUrl || '',
        extraText: extras,
        statusText: STATUS[data.order.status] || data.order.status,
        queue,
      });
      if (data.order.status === 'done' || data.order.status === 'cancelled') {
        this.stopPoll();
      }
    } catch (e) {
      if (!silent) wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  goOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goVideo() {
    if (!this.data.order) return;
    wx.navigateTo({ url: `/pages/video/video?id=${this.data.order.id}` });
  },
});
