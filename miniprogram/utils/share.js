/** 开启右上角「转发 / 朋友圈」菜单 */
function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (_) {
    /* ignore */
  }
}

function homeShare() {
  return {
    title: '四季果先 · 现切果切 · 免洗什锦',
    path: '/pages/index/index',
  };
}

function productShare(product, coverUrl) {
  const name = (product && product.name) || '四季果先';
  const id = product && product.id;
  return {
    title: `${name} · 四季果先`,
    path: id ? `/pages/detail/detail?id=${id}` : '/pages/index/index',
    imageUrl: coverUrl || '',
  };
}

module.exports = {
  enableShareMenu,
  homeShare,
  productShare,
};
