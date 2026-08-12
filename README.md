# 四季果先 · 果切小程序

顾客端选规格下单 → 支付 → 生成取餐码/二维码 → 门店管理端打印贴纸贴杯。

## 项目结构

```
sijiguoxian/
├── server/          # Node.js 后端（零 npm 依赖，Node 18+ 即可）
├── admin/           # 门店管理端（浏览器）
├── miniprogram/     # 微信小程序顾客端
├── assets/logo.png  # 品牌 Logo
└── docs/HARDWARE.md # 打印机硬件说明
```

## 快速启动

### 1. 启动后端 + 管理端

```bash
cd /home/wujie/work/sijiguoxian
./start.sh
```

或：

```bash
cd server && node src/index.js
```

- API / 管理端：http://localhost:3000/admin/
- 默认账号：`admin` / `admin123`
- 当前为 **模拟支付**（`PAY_MODE=mock`），点支付即成功并出码
- 管理端可开「新单提示音」「新单自动打印」（需允许浏览器弹窗）

### 2. 导入小程序

1. 打开[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入目录 `miniprogram`
3. 详情 → 本地设置 → 勾选「不校验合法域名」
4. 修改 `miniprogram/utils/config.js` 的 `baseUrl`（真机请填电脑局域网 IP，如 `http://192.168.1.8:3000`）

## 功能清单

| 端 | 能力 |
|----|------|
| 小程序 | 浏览果切、选规格/加料、下单支付、展示取餐码+二维码、订单列表 |
| 管理端 | 今日概览、订单状态、一键打印标签、商品规格维护、取餐码核销 |
| 后端 | 订单、模拟/真实支付开关、取餐码序号、标签 HTML、数据存 `server/data/db.json` |

## 打印贴纸要买什么硬件？

**推荐起步（约 300–600 元）：**

1. **热敏标签打印机**（USB）：汉印 / 佳博 / 芯烨  
2. **40×30mm 或 50×30mm 热敏不干胶标签纸**（防水更好）  
3. 电脑打开管理端 → 订单点「打印标签」→ 选打印机 → 贴纸贴杯盖  

也可买 **蓝牙标签机**（精臣等）手机打，或 **云打印机**（飞鹅/易联云）实现支付后自动出纸。

完整说明见 [docs/HARDWARE.md](./docs/HARDWARE.md)。

## 上线微信支付 + 云打印

完整步骤见 [docs/PAY_AND_PRINT.md](./docs/PAY_AND_PRINT.md)。

摘要：

1. `.env` 设 `PAY_MODE=wechat`，填写 `WX_APPID / WX_SECRET / WX_MCH_ID / WX_API_KEY / WX_NOTIFY_URL`
2. `.env` 设 `CLOUD_PRINT_ENABLED=true`，按飞鹅或易联云填写对应参数
3. 支付成功后自动：出取餐码 → 推送到云打印机

## 品牌色

- 主橙 `#F5A623`
- 叶绿 `#4CAF50`
