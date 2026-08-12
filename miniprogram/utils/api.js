const config = require('./config');

function request(path, options = {}) {
  const token = wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...(options.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.error) || '请求失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${config.baseUrl}${path}`;
}

async function ensureLogin() {
  let token = wx.getStorageSync('token');
  if (token) return token;
  const loginRes = await new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    });
  });
  const data = await request('/api/auth/wxlogin', {
    method: 'POST',
    data: { code: loginRes.code || `dev_${Date.now()}` },
  });
  wx.setStorageSync('token', data.token);
  wx.setStorageSync('user', data.user);
  const app = getApp();
  app.globalData.token = data.token;
  app.globalData.user = data.user;
  return data.token;
}

function rememberOrderId(id) {
  const ids = wx.getStorageSync('localOrderIds') || [];
  if (!ids.includes(id)) {
    ids.unshift(id);
    wx.setStorageSync('localOrderIds', ids.slice(0, 50));
  }
}

module.exports = {
  request,
  mediaUrl,
  ensureLogin,
  rememberOrderId,
  config,
};
