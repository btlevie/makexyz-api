import { test } from '@japa/runner'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { extractUrls } from '#services/moderation/extractors'
import { buildViews } from '#services/moderation/normalizer'
import urlUnsafe from '#services/moderation/rules/url_unsafe'
import urlUnverified from '#services/moderation/rules/url_unverified'
import urlYoungDomain from '#services/moderation/rules/url_young_domain'
import urlUserContentFromVendor from '#services/moderation/rules/url_user_content_from_vendor'
import urlDangerousFile from '#services/moderation/rules/url_dangerous_file'
import urlReputationUnknown from '#services/moderation/rules/url_reputation_unknown'
import attachmentPending from '#services/moderation/rules/attachment_pending'
import attachmentRejected from '#services/moderation/rules/attachment_rejected'
import {
  BUILTIN_LISTS,
  listStatusFor,
  mergeDomainLists,
} from '#services/moderation/url/domain_registry'
import { isBlockedAddress } from '#services/moderation/url/ip_policy'
import { normalizeUrl } from '#services/moderation/url/normalize'
import { SafeUrlFetcher } from '#services/moderation/url/safe_url_fetcher'
import { staticFlags } from '#services/moderation/url/static_checks'
import type { RuleContext, UrlScanSummary } from '#services/moderation/types'
import { contextFor } from '#tests/helpers/moderation'

function flagsOf(url: string) {
  return staticFlags(normalizeUrl(url)!, BUILTIN_LISTS.allowDomains)
}

/** A rule context whose links carry the given async-analysis result. */
function withScan(text: string, scan: Partial<UrlScanSummary>, overrides = {}): RuleContext {
  const ctx = contextFor(text, overrides)
  for (const url of ctx.signals.urls) {
    url.scan = {
      verdict: 'safe',
      threatTypes: [],
      finalHostname: null,
      finalList: null,
      domainAgeDays: null,
      reasons: [],
      ...scan,
    }
  }
  return ctx
}

test.group('URL normalization', () => {
  test('{$self.input} -> {$self.url}')
    .with([
      {
        input: 'HTTP://Example.COM:80/a//b/%7Efoo?utm_source=x&id=3#top',
        url: 'http://example.com/a/b/~foo?id=3',
      },
      { input: 'example.shop/deal', url: 'http://example.shop/deal' },
      { input: 'http://bit.ly/abc?fbclid=1&gclid=2', url: 'http://bit.ly/abc' },
      { input: 'http://0x7f.1/admin', url: 'http://127.0.0.1/admin' },
      { input: 'http://2130706433/', url: 'http://127.0.0.1/' },
      { input: 'http://0177.0.0.1/', url: 'http://127.0.0.1/' },
      { input: 'http://user:pw@evil.example/', url: 'http://evil.example/' },
      { input: 'https://аррӏе.com/login', url: 'https://xn--80ak6aa92e.com/login' },
      { input: 'http://[::ffff:127.0.0.1]/', url: 'http://[::ffff:7f00:1]/' },
    ])
    .run(({ assert }, { input, url }) => {
      assert.equal(normalizeUrl(input)?.url, url)
    })

  test('the same link written two ways shares one hash', ({ assert }) => {
    assert.equal(
      normalizeUrl('https://Example.com/path?utm_campaign=x')!.hash,
      normalizeUrl('https://example.com/path')!.hash
    )
  })

  test('credentials in a link are noted, then stripped', ({ assert }) => {
    const url = normalizeUrl('https://paypal.com@evil.example/')!
    assert.isTrue(url.hadUserinfo)
    assert.equal(url.hostname, 'evil.example')
  })
})

