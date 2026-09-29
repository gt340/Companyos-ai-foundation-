import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; message?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const connection = await prisma.googleConnection.findUnique({ where: { userId: user.id } });

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>

      {params.google === "connected" && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Google account connected successfully.
        </div>
      )}
      {params.google === "disconnected" && (
        <div className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Google account disconnected.
        </div>
      )}
      {params.google === "error" && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t connect Google account{params.message ? `: ${params.message}` : "."}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Google Account</h2>
        {connection ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Connected as <span className="font-medium">{connection.connectedEmail}</span>
            </p>
            <p className="text-xs text-gray-400">
              Scopes: {connection.scopes.length ? connection.scopes.join(", ") : "none recorded"}
            </p>
            <form action="/api/auth/google/disconnect" method="POST">
              <button
                type="submit"
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Disconnect Google Account
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              No Google account connected yet. Connecting gives the assistant access to Gmail (read
              and send), Google Calendar, and Google Drive.
            </p>
            <a
              href="/api/auth/google/connect"
              className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Connect Google Account
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
