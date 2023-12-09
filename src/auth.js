import { UnauthorizedError, registryErrorResponse } from './registry'

/**
 * @param {import('itty-router').IRequest} request
 * @param {Env} env
 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
 * @returns {Promise<import('@cloudflare/workers-types').Response | undefined>}
 */
export async function authorized (request, env, ctx) {
	if (!isPushRequest(request)) {
		// always allow pull
		return
	}

	const canPush = false
	const resp = registryErrorResponse(401, UnauthorizedError)
	resp.headers.set('www-authenticate', `basic realm=${request.url}`)

	const auth = request.headers.get('authorization')
	if (!auth) {
		return resp
	}

	if (!env.AUTH_USER || !env.AUTH_PASSWORD) {
		// no env, not allow
		return resp
	}

	const [scheme, token] = auth.split(' ', 2)
	if (scheme?.toLocaleLowerCase() !== 'basic' || token === '') {
		return resp
	}
	if (token !== btoa(env.AUTH_USER + ':' + env.AUTH_PASSWORD)) { // TODO: use subtle
		return resp
	}
}

/**
 * @param {import('itty-router').IRequest} request
 * @returns {boolean}
 */
function isPushRequest (request) {
	return !({
		'GET': true,
		'HEAD': true
	}[request.method])
}
