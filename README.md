# Apple Music Web Player

仿 Apple Music 界面的网页播放器，音乐源为**直链音频文件**，浏览器端解析内嵌元数据（封面/歌手/专辑/歌词）。

## 功能

- 🎵 **直链播放**：在 `public/playlist.json` 里填写音频直链（FLAC / MP3 / M4A / OGG / WAV），刷新即加载
- 📝 **曲库即文件**：`public/playlist.json` 一行一个直链，无界面管理；写成对象时还能人工覆写标题 / 歌手 / 封面 / 标签
- 📻 **电台**：一键把资料库全部歌曲乱序无限播放；封面每次点播程序化随机生成
- 💽 **歌单卡片**：`public/playlists.json` 自定义歌单（按歌手/专辑/曲名筛选），首页推荐区卡片式展示，封面自动取成员专辑封面拼贴
- 🌅 **每日推荐**：按日期从曲库轮换出一份当天歌单，排在推荐区第一位；由 GitHub Actions 每天定时生成（cron），不跑也不会空着
- 🎛️ **Emby 音乐库**：`pnpm emby` 直接把一台 Emby 服务器上的音乐库同步进曲库（907 首约 4 秒），元数据与封面取自 Emby；播放经本站端点中转，密钥不出服务端
- 🔎 **搜索**：歌手 / 专辑 / 歌曲 / 歌单四类结果，入口在顶栏（快捷键 `/` 或 `⌘K`）。匹配前先归一化，所以写法差异不影响结果——「張韶涵」搜得到「张韶涵」、`sens` 搜得到 S.E.N.S.；多词按 AND 处理，「周杰伦 稻香」直接定位那一首
- 🏷️ **元数据解析**：浏览器端用 `music-metadata` v11 解析内嵌封面、标题、歌手、专辑、歌词（ID3v2 / Vorbis Comment / MP4 atom）
- ⚡ **预解析缓存**：构建时生成 `public/meta.json` + `public/covers/` + `public/lyrics/`，首页直接渲染、不再联网解析。这三项产物**随仓库提交**——`meta.json` 本身就是解析缓存，入库后部署构建能直接命中，不必每次重新下载解析整个曲库
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

**只做一步**：编辑 `public/playlist.json`，往数组里加音频直链（中文文件名需百分号编码），
提交并推送。剩下的由 GitHub Actions 完成（`.github/workflows/daily.yml`）——

| 自动做的事 | 步骤 |
|---|---|
| 解析直链，取元数据 / 封面 / 内嵌歌词 | `gen-meta.mjs` |
| 把歌名回填进 `playlist.json`，让源文件自己认得出歌 | `label-playlist.mjs` |
| 同步 Emby 曲库（配了密钥才跑） | `gen-emby.mjs` |
| 生成当天的每日推荐 | `gen-daily.mjs` |
| 把这些产物一起提交并推送 | `chore(data): 曲库与每日推荐同步` |

推送 `playlist.json` 会**立刻触发**一次（不必等每天 00:05），每天 00:05 也会定时跑一次兜底。
工作流跑完、平台重新构建后新歌就上线了。想手动补跑：Actions → 曲库与每日推荐 → Run workflow。

本地想自己跑一遍也是可以的（`pnpm meta` / `pnpm label`），只是不再是必需步骤。

**回填歌名解决的是「加完就忘」**：远程直链多半是随机 token（`Pks0olqo.flac`），
光看链接认不出是哪首歌，而能认出歌的元数据只存在于生成物 `meta.json` 里 ——
于是下次打开源文件想加歌只能靠记忆。`label-playlist.mjs` 把歌名补进对象写法：

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

