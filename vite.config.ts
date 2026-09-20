import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * 开发服务器直通 /api/*（生产由各平台的函数实现）。
 *
 * 这里刻意复用 Cloudflare Pages 那份处理器（Web 标准 Request/Response），
 * 而不是为开发期另写一套：两套实现必然漂移，而最不该漂的就是
 * 「密钥怎么注入、Range 怎么透传」这两件事。
 * 环境变量从 .env.local 读（Vite 的 loadEnv 带 '' 前缀 = 全都读，不只看 VITE_）。
 */
const DEV_ROUTES: Record<string, string> = {
  '/api/emby/stream': 'functions/api/emby/stream.js',
  '/api/emby/cover': 'functions/api/emby/cover.js',
  '/api/emby/lyrics': 'functions/api/emby/lyrics.js',
  '/api/proxy': 'functions/api/proxy.js',
  '/api/lastfm': 'functions/api/lastfm.js',
  '/api/lastfm/auth': 'functions/api/lastfm/auth.js',
  '/api/lastfm/callback': 'functions/api/lastfm/callback.js',
}

function apiDevPlugin(): Plugin {
  return {
    name: 'lyra-api-dev',
    configureServer(server) {
      const env = { ...loadEnv(server.config.mode, process.cwd(), ''), ...process.env }
      const handlers = new Map<string, (ctx: unknown) => Promise<Response>>()

      server.middlewares.use((req, res, next) => {
        const file = DEV_ROUTES[new URL(req.url ?? '/', 'http://localhost').pathname]
        if (!file) return next()

        void (async () => {
          try {
            let handler = handlers.get(file)
            if (!handler) {
              // process.cwd()：配置本身会被 esbuild 打成临时文件，import.meta.dirname 指不到项目根
              const abs = pathToFileURL(path.resolve(process.cwd(), file)).href
              handler = (await import(/* @vite-ignore */ abs)).onRequest
              handlers.set(file, handler!)
            }
            const headers = new Headers()
            if (req.headers.range) headers.set('range', req.headers.range)
            if (req.headers['content-type']) headers.set('content-type', req.headers['content-type'])
            // POST 的请求体也要透传：Last.fm 上报是 POST + JSON body，
            // 不透传的话本地只能测到「body 是空的」，而且报错方向会完全跑偏。
            let body: Buffer | undefined
            if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              if (chunks.length) body = Buffer.concat(chunks)
            }
            const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
              method: req.method,
              headers,
              body,
            })
            const resp = await handler!({ request, env })
            res.statusCode = resp.status
            resp.headers.forEach((v, k) => res.setHeader(k, v))
            if (!resp.body) {
              res.end()
              return
            }
            Readable.fromWeb(resp.body as never).pipe(res)
          } catch (e) {
            res.statusCode = 500
            res.end(`dev api error: ${String(e)}`)
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), apiDevPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
