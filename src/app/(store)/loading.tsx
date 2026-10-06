export default function Loading() {
  return (
    <div className="container-luxe pt-20" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-4 w-32" />
      <div className="skeleton mt-8 h-24 w-3/4 max-w-2xl" />
      <div className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[4/5]" />
            <div className="skeleton mt-5 h-6 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
