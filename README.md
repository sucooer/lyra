# Apple Music Web Player

仿 Apple Music 界面的网页播放器，音乐源为**直链音频文件**，浏览器端解析内嵌元数据（封面/歌手/专辑/歌词）。

## 功能

- 🎵 **直链播放**：在 `public/playlist.json` 里填写音频直链（FLAC / MP3 / M4A / OGG / WAV），刷新即加载
- 📝 **曲库即文件**：`public/playlist.json` 一行一个直链，无界面管理；写成对象时还能人工覆写标题 / 歌手 / 封面 / 标签
- 📻 **电台**：一键把资料库全部歌曲乱序无限播放；封面每次点播程序化随机生成
- 💽 **歌单卡片**：`public/playlists.json` 自定义歌单（按歌手/专辑/曲名筛选），首页推荐区卡片式展示，封面自动取成员专辑封面拼贴
- 🏷️ **元数据解析**：浏览器端用 `music-metadata` v11 解析内嵌封面、标题、歌手、专辑、歌词（ID3v2 / Vorbis Comment / MP4 atom）
- ⚡ **预解析缓存**：构建时自动生成 `public/meta.json` + `public/covers/` + `public/lyrics/`（已 gitignore，不入库），首页直接渲染，不再联网解析
- ⚡ **Range 分块**：未预解析的条目在浏览器端按需解析，只下载文件头部（默认 2MB），40MB FLAC 秒开信息
- 📜 **滚动歌词**：内嵌 LRC / SYLT 同步歌词逐行高亮滚动，支持点击跳转；自动尝试同路径 `.lrc` 外挂歌词。播放页右上角引号按钮切换歌词视图
- 🍎 **Apple Music 风格**：全屏播放页、封面主色调提取模糊背景、底部播放栏、播放/暂停缩放动画
- 🖥️ **宽屏（≥1024px）另一套布局**：顶部磨砂工具栏 + 自适应铺满的卡片网格（约 200px 一张）+ 底部单行磨砂胶囊播放条（左曲目与进度 / 中控制键 / 右队列与音量）
- 🌐 **CORS 兜底**：直链无跨域头时自动回落 `/api/proxy` 中转（同时支持 Range 透传）

## 宽屏与移动端

同一套组件按 `lg`（1024px）分叉，两边互不影响：

| | 移动 / 平板（< 1024px） | 宽屏（≥ 1024px） |
|---|---|---|
| 顶栏 | 随内容滚动的普通标题栏 | 悬浮磨砂工具栏，内容从它底下滚过 |
| 卡片网格 | 2 / 3 列固定 | `auto-fill` 自适应铺满，一行 5-7 张 |
| 播放条 | `PlayerBar.vue`：两行迷你玻璃条（含进度与时间） | `PlayerBarWide.vue`：单行胶囊，含队列面板与音量滑轨 |
| 歌单页头部 | 封面居中、文字居中 | 官方式「左封面 + 右信息」，标题 40px |

材质集中在 `src/style.css`：`.bar-glass`（迷你条）、`.capsule-glass` / `.capsule-panel`（胶囊与队列面板）、
`.topbar-glass`（工具栏，媒体查询写在样式里，仅 lg 生效）。**新增主题变量要同时改浅色、
媒体查询深色、强制深色三处**，漏一处会出现主题不一致。

## 更新歌单

1. 编辑 `public/playlist.json`，往数组里加音频直链（中文文件名需百分号编码）
2. `pnpm meta` 解析新增条目（增量，已缓存的跳过）
3. `pnpm label` 把解析出来的歌名回填进 `playlist.json`，让源文件自己认得出歌
4. `pnpm build` 构建（内部会先跑一次 `pnpm meta`，部署平台也走这条）

**第 3 步解决的是「加完就忘」**：远程直链多半是随机 token（`Pks0olqo.flac`），
光看链接认不出是哪首歌，而能认出歌的 `meta.json` 是生成物、不入库 ——
于是下次打开源文件想加歌只能靠记忆。`pnpm label` 把歌名补进对象写法：

`"https://.../Pks0olqo.flac"` → `{ "url": "https://.../Pks0olqo.flac", "title": "知足", "artist": "五月天" }`

三条原则：**只补不改**（文件里已有的人工值一律保留，不会被音频 tag 覆盖；
tag 后来被修正的情况用 `--force` 显式刷新）、**保持顺序**（顺序就是播放顺序）、
**无需改动就不碰文件**（不会每跑一次都多出一堆无意义的 diff）。

