import { Body, Controller, ForbiddenException, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Caller, DuringPasswordChange, GuessLimit, Me, Open, Role, STAFF, Who, bearer } from './access';
import { Db } from './db';
import { accountChange, changePassword, download, endAll, fingerprint, kioskCheckIn, kioskLabel, newAccount, pairing, passwordOnly, passwordReset, read, signIn, siteChange, twoStepCode } from './input';
import { VISIT_FIELDS } from './gate.controller';

const PAGE_NAMES: Record<string, string> = { admin: 'Admin', security: 'Security', dock: 'Dock coordinator' };
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 12);

@Controller('api')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Get('health')
  @Open()
  async health() {
    return { ok: await this.db.ping() };
  }
}

/** Signing in and out. Lockout after five failures lives in the database (base.sign_in). */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly db: Db, private readonly limit: GuessLimit) {}

  @Post('sign-in')
  @HttpCode(200)
  @Open()
  async signIn(@Body() body: unknown, @Ip() ip: string) {
    this.limit.check(`sign-in:${ip}`);
    const { page, username, password, code } = read(signIn, body);
    const [r] = await this.db.as(null, (sql) => sql<{ outcome: string; token: string | null; role: string | null; must_change: boolean | null }>(
      'SELECT * FROM base.sign_in($1, $2, $3, $4, $5, $6)', [username, password, page, ip, SESSION_HOURS, code ?? null]));
    if (r.outcome === 'need_code') {
      throw new UnauthorizedException({ message: 'Enter the 6-digit code from your authenticator app', code: 'TWO_STEP_REQUIRED' });
    }
    if (r.outcome === 'locked') throw new ForbiddenException({ message: 'Too many failed attempts. Try again in a few minutes.', code: 'LOCKED' });
    if (r.outcome === 'wrong_page') {
      throw new ForbiddenException({
        message: `This is not a ${PAGE_NAMES[page]} account. Use the "${PAGE_NAMES[r.role ?? ''] ?? 'right'}" sign-in instead.`,
        code: 'WRONG_PAGE', role: r.role,
      });
    }
    if (r.outcome !== 'ok' || !r.token) throw new UnauthorizedException(code ? 'Wrong username, password or code' : 'Wrong username or password');
    return { token: r.token, role: r.role, mustChange: r.must_change };
  }

  @Post('sign-out')
  @HttpCode(200)
  @Open()
  async signOut(@Req() req: Request) {
    const token = bearer(req);
    if (token) await this.db.as(token, (sql) => sql('SELECT base.sign_out()'));
    return { ok: true };
  }

  @Get('me')
  @Who(...STAFF, 'kiosk')
  @DuringPasswordChange()
  async me(@Me() me: Caller) {
    const [site] = await this.db.as(me.token, (sql) => sql<{ name: string }>('SELECT name FROM base.orgs'));
    const [acct] = me.accountId
      ? await this.db.as(me.token, (sql) => sql<{ two_step: boolean; required: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM base.accounts WHERE id = $1 AND totp_enabled_at IS NOT NULL) AS two_step,
                coalesce((SELECT require_two_step_admins FROM base.site_settings), false) AS required`, [me.accountId]))
      : [];
    return {
      id: me.accountId, name: me.name, role: me.role, mustChange: me.mustChange, site: site?.name ?? '',
      mustSetUpTwoStep: me.mustSetUpTwoStep, twoStep: acct?.two_step ?? false, twoStepRequired: me.role === 'admin' && !!acct?.required,
    };
  }

  @Post('password')
  @HttpCode(200)
  @Who(...STAFF)
  @DuringPasswordChange()
  async password(@Me() me: Caller, @Body() body: unknown) {
    const { currentPassword, newPassword } = read(changePassword, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.change_password($1, $2)', [currentPassword, newPassword]));
    return { ok: true };
  }

  @Post('two-step/start')
  @HttpCode(200)
  @Who(...STAFF)
  @DuringPasswordChange()
  async twoStepStart(@Me() me: Caller) {
    const [r] = await this.db.as(me.token, (sql) => sql<{ secret: string; uri: string }>('SELECT * FROM base.start_two_step()'));
    return r;
  }

  @Post('two-step/confirm')
  @HttpCode(200)
  @Who(...STAFF)
  @DuringPasswordChange()
  async twoStepConfirm(@Me() me: Caller, @Body() body: unknown, @Ip() ip: string) {
    this.limit.check(`two-step:${me.sessionId}`, 10);
    const { code } = read(twoStepCode, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.confirm_two_step($1)', [code]));
    return { ok: true };
  }

  @Post('two-step/off')
  @HttpCode(200)
  @Who(...STAFF)
  async twoStepOff(@Me() me: Caller, @Body() body: unknown) {
    const { currentPassword } = read(passwordOnly, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.turn_off_two_step($1)', [currentPassword]));
    return { ok: true };
  }
}

/** The site's name and wording, for every screen that shows it (kiosk included). */
@Controller('api/site')
export class SiteController {
  constructor(private readonly db: Db) {}

  @Get()
  @Who(...STAFF, 'kiosk')
  async site(@Me() me: Caller) {
    const [r] = await this.db.as(me.token, (sql) => sql(
      `SELECT o.name, s.safety_visitor AS "safetyVisitor", s.safety_driver AS "safetyDriver", s.kiosk_welcome AS "kioskWelcome",
              s.updated_at AS "updatedAt", s.updated_by AS "updatedBy", s.require_two_step_admins AS "requireTwoStepAdmins",
              s.keep_photo_days AS "keepPhotoDays", s.keep_personal_days AS "keepPersonalDays"
         FROM base.orgs o JOIN base.site_settings s ON s.org_id = o.id`));
    return r;
  }
}

/** Accounts, kiosks and the history. Admins only, and only their own site (the database makes sure). */
@Controller('api/team')
@Who('admin')
export class TeamController {
  constructor(private readonly db: Db) {}

  @Get('accounts')
  accounts(@Me() me: Caller) {
    return this.db.as(me.token, (sql) => sql(
      `SELECT id, username, full_name AS "fullName", role, active, must_change_password AS "mustChangePassword",
              created_at AS "createdAt", last_sign_in_at AS "lastSignInAt", totp_enabled_at IS NOT NULL AS "twoStep"
         FROM base.accounts ORDER BY active DESC, role, username`));
  }

  @Post('accounts')
  async addAccount(@Me() me: Caller, @Body() body: unknown) {
    const input = read(newAccount, body);
    const [r] = await this.db.as(me.token, (sql) => sql<{ id: string }>('SELECT base.add_account($1) AS id', [input]));
    return { id: r.id };
  }

  @Patch('accounts/:id')
  async changeAccount(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = read(accountChange, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.update_account($1, $2)', [id, input]));
    return { ok: true };
  }

  @Post('accounts/:id/reset-password')
  @HttpCode(200)
  async resetPassword(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const { password } = read(passwordReset, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.reset_password($1, $2)', [id, password]));
    return { ok: true };
  }

  @Post('accounts/:id/reset-two-step')
  @HttpCode(200)
  async resetTwoStep(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.as(me.token, (sql) => sql('SELECT base.reset_two_step($1)', [id]));
    return { ok: true };
  }

  @Post('visits/:id/erase')
  @HttpCode(200)
  async erase(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.as(me.token, (sql) => sql('SELECT gate.erase_visit($1)', [id]));
    return { ok: true };
  }

  @Get('kiosks')
  kiosks(@Me() me: Caller) {
    return this.db.as(me.token, (sql) => sql(
      `SELECT id, label, paired_at AS "pairedAt", pairing_expires_at AS "codeExpiresAt", retired_at AS "retiredAt", created_at AS "createdAt"
         FROM base.kiosks ORDER BY retired_at NULLS FIRST, label`));
  }

  @Post('kiosks')
  async addKiosk(@Me() me: Caller, @Body() body: unknown) {
    const { label } = read(kioskLabel, body);
    const [r] = await this.db.as(me.token, (sql) => sql<{ id: string; code: string }>('SELECT * FROM base.add_kiosk($1)', [label]));
    return r;
  }

  @Post('kiosks/:id/new-code')
  @HttpCode(200)
  async newCode(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    const [r] = await this.db.as(me.token, (sql) => sql<{ code: string }>('SELECT base.repair_kiosk($1) AS code', [id]));
    return r;
  }

  @Post('kiosks/:id/retire')
  @HttpCode(200)
  async retire(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.as(me.token, (sql) => sql('SELECT base.retire_kiosk($1)', [id]));
    return { ok: true };
  }

  @Get('summary')
  async summary(@Me() me: Caller) {
    const [r] = await this.db.as(me.token, (sql) => sql<{ s: unknown }>('SELECT base.site_summary() AS s'));
    return r.s;
  }

  @Patch('site')
  async changeSite(@Me() me: Caller, @Body() body: unknown) {
    const input = read(siteChange, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.update_site($1)', [input]));
    return { ok: true };
  }

  @Get('sessions')
  sessions(@Me() me: Caller) {
    return this.db.as(me.token, (sql) => sql(
      `SELECT id, who, kind, role, started_at AS "startedAt", expires_at AS "expiresAt", is_me AS "isMe" FROM base.open_sessions()`));
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  async endSession(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.as(me.token, (sql) => sql('SELECT base.end_session($1)', [id]));
    return { ok: true };
  }

  @Post('sessions/end-all')
  @HttpCode(200)
  async endAll(@Me() me: Caller, @Body() body: unknown) {
    const { kiosks } = read(endAll, body);
    const [r] = await this.db.as(me.token, (sql) => sql<{ n: number }>('SELECT base.end_all_sessions($1) AS n', [kiosks]));
    return { ended: r.n };
  }

  @Get('history/check')
  async checkHistory(@Me() me: Caller) {
    const [r] = await this.db.as(me.token, (sql) => sql('SELECT intact, entries::int AS entries, first_at AS "firstAt", fingerprint FROM base.check_history()'));
    return r;
  }

  @Post('history/compare')
  @HttpCode(200)
  async compare(@Me() me: Caller, @Body() body: unknown) {
    const f = read(fingerprint, body);
    const [r] = await this.db.as(me.token, (sql) => sql('SELECT matches, reason FROM base.compare_fingerprint($1, $2)', [f.entries, f.fingerprint]));
    return r;
  }

  /** Everything the site holds, in one file (photos left out), for its own records or before leaving the service. */
  @Post('export')
  @HttpCode(200)
  async exportAll(@Me() me: Caller) {
    return this.db.as(me.token, async (sql) => ({
      recorded: (await sql('SELECT base.record_export()')).length === 1,
      historyFingerprint: (await sql('SELECT entries::int AS entries, fingerprint FROM base.check_history()'))[0],
      exportedAt: new Date().toISOString(),
      exportedBy: me.name,
      site: (await sql('SELECT id, name, created_at AS "createdAt" FROM base.orgs'))[0],
      settings: (await sql('SELECT safety_visitor AS "safetyVisitor", safety_driver AS "safetyDriver", kiosk_welcome AS "kioskWelcome" FROM base.site_settings'))[0],
      accounts: await sql(`SELECT username, full_name AS "fullName", role, active, created_at AS "createdAt", last_sign_in_at AS "lastSignInAt" FROM base.accounts ORDER BY username`),
      kiosks: await sql(`SELECT label, paired_at AS "pairedAt", retired_at AS "retiredAt", created_at AS "createdAt" FROM base.kiosks ORDER BY created_at`),
      visits: await sql(`SELECT ${VISIT_FIELDS} FROM gate.visits ORDER BY arrived_at`),
      history: await sql('SELECT seq, at, actor, action, subject, detail FROM base.history ORDER BY seq'),
    }));
  }

  @Get('history')
  history(@Me() me: Caller) {
    return this.db.as(me.token, (sql) => sql(
      'SELECT seq, at, actor, action, subject, detail FROM base.history ORDER BY seq DESC LIMIT 300'));
  }
}

/** The reception tablet. Paired once with a code from an admin; after that it can only check people in. */
@Controller('api/kiosk')
export class KioskController {
  constructor(private readonly db: Db, private readonly limit: GuessLimit) {}

  @Post('pair')
  @HttpCode(200)
  @Open()
  async pair(@Body() body: unknown, @Ip() ip: string) {
    this.limit.check(`pair:${ip}`, 10);
    const { code } = read(pairing, body);
    const [r] = await this.db.as(null, (sql) => sql<{ outcome: string; token: string; label: string; site: string }>(
      'SELECT * FROM base.pair_kiosk($1, $2)', [code, ip]));
    if (r.outcome === 'locked') throw new ForbiddenException({ message: 'Too many wrong codes. Try again in a few minutes.', code: 'LOCKED' });
    if (r.outcome !== 'ok') throw new UnauthorizedException({ message: 'That code is not valid or has expired. Ask an admin for a new one.', fieldErrors: { code: 'Not a valid code' } });
    return { token: r.token, label: r.label, site: r.site };
  }

  @Post('check-in')
  @Who('kiosk' as Role)
  async checkIn(@Me() me: Caller, @Body() body: unknown) {
    this.limit.check(`kiosk-check-in:${me.sessionId}`, 6); // a person takes well over 10 seconds; a script does not
    const input = read(kioskCheckIn, body);
    const [r] = await this.db.as(me.token, (sql) => sql('SELECT id, full_name AS "fullName", kind, arrived_at AS "arrivedAt" FROM gate.kiosk_check_in($1)', [input]));
    return r;
  }
}
