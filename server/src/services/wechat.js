const crypto = require('crypto');
const http = require('http');
const https = require('https');

/**
 * 微信支付（APIv2）· 默认按「个体工商户直连」
 *
 * 推荐（先办个体户再自己开户）：
 *   WX_APPID / WX_SECRET / WX_MCH_ID / WX_API_KEY / WX_NOTIFY_URL
 *   不填 WX_SUB_MCH_ID
 *
 * 可选：服务商通道（不推荐作首选）再填 WX_SUB_MCH_ID、WX_SP_APPID
 */
function cfg() {
  const appId = process.env.WX_APPID || '';
  const subMchId = process.env.WX_SUB_MCH_ID || '';
  const partner = Boolean(subMchId) || process.env.WX_MCH_MODE === 'partner';
  return {
    /** 小程序 AppID（登录 + 调起支付签名） */
    appId,
    secret: process.env.WX_SECRET || '',
    /** 直连=小微/普通商户号；服务商模式=服务商商户号 */
    mchId: process.env.WX_MCH_ID || '',
    apiKey: process.env.WX_API_KEY || '',
    notifyUrl: process.env.WX_NOTIFY_URL || '',
    /** 服务商模式下的小微/特约子商户号 */
    subMchId,
    /** 服务商 AppID；不填则与小程序 AppID 相同（少数通道如此） */
    spAppId: process.env.WX_SP_APPID || appId,
    partner,
  };
}

function assertPayConfig() {
  const c = cfg();
  const miss = [];
  if (!c.appId) miss.push('WX_APPID');
  if (!c.mchId) miss.push('WX_MCH_ID');
  if (!c.apiKey) miss.push('WX_API_KEY');
  if (!c.notifyUrl) miss.push('WX_NOTIFY_URL');
  if (c.partner && !c.subMchId) miss.push('WX_SUB_MCH_ID');
  if (miss.length) {
    throw Object.assign(new Error(`微信支付未配置完整：缺少 ${miss.join(', ')}`), { status: 400 });
  }
  return c;
}

function nonceStr(len = 32) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}

/** 微信签名（MD5），排除 sign / 空值 */
function signMd5(params, apiKey) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort();
  const str = keys.map((k) => `${k}=${params[k]}`).join('&') + `&key=${apiKey}`;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

