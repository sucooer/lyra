/**
 * 一个够小的 OpenAI 兼容 chat 客户端，只服务于「让模型写一段推荐语」这一件事。
 *
 * 为什么是「兼容 OpenAI 接口」而不是绑定某一家：这个项目里要调的只有一次
 * POST /chat/completions，DeepSeek / 智谱 / 通义 / OpenAI 的请求体完全一样，
 * 差别只有 base_url 与模型名 —— 做成三个环境变量就没有必要为每家写一份适配。
 *
 * 三条硬规矩：
 *   1. **密钥只走服务端**。这个模块只在 Node 脚本里跑（cron），绝不进前端产物 ——
 *      与 EMBY_API_KEY 同理，见 .env.example 的说明。
 *   2. **永不抛错**。调用方是每日 cron，一次接口抖动不该让当天的产物生成失败；
 *      失败就把错误回传，由调用方退回模板文案（见 scripts/gen-daily.mjs）。
 *   3. **不阻塞太久**。超时 + 至多一次重试，最坏情况也有上限。
 */
import { envValue } from './env.mjs'

/** 没写 AI_BASE_URL 时的默认值：DeepSeek 的 OpenAI 兼容入口（国内可直连、便宜） */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * 从环境变量读出配置。没配密钥就是没启用 —— 调用方据此跳过 AI、直接用模板文案，
 * 这也是本地开发与「忘了配 secret」时的正常状态，不是错误。
 *
 * 认两种写法：AI_BASE_URL / AI_API_KEY / AI_MODEL，或通用的 OPENAI_* 同名变量。
 */
export function aiConfig(env, { log = console.log } = {}) {
  const key = envValue(env, 'AI_API_KEY', 'OPENAI_API_KEY')
  if (!key) {
    return { enabled: false, reason: '未配置 AI_API_KEY（或 OPENAI_API_KEY）' }
  }
  const baseUrl = envValue(env, 'AI_BASE_URL', 'OPENAI_BASE_URL') || DEFAULT_BASE_URL
  const model = envValue(env, 'AI_MODEL', 'OPENAI_MODEL') || DEFAULT_MODEL
  const temperature = Number(envValue(env, 'AI_TEMPERATURE')) || 1.15
  const timeoutMs = Number(envValue(env, 'AI_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS
  /**
   * max_tokens 是「本次最多生成多少 token」的输出上限，与模型支持多大上下文无关；
   * 服务商会拿它跟模型的真实输出上限校验，超出直接 400，所以不能拍脑袋填 1M。
   * 默认 8192：普通模型写 60~120 字用不了几百 token，而推理类模型会把隐藏思考
   * 也算进这份预算 —— 1024 的时候实测全部花在思考上、正文为空（finish_reason=length）。
   */
  const maxTokens = Number(envValue(env, 'AI_MAX_TOKENS')) || 8192
  if (!envValue(env, 'AI_BASE_URL', 'OPENAI_BASE_URL')) {
    log(`· 未设 AI_BASE_URL，按 DeepSeek 兼容接口处理（${DEFAULT_BASE_URL}）`)
  }
  return { enabled: true, apiKey: key, baseUrl, model, temperature, timeoutMs, maxTokens }
}

/**
 * base_url → 补全地址。允许调用方直接给到 /chat/completions（有人习惯这么填），
 * 其余情况一律按「OpenAI 兼容根路径」处理，末尾斜杠容错。
 */
export function completionsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(base)) return base
  return `${base}/chat/completions`
}

/** 把上游返回体里的正文抠出来。结构千奇百怪，认不出来就当没有 */
function pickText(data) {
  const c = data?.choices?.[0]
  const content = c?.message?.content ?? c?.text
  if (typeof content === 'string') return content
  // 少数实现把它做成 [{type:'text',text:'…'}] 的分段数组
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('')
      .trim()
  }
  return ''
}

/** 只留一行、掐到 n 字：错误信息要能读，但不该把整个 HTML 错误页灌进日志 */
function brief(s, n = 200) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 发一次请求。
 * @returns {Promise<{text: string, error: string, ms: number}>} 失败时 text 为空串
 */
export async function chat(cfg, { system, user, maxTokens, log = console.log }) {
  const url = completionsUrl(cfg.baseUrl)
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: cfg.temperature,
    // 调用方显式传了就用调用方的，否则用配置里的（环境变量 AI_MAX_TOKENS，默认 8192）
    max_tokens: maxTokens ?? cfg.maxTokens,
    stream: false,
  }

  // 一次重试：只针对「网络断了 / 429 / 5xx」这类过后可能就好了的情况，
  // 4xx（密钥错、模型名错、余额不足）重试没有意义，只会多等一轮
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now()
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      })
    } catch (e) {
      const ms = Date.now() - t0
      const why = e?.name === 'TimeoutError' ? `超时（>${cfg.timeoutMs}ms）` : brief(e?.message ?? e)
      if (attempt < 2) {
        log(`· 第 ${attempt} 次请求失败：${why}，3 秒后重试`)
        await sleep(3000)
        continue
      }
      return { text: '', error: why, ms }
    }

    const ms = Date.now() - t0
    const raw = await res.text().catch(() => '')
    if (!res.ok) {
      const why = `HTTP ${res.status} ${brief(raw, 160)}`
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < 2) {
        log(`· 第 ${attempt} 次请求失败：HTTP ${res.status}，3 秒后重试`)
        await sleep(3000)
        continue
      }
      return { text: '', error: why, ms }
    }

    let data
    try {
      data = JSON.parse(raw)
    } catch {
      return { text: '', error: `响应不是 JSON：${brief(raw)}`, ms }
    }
    const text = pickText(data).trim()
    if (!text) {
      // 有的实现把「触发了安全策略」「被截断」都放在 finish_reason 里，带上便于排查
      const finish = data?.choices?.[0]?.finish_reason
      return { text: '', error: `响应里没有正文${finish ? `（finish_reason=${finish}）` : ''}`, ms }
    }
    return { text, error: '', ms }
  }
  return { text: '', error: '重试后仍失败', ms: 0 }
}
