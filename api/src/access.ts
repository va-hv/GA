import {
  CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata,
  UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Db } from './db';

export type Role = 'admin' | 'security' | 'dock' | 'kiosk';
export const STAFF: Role[] = ['admin', 'security', 'dock'];

export interface Caller {
  token: string;
  sessionId: string;
  accountId: string | null;
  orgId: string;
  role: Role;
  name: string;
  mustChange: boolean;
  mustSetUpTwoStep: boolean;
}

const WHO = 'gatehouse:who';
const OPEN = 'gatehouse:open';
const DURING_PASSWORD_CHANGE = 'gatehouse:pw';

/** Which roles may call this route. The database checks again inside every rule function. */
export const Who = (...roles: Role[]) => SetMetadata(WHO, roles);
/** Reachable without signing in (health, sign-in, kiosk pairing). */
export const Open = () => SetMetadata(OPEN, true);
/** Reachable while the person still has to replace a temporary password. */
export const DuringPasswordChange = () => SetMetadata(DURING_PASSWORD_CHANGE, true);

export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): Caller => ctx.switchToHttp().getRequest().caller);

export function bearer(req: Request): string | null {
  const h = String(req.headers.authorization ?? '');
  return h.startsWith('Bearer ') && h.length > 20 && h.length < 200 ? h.slice(7) : null;
}

/** Every route is closed unless marked @Open(); a signed-in caller must also hold one of the @Who() roles. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(OPEN, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = bearer(req);
    if (!token) throw new UnauthorizedException('Please sign in');

    const [row] = await this.db.as(token, (sql) =>
      sql<{ session_id: string | null; account_id: string | null; org_id: string; role: Role; name: string; must_change: boolean; must_set_up_two_step: boolean | null }>(
        'SELECT session_id, account_id, org_id, role, name, must_change, must_set_up_two_step FROM base.caller()'));
    if (!row?.session_id) throw new UnauthorizedException('Your session has ended. Please sign in again.');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(WHO, targets);
    if (!roles || !roles.includes(row.role)) throw new ForbiddenException('Your role cannot do this');
    if (row.must_change && !this.reflector.getAllAndOverride<boolean>(DURING_PASSWORD_CHANGE, targets)) {
      throw new ForbiddenException({ message: 'You must change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (row.must_set_up_two_step && !this.reflector.getAllAndOverride<boolean>(DURING_PASSWORD_CHANGE, targets)) {
      throw new ForbiddenException({ message: 'Set up two-step sign-in before continuing', code: 'TWO_STEP_SETUP_REQUIRED' });
    }

    const caller: Caller = { token, sessionId: row.session_id, accountId: row.account_id, orgId: row.org_id, role: row.role, name: row.name, mustChange: row.must_change, mustSetUpTwoStep: !!row.must_set_up_two_step };
    req.caller = caller;
    return true;
  }
}

/** A small per-address limit for the open routes that take guesses (sign-in, kiosk pairing). */
@Injectable()
export class GuessLimit {
  private readonly hits = new Map<string, number[]>();

  check(key: string, perMinute = 20) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      throw new HttpException({ message: 'Too many attempts. Wait a minute and try again.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}
