const { request } = require('../../utils/api');

Page({
  data: {
    shopName: '四季果先',
    shopPhone: '18813017847',
    shopContact: '',
    groupBuyHint: '',
    points: [
      '适合企业团建、部门下午茶、会议茶歇',
      '建议 10 份起订，可混搭现菜单品',
      '按预售波次取餐：12:00 / 18:00',
      '价格与配送细节电话确认即可',
    ],
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const shop = await request('/api/shop');
      this.setData({
        shopName: shop.shopName || '四季果先',
        shopPhone: shop.shopPhone || '18813017847',
        shopContact: shop.shopContact || '',
        groupBuyHint: shop.groupBuyHint || this.data.groupBuyHint,
      });
    } catch (_) {
      /* 本地默认号码仍可拨打 */
    }
  },

  callShop() {
    const phone = String(this.data.shopPhone || '').replace(/\s+/g, '');
    if (!phone) {
      wx.showToast({ title: '暂未配置电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => wx.showToast({ title: '无法拨号', icon: 'none' }),
    });
  },

  copyPhone() {
    const phone = String(this.data.shopPhone || '');
    if (!phone) return;
    wx.setClipboardData({
      data: phone,
      success: () => wx.showToast({ title: '已复制号码', icon: 'success' }),
    });
  },
});
