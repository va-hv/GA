import { z } from 'zod';
import { fromZod } from './problems';

/**
 * What the forms send, checked before anything reaches the database (which checks the same rules again).
 * The field names are the ones the web forms use; field errors come back under the same names.
 */

const text = (label: string, max = 150) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const maybe = (max = 150) =>
  z.string().trim().max(max, 'Too long').nullish().transform((v) => (v ? v : null));

const yes = (message: string) => z.literal(true, { error: message });
const flag = z.boolean().default(false);
const phone = text('Phone number', 40).regex(/^[0-9+()\-. ]{6,}$/, 'Enter a valid phone number');

export const VEHICLE_TYPES = [
  'Tractor', '53" Skirted Trailer', '53" Trailer', 'Box Truck', 'Intermodal Trailer',
  'Pup Trailer', 'Refrigerator Trailer', 'Van', 'Garbage BIN', 'Other',
] as const;
export const VISIT_REASONS = ['Inbound', 'Outbound', 'Non-Inventory', 'Other'] as const;
export const LOAD_TYPES = ['Live', 'Drop'] as const;

const kioskShared = {
  fullName: text('Full name'),
  email: z.string({ error: 'Email is required' }).trim().pipe(z.email('Enter a valid email')),
  phone,
  purpose: text('Purpose of visit', 255),
  hostName: text('Person being visited'),
  idScanned: flag,
  photoData: z.string().max(4_000_000, 'Photo is too large').startsWith('data:image/', 'Photo must be an image').nullish(),
  safetyAccepted: yes('You must accept the safety declaration'),
};

export const kioskCheckIn = z.discriminatedUnion('role', [
  z.object({ role: z.literal('VISITOR'), ...kioskShared }),
  z.object({ role: z.literal('CONTRACTOR'), ...kioskShared, companyName: text('Company name'), insuranceNumber: text('Insurance number', 80) }),
], { error: 'Choose visitor or contractor' });

export const driverCheckIn = z.object({
  fullName: text('Driver name'),
  phone,
  driverLicense: text("Driver's licence", 80),
  companyName: text('Company name'),
  scacCode: z.string({ error: 'SCAC code is required' }).trim().regex(/^[A-Za-z]{2,4}$/, 'SCAC code is 2 to 4 letters'),
  vehicleType: z.enum(VEHICLE_TYPES, { error: 'Select a vehicle type' }),
  truckLicensePlate: text('Truck licence plate', 30),
  truckNumber: text('Truck No.', 40),
  appointmentNumber: text('Appointment No.', 60),
  visitReason: z.enum(VISIT_REASONS, { error: 'Select a visit reason' }),
  purpose: z.enum(LOAD_TYPES, { error: 'Select Live or Drop' }),
  bobtail: flag,
  trailerNoIn: maybe(40),
  arrivedEmpty: flag,
  sealNoIn: maybe(40),
  safetyAccepted: yes('Safety declaration must be acknowledged'),
}).superRefine((v, ctx) => {
  if (v.bobtail) return;
  if (!v.trailerNoIn) ctx.addIssue({ code: 'custom', path: ['trailerNoIn'], message: 'Trailer No. IN is required unless the driver is a bobtail' });
  if (!v.arrivedEmpty && !v.sealNoIn) ctx.addIssue({ code: 'custom', path: ['sealNoIn'], message: 'Seal No. is required unless the trailer arrives empty' });
});

export const departure = z.object({
  goingEmpty: flag,
  trailerNoOut: maybe(40),
  sealNoOut: maybe(40),
}).superRefine((v, ctx) => {
  if (v.goingEmpty) return;
  if (!v.trailerNoOut) ctx.addIssue({ code: 'custom', path: ['trailerNoOut'], message: 'Trailer No. OUT is required when loaded' });
  if (!v.sealNoOut) ctx.addIssue({ code: 'custom', path: ['sealNoOut'], message: 'Seal No. OUT is required when loaded' });
});

/** Security may correct what the dock wrote; anything left out keeps the dock's value. */
export const releaseCorrection = z.object({
  goingEmpty: z.boolean().optional(),
  trailerNoOut: maybe(40),
  sealNoOut: maybe(40),
}).partial();

export const PAGES = ['admin', 'security', 'dock'] as const;

export const signIn = z.object({
  page: z.enum(PAGES, { error: 'Choose how you are signing in' }),
  username: z.string({ error: 'Username is required' }).trim().toLowerCase().min(1, 'Username is required').max(60),
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
  code: z.string().trim().max(12).optional(),
});

const password = z.string({ error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters').max(100, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password needs at least one letter').regex(/[0-9]/, 'Password needs at least one number');

export const changePassword = z.object({
  currentPassword: z.string({ error: 'Current password is required' }).min(1, 'Current password is required'),
  newPassword: password,
});

export const newAccount = z.object({
  username: z.string({ error: 'Username is required' }).trim().toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3-40 characters, letters, numbers, dot, dash or underscore'),
  fullName: text('Full name', 100),
  role: z.enum(PAGES, { error: 'Select a role' }),
  password,
});

export const accountChange = z.object({
  fullName: text('Full name', 100).optional(),
  role: z.enum(PAGES, { error: 'Select a role' }).optional(),
  active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const siteChange = z.object({
  name: text('Site name', 120).optional(),
  safetyVisitor: z.array(z.string().trim().max(200, 'Each safety rule is 200 characters at most'), { error: 'Safety rules must be a list' })
    .transform((l) => l.filter(Boolean)).pipe(z.array(z.string()).min(1, 'Keep at least one safety rule').max(12, 'Twelve safety rules at most')).optional(),
  safetyDriver: text('The driver safety note', 500).optional(),
  kioskWelcome: z.string().trim().max(200, 'The welcome note is 200 characters at most').optional(),
  requireTwoStepAdmins: z.boolean().optional(),
  keepPhotoDays: z.number({ error: 'Enter a number of days' }).int().min(1, 'Keep photos at least 1 day').max(365, 'Keep photos at most 365 days').optional(),
  keepPersonalDays: z.number({ error: 'Enter a number of days' }).int().min(30, 'Keep details at least 30 days').max(3650, 'Keep details at most 3,650 days').optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const twoStepCode = z.object({ code: z.string({ error: 'Enter the 6-digit code' }).trim().regex(/^\d{3}\s?\d{3}$/, 'Enter the 6-digit code') });
export const passwordOnly = z.object({ currentPassword: z.string({ error: 'Password is required' }).min(1, 'Password is required') });
export const fingerprint = z.object({
  entries: z.coerce.number({ error: 'Enter the number of entries' }).int().min(1, 'Enter the number of entries'),
  fingerprint: z.string({ error: 'Enter the fingerprint' }).trim().regex(/^[0-9a-fA-F]{64}$/, 'A fingerprint is 64 characters, 0-9 and a-f'),
});
export const download = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day'),
  rows: z.number().int().min(0).max(100000),
});

export const endAll = z.object({ kiosks: z.boolean().default(false) });

export const passwordReset = z.object({ password });
export const kioskLabel = z.object({ label: text('Kiosk name', 60) });
export const pairing = z.object({ code: z.string({ error: 'Enter the pairing code' }).trim().min(4, 'Enter the pairing code').max(20) });

export const visitFilter = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  tz: z.string().regex(/^[A-Za-z0-9_+\-/]{1,64}$/).optional().catch(undefined),
  status: z.enum(['on_site', 'dock_cleared', 'left']).optional().catch(undefined),
  kind: z.enum(['visitor', 'contractor', 'driver']).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
});

export function read<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw fromZod(r.error);
  return r.data;
}
