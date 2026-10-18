# market-web-kit

面向非洲 / 东南亚内容站与落地页的**可复用脚手架**（阿泰专用）。  
当前阶段只做基建：搭站 → 本地预览 → 静态构建 → 免费路径上线。**不必先定死品类。**

## 环境要求（本盒子已具备）

| 工具 | 状态 |
|------|------|
| Node.js ≥ 18 | ✅ v20 |
| npm / npx | ✅ |
| pnpm | ✅（可选） |
| git / gh | ✅ |
| Python 3 | ✅（备用本地静态服务） |

首次进入目录执行一次：

```bash
cd /workspace/market-web-kit
npm install
```

## 目录结构

```
market-web-kit/
├── README.md          # 本说明
├── DEPLOY.md          # 部署全流程（中文）
├── package.json
├── scripts/
│   ├── start.sh       # 默认启动预览
│   ├── preview.sh     # 预览指定站点
│   ├── build.sh       # 输出到 dist/
│   └── new-site.sh    # 从样例克隆新站
├── shared/css/        # 全站共用样式
├── sites/             # 每个小站一个文件夹
│   └── ph-howto-sample/   # 菲律宾英文 how-to 样例
└── dist/              # build 产物（勿手改，可部署）
```

## 本地预览

```bash
cd /workspace/market-web-kit
npm start
# 等价于：npm run preview -- ph-howto-sample
# 浏览器打开：http://127.0.0.1:4173/sites/ph-howto-sample/
```

预览服务挂在**整仓根目录**（这样才能加载 `shared/css`）。其他站点地址规则：

```text
http://127.0.0.1:4173/sites/<站点文件夹名>/
```

```bash
npm run preview -- <站点文件夹名>
# 换端口：PORT=5173 npm run preview -- ph-howto-sample
```

## 新增一个站点

```bash
npm run new-site -- my-new-niche
# 会从 ph-howto-sample 复制到 sites/my-new-niche/
```

然后：

1. 改 `sites/my-new-niche/*.html` 标题、正文、FAQ  
2. 需要时调 `css/style.css` 或 `shared/css/base.css`  
3. `npm run preview -- my-new-niche` 自测  
4. `npm run build -- my-new-niche` → 产物在 `dist/my-new-niche/`  
5. 按 `DEPLOY.md` 上线

站点 slug 规则：小写字母、数字、连字符（如 `ph-gcash-howto`、`ke-momo-guide`）。

## 构建（部署前）

```bash
# 只构建一个站
npm run build -- ph-howto-sample

# 构建 sites/ 下全部
npm run build
```

构建会把 `shared/css` 拷进 `dist/<site>/_shared/`，并改写 CSS 引用，保证**单独上传某站目录也能正常显示样式**。

## 样例站说明

`sites/ph-howto-sample`：菲律宾英文「GCash 在 7-Eleven 充值」how-to 落地页占位内容。

- 带 `noindex`，避免误被收录  
- 文案仅为脚手架演示，上线前请换成核实过的步骤与费用  

## 下一步

- 部署步骤、域名、需要你提供的 Token → 见 **[DEPLOY.md](./DEPLOY.md)**  
- 品类与关键词仍可继续摸；本仓库不绑定最终方向  

## 常用命令速查

| 命令 | 作用 |
|------|------|
| `npm start` | 预览样例站 |
| `npm run preview -- <slug>` | 预览指定站 |
| `npm run new-site -- <slug>` | 新建站 |
| `npm run build [-- <slug>]` | 打静态包到 dist/ |
