import { PageHeader } from "@/components/shared/page-header";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default function OnboardingPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Company onboarding"
        description="Tell CompanyOS about your business — this becomes your company's profile."
        className="mx-auto max-w-2xl text-center sm:text-left"
      />
      <OnboardingWizard />
    </div>
  );
}