顺带一提，`pnpm label` 会打印一份曲库清单，里面的歌手 / 专辑就是写
`playlists.json` 规则时要用的**原字符串**，可以照抄——省掉「猜某个歌手的 tag 到底怎么拼」。
参数：`--album` 连专辑一起写，`--force` 刷新已有值，`--dry` 只看不写。
还没解析到的新链接会保持原样，末尾会提示先跑 `pnpm meta`。

每条既可以写成纯字符串，也可以写成对象来**人工覆写**音频里解析出来的信息：

```jsonc
[
  "https://.../a.flac",
  {
    "url": "https://.../b.flac",
    "title": "粉雪",               // 内嵌 tag 写错/缺失时在这里改
    "artist": "レミオロメン",        // 不写就等于沿用音频里的值
    "album": "...",
    "cover": "/covers/xxxx.jpg",   // 换成自己的封面图
    "tags": ["日系", "冬季"]        // 自由标签，供 playlists.json 按标签分组
  }
]
```

覆写是**在前端显示时合并**的：改完刷新页面就生效，不必重跑 `gen-meta`。
两种写法可以混排，纯字符串的旧格式完全不受影响。

`meta.json` / `covers/` / `lyrics/` 都在 `.gitignore` 里，不会提交到仓库；部署时由构建步骤现生成。
强制全量重跑：`node scripts/gen-meta.mjs --force`；只重跑某一条：`--only <下标>`。
某条解析失败不影响构建，该曲目会退回浏览器端解析。

**曲目 id 是稳定的**：由直链哈希得出（`stableId()`），同一首歌在任何设备、任何会话
拿到的都是同一个 id。收藏、播放历史、自定义排序这类需要跨会话记住一首歌的功能都依赖它，
所以不要往 `Track.id` 里塞随机值——那会让存下来的引用下次全部失效。

**歌词是独立文件**：`meta.json` 里只存一个 `lyricsUrl` 指针，真正的歌词放在
`public/lyrics/<hash>.json`。歌词占了元数据的绝大部分体积，而列表页一个字都用不到，
拆开后 `meta.json` 从 36KB 降到约 4KB，且只在播放到某首曲目时才拉取那一首的歌词。
从旧版本升级时，首次运行脚本会把已缓存的歌词自动迁出，不需要重新下载音频。

**封面按内容去重**：文件名是图片内容的哈希（`public/covers/<sha1>.jpg`），不是曲目直链。
同一张专辑的每首曲子都内嵌同一张封面，按直链命名会各存一份完全相同的文件
（实测 9 首里就有 3 对重复，8 个文件里只有 5 张不同的图）；按内容命名后自动合并成一个。
脚本每次运行结束还会清掉 `covers/` 与 `lyrics/` 里不再被 `meta.json` 引用的文件
（改名后的旧文件、换封面/换歌词后的残留）——判断依据是当前 `meta.json`，
所以处理到一半中断也不会误删还在用的资源。
从旧版本升级时，封面会就地按内容重新命名（读本地图片，不重新下载音频）。

**封面会压到长边 800px**：原图动辄 2048×2048 / 800KB，而界面里最大只显示到约 300px，
压完单张 40~80KB（本仓库 5 张从 1657KB 降到 315KB，少 81%）。这一步用 `ffmpeg`，
**属可选优化**：找不到就按原图落盘，其余流程完全不受影响。ffmpeg 依次从
环境变量 `FFMPEG_PATH` → 系统 `PATH` → 依赖里的 `ffmpeg-static` 里找：
开发机一般走系统装的那份，部署平台走 `ffmpeg-static` —— Cloudflare Pages 的构建镜像
不含 ffmpeg，只能把二进制当依赖装下来。注意该包的二进制由它自己的 postinstall 下载，
pnpm 10 默认拦截依赖脚本，所以已在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 里放行。
上限和质量在 `scripts/gen-meta.mjs` 顶部
（`MAX_COVER_EDGE` / `COVER_QUALITY`）。已经压过的图不会重复压缩
（脚本自己读文件头判断尺寸，不为「要不要压」多走一次有损转换）。
升级时同样的道理：已有的封面会就地重压，不需要重新下载音频。

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
    // tags 匹配的是 playlist.json 对象写法里人工写的标签，不依赖音频内嵌 tag
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
