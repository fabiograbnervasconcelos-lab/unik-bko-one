export type UserRole = "master" | "admin" | "vendedor";

export type QueueStatus =
  | "transferir"
  | "tratando"
  | "sem_interesse"
  | "vendido";

export type LeadSource = "pap" | "excel" | "manual";

export type MailingUser = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LeadPartData = Record<string, string>;

export type MailingLead = {
  id: string;
  source: LeadSource;
  queue: QueueStatus;
  name: string;
  phone: string;
  document?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  plan?: string;
  saleType?: string;
  saleDate?: string;
  papId?: string;
  part1?: LeadPartData;
  part2?: LeadPartData;
  planData?: LeadPartData;
  notes?: string;
  raw?: Record<string, unknown>;
  assignedTo?: string | null;
  assignedAt?: string | null;
  treatingSince?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

export type PapCredentials = {
  email: string;
  password: string;
};

export type ScrapeJobState =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export type ScrapeProgress = {
  state: ScrapeJobState;
  message: string;
  dateFrom: string;
  dateTo: string;
  saleType: string;
  page: number;
  processed: number;
  imported: number;
  skipped: number;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
  lastLeadName: string | null;
};

export type SessionUser = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
};

export type TransferBlockInfo = {
  blocked: boolean;
  reason?: string;
  staleCount?: number;
  staleLeads?: Array<{ id: string; name: string; treatingSince: string }>;
};
