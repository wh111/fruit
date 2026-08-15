/**
 * 真机调试必须用电脑局域网 IP，不能用 127.0.0.1（那是手机自己）
 * 手机和电脑要同一网段；浏览器打开 http://IP:3000/api/health 能通即可
 */
const config = {
  baseUrl: 'http://10.17.0.44:3000',
  shopName: '四季果先',
};

module.exports = config;
