import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2, "Organization name is required").max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  roleKey: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(100),
  jobTitle: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  timezone: z.string().min(1),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export const updateOrganizationSchema = z.object({
  name: z.string().min(2, "Organization name is required").max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const updateSecuritySettingsSchema = z.object({
  requireTwoFactor: z.boolean(),
  sessionTimeoutMinutes: z.coerce.number().int().min(15).max(43200),
});
export type UpdateSecuritySettingsInput = z.infer<typeof updateSecuritySettingsSchema>;

export const updateNotificationSettingsSchema = z.object({
  notifyOnNewMember: z.boolean(),
  notifyOnBillingEvents: z.boolean(),
});
export type UpdateNotificationSettingsInput = z.infer<typeof updateNotificationSettingsSchema>;
