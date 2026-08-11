import type {
  ActivityCategory,
  BusinessSize,
  InvitationStatus,
  NotificationType,
  RoleKey,
} from "@prisma/client";

export type { ActivityCategory, BusinessSize, InvitationStatus, NotificationType, RoleKey };

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  roleKey: RoleKey;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}

export interface ActivityLogEntry {
  id: string;
  category: ActivityCategory;
  action: string;
  actorName: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationEntry {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  actionUrl: string | null;
  createdAt: string;
}
