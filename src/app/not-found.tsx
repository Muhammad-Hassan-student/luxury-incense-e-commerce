import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container-luxe grid min-h-dvh place-items-center text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="display mt-6 text-6xl md:text-9xl">
          Lost in <span className="italic text-gold">the smoke</span>
        </h1>
        <p className="mx-auto mt-6 max-w-sm text-muted">The page you’re looking for has drifted away.</p>
        <Link href="/" className="link-draw mt-10 inline-block text-[0.6875rem] uppercase tracking-[0.28em]">
          Return to the house
        </Link>
      </div>
    </main>
  );
}
