import { canExport, currentStaff } from "@/lib/auth";
import { TopSearch } from "./TopSearch";
import { THINK_HARDER_KEY } from "@/lib/ask/models";

/** The top search bar with AI mode, once we know who is signed in. */
export async function TopSearchGate() {
  const me = await currentStaff().catch(() => null);
  return <TopSearch admin={canExport(me?.role)} thinkKey={THINK_HARDER_KEY} />;
}
