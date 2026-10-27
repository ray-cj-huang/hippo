import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <Icon className="size-6 opacity-60" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
