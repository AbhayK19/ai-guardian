import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import SharedLocation from "./pages/SharedLocation";
import { useRoute } from "wouter";

function App() {
  const [isSharedLocation, params] = useRoute("/share/:token");
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {isSharedLocation ? (
            <SharedLocation token={params?.token ?? ""} />
          ) : (
            <Home />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
