import type { FastifyInstance, RouteShorthandOptions } from "fastify";

/** Route options that require a valid session (attaches req.user). */
export function authed(app: FastifyInstance): RouteShorthandOptions {
  return { preHandler: (req, reply) => app.requireAuth(req, reply) };
}
