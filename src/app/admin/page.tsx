import { redirect } from "next/navigation";

// legacy route kept so old bookmarks keep working
export default function AdminIndex() {
  redirect("/dashboard");
}
