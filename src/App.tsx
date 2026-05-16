import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.tsx";
import LegalNotice from "./pages/LegalNotice.tsx";
import Partners from "./pages/Partners.tsx";
import PartnerLogin from "./pages/PartnerLogin.tsx";
import CommuneDashboard from "./pages/CommuneDashboard.tsx";
import AdminCommunes from "./pages/AdminCommunes.tsx";
import CheckoutReturn from "./pages/CheckoutReturn.tsx";
import Contact from "./pages/Contact.tsx";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PaymentTestModeBanner />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/confidentialite" element={<PrivacyPolicy />} />
            <Route path="/mentions-legales" element={<LegalNotice />} />
            <Route path="/partenaires" element={<Partners />} />
            <Route path="/partenaires/connexion" element={<PartnerLogin />} />
            <Route path="/partenaires/paiement-confirme" element={<CheckoutReturn />} />
            <Route
              path="/dashboard/commune"
              element={
                <ProtectedRoute>
                  <CommuneDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/admin/communes" element={<AdminCommunes />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