function toXml(obj) {
  const body = Object.keys(obj)
    .map((k) => {
      const v = obj[k];
      if (v === undefined || v === null) return '';
      const s = String(v);
      if (/[<>&'"]/.test(s)) return `<${k}><![CDATA[${s}]]></${k}>`;
      return `<${k}>${s}</${k}>`;
    })
    .join('');
  return `<xml>${body}</xml>`;
}

function fromXml(xml) {
  const out = {};
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function requestText(url, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestJson(url, { method = 'GET', bodyObj = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ raw: text });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let tokenCache = { token: '', expireAt: 0 };

async function getAccessToken(force = false) {
  const { appId, secret } = cfg();
  if (!appId || !secret) {
    throw Object.assign(new Error('未配置 WX_APPID / WX_SECRET'), { status: 400 });
  }
  if (!force && tokenCache.token && Date.now() < tokenCache.expireAt - 60_000) {
    return tokenCache.token;
  }
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`;
  const data = await requestJson(url);
  if (!data.access_token) {
    throw Object.assign(new Error(data.errmsg || '获取 access_token 失败'), { status: 400, raw: data });
  }
  tokenCache = {
    token: data.access_token,
    expireAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
  };
  return tokenCache.token;
}

/**
 * 手机号快速验证组件返回的 code → 真实手机号
 * @see https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html
 */
async function getUserPhoneNumber(code) {
  if (!code) throw Object.assign(new Error('缺少手机号 code'), { status: 400 });
  // 开发/无密钥：允许 mock_13800138000 形式
  if (String(code).startsWith('mock_')) {
    const phone = String(code).slice(5).replace(/\D/g, '');
    if (phone.length < 11) throw Object.assign(new Error('模拟手机号无效'), { status: 400 });
    return { phoneNumber: phone, purePhoneNumber: phone, countryCode: '86' };
  }
  let token = await getAccessToken();
  let data = await requestJson(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`,
    { method: 'POST', bodyObj: { code } }
  );
  if (data.errcode === 40001 || data.errcode === 42001) {
    token = await getAccessToken(true);
    data = await requestJson(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`,
      { method: 'POST', bodyObj: { code } }
    );
  }
  if (data.errcode && data.errcode !== 0) {
    throw Object.assign(new Error(data.errmsg || '获取手机号失败'), { status: 400, raw: data });
  }
  const info = data.phone_info || {};
  const phone = String(info.purePhoneNumber || info.phoneNumber || '').replace(/\D/g, '');
  if (!phone) throw Object.assign(new Error('未返回手机号'), { status: 400, raw: data });
  return {
    phoneNumber: info.phoneNumber || phone,
    purePhoneNumber: phone,
    countryCode: info.countryCode || '86',
  };
}

function maskPhone(phone) {
  const s = String(phone || '').replace(/\D/g, '');
  if (s.length < 7) return s ? `${s.slice(0, 2)}****` : '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 旧版 getPhoneNumber：用 session_key 解密 encryptedData */
function decryptPhoneData(sessionKey, encryptedData, iv) {
  if (!sessionKey || !encryptedData || !iv) {
    throw Object.assign(new Error('缺少 session_key / encryptedData / iv'), { status: 400 });
  }
  try {
    const key = Buffer.from(sessionKey, 'base64');
    const ivBuf = Buffer.from(iv, 'base64');
    const data = Buffer.from(encryptedData, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuf);
    decipher.setAutoPadding(true);
    let decoded = decipher.update(data, undefined, 'utf8');
    decoded += decipher.final('utf8');
    const parsed = JSON.parse(decoded);
    const phone = String(parsed.purePhoneNumber || parsed.phoneNumber || '').replace(/\D/g, '');
    if (!phone) throw new Error('解密结果无手机号');
    return {
      phoneNumber: parsed.phoneNumber || phone,
      purePhoneNumber: phone,
      countryCode: parsed.countryCode || '86',
    };
  } catch (e) {
    throw Object.assign(new Error(`手机号解密失败：${e.message}`), { status: 400 });
  }
}

/** code2session 换 openid（始终用小程序 AppID/Secret） */
async function code2Session(code) {
  const { appId, secret } = cfg();
  if (!appId || !secret) {
    throw Object.assign(new Error('未配置 WX_APPID / WX_SECRET'), { status: 400 });
  }
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const text = await requestText(url);
  const data = JSON.parse(text);
  if (!data.openid) {
    throw Object.assign(new Error(data.errmsg || '微信登录失败'), { status: 400, raw: data });
  }
  return data;
}

/**
 * 小程序统一下单 JSAPI
 * @returns {{ prepayId, payment }} payment 可直接给 wx.requestPayment
 */
async function createJsapiPrepay({ orderNo, amountYuan, openid, description, clientIp }) {
  const c = assertPayConfig();
  if (!openid) {
    throw Object.assign(new Error('缺少用户 openid，请先完成微信登录'), { status: 400 });
  }
  const totalFee = Math.round(Number(amountYuan) * 100);
  if (!totalFee || totalFee < 1) {
    throw Object.assign(new Error('支付金额无效'), { status: 400 });
  }

  const params = {
    nonce_str: nonceStr(16),
    body: String(description || '四季果先果切').slice(0, 120),
    out_trade_no: orderNo,
    total_fee: totalFee,
    spbill_create_ip: clientIp || '127.0.0.1',
    notify_url: c.notifyUrl,
    trade_type: 'JSAPI',
  };

  if (c.partner) {
    // 服务商 / 小微商户通道
    params.appid = c.spAppId;
    params.mch_id = c.mchId;
    params.sub_mch_id = c.subMchId;
    params.sub_appid = c.appId;
    params.sub_openid = openid;
  } else {
    // 直连：官方小微商户或普通商户
    params.appid = c.appId;
    params.mch_id = c.mchId;
    params.openid = openid;
  }

  params.sign = signMd5(params, c.apiKey);

  const xml = toXml(params);
  const respXml = await requestText('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST',
    body: xml,
    headers: { 'Content-Type': 'text/xml' },
  });
  const data = fromXml(respXml);
  if (data.return_code !== 'SUCCESS') {
    throw Object.assign(new Error(data.return_msg || '统一下单失败'), { status: 502, raw: data });
  }
  if (data.result_code !== 'SUCCESS') {
    throw Object.assign(new Error(data.err_code_des || data.err_code || '统一下单业务失败'), {
      status: 502,
      raw: data,
    });
  }

  const prepayId = data.prepay_id;
  const payment = buildJsapiPayment(prepayId);
  return { prepayId, payment, raw: data, mode: c.partner ? 'partner' : 'direct' };
}

function buildJsapiPayment(prepayId) {
  const c = assertPayConfig();
  // 在自家小程序里调起支付，签名 appId 必须是小程序 AppID
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const ns = nonceStr(16);
  const pkg = `prepay_id=${prepayId}`;
  const payParams = {
    appId: c.appId,
    timeStamp,
    nonceStr: ns,
    package: pkg,
    signType: 'MD5',
  };
  const paySign = signMd5(payParams, c.apiKey);
  return {
    timeStamp,
    nonceStr: ns,
    package: pkg,
    signType: 'MD5',
    paySign,
  };
}

/** 查单（前端支付成功后兜底确认） */
async function queryOrder(orderNo) {
  const c = assertPayConfig();
  const params = {
    out_trade_no: orderNo,
    nonce_str: nonceStr(16),
  };
  if (c.partner) {
    params.appid = c.spAppId;
    params.mch_id = c.mchId;
    params.sub_mch_id = c.subMchId;
  } else {
    params.appid = c.appId;
    params.mch_id = c.mchId;
  }
  params.sign = signMd5(params, c.apiKey);
  const respXml = await requestText('https://api.mch.weixin.qq.com/pay/orderquery', {
    method: 'POST',
    body: toXml(params),
    headers: { 'Content-Type': 'text/xml' },
  });
  return fromXml(respXml);
}

function verifyNotifySign(data) {
  const c = cfg();
  if (!c.apiKey) return false;
  const sign = data.sign;
  const calc = signMd5(data, c.apiKey);
  return sign && sign === calc;
}

function notifySuccessXml() {
  return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>';
}

function notifyFailXml(msg) {
  return `<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[${msg || 'ERR'}]]></return_msg></xml>`;
}

module.exports = {
  cfg,
  assertPayConfig,
  code2Session,
  createJsapiPrepay,
  buildJsapiPayment,
  queryOrder,
  verifyNotifySign,
  fromXml,
  toXml,
  notifySuccessXml,
  notifyFailXml,
  signMd5,
  requestText,
  requestJson,
  getAccessToken,
  getUserPhoneNumber,
  decryptPhoneData,
  maskPhone,
};
