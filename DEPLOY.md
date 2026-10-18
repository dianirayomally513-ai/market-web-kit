# 部署指南（写内容 → 预览 → 上线）

## ✅ 已上线：GitHub Pages（一条命令发布）

- 仓库：https://github.com/dianirayomally513-ai/market-web-kit （公开）
- 站点总入口：https://dianirayomally513-ai.github.io/market-web-kit/
- 示例站：https://dianirayomally513-ai.github.io/market-web-kit/ph-howto-sample/

### 日常发布流程
```bash
cd /workspace/market-web-kit
git add -A && git commit -m "更新内容" && git push   # 保存源码到 main
npm run deploy                                         # 构建全部站点并发布到 gh-pages，约 1 分钟生效
```

`npm run deploy` 会：构建 `sites/` 下所有站点到 `dist/` → 生成总入口 `dist/index.html` → 强推到 `gh-pages` 分支，GitHub Pages 自动发布。

### 新增站点
```bash
npm run new-site -- my-new-site   # 写内容…
npm run deploy                    # 上线地址：.../market-web-kit/my-new-site/
```

> 说明：当前 GitHub 授权没有 `workflow` 权限，所以未使用 GitHub Actions 自动部署（push 即部署）。如需该方式，需重新授权 `gh auth refresh -s workflow` 后再添加 `.github/workflows/pages.yml`。
> 注意：仓库公开，不要提交 `.env` 或任何密钥。

---


目标：从本盒子把静态站发到**免费或低成本**托管。优先路径不依赖付费套餐。

---

## 总流程

```
改 sites/<slug>/ 内容
    → npm run preview -- <slug>     # 本地看一眼
    → npm run build -- <slug>       # 生成 dist/<slug>/
    → 选一种托管上传 dist/<slug>/
    → （可选）绑自定义域名
```

---

## 路径 A：GitHub Pages（推荐起步，免费）

**你需要提供**：一个 GitHub 账号；本机已装 `gh`（盒子上已有）。

### 1. 登录 GitHub CLI（一次性）

```bash
gh auth login
# 按提示：GitHub.com → HTTPS → 浏览器或 token 登录
```

### 2. 新建仓库并推送（示例：只放构建产物或整仓）

**方式 A2 — 整仓推送（保留源码，用 Actions 发布）**

```bash
cd /workspace/market-web-kit
git init   # 若尚未 init
gh repo create market-web-kit --private --source=. --remote=origin --push
```

在仓库 Settings → Pages → Source 选 **GitHub Actions**，并添加  
`.github/workflows/pages.yml`（可向助手要一份；核心是 build 后 upload `dist/<slug>`）。

**方式 A1 — 最快：把某个站的 dist 推到 `gh-pages` 分支**

```bash
cd /workspace/market-web-kit
npm run build -- ph-howto-sample
cd dist/ph-howto-sample
git init
git checkout -b gh-pages
git add .
git commit -m "deploy sample"
# 换成你的用户名/仓库名
gh repo create ph-howto-sample --public --source=. --remote=origin --push
```

然后在 GitHub 该仓库 → Settings → Pages → Branch 选 `gh-pages` / root。  
几分钟后得到：`https://<用户名>.github.io/ph-howto-sample/`

> 若站在子路径，注意资源用相对路径（本脚手架的 CSS/链接已是相对路径，适合子路径托管）。

---

## 路径 B：Cloudflare Pages（免费额度大，全球 CDN）

**你需要提供**：

1. Cloudflare 账号  
2. **API Token**（Permissions：Account → Cloudflare Pages → Edit；Zone → DNS → Edit 若要绑域名）  
3. **Account ID**（Dashboard 右侧可复制）

### 本盒子安装 CLI

```bash
cd /workspace/market-web-kit
npm install   # 已含可选依赖 wrangler
# 或：npm i -D wrangler
```

### 登录 / 配 Token