`meta.json` / `covers/` / `lyrics/` **随仓库提交**（合计约 860KB），由上面的工作流自动生成并推送。
`meta.json` 同时充当解析缓存，入库后每次运行可直接命中、跳过对已有曲目的下载与解析（新增条目仍会
增量解析）—— 所以这些产物**必须留在仓库里**，删掉会让下一次运行重新解析整库（十几首也要几分钟，
几百首会很久）。
强制全量重跑：`node scripts/gen-meta.mjs --force`（保留已有缓存，只重解析，中途失败不丢其它条目）；
只重跑某一条：`--only <下标>`；调并发：`--jobs N`（默认 3 首并行，每首内部再并发取 4 块，可用 `--jobs 1` 退回串行）。
慢在网络而不是解析：单次 Range 请求约 2.8 秒花在建连与回源首字节上，所以脚本用「多首并行 + 一首内多块并发」
把这份固定开销重叠掉，而不是加大单次请求。`--force` 与 `--only` 同用时不会误删其它曲目的封面/歌词——
只有当前所有直链都解析出条目了，脚本才会清理孤儿文件。
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

## 每日推荐

首页推荐区里的**第一张卡片**，每天自动换一批歌，不需要手工维护。

**怎么选**（规则在 `src/lib/daily.ts`）：把整个曲库排成一个长度恰好等于曲目数的
「周期序列」，第 n 天取其中等分的一段 —— 周期长度 = `ceil(曲库 ÷ 首数)`，
4013 首 / 30 首就是 134 天。序列内部**按歌手分层**：每位歌手按自己在曲库里的占比匀速被取走，
一次取走一小批（`ARTIST_BATCH`，默认 3 首）。所以

- 一个周期里每首歌恰好出现一次 —— 4013 首时同一首要隔 **134 天**才回来，相邻两天零重合
- 每天约 10 位歌手轮换上台，**单日同歌手最多 7 首**（改之前是「同一位歌手占 11 首」）
- **相邻两天的歌手重合约 23%**（改之前 75%）；两位热门歌手仍会常见，因为它们本来就各占曲库的 13%
- 同一天在任何设备、刷新多少次都是同一份（纯函数，种子只有日期与曲库）
- 首数默认不超过**曲库的一半**、上限 30 首；曲库超过 60 首后固定 30 首

`ARTIST_BATCH` 是唯一的调性旋钮：调大 → 每天歌手更少、轮换更明显；调小 → 每天歌手更多、
更像随机抽样。实测（4013 首 / 47 位歌手）1/2/3/4 分别对应每天 19/13/10/8 位歌手、
相邻两天歌手重合 35%/27%/23%/22%。

⚠️ 选歌要用到每首曲目的**歌手**，所以浏览器与脚本必须装出同一份曲库视图
（`DailyContext.metaOf`）：两边差一首，周期长度与相位就整体错位。拿不到歌手时
退化成「按直链哈希定序 + 连续窗口轮换」。

**谁来生成**：`.github/workflows/daily.yml` 每天北京 00:05 跑一次
`scripts/gen-daily.mjs`，把当天的清单写进 `public/daily.json` 并提交，
部署平台收到这个提交会重新构建。

**不跑 cron 也不会空着**：页面打开时如果 `daily.json` 缺失或不是当天的
（Actions 没开、cron 被跳过、本地开发没跑过脚本），前端会就地按同一套规则现算一份 ——
选歌规则由浏览器和脚本共用同一份代码，两条路结果逐字一致。

```bash
pnpm daily                      # 生成今天的（加完新歌想当天就带上，跑一次即可）
pnpm daily --date 2026-09-18    # 补指定日期
pnpm daily --size 6             # 改当天首数
pnpm daily --no-ai              # 强制用模板文案，不调模型
pnpm daily --dry                # 只打印不写文件
```

改文案或换歌单 id 在 `lib/daily.ts` 顶部（`DAILY_ID` / `DAILY_TITLE`）；
`playlists.json` 里手写同 id 的定义会被每天生成的这份覆盖。

### 推荐语

歌单页标题下面那段话，写在 `daily.json` 的 `blurb` 里，有两条产出路径：

