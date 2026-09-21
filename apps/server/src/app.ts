import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DB } from "./db/index.js";
import { env } from "./env.js";
import { AppError } from "./lib/errors.js";
import { openApiSpec, apiIndex } from "./openapi.js";
import { applySecurityHeaders, isSameOrigin, makeRateLimiter } from "./security.js";
import { registerPortfolioRoutes } from "./domain/portfolios.js";
import { registerAccountRoutes } from "./domain/accounts.js";
import { registerSecurityRoutes } from "./domain/securities.js";
import { registerTransactionRoutes } from "./domain/transactions.js";
import { registerHoldingsRoutes } from "./domain/holdings.js";
import { registerImportRoutes } from "./domain/imports.js";
import { registerMarketRoutes } from "./domain/market.js";
import { registerPerformanceRoutes } from "./domain/performance.js";
import { registerDividendRoutes } from "./domain/dividends.js";
import { registerAccountManagementRoutes } from "./domain/account.js";
import { registerGoalRoutes } from "./domain/goals.js";
import { registerRebalanceRoutes } from "./domain/rebalance.js";
import { registerManualAssetRoutes } from "./domain/manual-assets.js";
import type { MarketDataProvider, FxProvider, BenchmarkProvider, SecurityHistoryProvider } from "./market/types.js";
import { YahooProvider } from "./market/providers/yahoo.js";
import { AmfiProvider } from "./market/providers/amfi.js";
import { DerivativeEstimateProvider } from "./market/providers/derivative-estimate.js";
import { CompositeProvider } from "./market/composite.js";
import { FrankfurterProvider } from "./market/providers/frankfurter.js";
import { YahooBenchmarkProvider } from "./market/providers/yahoo-benchmark.js";
import { YahooSecurityHistoryProvider } from "./market/providers/yahoo-security-history.js";
import { registerFxRoutes } from "./domain/fx.js";
import { refreshQuotes } from "./market/service.js";
import { writeAllScopes } from "./domain/snapshots.js";
import {
  SESSION_COOKIE,
  authenticate,
  createSession,
  destroySession,
  getSessionUser,
  registerUser,
  toPublicUser,
} from "./auth/service.js";
import type { User } from "./db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

const credentialsSchema = z.object({
  username: z.string().trim().min(3, "username must be at least 3 chars").max(64),
  password: z.string().min(8, "password must be at least 8 chars").max(200),
});
const registerSchema = credentialsSchema.extend({
  email: z.string().email().optional(),
  baseCurrency: z.string().length(3).optional(),
});

export interface AppOptions {
  /** Injectable price source; defaults to Yahoo (equities) + AMFI (MFs). */
  marketProvider?: MarketDataProvider;
  /** Injectable FX source; defaults to frankfurter.app (ECB rates). */
  fxProvider?: FxProvider;
  /** Injectable historical-index source for benchmark comparison; defaults to Yahoo. */
  benchmarkProvider?: BenchmarkProvider;
  /** Injectable per-security price history for time-weighted return; defaults to Yahoo. */
  historyProvider?: SecurityHistoryProvider;
  /** If set to a built web `dist` dir, the server also serves the SPA (single-service self-host). */
  webDir?: string;
}

