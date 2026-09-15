# Apple Music Web Player

仿 Apple Music 界面的网页播放器，音乐源为**直链音频文件**，浏览器端解析内嵌元数据（封面/歌手/专辑/歌词）。

## 功能

- 🎵 **直链播放**：在 `public/playlist.json` 里填写音频直链（FLAC / MP3 / M4A / OGG / WAV），刷新即加载
- 📝 **歌单即文件**：歌单就是仓库里的 `public/playlist.json`，一行一个 url，无界面管理
- 🏷️ **元数据解析**：浏览器端用 `music-metadata-browser` 解析内嵌封面、标题、歌手、专辑、歌词（ID3v2 / Vorbis Comment / MP4 atom）
- ⚡ **Range 分块**：元数据解析只下载文件头部（默认 2MB），40MB FLAC 秒开信息
- 📜 **滚动歌词**：内嵌 LRC / SYLT 同步歌词逐行高亮滚动，支持点击跳转；自动尝试同路径 `.lrc` 外挂歌词
- 🍎 **Apple Music 风格**：全屏播放页、封面主色调提取模糊背景、底部迷你播放栏、播放/暂停缩放动画
- 🌐 **CORS 兜底**：直链无跨域头时自动回落 `/api/proxy` 中转（同时支持 Range 透传）

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

Vite 6 + Vue 3 + Pinia + TailwindCSS 4 · music-metadata-browser · 纯前端 + 1 个 CORS 代理函数
