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
};
