import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="container-luxe grid min-h-dvh place-items-center text-center">
      <div>
        <p className="eyebrow">403</p>
        <h1 className="display mt-4 text-5xl md:text-7xl">This room is for staff</h1>
        <p className="mt-4 text-muted">Your account doesn’t have access to this page.</p>
        <Link href="/" className="link-draw mt-8 inline-block text-[0.6875rem] uppercase tracking-[0.28em]">
          Return to the house
        </Link>
      </div>
    </main>
  );
}
