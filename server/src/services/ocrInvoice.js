/**
 * 腾讯云增值税发票 OCR（可选）
 * 环境变量：OCR_SECRET_ID / OCR_SECRET_KEY
 * 或复用：TENCENT_SECRET_ID / TENCENT_SECRET_KEY / SECRET_ID / SECRET_KEY
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

function getCredentials() {
  const secretId =
    process.env.OCR_SECRET_ID ||
    process.env.TENCENT_SECRET_ID ||
    process.env.SECRET_ID ||
    '';
  const secretKey =
    process.env.OCR_SECRET_KEY ||
    process.env.TENCENT_SECRET_KEY ||
    process.env.SECRET_KEY ||
    '';
  if (!secretId || !secretKey) return null;
  return { secretId, secretKey };
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function tc3Sign({ secretId, secretKey, service, host, action, version, region, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = sha256hex(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    authorization,
    timestamp,
    action,
    version,
    region,
  };
}

function httpsPostJson(host, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: '/',
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`OCR 响应非 JSON: ${text.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OCR 请求超时'));
    });
    req.write(body);
    req.end();
  });
}

function infoMap(infos) {
  const map = {};
  for (const row of infos || []) {
    const name = String(row.Name || row.name || '').trim();
    const value = String(row.Value || row.value || '').trim();
    if (name) map[name] = value;
  }
  return map;
}

function pick(map, keys) {
  for (const k of keys) {
    if (map[k] != null && String(map[k]).trim() !== '') return String(map[k]).trim();
  }
  return '';
}

function parseAmount(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').replace(/元/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function draftFromVatResponse(resp) {
  const response = resp?.Response || resp || {};
  const map = infoMap(response.VatInvoiceInfos || response.InvoiceInfos || []);
  const items = [];
  const rawItems = response.Items || [];
  for (const it of rawItems) {
    items.push({
      name: String(it.Name || it.LineNo || '').trim() || '商品',
      qty: Number(it.Quantity) || 1,
      unit: String(it.Unit || '').trim() || '',
      amount: parseAmount(it.AmountWithTax || it.Total || it.AmountWithoutTax),
    });
  }

  const amount =
    parseAmount(pick(map, ['价税合计(小写)', '价税合计', '小写金额', '合计金额'])) ||
    parseAmount(pick(map, ['金额合计', '合计']));
  const taxAmount = parseAmount(pick(map, ['税额合计', '税额', '合计税额']));
  const supplier =
    pick(map, ['销售方名称', '销售方', '销方名称', '卖方名称']) ||
    pick(map, ['购买方名称', '购买方']);
  const taxNo = pick(map, ['销售方识别号', '销方识别号', '纳税人识别号', '销售方纳税人识别号']);
  const invoiceNo = pick(map, ['发票号码', '号码']);
  const date = normalizeDate(pick(map, ['开票日期', '日期']));

  return {
    date: date || '',
    supplier: supplier || '',
    taxNo: taxNo || '',
    invoiceNo: invoiceNo || '',
    amount,
    taxAmount,
    items,
    note: '',
    ocrOk: true,
    ocrMessage: '',
  };
}

/**
 * @param {string} filePath
 * @returns {Promise<{ draft: object, raw: object|null, configured: boolean }>}
 */
async function parseInvoiceImage(filePath) {
  const creds = getCredentials();
  if (!creds) {
    return {
      configured: false,
      raw: null,
      draft: {
        date: '',
        supplier: '',
        taxNo: '',
        invoiceNo: '',
        amount: 0,
        taxAmount: 0,
        items: [],
        note: '',
        ocrOk: false,
        ocrMessage: '未配置 OCR 密钥，请手动填写',
      },
    };
  }

  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const host = 'ocr.tencentcloudapi.com';
  const service = 'ocr';
  const action = 'VatInvoiceOCR';
  const version = '2018-11-19';
  const region = process.env.OCR_REGION || 'ap-guangzhou';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ ImageBase64: b64 });
  const signed = tc3Sign({
    secretId: creds.secretId,
    secretKey: creds.secretKey,
    service,
    host,
    action,
    version,
    region,
    payload,
    timestamp,
  });

  const resp = await httpsPostJson(
    host,
    {
      Authorization: signed.authorization,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version,
      'X-TC-Region': region,
    },
    payload
  );

  if (resp?.Response?.Error) {
    const err = resp.Response.Error;
    return {
      configured: true,
      raw: resp,
      draft: {
        date: '',
        supplier: '',
        taxNo: '',
        invoiceNo: '',
        amount: 0,
        taxAmount: 0,
        items: [],
        note: '',
        ocrOk: false,
        ocrMessage: `${err.Code || 'Error'}: ${err.Message || '识别失败'}`,
      },
    };
  }

  const draft = draftFromVatResponse(resp);
  return { configured: true, raw: resp, draft };
}

module.exports = {
  getCredentials,
  parseInvoiceImage,
};