- **模板**（`src/lib/blurb.ts`）—— 从当天曲目的年份、歌手阵容、专辑、时长里算出来。
  它是**纯函数**，所以前端在 `daily.json` 缺失或过期时能就地现算出逐字一致的一份。
- **模型**（配了 `AI_API_KEY` 才走）—— 事实清单由同一个 `blurbFacts()` 给出，
  措辞交给模型写成一段文艺随笔。提示词在 `scripts/lib/blurb-prompt.mjs`。

**模型写的文案不做跨环境复现**，所以只在 cron 侧生成、写进产物；前端那条兜底路径永远走模板。
调用失败、返回空、长度超出 30~220 字，都自动退回模板文案，当天不会开天窗。
产物里另记一个 `blurbFrom: 'ai' | 'template'`，方便回头查某天的文案是谁写的。

模型返回的文本会过一遍 `tidyBlurb()`：摘掉 markdown 痕迹、整段引号、「推荐语：」这类小标题、
表情符号，压平换行，再补中英之间的空格 —— 模板与模型两条路的产出形态因此一致。

```bash
# 本地想试真接口：写进 .env.local
AI_API_KEY=sk-…
AI_BASE_URL=https://api.deepseek.com/v1   # 任何 OpenAI 兼容根路径
AI_MODEL=deepseek-chat
```

⚠️ 本机 bash 通常出不了外网，真接口那条路实际由 GitHub Actions 跑（仓库 Settings →
Secrets and variables → Actions 里加 `AI_API_KEY`，`AI_BASE_URL` / `AI_MODEL` 可选）。
本地验收用 mock 服务即可：`gen-daily.mjs` 只认这三样，把 `AI_BASE_URL` 指到本地就能全链路走通。

## 接入 Emby 音乐库

除了 `public/playlist.json` 里逐首手写的直链，曲库也可以直接同步一台 **Emby** 服务器：
`pnpm emby` 把整个音乐库生成为 `public/emby.json`，页面加载时并进同一个曲库 ——
于是它们自动出现在电台、每日推荐和 `playlists.json` 的歌单规则里。

**为什么不用解析**：Emby 已经把库索引好了，一次 `Items` 查询就带回标题 / 艺术家 /
专辑 / 年份 / 轨号 / 时长 / 码率 / 采样率，封面也有现成接口。实测 907 首 **4.3 秒**
完成；同规模若走 `pnpm meta` 的「下载音频分块解析」，要跑约半小时、并经 Emby
再拉 1.8GB 流量。代价是**拿不到歌词** —— 实测库里所有曲目内嵌歌词都是 0 条，
Emby 也没有可用的歌词端点。纯音乐库不受影响。

```bash
cp .env.example .env.local   # 填 EMBY_URL 与 EMBY_API_KEY
pnpm emby                    # 生成 public/emby.json 与封面
pnpm emby --dry              # 只打印不落盘
pnpm emby --limit 30         # 试跑
```

**自动同步要把密钥放进仓库 secret**：Settings → Secrets and variables → Actions →
New repository secret，加 `EMBY_URL` 与 `EMBY_API_KEY`。配好之后每天 00:05 的工作流会
同步新歌、新封面与新歌词并提交；也可以在 Actions → 曲库与每日推荐 → Run workflow 立刻跑一次。
**没配的话工作流不会失败，只是静默跳过** —— 表现是线上曲库一直停在仓库快照里的那批歌
（运行日志里会有黄字提醒）。⚠️ 部署构建**不**做同步（CF Pages 构建有 20 分钟上限，
4700 首全量同步随时会超时，而且产物不进仓库就无法复现），这条路已经废弃。

密钥在 Emby 后台 → 设置 → 高级 → API 密钥 新建。⚠️ 它**不是只读音乐库的凭证，
而是整台服务器的完整权限**（含其它媒体库与管理接口），因此只能待在服务端：
本地放 `.env.local`（`.gitignore` 已排除），线上放 CF Pages / Vercel 的环境变量。
没配也能正常构建 —— 脚本会跳过，直接用仓库里已提交的快照。

