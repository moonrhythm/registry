import { Router } from 'itty-router'

const ChunkMinLength = 5<<10*2 // 5 MiB

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
					? 'public, max-age=86400'
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

/**
 * @typedef UploadState
 * @property {number} size
 * @property {import('@cloudflare/workers-types').R2UploadedPart[]} parts
 */

// end-4,11
// end-4a /v2/<name>/blobs/uploads/
// end-4b /v2/<name>/blobs/uploads/?digest=<digest>
// end-11 /v2/<name>/blobs/uploads/?mount=<digest>&from=<other_name>
router.post('/:name+/blobs/uploads/',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name } = request.params
		const { digest, mount, from } = request.query

		// end-11
		if (mount && from) {
			// not supported pass through end-4a
		}

		// end-4b
		if (digest) {
			const res = await env.BUCKET.head(`${name}/blobs/${digest}`)
			if (!res) { // not exists, then put to bucket
				await env.BUCKET.put(`${name}/blobs/${digest}`, request.body, {
					sha256: digestToSHA256(digest)
				})
			}
			return new Response(null, {
				status: 201,
				headers: {
					location: `/v2/${name}/blobs/${digest}`,
				}
			})
		}

		// end-4a
		// POST => PATCH => PUT

		const sessionId = crypto.randomUUID()
		const upload = await env.BUCKET.createMultipartUpload(`uploads/${sessionId}`)
		/** @type {UploadState} */
		const uploadState = {
			size: 0,
			parts: []
		}

		return new Response(null, {
			status: 202,
			headers: {
				location: uploadLocation(name, sessionId, upload.uploadId, uploadState),
				'oci-chunk-min-length': ChunkMinLength
			}
		})
	}
)

// end-4a patch
// /:name+/blobs/_upload?session=<sessionId>&upload=<uploadId>&state=<state>
router.patch('/:name+/blobs/_upload',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { session: sessionId, upload: uploadId, state } = request.query
		if (typeof sessionId !== 'string'
			|| typeof uploadId !== 'string'
			|| typeof state !== 'string') {
			return new registryErrorResponse(400, UnsupportedError)
		}
		const length = parseInt(request.headers.get('content-length') ?? '0')
		if (!length) {
			return new registryErrorResponse(400, UnsupportedError)
		}
		const [ rangeStart, rangeEnd ] = request.headers.get('content-range')?.split('-')
		if (!rangeStart || !rangeEnd) {
			return new registryErrorResponse(400, UnsupportedError)
		}

		/** @type {UploadState} */
		const uploadState = JSON.parse(state)
		if (!uploadState) {
			return new registryErrorResponse(400, UnsupportedError)
		}

		if (uploadState.size !== +rangeStart) {
			return new Response(null, {
				status: 416
			})
		}
		if (uploadState.parts.length >= 10000) { // r2 limitation
			return new Response(null, {
				status: 500
			})
		}

		const upload = env.BUCKET.resumeMultipartUpload(`uploads/${sessionId}`, uploadId)
		const part = await upload.uploadPart(uploadState.parts.length + 1, request.body)
		uploadState.parts.push(part)
		uploadState.size += length

		return new Response(null, {
			status: 202,
			headers: {
				location: uploadLocation(name, sessionId, uploadId, uploadState),
			}
		})
	}
)

