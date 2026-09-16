# Apple Music Web Player

仿 Apple Music 界面的网页播放器，音乐源为**直链音频文件**，浏览器端解析内嵌元数据（封面/歌手/专辑/歌词）。

## 功能

- 🎵 **直链播放**：在 `public/playlist.json` 里填写音频直链（FLAC / MP3 / M4A / OGG / WAV），刷新即加载
- 📝 **歌单即文件**：歌单就是仓库里的 `public/playlist.json`，一行一个 url，无界面管理
- 📻 **电台**：一键把资料库全部歌曲乱序无限播放；封面每次点播程序化随机生成
- 💽 **歌单卡片**：`public/playlists.json` 自定义歌单（按歌手/专辑/曲名筛选），首页推荐区卡片式展示，封面自动取成员专辑封面拼贴
- 🏷️ **元数据解析**：浏览器端用 `music-metadata` v11 解析内嵌封面、标题、歌手、专辑、歌词（ID3v2 / Vorbis Comment / MP4 atom）
- ⚡ **预解析缓存**：构建时自动生成 `public/meta.json` + `public/covers/`（已 gitignore，不入库），首页直接渲染，不再联网解析
- ⚡ **Range 分块**：未预解析的条目在浏览器端按需解析，只下载文件头部（默认 2MB），40MB FLAC 秒开信息
- 📜 **滚动歌词**：内嵌 LRC / SYLT 同步歌词逐行高亮滚动，支持点击跳转；自动尝试同路径 `.lrc` 外挂歌词。播放页右上角引号按钮切换歌词视图
- 🍎 **Apple Music 风格**：全屏播放页、封面主色调提取模糊背景、底部迷你播放栏、播放/暂停缩放动画
- 🌐 **CORS 兜底**：直链无跨域头时自动回落 `/api/proxy` 中转（同时支持 Range 透传）

## 更新歌单

1. 编辑 `public/playlist.json`，往数组里加音频直链（字符串数组，中文文件名需百分号编码）
2. `npm run build` 会自动先跑 `scripts/gen-meta.mjs` 解析新增条目（增量，已缓存的跳过）
3. 本地开发想即时预览，可手动跑一次 `pnpm meta` 再刷新页面

`meta.json` / `covers/` 都在 `.gitignore` 里，不会提交到仓库；部署时由构建步骤现生成。
强制全量重跑：`node scripts/gen-meta.mjs --force`；只重跑某一条：`--only <下标>`。
某条解析失败不影响构建，该曲目会退回浏览器端解析。

## 自定义歌单与电台

编辑 `public/playlists.json`（数组，顺序即首页展示顺序）：

```jsonc
[
  // 电台：唯一，点击即把全部歌曲乱序无限播放；封面程序化随机生成，每次点播换一张
  { "id": "radio", "type": "radio", "title": "无限电台", "subtitle": "资料库全部歌曲 · 随机无限播放" },

  {
    "id": "chill",                       // 唯一标识，同时用作程序化封面的种子
    "title": "一个人静静",
    "subtitle": "抒情慢歌",
    "artists": ["Enya", "M2M"]           // 精确匹配（忽略大小写/首尾空格），任一命中即收录
    // 也可用 titles / albums / urls（曲目直链）；"all": true 表示收录全部
  }
]
```

- 一首都没命中的歌单会自动隐藏，不会出现空卡片
- 歌单成员跟着 `meta.json` 的元数据走，改了歌手/专辑名不需要同步改歌单
- **封面规则**（按优先级）：`cover` 字段指定图片 → 成员专辑封面拼贴（1 张铺满 / 2 张左右对半 / 3 张左大右二 / 4 张 2×2）→ 都没有则按歌单 id 程序化生成一张渐变封面（同名永远同一张）

## 部署

### Cloudflare Pages

```bash
npm install   # 或 pnpm install
npm run build # 产物在 dist/
```

Pages 控制台连接仓库：构建命令 `npm run build`，输出目录 `dist`。CORS 代理由 `functions/api/proxy.js` 自动生效。

或 CLI 直接部署：`npx wrangler pages deploy dist --project-name=apple-music-player`

### Vercel

连接仓库即可，`vercel.json` 已配置（构建 `npm run build`，输出 `dist`，`/api/proxy` 走 `api/proxy.js` serverless 函数）。

## ⚠️ 音乐源要求

1. **HTTPS 直链**（播放器部署在 https 下，http 会被浏览器拦截为混合内容）
2. **CORS**：直链响应需带 `Access-Control-Allow-Origin`；没有则自动走 `/api/proxy`（要求音源允许服务端请求）
3. **关闭 Cloudflare 安全挑战**：若音源域名开了 Bot Fight Mode / 高安全级别（"Just a moment" 挑战页），浏览器 fetch 和服务端代理都会被拦。请在 Cloudflare 控制台为音源路径加 WAF 放行规则：
   - Security → WAF → Custom rules → `(http.host eq "img.example.com" and starts_with(http.request.uri.path, "/file/"))` → Skip: **All remaining custom rules / Security features**
4. **Range 支持**：元数据解析需要服务端支持 `Range` 请求（响应 `Accept-Ranges: bytes`）；不支持时会退回全量下载解析

## 本地开发

```bash
npm install
npm run dev        # vite dev server（/api/proxy 在 dev 下不可用）
npx wrangler pages dev dist  # 构建后用 wrangler 模拟 Pages（含 functions）
```

## 技术栈

Vite 6 + Vue 3 + Pinia + TailwindCSS 4 · music-metadata 11 · 纯前端 + 1 个 CORS 代理函数