### 播放为什么要中转

Emby 取流必须带 `api_key`，而站点是 https、Emby 通常只有 http。两者叠加使得
**前端不可能直连**：密钥写进 `emby.json` 等于公开给所有访问者，而 http 媒体在
https 页面里会被混合内容策略拦掉。

所以 `emby.json` 里存的不是音频地址，而是本站端点 `/api/emby/stream?id=<条目 id>`，
密钥由服务端注入（`functions/api/emby/stream.js` / `api/emby/stream.js`，两份逻辑等价）。
`pnpm dev` 下由 `vite.config.ts` 的中间件复用同一个处理器，不另写一套 ——
免得开发期和生产期恰好在「密钥怎么注入」这件事上漂移。

### 产物

`public/emby.json`（约 245KB / 907 首）+ `public/emby-covers/`（约 4.5MB / 58 张），
**两者都要入库**：构建环境通常没有密钥，靠的就是仓库里这份快照。

封面按专辑去重，文件名取图片内容的 sha1 前 12 位（与 `covers/` 同一套约定），
刻意放在**单独目录** —— `gen-meta` 会清理 `public/covers/` 里未被 `meta.json`
引用的文件，放进去会被当孤儿删掉。

## 同步听歌记录到 Last.fm

播放时自动上报 now playing，并按 Last.fm 的规则计入收听记录（实听 ≥ 30 秒，且
≥ 时长的 50% 或 ≥ 4 分钟）。上报走本站自己的端点 `POST /api/lastfm`。

**为什么不能前端直接打 Last.fm**：scrobble 的 `api_sig` 必须用 **API secret** 做 md5
签名，而本站是公开的 —— secret 进前端就等于公开，任何人都能冒充本站往别人的账号写记录。
所以签名只在服务端（`functions/_lib/lastfm.js`，CF Functions 与 Vercel 两个入口共用同一份），
和 Emby 取流是同一个思路。

### 配置（一次，约两分钟）

1. 到 <https://www.last.fm/api/account/create> 建应用（或复用已有的），页面上有
   **API key** 与 **API secret** —— 抓歌手简介用的也是这个 key，secret 只有这里给。
2. 把 Callback URL 一栏填上 `https://你的域名/api/lastfm/callback`
   （**必须非空**，否则授权后 Last.fm 会把你送到错误页而不是本站）。
3. 在 **CF Pages → Settings → 环境变量** 里加两个：

   | 变量 | 说明 |
   | --- | --- |
   | `LASTFM_API_KEY` | API key |
   | `LASTFM_API_SECRET` | API secret，**只放服务端** |

   ⚠️ Pages 的 Functions 读的是**部署级快照**，加完必须**重新部署**才生效。
4. 打开站点，点顶栏的**柱状图标**（「连接 Last.fm」）→ 在 Last.fm 点「允许」→
   自动回到播放器，图标变红即为已连接。**session key 由浏览器自己保存**，
   所以环境变量只需要上面两个，换账号也只要在网页上重新授权。

> 备选：`pnpm lastfm:auth` 走的是桌面授权流程（终端里跑），拿到 session key 后可以配
> `LASTFM_SESSION_KEY` 让服务端固定用一个账号（和 Emby 的密钥一样只存服务端）。
> 网页授权已经足够，这条只在你想「所有人共用同一个账号、且不依赖浏览器存储」时才需要。

### 行为细节

- **上报时机**：条件满足的那一刻就报，不等播完 —— 中途关掉页面也不丢。时间戳取开始播放的时刻。
- **离线队列**：上报失败（断网、服务端没配好）就存进 `localStorage` 的 `lyra.scrobble.queue`，
  下次启动或网络恢复时补发，单次最多 50 首。