test.group('URL address policy', () => {
  test('{$self.address} blocked: {$self.blocked}')
    .with([
      { address: '127.0.0.1', blocked: true },
      { address: '10.1.2.3', blocked: true },
      { address: '172.20.0.1', blocked: true },
      { address: '192.168.1.1', blocked: true },
      { address: '100.64.0.1', blocked: true },
      { address: '169.254.169.254', blocked: true },
      { address: '::1', blocked: true },
      { address: 'fd00:ec2::254', blocked: true },
      { address: 'fe80::1', blocked: true },
      { address: '::ffff:10.0.0.1', blocked: true },
      { address: '::ffff:7f00:1', blocked: true },
      { address: '64:ff9b::a9fe:a9fe', blocked: true },
      { address: '2002:c0a8:0101::1', blocked: true },
      { address: 'not-an-ip', blocked: true },
      { address: '8.8.8.8', blocked: false },
      { address: '::ffff:8.8.8.8', blocked: false },
      { address: '2606:4700:4700::1111', blocked: false },
    ])
    .run(({ assert }, { address, blocked }) => {
      assert.equal(isBlockedAddress(address), blocked)
    })
})

test.group('URL static checks', () => {
  test('look-alikes of brands and allow-listed domains: {$self}')
    .with([
      'https://paypa1.com/login',
      'https://rnakexyz.com',
      'https://paypai.com',
      'https://mcmaster-carr.com.paypa1.com',
      'https://аррӏе.com',
      'https://thingiverse.co',
    ])
    .run(({ assert }, url) => {
      // thingiverse.co is an exact name on another TLD - a country site, not a look-alike.
      const expected = !url.endsWith('thingiverse.co')
      assert.equal(flagsOf(url).includes('lookalike'), expected)
    })

  test('real brand domains are not look-alikes: {$self}')
    .with(['https://www.paypal.com', 'https://makexyz.com/quotes', 'https://dhl.de/track'])
    .run(({ assert }, url) => {
      assert.notInclude(flagsOf(url), 'lookalike')
    })

  test('shape flags', ({ assert }) => {
    assert.includeMembers(flagsOf('http://10.0.0.5/x'), ['ip_literal', 'private_ip'])
    assert.include(flagsOf('https://bit.ly/3abc'), 'shortener')
    assert.include(flagsOf('https://files.example.net/setup.EXE'), 'dangerous_extension')
    assert.include(flagsOf('https://files.example.net/parts.zip'), 'archive_extension')
    assert.include(flagsOf('https://deals.example.top'), 'high_abuse_tld')
    assert.include(flagsOf('https://a.b.c.d.e.example.com'), 'deep_subdomain')
    assert.include(flagsOf('https://example.com:8443/'), 'non_standard_port')
    assert.include(flagsOf('https://user@example.com/'), 'userinfo')
  })

  test('a homograph is read from the text as written, not folded to Latin', ({ assert }) => {
    // Cyrillic "у" in makexyz - the folded text views would read the real domain.
    const urls = extractUrls(buildViews('Log in at https://makexуz.com/account to pay'))
    const homograph = urls.find((url) => url.hostname.startsWith('xn--'))
    assert.exists(homograph)
    assert.include(homograph!.flags, 'lookalike')
    assert.equal(
      urlUnsafe.evaluate(contextFor('Log in at https://makexуz.com/account'), {})?.action,
      'block'
    )
  })
})

test.group('URL domain lists', () => {
  test('the most specific entry wins', ({ assert }) => {
    assert.equal(listStatusFor('docs.google.com', BUILTIN_LISTS).status, 'user_content')
    assert.equal(listStatusFor('www.google.com', BUILTIN_LISTS).status, 'none')
    assert.equal(listStatusFor('www.printables.com', BUILTIN_LISTS).status, 'allow')
  })

  test('admin rows override built-ins, and can take a subdomain off a list', ({ assert }) => {
    const lists = mergeDomainLists([
      { domain: 'printables.com', listStatus: 'block' },
      { domain: 'shop.ups.com', listStatus: 'none' },
      { domain: 'example.net', listStatus: null },
    ])
    assert.equal(listStatusFor('www.printables.com', lists).status, 'block')
    assert.equal(listStatusFor('shop.ups.com', lists).status, 'none')
    assert.equal(listStatusFor('www.ups.com', lists).status, 'allow')
    assert.equal(listStatusFor('example.net', lists).status, 'none')
  })
})

