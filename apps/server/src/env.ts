/** Central runtime config. Local-first defaults; override via environment. */
export const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "127.0.0.1",
  databaseUrl: process.env.DATABASE_URL ?? "./data/dhan-drishti.sqlite",
  /** Secure cookies require HTTPS; off by default for local self-hosting over http. */
  secureCookies: process.env.SECURE_COOKIES === "true",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  isProd: process.env.NODE_ENV === "production",
  /** Directory of the built web SPA to serve (single-service self-host). Empty = API only. */
  webDir: process.env.WEB_DIR ?? "",
};
