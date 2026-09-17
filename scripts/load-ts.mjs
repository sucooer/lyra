/**
 * 让 Node 脚本能直接复用 src/lib 下的 .ts 纯函数。
 *
 * 为什么不靠 Node 自带的类型擦除（`import './x.ts'`）：那个特性要 **Node >= 22.18**
 * 才默认开启，而 Cloudflare Pages 的构建镜像目前是 22.16 —— 本地和 GitHub Actions
 * 上都跑得好好的，一上 CF 就 `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"`。
 * （GitHub runner 装的是最新的 22.x，所以 CI 那条线看不出问题。）
 *
 * 所以这里改成先用 esbuild 把 .ts 转译成一份临时 .mjs 再 import，
 * 不再依赖任何 Node 版本特性：22.16 / 22.22 / 24 行为一致。
 *
 * 只有「浏览器与脚本共用同一份算法」的 .ts 才需要走这里（daily.ts / emby.ts）。
 */
import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 临时产物目录，按系统临时目录走，不进仓库、不进 public/ */
const OUT_DIR = path.join(tmpdir(), 'lyra-ts-loader')

/**
 * 加载一份 .ts 模块，返回它的命名空间对象（等价于 `await import()` 的结果）。
 *
 * @param {string | URL} file 目标 .ts 路径，建议用 `new URL('../src/lib/x.ts', import.meta.url)`
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadTs(file) {
  const entry = file instanceof URL ? fileURLToPath(file) : path.resolve(file)

  const res = await build({
    entryPoints: [entry],
    // bundle 而不是单纯 transform：源文件可能有（类型上的）相对 import，
    // 单文件 transform 会把它们原样留在产物里，import 时就找不到模块了。
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  })
  const code = res.outputFiles?.[0]?.text
  if (!code) throw new Error(`loadTs: esbuild 没有产出代码：${entry}`)

  await mkdir(OUT_DIR, { recursive: true })
  // 用源码内容哈希命名：内容没变就复用同一个文件，调试时堆栈也稳定
  const hash = createHash('sha1').update(code).digest('hex').slice(0, 12)
  const out = path.join(OUT_DIR, `${path.basename(entry, '.ts')}-${hash}.mjs`)
  await writeFile(out, code, 'utf8')
  return import(pathToFileURL(out).href)
}

/**
 * 读一份 .ts 的源码（给需要把源码一起哈希/打印的场景用）。
 * 只是 fs 的薄封装，放这儿是为了让脚本不必各写一遍路径转换。
 *
 * @param {string | URL} file
 * @returns {Promise<string>}
 */
export function readTs(file) {
  return readFile(file instanceof URL ? fileURLToPath(file) : path.resolve(file), 'utf8')
}
