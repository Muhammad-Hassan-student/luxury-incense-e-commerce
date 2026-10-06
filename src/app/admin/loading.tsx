import { Skeleton } from "@/components/ui/field";

export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-8 border-b border-line pb-6">
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}
