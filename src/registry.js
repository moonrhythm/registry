import { Router } from 'itty-router'

export const router = Router({ base: '/v2/' })

// https://github.com/opencontainers/distribution-spec/blob/main/spec.md

// end-1
router.get('/',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		return new Response('ok')
	}
)

// end-2 GET
router.get('/:name+/blobs/:digest+',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, digest } = request.params

		const cache = caches.default
		{
			const resp = await cache.match(request)
			if (resp) {
				return resp
			}
		}

		const res = await env.BUCKET.get(`${name}/blobs/${digest}`)
		if (!res) {
			return registryErrorResponse(404, BlobUnknownError)
		}

		const resp = new Response(res.body, {
			headers: {
				'docker-content-digest': hexToDigest(res.checksums.sha256),
				'content-length': res.size,
				'cache-control': 'public, max-age=31536000; immutable'
			}
		})
		ctx.waitUntil(cache.put(request, resp.clone()))

		return resp
	}
)

// end-2 HEAD
router.head('/:name+/blobs/:digest+',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, digest } = request.params

		const res = await env.BUCKET.head(`${name}/blobs/${digest}`)
		if (!res) {
			return registryErrorResponse(404, BlobUnknownError)
		}

		return new Response(null, {
			headers: {
				'docker-content-digest': hexToDigest(res.checksums.sha256),
				'content-length': res.size
			}
		})
	}
)

// end-3 GET
router.get('/:name+/manifests/:reference',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, reference } = request.params

		const cache = caches.default
		{
			const resp = await cache.match(request)
			if (resp) {
				return resp
			}
		}

		const res = await env.BUCKET.get(`${name}/manifests/${reference}`)
		if (!res) {
			return registryErrorResponse(404, ManifestUnknownError)
		}

		const resp = new Response(res.body, {
			headers: {
				'docker-content-digest': hexToDigest(res.checksums.sha256),
				'content-length': res.size,
				'content-type': res.httpMetadata.contentType,
				'cache-control': reference.startsWith('sha256:')
					? 'public, max-age=31536000; immutable'
					: 'public, max-age=600'
			}
		})
		ctx.waitUntil(cache.put(request, resp.clone()))

		return resp
	}
)

// end-3 HEAD
router.head('/:name+/manifests/:reference',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, reference } = request.params

		const res = await env.BUCKET.head(`${name}/manifests/${reference}`)
		if (!res) {
			return registryErrorResponse(404, ManifestUnknownError)
		}

		return new Response(null, {
			headers: {
				'docker-content-digest': hexToDigest(res.checksums.sha256),
				'content-length': res.size,
				'content-type': res.httpMetadata.contentType
			}
		})
	}
)

// end-8
router.get('/:name+/tags/list',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name } = request.params
		const { n, last } = request.query

		const limit = typeof n === 'string' ? parseInt(n) : 50
		const startAfter = typeof last === 'string' ? last : undefined

		const res = await env.BUCKET.list({
			prefix: `${name}/manifests`,
			limit,
			startAfter
		})

		const tags = res.objects
			.map((x) => x.key.split('/').pop())
		const lastKey = tags.length > 0 ? tags[tags.length - 1] : ''

		let link = ''
		if (tags.length >= n) {
			const qs = new URLSearchParams({ n: '' + limit, last: lastKey })
			const url = new URL(request.url)
			url.search = qs.toString()
			link = url.toString()
		}

		return new Response(JSON.stringify({ name, tags }), {
			headers: {
				'content-type': 'application/json',
				...link ? { 'link': `<${link}>; rel=next` } : null
			}
		})
	}
)

function hexToDigest (s) {
	const digest = [...new Uint8Array(s)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
	return `sha256:${digest}`;
}

// errors

/**
 * @typedef RegistryError
 * @property {string} code
 * @property {string} message
 * @property {string} detail
 */

// code-1
/** @type {RegistryError} */
const BlobUnknownError = {
	code: 'BLOB_UNKNOWN',
	message: 'blob unknown to registry',
	detail: 'blob unknown to registry'
}

// code-7
/** @type {RegistryError} */
const ManifestUnknownError = {
	code: 'MANIFEST_UNKNOWN',
	message: 'manifest unknown to registry',
	detail: 'manifest unknown to registry'
}

/**
 * @typedef RegistryErrorResult
 * @property {RegistryError[]} errors
 */

/**
 * Generates a registry error response.
 * @param {number} status - http status code
 * @param {...RegistryError} errors - The error(s) to include in the response.
 */
function registryErrorResponse (status, ...errors) {
	return new Response(JSON.stringify({
		errors: errors
	}), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	})
}