```bash
export CLOUDFLARE_API_TOKEN="粘贴你的token"
export CLOUDFLARE_ACCOUNT_ID="粘贴你的account id"
npx wrangler whoami
```

### 直接上传静态目录（无需先连 Git）

```bash
npm run build -- ph-howto-sample
npx wrangler pages project create market-ph-howto   # 首次
npx wrangler pages deploy dist/ph-howto-sample --project-name=market-ph-howto
```

成功后会给出 `*.pages.dev` 地址。

### 自定义域名

Cloudflare Dashboard → Workers & Pages → 你的项目 → Custom domains → 按提示加域名。  
域名 DNS 若已在 Cloudflare，通常一键完成；若在别处，按提示加 CNAME。

---

## 路径 C：Netlify CLI（免费档够用）

**你需要提供**：Netlify 账号 + Personal Access Token（或浏览器登录）。

```bash
cd /workspace/market-web-kit
npm install   # 含可选 netlify-cli
npm run build -- ph-howto-sample
npx netlify login          # 或：export NETLIFY_AUTH_TOKEN=...
npx netlify init           # 首次关联站点
npx netlify deploy --prod --dir=dist/ph-howto-sample
```

自定义域名：Netlify 后台 Domain management。

---

## 路径 D：本机 / 盒子临时演示（不上公网）

不装 nginx 时，任选其一：

```bash
# 已集成
npm run preview -- ph-howto-sample

# 或对构建产物
npm run build -- ph-howto-sample
python3 -m http.server 8080 --directory dist/ph-howto-sample
# 打开 http://127.0.0.1:8080
```

若以后要盒子上长期反代，可再装 nginx（需 apt，按需执行），当前**不是必须**。

---

## 路径 E：rsync 到已有 VPS（有服务器时）

```bash
npm run build -- ph-howto-sample
rsync -avz --delete dist/ph-howto-sample/ user@你的服务器:/var/www/ph-howto-sample/
```

服务器需已配置 nginx/Caddy 指向该目录（证书用 Let’s Encrypt）。  
**本盒子默认没有你的 VPS 密钥**——需要你自行 `ssh-copy-id` 或把私钥配好后再跑。

---

## 自定义域名注意事项（通用）

1. **先能打开 `*.github.io` / `*.pages.dev` / `*.netlify.app`**，再绑域名。  
2. DNS：常见是根域 A/ALIAS，或 `www` CNAME 到托管方给的目标。  
3. HTTPS：上述三家免费托管都会自动签证书，DNS 生效后等 5–30 分钟。  
4. 菲律宾/非洲访客：Cloudflare Pages 延迟通常更稳；GitHub Pages 也够用。  
5. 样例站带了 `noindex`——正式站请删掉 meta robots，并换真实 `robots.txt`。

---

## 还需要你提供的凭证（清单）

| 用途 | 是否必须 | 你要准备的 |
|------|----------|------------|
| 仅本地预览 | 否 | 无 |
| GitHub Pages | 否（但推荐） | `gh auth login` 或 PAT |
| Cloudflare Pages | 否 | `CLOUDFLARE_API_TOKEN` + `ACCOUNT_ID` |
| Netlify | 否 | `NETLIFY_AUTH_TOKEN` 或 `netlify login` |
| 自定义域名 | 否 | 域名持有权 + DNS 控制台 |
| VPS rsync | 否 | SSH 账号与密钥 |

**把 Token 放进环境变量或 `.env`（勿提交 git）**。可参考根目录 `.env.example`。

---

## 推荐组合（预算紧）

1. **现在**：`npm start` 本地写内容  
2. **第一次上线**：GitHub Pages 或 Cloudflare Pages 免费域名  
3. **有流量后再**：买域名 → 绑到同一项目 → 再考虑广告/联盟代码  

CLI 已在 `package.json` 的 optionalDependencies 中声明；`npm install` 后即可用 `npx wrangler` / `npx netlify`。若 optional 安装失败，可单独：

```bash
npm i -D wrangler
npm i -D netlify-cli
```
