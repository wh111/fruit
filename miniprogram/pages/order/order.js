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
    sideMealText: '',
    itemLines: [],
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
      if (['queued', 'making', 'ready', 'paid', 'reserved'].includes(phase) || ['paid', 'making', 'ready'].includes(this.data.order && this.data.order.status)) {
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
      const extrasList = data.order.extras || [];
      const items = Array.isArray(data.order.items) ? data.order.items : [];
      const itemLines = items.map((it) => {
        const tops = (it.toppings || []).map((t) => t.name).filter(Boolean);
        return {
          name: `${it.productName} · ${it.specName}×${it.quantity}${
            tops.length ? `（${tops.join('、')}）` : ''
          }`,
        };
      });
      const toppings = items.length
        ? ''
        : extrasList
            .filter((e) => e && e.kind !== 'sideMeal')
            .map((e) => e.name)
            .join('、');
      const sideFromExtras = extrasList.find((e) => e && e.kind === 'sideMeal');
      const sideMealText =
        (sideFromExtras && sideFromExtras.name) ||
        (data.order.sideMeal && data.order.sideMeal.name
          ? `小食套餐·${data.order.sideMeal.name}`
          : '');
      const queue = data.queue || {};
      const isLocker = data.order.deliveryPoint && data.order.deliveryPoint !== 'shop';
      let statusText = STATUS[data.order.status] || data.order.status;
      if (data.order.fulfillmentType === 'reserve' && data.order.status === 'paid') {
        statusText = '已预约';
      } else if (data.order.status === 'ready' && isLocker) {
        statusText = '已投柜';
      }
      this.setData({
        order: data.order,
        qrDataUrl: data.qrDataUrl || '',
        extraText: toppings,
        sideMealText,
        itemLines,
        statusText,
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
});
