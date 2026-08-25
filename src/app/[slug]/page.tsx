import { Suspense } from "react";
import { headers } from "next/headers";

// One entry is enough; every other slug is rendered on demand, which is the
// high-cardinality traffic shape that makes the retention visible.
export function generateStaticParams() {
  return [{ slug: "seed" }];
}

// A cached scope per slug, sized like a real content page (~200 KB of HTML).
async function getContent(slug: string) {
  "use cache";
  const paragraphs = Array.from({ length: 900 }, (_, i) => `${slug} paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(6)}`);
  return { paragraphs, slug };
}

async function Content({ slug }: { slug: string }) {
  const { paragraphs } = await getContent(slug);
  return (
    <div>
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </div>
  );
}

// Reading a request-bound API is what drives the render onto the prerender-abort
// path once the shell has been emitted.
async function RequestBound() {
  const h = await headers();
  return <span data-ua={h.get("user-agent")?.slice(0, 24) ?? "none"} />;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <h1>{slug}</h1>
      <Suspense fallback={<p>loading request data…</p>}>
        <RequestBound />
      </Suspense>
      <Suspense fallback={<p>loading content…</p>}>
        <Content slug={slug} />
      </Suspense>
    </main>
  );
}
