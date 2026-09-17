/**
 * 读取仓库根目录的 .env.local，与真实环境变量合并（真实环境变量优先）。
 *
 * 为什么两边都要看：CI 里密钥来自仓库 secret / 变量，本地开发放 .env.local（已被
 * .gitignore 排除）。
 *
 * 注意：gen-emby.mjs 与 gen-artists.mjs 里**还各有一份等价实现**（本项目一开始就两份拷贝，
 * 这次新增 gen-daily 的需求时才抽出来）。没顺手改那两个是因为：它们的验证需要真连 Emby /
 * 维基，本机做不到，而它们启动后就会写 public/emby.json、public/artists.json 这类**入库产物** ——
 * 为一个纯机械的重构去冒写坏产物的风险不划算。**下次动到那两个脚本时再收敛到这里**，
 * 顺便把「剥成对引号」这个改进带过去。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 值两边成对的引号剥掉：`AI_API_KEY="sk-x"` 与 `AI_API_KEY=sk-x` 等价 */
function unquote(v) {
  const s = v.trim()
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * 取第一个有值的变量，兼容同一件事的多种写法
 * （例如 OPENAI_API_KEY 与 AI_API_KEY），省得让使用者去猜该配哪个名字。
 */
export function envValue(env, ...names) {
  for (const n of names) {
    const v = env?.[n]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function loadEnv(root) {
  const env = { ...process.env }
  const file = join(root, '.env.local')
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim()
    // 只看 `KEY=value`：空行、注释、以及漏了等号的行都跳过
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 0) continue
    const k = s.slice(0, i).trim()
    if (!k || env[k]) continue
    env[k] = unquote(s.slice(i + 1))
  }
  return env
}
