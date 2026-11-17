"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading, PageHeader } from "@/components/shared";
import { StaffForm } from "@/components/staff-form";
import { useLoad } from "@/hooks/use-load";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { getRepo } from "@/lib/repo";
import { errorKey } from "@/lib/errors";

export default function EditStaffPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const router = useRouter();
  const allowed = useRequirePermission("staff.manage");
  const [busy, setBusy] = useState(false);
  const { data: staff, loading } = useLoad(() => getRepo().getStaff(id), [id], allowed);

  if (!allowed || loading) return <Loading />;
  if (!staff) return <p className="p-4 text-muted-foreground">{t("no_data")}</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("edit_staff")} />
      <Card>
        <CardHeader><CardTitle>{staff.full_name}</CardTitle></CardHeader>
        <CardContent>
          <StaffForm
            initial={staff}
            busy={busy}
            onCancel={() => router.back()}
            onSubmit={async (v) => {
              setBusy(true);
              try {
                // saving a reviewed record clears the "needs verification" flag
                await getRepo().updateStaff(id, { ...v, needs_review: false });
                toast.success(t("success"));
                router.push(`/staff/${id}`);
              } catch (err) {
                toast.error(t(errorKey(err)));
                setBusy(false);
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
