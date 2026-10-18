import { CalendarClock } from "lucide-react";
import { Card, PageHeader } from "./ui";

export function Soon({ title, hint, items }: { title: string; hint: string; items: string[]; when?: string }) {
  return (
    <>
      <PageHeader title={title} hint={hint} />
      <Card>
        <div className="flex items-start gap-4 p-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-dark"><CalendarClock className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold">Planned after the stock count</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.95rem] text-muted">
              {items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}
