/**
 * 进货台账
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseInvoiceImage } = require('./ocrInvoice');

const INVOICE_DIR = path.join(__dirname, '..', 'uploads', 'invoices');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function ensurePurchases(db) {
  if (!Array.isArray(db.purchases)) db.purchases = [];
  return db.purchases;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      name: String(it?.name || '').trim() || '商品',
      qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
      unit: String(it?.unit || '').trim(),
      amount: round2(it?.amount),
    }))
    .filter((it) => it.name);
}

function normalizeRecord(input, existing = null) {
  const now = Date.now();
  const id = existing?.id || crypto.randomUUID();
  const source = input.source === 'invoice' || existing?.source === 'invoice' ? 'invoice' : 'manual';
  return {
    id,
    date: String(input.date || existing?.date || '').trim() || '',
    supplier: String(input.supplier || existing?.supplier || '').trim(),
    taxNo: String(input.taxNo || existing?.taxNo || '').trim(),
    invoiceNo: String(input.invoiceNo || existing?.invoiceNo || '').trim(),
    amount: round2(input.amount != null ? input.amount : existing?.amount),
    taxAmount: round2(input.taxAmount != null ? input.taxAmount : existing?.taxAmount),
    items: normalizeItems(input.items != null ? input.items : existing?.items),
    note: String(input.note != null ? input.note : existing?.note || '').trim(),
    invoiceUrl: String(input.invoiceUrl != null ? input.invoiceUrl : existing?.invoiceUrl || '').trim(),
    source,
    ocrRaw: input.ocrRaw !== undefined ? input.ocrRaw : existing?.ocrRaw || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function listPurchases(db) {
  return ensurePurchases(db)
    .slice()
    .sort((a, b) => {
      const da = String(a.date || '');
      const db_ = String(b.date || '');
      if (da !== db_) return db_.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
}

function createPurchase(db, body) {
  ensurePurchases(db);
  const rec = normalizeRecord(body || {});
  if (!rec.date && !rec.supplier && !rec.amount) {
    const err = new Error('请至少填写日期、供应商或金额');
    err.status = 400;
    throw err;
  }
  db.purchases.unshift(rec);
  return rec;
}

function updatePurchase(db, id, body) {
  ensurePurchases(db);
  const idx = db.purchases.findIndex((p) => p && p.id === id);
  if (idx < 0) {
    const err = new Error('进货单不存在');
    err.status = 404;
    throw err;
  }
  const rec = normalizeRecord(body || {}, db.purchases[idx]);
  db.purchases[idx] = rec;
  return rec;
}

function removePurchase(db, id) {
  ensurePurchases(db);
  const idx = db.purchases.findIndex((p) => p && p.id === id);
  if (idx < 0) {
    const err = new Error('进货单不存在');
    err.status = 404;
    throw err;
  }
  const [removed] = db.purchases.splice(idx, 1);
  return removed;
}

function saveInvoiceBuffer(buf, ext) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'].includes(ext) ? ext : 'jpg';
  const filename = `inv-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${safeExt}`;
  const filePath = path.join(INVOICE_DIR, filename);
  fs.writeFileSync(filePath, buf);
  return {
    filename,
    filePath,
    url: `/uploads/invoices/${filename}`,
  };
}

async function uploadAndParseInvoice(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  const ext = ct.includes('png')
    ? 'png'
    : ct.includes('webp')
      ? 'webp'
      : ct.includes('gif')
        ? 'gif'
        : ct.includes('pdf')
          ? 'pdf'
          : 'jpg';
  const saved = saveInvoiceBuffer(buf, ext);
  let parsed;
  try {
    parsed = await parseInvoiceImage(saved.filePath);
  } catch (e) {
    parsed = {
      configured: true,
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
        ocrMessage: e.message || '识别失败',
      },
    };
  }
  const draft = {
    ...(parsed.draft || {}),
    invoiceUrl: saved.url,
    source: 'invoice',
  };
  return {
    url: saved.url,
    draft,
    ocrConfigured: !!parsed.configured,
    ocrRaw: parsed.raw,
  };
}

module.exports = {
  ensurePurchases,
  listPurchases,
  createPurchase,
  updatePurchase,
  removePurchase,
  uploadAndParseInvoice,
  INVOICE_DIR,
};