test.group('URL rules', () => {
  test('an unanalysed unknown link holds; once analysed it does not', ({ assert }) => {
    const text = 'Samples at https://my-shop.example.net/samples'
    assert.equal(urlUnverified.evaluate(contextFor(text), {})?.action, 'hold')
    assert.isNull(urlUnverified.evaluate(withScan(text, { verdict: 'safe' }), {}))
  })

  test('a Web Risk threat or a redirect to a blocked domain blocks', ({ assert }) => {
    const text = 'Invoice: https://bit.ly/3xyz'
    assert.equal(urlUnsafe.evaluate(withScan(text, { verdict: 'malicious' }), {})?.action, 'block')
    assert.equal(
      urlUnsafe.evaluate(withScan(text, { finalHostname: 'evil.example', finalList: 'block' }), {})
        ?.action,
      'block'
    )
    assert.isNull(urlUnsafe.evaluate(withScan(text, { verdict: 'safe' }), {}))
  })

  test('unknown reputation goes to a person', ({ assert }) => {
    const ctx = withScan('See my-shop.example.net', { verdict: 'unknown' })
    assert.equal(urlReputationUnknown.evaluate(ctx, {})?.action, 'review')
  })

  test('young domains: review, or block from a vendor or new account', ({ assert }) => {
    const config = urlYoungDomain.defaultConfig
    const text = 'See https://fresh-deals.example.net'
    const customer = { senderRole: 'customer' as const, trustTier: 'standard' as const }
    assert.equal(
      urlYoungDomain.evaluate(withScan(text, { domainAgeDays: 20 }, customer), config)?.action,
      'review'
    )
    assert.equal(
      urlYoungDomain.evaluate(withScan(text, { domainAgeDays: 3 }, customer), config)?.action,
      'review'
    )
    assert.equal(
      urlYoungDomain.evaluate(withScan(text, { domainAgeDays: 3 }), config)?.action,
      'block'
    )
    assert.equal(
      urlYoungDomain.evaluate(
        withScan(text, { domainAgeDays: 3 }, { ...customer, trustTier: 'new' }),
        config
      )?.action,
      'block'
    )
    assert.isNull(urlYoungDomain.evaluate(withScan(text, { domainAgeDays: 400 }), config))
  })

  test('file-sharing links from a vendor escalate, even behind a shortener', ({ assert }) => {
    assert.equal(
      urlUserContentFromVendor.evaluate(
        contextFor('Drawing: https://drive.google.com/file/d/abc'),
        {}
      )?.action,
      'escalate'
    )
    assert.equal(
      urlUserContentFromVendor.evaluate(
        withScan('Drawing: https://1drv.ms/abc', {
          finalHostname: 'onedrive.live.com',
          finalList: 'user_content',
        }),
        {}
      )?.action,
      'escalate'
    )
  })

  test('links to programs and archives are blocked with a reason', ({ assert }) => {
    const result = urlDangerousFile.evaluate(
      contextFor('Get the viewer: https://files.example.net/viewer.exe'),
      {}
    )
    assert.equal(result?.action, 'block')
    assert.match(result!.userMessage!, /Attach the file/)
    assert.isNull(
      urlDangerousFile.evaluate(contextFor('Files: https://www.printables.com/model/1.zip'), {})
    )
  })

  test('attachments: pending holds, rejected blocks', ({ assert }) => {
    const ctx = contextFor('see attached')
    const file = { uuid: 'a', fileName: 'part.stl', extname: 'stl', rejectReason: null }
    ctx.signals.attachments = [{ ...file, status: 'uploaded' }]
    assert.equal(attachmentPending.evaluate(ctx, {})?.action, 'hold')
    ctx.signals.attachments = [{ ...file, status: 'rejected', rejectReason: 'malware' }]
    assert.equal(attachmentRejected.evaluate(ctx, {})?.action, 'block')
  })
})

/**
 * The redirect fetcher against a real local server. 127.0.0.1 stands in for a
 * public host (the address policy is told to allow just that); every other
 * private address is still refused.
 */
