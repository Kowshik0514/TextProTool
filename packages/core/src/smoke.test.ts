import {
  TemplateResolver,
  createBuiltinProviders,
  extractPromptFields,
  rankActions,
  parseExportBundle,
  createExportBundle,
  ActionRegistry,
  PluginHost,
  type Action,
} from './index.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function testTemplates(): Promise<void> {
  const resolver = new TemplateResolver()
  for (const p of createBuiltinProviders()) resolver.register(p)

  const out = await resolver.resolve('Hi {{clipboard}} on {{date}} ticket {{prompt:Ticket}}', {
    clipboard: 'https://jira/ABC-1',
    prompts: { 'prompt:Ticket': 'ABC-1' },
    now: new Date('2026-07-30T10:00:00'),
  })
  assert(out.includes('https://jira/ABC-1'), 'clipboard missing')
  assert(out.includes('ABC-1'), 'prompt missing')

  const fields = extractPromptFields('A {{prompt:Env}} B {{prompt:Name}}')
  assert(fields.length === 2, 'expected 2 prompts')

  const withKey = await resolver.resolveParts('hi{{key:enter}}', {
    now: new Date('2026-07-30T10:00:00'),
  })
  assert(withKey.length === 2, 'expected text + key')
  assert(withKey[0].type === 'text' && withKey[0].text === 'hi', 'text part')
  assert(withKey[1].type === 'key' && withKey[1].key === 'enter', 'enter key')

  const shorthand = await resolver.resolve('mail{{enter}}', {})
  assert(shorthand === 'mail[Enter]', 'shorthand enter preview')

  const waited = await resolver.resolveParts('a{{wait:2s}}b{{wait:500}}', {})
  assert(waited.length === 4, 'expected text, wait, text, wait')
  assert(waited[1].type === 'wait' && waited[1].ms === 2000, '2s wait')
  assert(waited[3].type === 'wait' && waited[3].ms === 500, '500ms wait')

  const withCursor = await resolver.resolveParts('Hi {{cursor}},\n{{clipboard}}', {
    clipboard: 'LINK',
  })
  assert(withCursor.some((p) => p.type === 'cursor'), 'cursor part missing')
  const preview = await resolver.resolve('Hi {{cursor}},\n{{clipboard}}', { clipboard: 'LINK' })
  assert(preview === 'Hi |,\nLINK', `cursor preview got: ${preview}`)
}

function testSearch(): void {
  const actions: Action[] = [
    {
      id: '1',
      name: 'Email address',
      kind: 'text.insert',
      tags: ['contact'],
      favorite: true,
      enabled: true,
      payload: { body: 'a@b.com' },
      createdAt: '',
      updatedAt: '',
      trigger: { abbreviation: ';email' },
    },
    {
      id: '2',
      name: 'Open Google',
      kind: 'url.open',
      tags: ['demo'],
      favorite: false,
      enabled: true,
      payload: { url: 'https://google.com' },
      createdAt: '',
      updatedAt: '',
    },
  ]
  const ranked = rankActions(actions, 'email')
  assert(ranked[0]?.id === '1', 'email should rank first')
}

function testExport(): void {
  const bundle = createExportBundle({
    categories: [],
    actions: [],
    variables: [],
  })
  const parsed = parseExportBundle(bundle)
  assert(parsed.version === 1, 'version')
}

async function testRegistry(): Promise<void> {
  const registry = new ActionRegistry()
  registry.register({
    kind: 'url.open',
    execute: async () => ({ ok: true, message: 'opened' }),
  })
  const result = await registry.execute(
    {
      id: 'x',
      name: 't',
      kind: 'url.open',
      tags: [],
      favorite: false,
      payload: { url: 'https://example.com' },
      createdAt: '',
      updatedAt: '',
      enabled: true,
    },
    {},
  )
  assert(result.ok, 'handler should succeed')

  const host = new PluginHost()
  host.register({ id: 'test', name: 'Test Plugin' })
  assert(host.list().length === 1, 'plugin registered')
}

async function main(): Promise<void> {
  await testTemplates()
  testSearch()
  testExport()
  await testRegistry()
  console.log('All @textpro/core smoke tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
