import { z } from "zod";

export const businessSizeValues = [
  "SOLO",
  "MICRO",
  "SMALL",
  "MEDIUM",
  "LARGE",
  "ENTERPRISE",
] as const;

export const companyProfileSchema = z.object({
  name: z.string().min(2, "Company name is required").max(120),
  industry: z.string().min(2, "Select or enter an industry"),
  website: z
    .string()
    .url("Enter a full URL, e.g. https://example.com")
    .optional()
    .or(z.literal("")),
  businessSize: z.enum(businessSizeValues, {
    errorMap: () => ({ message: "Select a business size" }),
  }),
  employeeCount: z.coerce.number().int().min(1).max(1_000_000).optional(),
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;

export const companyOfferingSchema = z.object({
  products: z.array(z.string().min(1)).max(25).default([]),
  services: z.array(z.string().min(1)).max(25).default([]),
  mission: z.string().max(2000).optional().or(z.literal("")),
  vision: z.string().max(2000).optional().or(z.literal("")),
  goals: z.array(z.string().min(1)).max(25).default([]),
});
export type CompanyOfferingInput = z.infer<typeof companyOfferingSchema>;

export const companyMarketSchema = z.object({
  targetCustomers: z.string().max(2000).optional().or(z.literal("")),
  competitors: z.array(z.string().min(1)).max(25).default([]),
  brandVoice: z.string().max(2000).optional().or(z.literal("")),
});
export type CompanyMarketInput = z.infer<typeof companyMarketSchema>;

export const onboardingSchema = companyProfileSchema
  .merge(companyOfferingSchema)
  .merge(companyMarketSchema);
export type OnboardingInput = z.infer<typeof onboardingSchema>;
