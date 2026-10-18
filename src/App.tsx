// Root component: global providers and the route outlet.
import { lazy, Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastViewport } from "@/components/ui/toast";
import { useRoute } from "@/lib/router";

const GalleryPage = lazy(() => import("@/components/gallery/GalleryPage"));

export function App() {
  const route = useRoute();
  return (
    <TooltipProvider delayDuration={400}>
      {route.name === "gallery" ? (
        <Suspense fallback={null}>
          <GalleryPage />
        </Suspense>
      ) : (
        <main className="flex h-full items-center justify-center bg-bg text-fg">
          <h1 className="text-display font-bold">Machi</h1>
        </main>
      )}
      <ToastViewport />
    </TooltipProvider>
  );
}
