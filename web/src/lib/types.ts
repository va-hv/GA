export type Role = 'admin' | 'security' | 'dock';
export type Kind = 'visitor' | 'contractor' | 'driver';
export type Status = 'on_site' | 'dock_cleared' | 'left';

export interface Visit {
  id: string;
  kind: Kind;
  status: Status;
  fullName: string;
  phone: string;
  purpose: string;
  companyName: string | null;
  email: string | null;
  hostName: string | null;
  insuranceNumber: string | null;
  idScanned: boolean;
  hasPhoto: boolean;
  photoData?: string | null;
  driverLicense: string | null;
  scacCode: string | null;
  vehicleType: string | null;
  visitReason: string | null;
  truckLicensePlate: string | null;
  truckNumber: string | null;
  appointmentNumber: string | null;
  bobtail: boolean | null;
  trailerNoIn: string | null;
  arrivedEmpty: boolean | null;
  sealNoIn: string | null;
  goingEmpty: boolean | null;
  trailerNoOut: string | null;
  sealNoOut: string | null;
  arrivedAt: string;
  arrivedVia: string;
  dockClearedAt: string | null;
  dockClearedBy: string | null;
  leftAt: string | null;
  releasedBy: string | null;
}

export interface Me {
  id: string | null;
  name: string;
  role: Role | 'kiosk';
  mustChange: boolean;
  site: string;
  mustSetUpTwoStep?: boolean;
  twoStep?: boolean;
  twoStepRequired?: boolean;
}

export const ROLE_NAMES: Record<Role, string> = { admin: 'Admin', security: 'Security', dock: 'Dock coordinator' };

export const VEHICLE_TYPES = [
  'Tractor', '53" Skirted Trailer', '53" Trailer', 'Box Truck', 'Intermodal Trailer',
  'Pup Trailer', 'Refrigerator Trailer', 'Van', 'Garbage BIN', 'Other',
] as const;
export const VISIT_REASONS = ['Inbound', 'Outbound', 'Non-Inventory', 'Other'] as const;

export function stampFor(v: Pick<Visit, 'status' | 'kind'>) {
  if (v.status === 'left') return 'out' as const;
  if (v.status === 'dock_cleared') return 'cleared' as const;
  return v.kind === 'driver' ? ('dock' as const) : ('in' as const);
}

export function clock(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function since(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ${mins % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

export interface SiteWording {
  name: string;
  safetyVisitor: string[];
  safetyDriver: string;
  kioskWelcome: string | null;
}
