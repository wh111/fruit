# 真实微信支付 + 云打印机配置

## 一、微信支付（小程序 JSAPI）

### 1. 准备材料

1. 已认证的**微信小程序**（拿到 AppID、AppSecret）
2. **微信支付商户号**（mch_id），并在商户平台完成小程序绑定
3. 商户平台 → API 安全 → 设置 **APIv2 密钥**（32 位，即 `WX_API_KEY`）
4. 一台有公网 HTTPS 的服务器（支付回调必须公网可访问）

### 2. 填写 `server/.env`

```bash
PAY_MODE=wechat

WX_APPID=wx你的小程序AppID
WX_SECRET=你的小程序AppSecret
WX_MCH_ID=你的商户号
WX_API_KEY=你的APIv2密钥32位
WX_NOTIFY_URL=https://你的域名/api/pay/notify
```

说明：

- `WX_NOTIFY_URL` 必须是 **HTTPS**，且外网可访问（不要用 localhost）
- 本地开发可用内网穿透（ngrok / 花生壳 / frp）把 3000 端口映射出去，再填到 `WX_NOTIFY_URL`
- 开发阶段可继续 `PAY_MODE=mock` 测流程；上线改 `wechat`

### 3. 微信后台配置

1. 小程序后台 → 开发 → 开发管理 → 服务器域名  
   - request 合法域名：你的 API 域名  
2. 商户平台 → 产品中心 → 确认已开通 **JSAPI 支付**  
3. 商户平台 → 产品中心 → AppID 账号管理 → 关联小程序 AppID  

### 4. 小程序端

1. `miniprogram/project.config.json` 里填真实 `appid`  
2. `miniprogram/utils/config.js` 的 `baseUrl` 填 HTTPS API 地址  
3. 真机预览：用户先登录（会换真实 openid）再支付  

### 5. 支付流程（已实现）

1. `POST /api/auth/wxlogin` → code2session 拿 openid  
2. `POST /api/orders` → 创建待支付订单  
3. `POST /api/pay/create` → 微信统一下单 → 返回 `wx.requestPayment` 参数  
4. 用户付款成功  
5. 微信回调 `POST /api/pay/notify` → 验签 → 出取餐码 → **自动云打印**  
6. 小程序再调 `POST /api/pay/confirm` 查单兜底，展示取餐码页  

---

## 二、云打印机

支付成功后，后端会自动调用云打印（`CLOUD_PRINT_ENABLED=true`）。

### 方案 A：飞鹅云（推荐，对接已写好）

1. 购买飞鹅云小票机（带网线/Wi-Fi，支持云）  
2. 打开 [飞鹅开放平台](https://admin.feieyun.com/) 注册，添加打印机拿到 **SN**  
3. 在开放平台拿到 USER、UKEY  

```bash
CLOUD_PRINT_ENABLED=true
CLOUD_PRINT_PROVIDER=feie
CLOUD_PRINT_USER=你的飞鹅账号邮箱或用户名
CLOUD_PRINT_UKEY=你的UKEY
CLOUD_PRINT_SN=打印机编号SN
```

打印内容含：店名、取餐码大字、品名规格、金额、二维码。

### 方案 B：易联云

```bash
CLOUD_PRINT_ENABLED=true
CLOUD_PRINT_PROVIDER=yilianyun
YLY_CLIENT_ID=应用ID
YLY_CLIENT_SECRET=应用密钥
YLY_MACHINE_CODE=打印机终端号
# 可选：长期 token，不填则自动用 client_credentials 换
# YLY_ACCESS_TOKEN=
```

### 管理端补打

- 浏览器「打印标签」：USB/本地标签机  
- `POST /api/print/cloud` + `{ "orderId": "..." }`：再推一单到云打印机  

---

## 三、推荐上线清单

| 项目 | 说明 |
|------|------|
| HTTPS 域名 + 服务器 | 跑 `node src/index.js` 或前面加 Nginx |
| `.env` 微信支付五项 | PAY_MODE=wechat + WX_* |
| `.env` 云打印 | CLOUD_PRINT_ENABLED=true + 厂商参数 |
| 小程序 AppID | project.config.json + 合法域名 |
| 标签机（可选） | 管理端精细贴纸；云打印机负责后厨出票 |

改完 `.env` 后重启：

```bash
cd /home/wujie/work/sijiguoxian
./start.sh
```
