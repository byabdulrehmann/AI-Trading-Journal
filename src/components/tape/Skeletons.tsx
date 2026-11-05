/** Loading shapes: the same mass as what's coming, nothing moving. */

const Bar = ({ className }: { className: string }) => <span aria-hidden className={`block bg-raised ${className}`} />;

export function RowsSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" className="border-t border-line">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center justify-between gap-6 border-b border-line">
          <Bar className="h-2.5 w-28" />
          <Bar className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading your journal</span>
      <div className="mb-3 flex h-8 items-center gap-3">
        <Bar className="h-2.5 w-40" />
        <Bar className="h-2.5 w-24" />
      </div>
      <Bar className="h-10 w-56 sm:h-11" />
      <div className="mt-2 h-[68px] border-t border-line sm:h-9" />
      <div className="ticks h-[max(220px,calc(40dvh-92px))] max-h-[420px] bg-sunken" />
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {[5, 6, 4, 7].map((rows, i) => (
          <div key={i} className="border-t border-line">
            <div className="flex h-11 items-center"><Bar className="h-2.5 w-16" /></div>
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="flex h-9 items-center justify-between border-b border-line last:border-b-0">
                <Bar className="h-2.5 w-20" />
                <Bar className="h-2.5 w-12" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