- **断开同步**：点顶栏那个图标（已连接时会问一句），本地会话与待发队列一起清掉。
- **临时静音**：`localStorage.setItem('lyra.scrobble', 'off')`。
- **注意**：若用环境变量固定了 `LASTFM_SESSION_KEY`，则**任何人**打开这个站点播放都会记到那个账号。
  用网页授权时每条记录只属于「在那个浏览器上点过授权的账号」。
- 本地开发时 `vite` 会把 `/api/lastfm*` 直接交给 `functions/api/lastfm/**` 处理（与线上同一份代码），
  环境变量从 `.env.local` 读；没配齐时界面上的按钮会直接把服务端的原因显示出来。

## 部署

### Cloudflare Pages

```bash
npm install   # 或 pnpm install
npm run build # 产物在 dist/
```

Pages 控制台连接仓库：构建命令 `npm run build`，输出目录 `dist`。CORS 代理由 `functions/api/proxy.js` 自动生效。

构建只做一件事：`vite build`。**不要在构建里生成任何数据** —— 曲库同步、元数据解析、
每日推荐全部交给 `.github/workflows/daily.yml`（定时 + 推送 `playlist.json` 触发），产物随仓库提交；
构建期联网只会多一个挂起点（Emby 是裸 IP 时 CF 边缘还会直接回 403 `error code: 1003`）。
`functions/api/emby/stream.js` 需要的 `EMBY_URL` / `EMBY_API_KEY` 仍要在 Pages 的环境变量里配
（**Functions 的环境变量是部署级快照，改完必须重新部署才生效**），但它与构建无关。

⚠️ **别把 `ffmpeg-static` 加回依赖**：它 5.x 的 postinstall 要下载约 79MB 二进制，
在部署构建里一旦卡住表现为「build 步骤跑了好几分钟、一行日志都没有」。
封面压缩是 `gen-meta` 的可选优化，缺 ffmpeg 就按原图落盘。

或 CLI 直接部署：`npx wrangler pages deploy dist --project-name=apple-music-player`

### Vercel

连接仓库即可，`vercel.json` 已配置（构建 `npm run build`，输出 `dist`，`/api/proxy` 走 `api/proxy.js` serverless 函数）。Emby 取流走 `api/emby/stream.js`，同样按需配置上面两个环境变量。

## ⚠️ 音乐源要求

1. **HTTPS 直链**（播放器部署在 https 下，http 会被浏览器拦截为混合内容）
2. **CORS**：直链响应需带 `Access-Control-Allow-Origin`；没有则自动走 `/api/proxy`（要求音源允许服务端请求）
3. **关闭 Cloudflare 安全挑战**：若音源域名开了 Bot Fight Mode / 高安全级别（"Just a moment" 挑战页），浏览器 fetch 和服务端代理都会被拦。请在 Cloudflare 控制台为音源路径加 WAF 放行规则：
   - Security → WAF → Custom rules → `(http.host eq "img.example.com" and starts_with(http.request.uri.path, "/file/"))` → Skip: **All remaining custom rules / Security features**
4. **Range 支持**：元数据解析需要服务端支持 `Range` 请求（响应 `Accept-Ranges: bytes`）；不支持时会退回全量下载解析

以上是针对 `playlist.json` 里手写直链的。**Emby 来源的曲目不受第 1、2 条约束**：
http 源和缺失的 CORS 头都由 `/api/emby/stream` 在服务端抹平（见「接入 Emby 音乐库」）。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 要用 Emby 才需要填
npm run dev        # vite dev server；/api/proxy 与 /api/emby/stream 由 vite.config.ts 的中间件复用生产处理器
npx wrangler pages dev dist  # 构建后用 wrangler 模拟 Pages（含 functions）
```

`npm run dev` 下 `/api/*` 走的是 `vite.config.ts` 里那段中间件，它加载的正是
Cloudflare 那份函数实现 —— 所以开发期就能验到密钥注入与 Range 透传，不必先部署。

## 技术栈

Vite 6 + Vue 3 + Pinia + TailwindCSS 4 · music-metadata 11 · 纯前端 + 1 个 CORS 代理函数
