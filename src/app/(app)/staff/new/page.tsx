"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
import { StaffForm } from "@/components/staff-form";
import { getRepo } from "@/lib/repo";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { Loading } from "@/components/shared";
import { errorKey } from "@/lib/errors";

export default function NewStaffPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const allowed = useRequirePermission("staff.manage");
  const [busy, setBusy] = useState(false);

  if (!allowed) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("add_staff")} />
      <Card>
        <CardHeader><CardTitle>{t("add_staff")}</CardTitle></CardHeader>
        <CardContent>
          <StaffForm
            busy={busy}
            onCancel={() => router.back()}
            onSubmit={async (v) => {
              setBusy(true);
              try {
                const s = await getRepo().createStaff(v);
                toast.success(t("success"));
                router.push(`/staff/${s.id}`);
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
