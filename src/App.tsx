// Root component: global providers, theme application and the application shell.
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastViewport } from "@/components/ui/toast";
import { AppShell } from "@/components/shell/AppShell";
import { useThemeEffect } from "@/hooks/useThemeEffect";

export function App() {
  useThemeEffect();
  return (
    <TooltipProvider delayDuration={400}>
      <AppShell />
      <ToastViewport />
    </TooltipProvider>
  );
}
