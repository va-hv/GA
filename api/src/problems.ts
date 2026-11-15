import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** What every error looks like to the web app: a sentence, and per-field sentences where they apply. */
export interface Problem {
  message: string;
  fieldErrors?: Record<string, string>;
  code?: string;
}

const FROM_DATABASE: Record<string, number> = {
  GH400: 400, GH401: 401, GH403: 403, GH404: 404, GH409: 409, GH426: 403, GH428: 403,
};

/** Plain words for the table-level rules, in case one is ever reached past the rule functions. */
const RULE_WORDS: Record<string, string> = {
  kiosk_people_need_contact: 'Visitors and contractors need an email and the person they are visiting',
  contractors_need_company_and_insurance: 'Contractors need a company name and insurance number',
  drivers_need_truck_details: 'Drivers need all the truck details',
  trailer_and_seal_in: 'Trailer and seal IN do not match bobtail or empty',
  trailer_and_seal_out: 'Going empty, or trailer and seal OUT, must be recorded',
  left_has_time_and_guard: 'A departure needs a time and the guard who released it',
  photos_go_first: 'Photos cannot be kept longer than the other personal details',
  erased_only_after_leaving: 'Details can be erased once the person has left',
};

export class InputProblem extends HttpException {
  constructor(problem: Problem, status = 400) {
    super(problem, status);
  }
}

export function fromZod(err: ZodError): InputProblem {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_form';
    fieldErrors[key] ??= issue.message;
  }
  const first = Object.values(fieldErrors)[0];
  return new InputProblem({ message: first ?? 'Please check the form', fieldErrors });
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.describe(err);
    if (status >= 500) this.log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    res.status(status).json(body);
  }

  private describe(err: unknown): [number, Problem] {
    if (err instanceof ZodError) return this.describe(fromZod(err));
    if (err instanceof HttpException) {
      const r = err.getResponse();
      if (typeof r === 'string') return [err.getStatus(), { message: r }];
      const o = r as Record<string, unknown>;
      const message = typeof o.message === 'string' ? o.message : Array.isArray(o.message) ? String(o.message[0]) : err.message;
      return [err.getStatus(), { ...(o as object), message } as Problem];
    }
    const pg = err as { code?: string; message?: string; detail?: string; constraint?: string };
    if (pg?.code && FROM_DATABASE[pg.code]) {
      const problem: Problem = { message: pg.message ?? 'Refused' };
      if (pg.detail) problem.fieldErrors = { [pg.detail]: problem.message };
      if (pg.code === 'GH428') problem.code = 'PASSWORD_CHANGE_REQUIRED';
      if (pg.code === 'GH426') problem.code = 'TWO_STEP_SETUP_REQUIRED';
      return [FROM_DATABASE[pg.code], problem];
    }
    if (pg?.code === '23514') {
      return [400, { message: RULE_WORDS[pg.constraint ?? ''] ?? 'That breaks a gate rule' }];
    }
    if (pg?.code === '42501') return [403, { message: 'Not allowed' }];
    if (pg?.code === '22P02' || pg?.code === '22023') return [400, { message: 'Something in the request is not in the right format' }];
    return [500, { message: 'Something went wrong on our side. Please try again.' }];
  }
}
