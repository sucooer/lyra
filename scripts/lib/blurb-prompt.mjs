/**
 * 「每日推荐」文案的提示词。
 *
 * 单独成一个模块而不是塞进 gen-daily.mjs：提示词是这个功能里唯一需要反复调的东西，
 * 和取数、写文件的逻辑混在一起会很难改。这里只有纯字符串拼装，不发请求。
 *
 * 设计上的两个要点：
 *
 * 1. **事实与语感分开管**。模型最容易犯的错是「编」——虚构创作背景、灵感来源、销量、
 *    歌手生平。所以素材由 scripts/lib/blurb.ts 的 blurbFacts() 统一给出（与模板路同源），
 *    提示词里反复强调这些是唯一可当事实用的东西；气氛、意象、感受则完全放开。
 *    曲库没有 genre 字段，写「深夜抒情」这类判断同样属于编，一并禁掉。
 *
 * 2. **明令禁止统计腔**。模板路已经在数数（几首、几位、跨多少年），模型再数一遍就成了
 *    同一段话的改写，「没有特色」的根源。所以要求它改用具体的人名、专辑名、年份当锚点。
 */

export const BLURB_SYSTEM = `你为一个人的私人音乐播放器写「每日推荐」的导语。每天一批曲目，你写一段 60~120 字的中文短文。

风格是文艺随笔：像深夜随手写下的听歌笔记。写意象、光线、时间、天气、身体感受、情绪的气压，
而不是写推荐理由、评价或导购词。

硬性要求：
1. 事实只能来自我给的素材（曲名、歌手、专辑、年份）。绝不要编造：不虚构创作背景、灵感来源、
   销量、奖项、榜单名次、歌手生平、歌词内容或任何素材里没有的轶事。没把握就不说。
2. 不要罗列统计数字（几首、几位歌手、跨多少年）—— 那是另一段文字在做的事。
   但至少要落到一个具体的歌手名、专辑名或年份上，让这段文字只属于今天这批曲目。
3. 60~120 个汉字，一段，不分行。
4. 不要标题、不要 markdown、不要列表、不要 emoji、不要用引号把整段包起来。
5. 不要出现「今天」「每日推荐」「歌单」「播放列表」「精选」这类说破界面身份的词，
   也不要出现「AI」「模型」「生成」「为你挑选」。
6. 避开这些套话：让我们、一起、沉浸、陶醉、治愈、心灵、音乐之旅、开启、感受音乐的魅力、
   在这个……的时刻、愿、别有一番风味。同一个词不要在相邻句里重复。
7. 简体中文。中英文之间不加空格（我们会统一处理）。人名一律用简体；曲名与专辑名照抄素材里
   给你的写法，不要改写、不要补全。

语感示意（只是语感的参考，不要照抄其中的意象与句式，也不要提到里面没有的东西）：
· 雨后窗台的凉意、楼下车流的声音，还有一首很久没听的曲子。它们各自待在自己的年份里，
  凑在一起却像同一天的天气。
· 有些声音属于白天，有些要等到夜里两点。这一批更像后者——它们不急着说完，
  留了很多空白给别的东西。

只输出这段话本身：不要任何前后缀，不要解释，不要重复我的要求。`

/** 2026-09-17 → 2026 年 9 月 17 日 */
function fmtDate(date) {
  const [y, m, d] = String(date ?? '').split('-')
  if (!y || !m || !d) return String(date ?? '')
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`
}

/**
 * 把当天的曲目与事实拼成 user 消息。
 *
 * @param date  日期键 YYYY-MM-DD
 * @param items 曲目元数据（title / artist / album / year），顺序就是当天的播放顺序
 * @param facts BlurbFacts，与模板路同源
 */
export function buildBlurbUser({ date, items, facts }) {
  const lines = [`${fmtDate(date)}，这一批共 ${items.length} 首。`, '', '曲目：']
  for (const [i, t] of items.entries()) {
    // 联名歌手原样保留（「阿悄, 庄心妍 & 王麟」），模型自己决定提不提
    const bits = [t.artist, t.album ? `《${t.album}》` : '', t.year ? `${t.year} 年` : '']
      .filter(Boolean)
      .join(' · ')
    lines.push(`${i + 1}. ${(t.title || '').trim() || '（未知曲名）'}${bits ? ` — ${bits}` : ''}`)
  }

  const f = []
  if (facts.yearKnown) f.push(`年份跨度 ${facts.yearMin}–${facts.yearMax}`)
  if (facts.albumCount) f.push(`专辑 ${facts.albumCount} 张`)
  if (facts.distinctArtists) f.push(`歌手 ${facts.distinctArtists} 位`)
  if (facts.topArtist && facts.topArtistCount >= 2) {
    f.push(`出现最多的是 ${facts.topArtist}（${facts.topArtistCount} 首）`)
  }
  if (facts.japanese >= 2) f.push(`其中日语歌 ${facts.japanese} 首`)
  if (facts.longest && facts.longest.duration >= 360) {
    f.push(`最长的一首是《${facts.longest.title}》${facts.longest.durationText}`)
  }

  lines.push('', '素材（只能拿这些当事实用，也不要照抄成数字）：')
  for (const s of f) lines.push(`· ${s}`)
  lines.push('', '现在写这一段。')
  return lines.join('\n')
}