export function buildApp(db: DB, options: AppOptions = {}): FastifyInstance {
  // 25 MB body limit accommodates large broker-CSV imports (content up to ~20 MB).
  const app = Fastify({ logger: env.isProd, bodyLimit: 25 * 1024 * 1024 });
  const marketProvider =
    options.marketProvider ?? new CompositeProvider(new YahooProvider(), new AmfiProvider(), new DerivativeEstimateProvider());
  const fxProvider = options.fxProvider ?? new FrankfurterProvider();
  const benchmarkProvider = options.benchmarkProvider ?? new YahooBenchmarkProvider();
  const historyProvider = options.historyProvider ?? new YahooSecurityHistoryProvider();
  app.register(cookie);

  // Security: response headers on everything; a same-origin (CSRF) guard + auth rate limit.
  const authLimiter = makeRateLimiter(30, 5 * 60 * 1000); // 30 attempts / 5 min per IP
  app.addHook("onRequest", async (req, reply) => {
    applySecurityHeaders(reply);
    if (!isSameOrigin(req)) {
      reply.code(403).send({ error: "cross_origin_blocked", message: "Cross-origin request blocked" });
      return reply;
    }
    if (req.method === "POST" && (req.url === "/api/auth/login" || req.url === "/api/auth/register")) {
      if (!authLimiter(req.ip)) {
        reply.code(429).send({ error: "rate_limited", message: "Too many attempts. Please wait a few minutes." });
        return reply;
      }
    }
  });

  function setSessionCookie(reply: FastifyReply, sessionId: string) {
    reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.secureCookies,
      path: "/",
      maxAge: env.sessionTtlDays * 86_400,
    });
  }

  /** preHandler that requires a valid session; attaches request.user. */
  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const sid = req.cookies[SESSION_COOKIE];
    const user = sid ? await getSessionUser(db, sid) : null;
    if (!user) {
      reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
      return reply;
    }
    req.user = user;
  }
  app.decorate("requireAuth", requireAuth);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      reply.code(400).send({ error: "validation_error", issues: err.issues });
      return;
    }
    const e = err as { statusCode?: number; message?: string };
    reply
      .code(e.statusCode ?? 500)
      .send({ error: "internal_error", message: e.message ?? "Unexpected error" });
  });

  app.get("/health", async () => ({ status: "ok", service: "dhan-drishti", ts: new Date().toISOString() }));

  // Public API discovery + machine-readable contract (no auth — schema only, no data).
  app.get("/api", async () => apiIndex());
  app.get("/api/openapi.json", async () => openApiSpec);

  app.post("/api/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const user = await registerUser(db, body);
    const sid = await createSession(db, user.id, env.sessionTtlDays);
    setSessionCookie(reply, sid);
    reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    const user = await authenticate(db, body.username, body.password);
    const sid = await createSession(db, user.id, env.sessionTtlDays);
    setSessionCookie(reply, sid);
    reply.send({ user: toPublicUser(user) });
    // Freshen prices and record a snapshot in the background so the dashboard opens up to date.
    void refreshQuotes(db, user.id, marketProvider)
      .then(() => writeAllScopes(db, user.id))
      .catch(() => {
        /* best-effort; never affects the login response */
      });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await destroySession(db, sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: (req, reply) => app.requireAuth(req, reply) }, async (req) => {
    return { user: toPublicUser(req.user!) };
  });

  // Authenticated domain routes (each guards itself with app.requireAuth).
  registerPortfolioRoutes(app, db);
  registerAccountRoutes(app, db);
  registerSecurityRoutes(app, db);
  registerTransactionRoutes(app, db, fxProvider);
  registerHoldingsRoutes(app, db);
  registerImportRoutes(app, db);
  registerMarketRoutes(app, db, marketProvider);
  registerFxRoutes(app, db, fxProvider);
  registerPerformanceRoutes(app, db, benchmarkProvider, historyProvider);
  registerDividendRoutes(app, db);
  registerGoalRoutes(app, db);
  registerRebalanceRoutes(app, db);
  registerManualAssetRoutes(app, db);
  registerAccountManagementRoutes(app, db);

  // Single-service self-host: serve the built SPA and fall back to index.html for client routes.
  const serveSpa = Boolean(options.webDir && existsSync(options.webDir));
  if (serveSpa) {
    app.register(fastifyStatic, { root: options.webDir, prefix: "/" });
  }
  // Consistent 404: JSON for API/health always; SPA fallback for client routes when built.
  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith("/api") || req.url.startsWith("/health");
    if (serveSpa && req.method === "GET" && !isApi) {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "not_found", message: "Not found" });
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
