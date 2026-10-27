import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/features/auth/auth-provider";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <TenantProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster />
        </TenantProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
