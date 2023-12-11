import { Router } from 'itty-router'
import dayjs from 'dayjs'

export const router = Router({ base: '/api/' })

router.post('/getRepositories',
	/**
	 * @param {import('itty-router').IRequest} request
	 * @param {Env} env
	 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
	 * @returns {Promise<import('@cloudflare/workers-types').Response>}
	 */
	async (request, env, ctx) => {
		const db = env.DB
		const res = await db
			.prepare(`
				select name, created_at
				from repositories
				order by name
			`).all()
		return ok({
			items: res.results.map((x) => ({
				name: x.name,
				createdAt: format(dayjs(x.created_at))
			}))
		})
	}
)

function ok (result) {
	return new Response(JSON.stringify({
		ok: true,
		result
	}), {
		headers: {
			'content-type': 'application/json'
		}
	})
}

/**
 * format formats date to RFC3339 string
 * @param {import('dayjs').Dayjs} date
 * @returns {string}
 */
export function format (date) {
	return date.toISOString().replace(/\..+Z$/, 'Z')
}
