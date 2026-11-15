import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Caller, Me, STAFF, Who } from './access';
import { Db } from './db';
import { departure, download, driverCheckIn, read, releaseCorrection, visitFilter } from './input';

/** Every visit column the screens use, in the names the web app expects. The photo is only sent for one visit. */
export const VISIT_FIELDS = `
  id, kind, status, full_name AS "fullName", phone, purpose, company AS "companyName", email, host_name AS "hostName",
  insurance_no AS "insuranceNumber", id_scanned AS "idScanned", photo IS NOT NULL AS "hasPhoto",
  driver_licence AS "driverLicense", scac AS "scacCode", vehicle_type AS "vehicleType", visit_reason AS "visitReason",
  truck_plate AS "truckLicensePlate", truck_no AS "truckNumber", appointment_no AS "appointmentNumber", bobtail,
  trailer_in AS "trailerNoIn", arrived_empty AS "arrivedEmpty", seal_in AS "sealNoIn", going_empty AS "goingEmpty",
  trailer_out AS "trailerNoOut", seal_out AS "sealNoOut", arrived_at AS "arrivedAt", arrived_via AS "arrivedVia",
  dock_cleared_at AS "dockClearedAt", dock_cleared_by AS "dockClearedBy", left_at AS "leftAt", released_by AS "releasedBy"`;

/**
 * The gate. What each role sees is decided by the database (dock coordinators only ever get drivers back);
 * what each role may do is checked here and again in the rule functions.
 */
@Controller('api')
export class GateController {
  constructor(private readonly db: Db) {}

  /** The chosen day (in the viewer's time zone), plus everyone still on site so overnight trucks never drop off. */
  @Get('visits')
  @Who(...STAFF)
  list(@Me() me: Caller, @Query() query: unknown) {
    const f = read(visitFilter, query);
    // Security and the dock look back 31 days at most; older days are for admins (fewer ways to copy the log in bulk).
    if (f.date && me.role !== 'admin' && Date.parse(f.date) < Date.now() - 32 * 86_400_000) {
      throw new BadRequestException({ message: 'Days more than 31 days back are for admins only', fieldErrors: { date: 'Pick a day in the last 31 days' } });
    }
    return this.db.as(me.token, (sql) => sql(
      `WITH day AS (SELECT (coalesce($1::date, (now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2) AS start)
       SELECT ${VISIT_FIELDS} FROM gate.visits, day
        WHERE ((arrived_at >= day.start AND arrived_at < day.start + interval '1 day') OR status <> 'left')
          AND ($3::text IS NULL OR status = $3)
          AND ($4::text IS NULL OR kind = $4)
          AND ($5::text IS NULL OR position(lower($5) IN lower(concat_ws(' ', full_name, company, truck_plate, truck_no,
                 appointment_no, trailer_in, trailer_out, host_name, phone))) > 0)
        ORDER BY arrived_at DESC
        LIMIT 2000`,
      [f.date ?? null, f.tz ?? 'UTC', f.status ?? null, f.kind ?? null, f.q || null]));
  }

  /** The log page records each CSV download (who, which day, how many rows). */
  @Post('visits/downloaded')
  @HttpCode(200)
  @Who(...STAFF)
  async downloaded(@Me() me: Caller, @Body() body: unknown) {
    const d = read(download, body);
    await this.db.as(me.token, (sql) => sql('SELECT base.record_download($1, $2)', [d.day, d.rows]));
    return { ok: true };
  }

  @Get('visits/:id')
  @Who(...STAFF)
  async one(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    const [v] = await this.db.as(me.token, (sql) => sql(`SELECT ${VISIT_FIELDS}, photo AS "photoData" FROM gate.visits WHERE id = $1`, [id]));
    if (!v) throw new NotFoundException('Record not found');
    return v;
  }

  @Post('drivers')
  @Who('security')
  async checkInDriver(@Me() me: Caller, @Body() body: unknown) {
    const input = read(driverCheckIn, body);
    const [r] = await this.db.as(me.token, (sql) => sql<{ id: string }>('SELECT gate.driver_check_in($1) AS id', [input]));
    return { id: r.id };
  }

  @Post('visits/:id/dock-clear')
  @HttpCode(200)
  @Who('dock')
  async dockClear(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = read(departure, body);
    await this.db.as(me.token, (sql) => sql('SELECT gate.dock_clear($1, $2)', [id, input]));
    return { ok: true };
  }

  @Post('visits/:id/dock-reopen')
  @HttpCode(200)
  @Who('dock')
  async dockReopen(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.as(me.token, (sql) => sql('SELECT gate.dock_reopen($1)', [id]));
    return { ok: true };
  }

  @Post('visits/:id/release')
  @HttpCode(200)
  @Who('security')
  async release(@Me() me: Caller, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = read(releaseCorrection, body);
    await this.db.as(me.token, (sql) => sql('SELECT gate.release($1, $2)', [id, input]));
    return { ok: true };
  }
}