// end-4a put
// /:name+/blobs/_upload?session=<sessionId>&upload=<uploadId>&state=<state>&digest=<digest>
router.put('/:name+/blobs/_upload',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { session: sessionId, upload: uploadId, state, digest } = request.query
		if (typeof sessionId !== 'string'
			|| typeof uploadId !== 'string'
			|| typeof state !== 'string'
			|| typeof digest !== 'string') {
			return new registryErrorResponse(400, UnsupportedError)
		}

		/** @type {UploadState} */
		const uploadState = JSON.parse(state)
		if (!uploadState) {
			return new registryErrorResponse(400, UnsupportedError)
		}

		const upload = env.BUCKET.resumeMultipartUpload(`uploads/${sessionId}`, uploadId)

		const length = parseInt(request.headers.get('content-length') ?? '0')
		if (length > 0) {
			const part = await upload.uploadPart(uploadState.parts.length + 1, request.body)
			uploadState.parts.push(part)
		}
		await upload.complete(uploadState.parts)

		// copy completed object to blob
		{
			const upload = await env.BUCKET.get(`uploads/${sessionId}`)
			await env.BUCKET.put(`${name}/blobs/${digest}`, upload.body, {
				sha256: digestToSHA256(digest)
			})
			await env.BUCKET.delete(`uploads/${sessionId}`)
		}

		return new Response(null, {
			status: 201,
			headers: {
				location: `/v2/${name}/blobs/${digest}`
			}
		})
	}
)

// end-4a get - get current upload range
// /:name+/blobs/_upload?session=<sessionId>&upload=<uploadId>
router.get('/:name+/blobs/_upload',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		// TODO: store in d1 ?
	}
)

// end-5
router.patch('/:name+/blobs/:reference',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name } = request.params
		const { digest } = request.query

		// TODO: implement
	}
)

// end-6
router.put('/:name+/blobs/:reference',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, reference } = request.params
		const { digest } = request.query

		// TODO: implement
	}
)

// end-7
router.put('/:name+/manifests/:reference',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const { name, reference } = request.params

		// TODO: implement
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

// end-9
router.delete('/:name+/manifests/:reference',
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

		// TODO: remove manifests sha256 that matches with ref ? or send 2 request to delete, tag and ref
		// TODO: cronjob delete no ref blobs

		await env.BUCKET.delete(`${name}/manifests/${reference}`)
		return new Response(null, {
			status: 202
		})
	}
)

// end-10
router.delete('/:name+/blobs/:digest',
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

		await env.BUCKET.delete(`${name}/blobs/${digest}`)
		return new Response(null, {
			status: 202
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
export const BlobUnknownError = {
	code: 'BLOB_UNKNOWN',
	message: 'blob unknown to registry',
	detail: 'blob unknown to registry'
}

// code-3
/** @type {RegistryError} */
export const BlobUploadUnknownError = {
	code: 'BLOB_UPLOAD_UNKNOWN',
	message: 'blob upload unknown to registry',
	detail: 'blob upload unknown to registry'
}

// code-7
/** @type {RegistryError} */
export const ManifestUnknownError = {
	code: 'MANIFEST_UNKNOWN',
	message: 'manifest unknown to registry',
	detail: 'manifest unknown to registry'
}

// code-11
/** @type {RegistryError} */
export const UnauthorizedError = {
	code: 'UNAUTHORIZED',
	message: 'authentication required',
	detail: 'authentication required'
}

// code-13
/** @type {RegistryError} */
export const UnsupportedError = {
	code: 'UNSUPPORTED',
	message: 'the operation is unsupported',
	detail: 'the operation is unsupported'
}

/**
 * @typedef RegistryErrorResult
 * @property {RegistryError[]} errors
 */

/**
 * Generates a registry error response.
 * @param {number} status - http status code
 * @param {...RegistryError} errors - The error(s) to include in the response.
 * @returns {import('@cloudflare/workers-types').Response}
 */
export function registryErrorResponse (status, ...errors) {
	return new Response(JSON.stringify({
		errors: errors
	}), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	})
}

const sha256PrefixLength = 'sha256:'.length

/**
 *
 * @param {string} digest
 * @returns {string}
 */
function digestToSHA256 (digest) {
	return digest.slice(sha256PrefixLength)
}

/**
 * @param {string} name
 * @param {string} sessionId
 * @param {string} uploadId
 * @param {UploadState} uploadState
 * @returns {string}
 */
function uploadLocation (name, sessionId, uploadId, uploadState) {
	const state = encodeURIComponent(JSON.stringify(uploadState))
	return `/v2/${name}/blobs/_upload/?session${sessionId}&upload=${uploadId}&state=${state}`
}
