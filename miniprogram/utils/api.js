const config = require('./config');

function request(path, options = {}) {
  const token = wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: options.timeout || 15000,
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...(options.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
        }
      },
      fail(err) {
        const msg = (err && err.errMsg) || '网络错误';
        const tip = config.baseUrl;
        if (/合法域名|url not in domain list|not in domain/i.test(msg)) {
          reject(new Error(`域名未加入小程序白名单：${tip}。请在公众平台→开发管理→服务器域名，把 request/uploadFile/downloadFile 都填成该地址（需已 ICP 备案）`));
        } else if (/ssl|tls|certificate|握手/i.test(msg)) {
          reject(new Error(`HTTPS 失败：${tip}。请改用 4G 再试，办公室网络可能拦截该域名`));
        } else if (/timeout/i.test(msg)) {
          reject(new Error(`请求超时：${tip}`));
        } else if (/fail/i.test(msg)) {
          reject(new Error(`连不上后端 ${tip}。${msg}`));
        } else {
          reject(new Error(msg));
        }
      },
    });
  });
}

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${config.baseUrl}${path}`;
}

function wxLoginWithTimeout(ms = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve(code || `dev_${Date.now()}`);
    };
    const timer = setTimeout(() => finish(`dev_${Date.now()}`), ms);
    wx.login({
      success(res) {
        clearTimeout(timer);
        finish(res.code);
      },
      fail() {
        clearTimeout(timer);
        finish(`dev_${Date.now()}`);
      },
    });
  });
}

async function ensureLogin() {
  let token = wx.getStorageSync('token');
  if (token) return token;
  const code = await wxLoginWithTimeout(3000);
  const data = await request('/api/auth/wxlogin', {
    method: 'POST',
    data: { code },
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
