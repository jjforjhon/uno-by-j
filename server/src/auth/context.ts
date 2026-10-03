import type { Env } from "../net/router";
import { AuthService } from "./service";
import { D1UserRepo, D1RefreshTokenRepo, D1SecurityEventRepo } from "../db/d1";
import { CacheRateLimiter } from "../net/ratelimit";

/** Composition root for auth: one AuthService per request, backed by D1 + Cache limiter. */
export function getAuthService(env: Env): AuthService {
  return new AuthService({
    users: new D1UserRepo(env.DB),
    tokens: new D1RefreshTokenRepo(env.DB),
    events: new D1SecurityEventRepo(env.DB),
    limiter: new CacheRateLimiter("auth"),
    jwtSecret: env.JWT_SECRET,
  });
}
