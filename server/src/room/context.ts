import type { Env } from "../net/router";
import { RoomService } from "./service";
import { D1RoomRepo, D1RoomMemberRepo } from "../db/rooms";
import { D1UserRepo, D1SecurityEventRepo } from "../db/d1";
import { CacheRateLimiter } from "../net/ratelimit";

export function getRoomService(env: Env): RoomService {
  return new RoomService({
    rooms: new D1RoomRepo(env.DB),
    members: new D1RoomMemberRepo(env.DB),
    users: new D1UserRepo(env.DB),
    events: new D1SecurityEventRepo(env.DB),
    limiter: new CacheRateLimiter("room"),
    roomStub: (code) => env.ROOM_DO.get(env.ROOM_DO.idFromName(code)),
  });
}
