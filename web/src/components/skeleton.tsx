// Pending states in the sheet's own vocabulary: the rail with nothing on it
// yet, or a few hairline bars where a form will be. Never a spinner.

export function RailSkeleton() {
  return (
    <div className="relative" aria-busy="true" aria-label="Loading runs">
      <div aria-hidden className="absolute bottom-3 top-3 w-px bg-hair" style={{ left: 14 }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-[28px_1fr] items-start gap-x-2 py-3">
          <span className="relative z-10 flex h-6 items-center justify-center bg-sheet">
            <span className="bone size-3 rounded-full" />
          </span>
          <div className="pt-1.5">
            <span className="bone block h-3" style={{ width: `${44 - i * 6}%` }} />
            <span className="bone mt-2.5 block h-2.5" style={{ width: `${28 + i * 4}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SheetSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="max-w-[60ch]">
      <span className="bone block h-4 w-40" />
      <span className="bone mt-2 block h-3 w-72" />
      <div className="mt-6 divide-y divide-hair border-y border-hair">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-x-6 py-4 sm:grid-cols-[11rem_1fr]">
            <span className="bone block h-3 w-28" />
            <span className="bone mt-2 block h-8 sm:mt-0" style={{ width: `${60 - i * 12}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
