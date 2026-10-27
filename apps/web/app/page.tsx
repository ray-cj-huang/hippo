import { Suspense } from "react";
import { Console } from "@/components/console";

export default function Page() {
  return (
    <Suspense>
      <Console />
    </Suspense>
  );
}
