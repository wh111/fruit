/**
 * develop（开发者工具）→ 本机局域网
 * trial / release → 已备案域名
 */
const PROD = 'https://sijixiansheng.xin';
const DEV = 'http://10.17.0.44:3000';

function resolveBaseUrl() {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    if (env === 'develop') return DEV;
  } catch (_) {
    /* ignore */
  }
  return PROD;
}

const config = {
  baseUrl: resolveBaseUrl(),
  shopName: '四季果先',
};

module.exports = config;
