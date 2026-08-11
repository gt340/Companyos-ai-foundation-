"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  companyProfileSchema,
  companyOfferingSchema,
  companyMarketSchema,
  businessSizeValues,
  type OnboardingInput,
} from "@/lib/validations/onboarding";

const businessSizeLabels: Record<(typeof businessSizeValues)[number], string> = {
  SOLO: "Just me",
  MICRO: "2–10 employees",
  SMALL: "11–50 employees",
  MEDIUM: "51–250 employees",
  LARGE: "251–1,000 employees",
  ENTERPRISE: "1,000+ employees",
};

const steps = ["Company basics", "Products & services", "Mission & goals", "Market", "Documents"] as const;

type FormState = OnboardingInput;

const initialState: FormState = {
  name: "",
  industry: "",
  website: "",
  businessSize: "SMALL",
  employeeCount: undefined,
  products: [],
  services: [],
  mission: "",
  vision: "",
  goals: [],
  targetCustomers: "",
  competitors: [],
  brandVoice: "",
};

function TagField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={commit} aria-label={`Add ${label}`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1 pr-1">
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="rounded-full p-0.5 hover:bg-background/60"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function OnboardingWizard() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>(initialState);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [documents, setDocuments] = React.useState<File[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const progress = ((step + 1) / steps.length) * 100;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validateStep(): boolean {
    let result;
    if (step === 0) result = companyProfileSchema.safeParse(form);
    else if (step === 1) result = companyOfferingSchema.safeParse(form);
    else if (step === 2) result = companyOfferingSchema.pick({ mission: true, vision: true, goals: true }).safeParse(form);
    else if (step === 3) result = companyMarketSchema.safeParse(form);
    else return true;

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) fieldErrors[issue.path[0] as string] = issue.message;
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }

  function next() {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleFinish() {
    if (!validateStep()) return;
    setSubmitting(true);

    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setSubmitting(false);

    if (!response.ok) {
      toast({ variant: "destructive", title: "Couldn't save your company profile" });
      return;
    }

    toast({ variant: "success", title: "Company profile saved" });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">{steps[step]}</span>
          <span className="text-muted-foreground">
            Step {step + 1} of {steps.length}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{steps[step]}</CardTitle>
          <CardDescription>{stepDescription(step)}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Company name</Label>
                <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} />
                {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  placeholder="e.g. Logistics, Healthcare"
                  value={form.industry}
                  onChange={(e) => update("industry", e.target.value)}
                />
                {errors.industry && <p className="text-sm text-destructive">{errors.industry}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  placeholder="https://example.com"
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                />
                {errors.website && <p className="text-sm text-destructive">{errors.website}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessSize">Business size</Label>
                <Select value={form.businessSize} onValueChange={(v) => update("businessSize", v as FormState["businessSize"])}>
                  <SelectTrigger id="businessSize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {businessSizeValues.map((size) => (
                      <SelectItem key={size} value={size}>
                        {businessSizeLabels[size]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeCount">Employees (exact, optional)</Label>
                <Input
                  id="employeeCount"
                  type="number"
                  min={1}
                  value={form.employeeCount ?? ""}
                  onChange={(e) => update("employeeCount", e.target.value ? Number(e.target.value) : undefined)}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <TagField label="Products" placeholder="Add a product and press Enter" values={form.products} onChange={(v) => update("products", v)} />
              <TagField label="Services" placeholder="Add a service and press Enter" values={form.services} onChange={(v) => update("services", v)} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="mission">Mission</Label>
                <Textarea id="mission" rows={3} value={form.mission} onChange={(e) => update("mission", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vision">Vision</Label>
                <Textarea id="vision" rows={3} value={form.vision} onChange={(e) => update("vision", e.target.value)} />
              </div>
              <TagField label="Goals" placeholder="Add a goal and press Enter" values={form.goals} onChange={(v) => update("goals", v)} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="targetCustomers">Target customers</Label>
                <Textarea
                  id="targetCustomers"
                  rows={3}
                  placeholder="Who are you building for?"
                  value={form.targetCustomers}
                  onChange={(e) => update("targetCustomers", e.target.value)}
                />
              </div>
              <TagField label="Competitors" placeholder="Add a competitor and press Enter" values={form.competitors} onChange={(v) => update("competitors", v)} />
              <div className="space-y-2">
                <Label htmlFor="brandVoice">Brand voice</Label>
                <Textarea
                  id="brandVoice"
                  rows={3}
                  placeholder="How does your company sound when it communicates?"
                  value={form.brandVoice}
                  onChange={(e) => update("brandVoice", e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <Label htmlFor="documents">Company documents</Label>
              <label
                htmlFor="documents"
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center transition-colors hover:bg-accent"
              >
                <Plus className="h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Upload documents</p>
                <p className="text-xs text-muted-foreground">Policies, decks, or brand guidelines — optional</p>
                <input
                  id="documents"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setDocuments((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
                />
              </label>
              {documents.length > 0 && (
                <ul className="space-y-2">
                  {documents.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setDocuments((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-between border-t border-border pt-6">
          <Button type="button" variant="ghost" onClick={back} disabled={step === 0}>
            Back
          </Button>

          {step < steps.length - 1 ? (
            <Button type="button" variant="signal" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="button" variant="signal" onClick={handleFinish} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Finish setup
            </Button>
          )}
        </CardFooter>
      </Card>

      <div className="flex justify-center gap-1.5">
        {steps.map((label, i) => (
          <span
            key={label}
            className={cn("h-1.5 w-6 rounded-full transition-colors", i <= step ? "bg-signal" : "bg-border")}
          />
        ))}
      </div>
    </div>
  );
}

function stepDescription(step: number): string {
  switch (step) {
    case 0:
      return "The basics that identify your company.";
    case 1:
      return "What your company builds or offers.";
    case 2:
      return "Where your company is headed, and why.";
    case 3:
      return "Who you serve and how you're positioned.";
    default:
      return "Optional reference material for your company profile.";
  }
}
