/**
 * 支付联调：一律走线上（真实微信支付）
 * 测完本地可改回：develop → DEV，trial/release → PROD
 */
const PROD = 'https://sijixiansheng.xin';
const DEV = 'http://192.168.1.50:3000';

function resolveBaseUrl() {
  return PROD;
}

const config = {
  baseUrl: resolveBaseUrl(),
  shopName: '四季果先',
  // DEV 保留备用：本地联调时改 resolveBaseUrl
  _dev: DEV,
};

module.exports = config;
