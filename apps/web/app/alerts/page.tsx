import { Suspense } from "react";
import { AlertsClient } from "./AlertsClient";

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="screen">Loading alerts...</div>}>
      <AlertsClient />
    </Suspense>
  );
}
