import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getActiveOrganizationId } from "@/lib/active-org";
import { getZoomOAuthConfig, userCanManageZoom } from "@/lib/zoom/zoom-connection";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; zoom?: string; message?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const connection = await prisma.googleConnection.findUnique({ where: { userId: user.id } });

  // Zoom is a company-level connection (one per organization), managed by
  // company owners and admins.
  const organizationId = await getActiveOrganizationId(user.id);
  const zoomConnection = organizationId
    ? await prisma.zoomConnection.findUnique({
        where: { organizationId },
        select: { connectedEmail: true },
      })
    : null;
  const canManageZoom = organizationId ? await userCanManageZoom(user.id, organizationId) : false;
  const zoomConfigured = getZoomOAuthConfig() !== null;

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

      {params.zoom === "connected" && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Zoom connected successfully for your company.
        </div>
      )}
      {params.zoom === "disconnected" && (
        <div className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Zoom disconnected.
        </div>
      )}
      {params.zoom === "error" && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t connect Zoom{params.message ? `: ${params.message}` : "."}
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

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Zoom (company account)</h2>
        {zoomConnection ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Your company&apos;s Zoom is connected as{" "}
              <span className="font-medium">{zoomConnection.connectedEmail}</span>. The assistant
              creates meetings on this Zoom account.
            </p>
            {canManageZoom ? (
              <form action="/api/auth/zoom/disconnect" method="POST">
                <button
                  type="submit"
                  className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Disconnect Zoom
                </button>
              </form>
            ) : (
              <p className="text-xs text-gray-400">
                Only a company owner or admin can disconnect Zoom.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Zoom isn&apos;t connected for your company yet. Connecting lets the assistant
              schedule, list, and cancel meetings on your company&apos;s own Zoom account.
            </p>
            {!zoomConfigured ? (
              <p className="text-xs text-gray-400">
                Zoom sign-in hasn&apos;t been set up on the server yet.
              </p>
            ) : canManageZoom ? (
              <a
                href="/api/auth/zoom/connect"
                className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Connect Zoom
              </a>
            ) : (
              <p className="text-xs text-gray-400">
                Only a company owner or admin can connect Zoom.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
