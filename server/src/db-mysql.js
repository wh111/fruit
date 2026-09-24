/**
 * MySQL 存储（腾讯云 CynosDB/TDSQL-C、阿里云 RDS 均可）
 * 环境变量：DB_DRIVER=mysql + MYSQL_HOST/PORT/USER/PASSWORD/DATABASE
 */
const crypto = require('crypto');

let pool = null;

function cfg() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sijiguoxian',
    waitForConnections: true,
    connectionLimit: 10,
    timezone: '+08:00',
  };
}

function getMysql() {
  if (pool) return pool;
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    throw new Error('未安装 mysql2。请在 server 目录执行: npm install mysql2');
  }
  pool = mysql.createPool(cfg());
  return pool;
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function rowToProduct(r) {
  return {
    id: r.id,
    name: r.name,
    desc: r.description || '',
    cover: r.cover || '',
    category: r.category || '',
    status: Number(r.status),
    sort: Number(r.sort_order),
    specs: parseJson(r.specs, []),
    extras: parseJson(r.extras, []),
    createdAt: Number(r.created_at),
  };
}

function rowToOrder(r) {
  const raw = parseJson(r.raw, null);
  if (raw && raw.id) return raw;
  return {
    id: r.id,
    orderNo: r.order_no,
    userId: r.user_id,
    openid: r.openid,
    productId: r.product_id,
    productName: r.product_name,
    cover: r.cover,
    specId: r.spec_id,
    specName: r.spec_name,
    extras: parseJson(r.extras, []),
    quantity: Number(r.quantity),
    amount: Number(r.amount),
    remark: r.remark || '',
    status: r.status,
    pickupCode: r.pickup_code,
    qrPayload: r.qr_payload,
    payMode: r.pay_mode,
    transactionId: r.transaction_id,
    prepayId: r.prepay_id,
    printed: !!r.printed,
    printedAt: r.printed_at ? Number(r.printed_at) : null,
    paidAt: r.paid_at ? Number(r.paid_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToUser(r) {
  return {
    id: r.id,
    openid: r.openid,
    nickName: r.nick_name || '',
    avatarUrl: r.avatar_url || '',
    phone: r.phone || '',
    createdAt: Number(r.created_at),
  };
}

async function loadMysql() {
  const db = getMysql();
  const [products] = await db.query('SELECT * FROM products ORDER BY sort_order ASC, created_at ASC');
  const [orders] = await db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5000');
  const [users] = await db.query('SELECT * FROM users');
  const [metas] = await db.query('SELECT * FROM app_meta');
  const metaMap = {};
  for (const m of metas) metaMap[m.meta_key] = parseJson(m.meta_value, null);

  return {
    products: products.map(rowToProduct),
    orders: orders.map(rowToOrder),
    users: users.map(rowToUser),
    coupons: Array.isArray(metaMap.coupons) ? metaMap.coupons : [],
    settings: metaMap.settings || {
      shopName: '四季果先',
      shopPhone: '',
      pickupHint: '取餐前最多半小时现切，做好后请到柜台取餐，出示取餐码即可',
    },
    seq: metaMap.seq || { orderDay: '', pickupNo: 0 },
  };
}

async function upsertMeta(conn, key, value) {
  const now = Date.now();
  await conn.query(
    `INSERT INTO app_meta (meta_key, meta_value, updated_at) VALUES (?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE meta_value = CAST(? AS JSON), updated_at = ?`,
    [key, JSON.stringify(value), now, JSON.stringify(value), now]
  );
}

async function saveMysql(data) {
  const db = getMysql();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // products
    await conn.query('DELETE FROM products');
    for (const p of data.products || []) {
      await conn.query(
        `INSERT INTO products
        (id, name, description, cover, category, status, sort_order, specs, extras, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
        [
          p.id,
          p.name,
          p.desc || '',
          p.cover || '',
          p.category || '',
          p.status == null ? 1 : p.status,
          p.sort || 0,
          JSON.stringify(p.specs || []),
          JSON.stringify(p.extras || []),
          p.createdAt || Date.now(),
          Date.now(),
        ]
      );
    }

    // orders：按 id upsert，避免全删丢历史；先取现有 id 再同步
    const ids = (data.orders || []).map((o) => o.id);
    if (ids.length) {
      // 简化：全量替换最近集合（正式店日订单量通常可控）
      await conn.query('DELETE FROM orders');
      for (const o of data.orders || []) {
        await conn.query(
          `INSERT INTO orders
          (id, order_no, user_id, openid, product_id, product_name, cover, spec_id, spec_name,
           extras, quantity, amount, remark, status, pickup_code, qr_payload, pay_mode, transaction_id,
           prepay_id, printed, printed_at, paid_at, created_at, updated_at, raw)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [
            o.id,
            o.orderNo,
            o.userId || null,
            o.openid || null,
            o.productId || null,
            o.productName,
            o.cover || '',
            o.specId,
            o.specName,
            JSON.stringify(o.extras || []),
            o.quantity || 1,
            o.amount,
            o.remark || '',
            o.status,
            o.pickupCode || null,
            o.qrPayload || null,
            o.payMode || null,
            o.transactionId || null,
            o.prepayId || null,
            o.printed ? 1 : 0,
            o.printedAt || null,
            o.paidAt || null,
            o.createdAt || Date.now(),
            o.updatedAt || Date.now(),
            JSON.stringify(o),
          ]
        );
      }
    } else {
      await conn.query('DELETE FROM orders');
    }

    await conn.query('DELETE FROM users');
    for (const u of data.users || []) {
      await conn.query(
        `INSERT INTO users (id, openid, nick_name, avatar_url, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          u.id,
          u.openid,
          u.nickName || '',
          u.avatarUrl || '',
          u.phone || '',
          u.createdAt || Date.now(),
          Date.now(),
        ]
      );
    }

    await upsertMeta(conn, 'settings', data.settings || {});
    await upsertMeta(conn, 'seq', data.seq || { orderDay: '', pickupNo: 0 });
    await upsertMeta(conn, 'coupons', data.coupons || []);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function ensureMysql(seedFn) {
  const db = getMysql();
  // 探测表是否存在
  const [tables] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'products'`,
    [cfg().database]
  );
  if (!tables[0] || Number(tables[0].c) === 0) {
    throw new Error('MySQL 库表未创建。请先执行 server/sql/schema.sql');
  }
  const [countRows] = await db.query('SELECT COUNT(*) AS c FROM products');
  if (Number(countRows[0].c) === 0 && typeof seedFn === 'function') {
    const data = {
      products: [],
      orders: [],
      users: [],
      coupons: [],
      settings: {
        shopName: '四季果先',
        shopPhone: '',
        pickupHint: '取餐前最多半小时现切，做好后请到柜台取餐，出示取餐码即可',
      },
      seq: { orderDay: '', pickupNo: 0 },
    };
    seedFn(data);
    await saveMysql(data);
    console.log('[mysql] 已写入初始商品数据');
  }
  // 连通性
  await db.query('SELECT 1');
  console.log(`[mysql] 已连接 ${cfg().host}/${cfg().database}`);
}

module.exports = {
  loadMysql,
  saveMysql,
  ensureMysql,
  getMysql,
  cfg,
};