test.group('Safe URL fetcher', (group) => {
  let server: http.Server
  let port: number
  const hostAddresses: Record<string, string[]> = {}
  let lookups = 0

  group.setup(async () => {
    server = http.createServer((request, response) => {
      const path = request.url ?? '/'
      if (path === '/start') {
        response.writeHead(302, { location: '/middle' }).end()
      } else if (path === '/middle') {
        response.writeHead(301, { location: `http://final.test:${port}/end` }).end()
      } else if (path === '/loop') {
        response.writeHead(302, { location: '/loop' }).end()
      } else if (path === '/to-metadata') {
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end()
      } else if (path === '/to-private-name') {
        response.writeHead(302, { location: `http://intranet.test:${port}/` }).end()
      } else if (path === '/to-ssh') {
        response.writeHead(302, { location: 'http://127.0.0.1:22/' }).end()
      } else if (path === '/meta') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<html><head><meta http-equiv="refresh" content="0; url=/end"></head></html>`)
      } else if (path === '/no-head') {
        if (request.method === 'HEAD') response.writeHead(405).end()
        else response.writeHead(302, { location: '/end' }).end()
      } else if (path === '/slow') {
        // Never answers.
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
    Object.assign(hostAddresses, {
      'start.test': ['127.0.0.1'],
      'final.test': ['127.0.0.1'],
      'intranet.test': ['10.0.0.8'],
      'mapped.test': ['::ffff:10.0.0.8'],
      'rebind.test': ['127.0.0.1', '192.168.1.20'],
    })
    return () => new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function fetcher(overrides = {}) {
    return new SafeUrlFetcher({
      lookupAll: async (hostname) => {
        lookups++
        return (hostAddresses[hostname] ?? []).map((address) => ({
          address,
          family: address.includes(':') ? 6 : 4,
        }))
      },
      isAllowedAddress: (address) => address === '127.0.0.1' || !isBlockedAddress(address),
      allowedPorts: [port, 80, 443],
      hopTimeoutMs: 300,
      totalTimeoutMs: 1500,
      ...overrides,
    })
  }

  test('follows a redirect chain to where it ends', async ({ assert }) => {
    const result = await fetcher().resolve(`http://start.test:${port}/start`)
    assert.isNull(result.blockedHop)
    assert.isNull(result.error)
    assert.equal(result.finalUrl, `http://final.test:${port}/end`)
    assert.lengthOf(result.chain, 3)
  })

  test('falls back to GET when HEAD is refused, and follows meta refresh', async ({ assert }) => {
    const noHead = await fetcher().resolve(`http://start.test:${port}/no-head`)
    assert.equal(noHead.finalUrl, `http://start.test:${port}/end`)
    const meta = await fetcher().resolve(`http://start.test:${port}/meta`)
    assert.equal(meta.finalUrl, `http://start.test:${port}/end`)
  })

  test('a redirect to the metadata endpoint is a blocked hop', async ({ assert }) => {
    const result = await fetcher().resolve(`http://start.test:${port}/to-metadata`)
    assert.equal(result.blockedHop, 'http://169.254.169.254/latest/meta-data/')
  })

  test('a name resolving to a private address is never connected to', async ({ assert }) => {
    const redirected = await fetcher().resolve(`http://start.test:${port}/to-private-name`)
    assert.equal(redirected.blockedHop, `http://intranet.test:${port}/`)
    const mapped = await fetcher().resolve(`http://mapped.test:${port}/`)
    assert.isNotNull(mapped.blockedHop)
  })

  test('DNS rebinding: any private address in the answer blocks, and DNS is asked once', async ({
    assert,
  }) => {
    lookups = 0
    const result = await fetcher().resolve(`http://rebind.test:${port}/`)
    assert.isNotNull(result.blockedHop)
    assert.equal(lookups, 1)
  })

  test('ports other than the allowed ones are refused', async ({ assert }) => {
    const result = await fetcher().resolve(`http://start.test:${port}/to-ssh`)
    assert.equal(result.blockedHop, 'http://127.0.0.1:22/')
  })

  test('redirect loops stop at the hop cap', async ({ assert }) => {
    const result = await fetcher({ maxHops: 3 }).resolve(`http://start.test:${port}/loop`)
    assert.equal(result.error, 'too_many_redirects')
    assert.lengthOf(result.chain, 4)
  })

  test('a server that never answers times out', async ({ assert }) => {
    const startedAt = Date.now()
    const result = await fetcher().resolve(`http://start.test:${port}/slow`)
    assert.equal(result.error, 'timeout')
    assert.isBelow(Date.now() - startedAt, 1400)
  })
})
