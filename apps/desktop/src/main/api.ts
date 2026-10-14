import http from 'http'
import type { Store } from './store'
import type { ActionExecutorService } from './executor'

/**
 * Optional local HTTP API for scripting hooks (Phase 4).
 * Bound to 127.0.0.1 only.
 */
export function startLocalApi(opts: {
  store: Store
  executor: ActionExecutorService
  port?: number
}): http.Server {
  const port = opts.port ?? 47821

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')

    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      if (req.method === 'GET' && url.pathname === '/health') {
        res.end(JSON.stringify({ ok: true, name: 'textpro' }))
        return
      }

      if (req.method === 'GET' && url.pathname === '/actions') {
        const q = url.searchParams.get('q') ?? ''
        const actions = q ? opts.store.searchActions(q) : opts.store.listActions()
        res.end(JSON.stringify(actions))
        return
      }

      if (req.method === 'POST' && url.pathname.startsWith('/actions/') && url.pathname.endsWith('/run')) {
        const id = url.pathname.split('/')[2]
        const result = await opts.executor.runAction(id)
        res.end(JSON.stringify(result))
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`TextPro local API disabled: port ${port} already in use`)
      return
    }
    console.error('TextPro local API error:', err)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`TextPro local API on http://127.0.0.1:${port}`)
  })

  return server
}
