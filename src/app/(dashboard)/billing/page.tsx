import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function BillingPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Billing" description="Manage your plan and payment details." />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Current plan</CardTitle>
            <CardDescription>You're on the Starter plan.</CardDescription>
          </div>
          <Badge variant="secondary">Starter</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Billing is not connected yet in this phase of CompanyOS AI — this page is a placeholder for
            subscription management once a payment provider is integrated.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment method</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={CreditCard}
            title="No payment method on file"
            description="Add a payment method to upgrade your plan when billing goes live."
            action={<Button variant="outline" disabled>Add payment method</Button>}
          />
        </CardContent>
      </Card>
    </div>
  );
}
