import type { Metadata } from "next";

import { loginAction } from "@/app/(auth)/actions/login.action";
import { GoogleButton } from "@/app/(auth)/components/google-button";
import { LoginForm } from "@/modules/auth/ui/components/login-form";

export const metadata: Metadata = {
  title: "Ingresar — ez finance",
};

interface LoginPageProps {
  searchParams: Promise<{ deletion?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Set after a deletion request signs this browser out: without this note the
  // user lands on a bare login screen right after a destructive action.
  const { deletion } = await searchParams;

  return (
    <>
      <h2 className="text-foreground mb-6 text-center text-xl font-semibold">
        Ingresá a tu cuenta
      </h2>

      {deletion === "requested" && (
        <div
          role="status"
          aria-live="polite"
          className="bg-muted mb-4 rounded-lg px-4 py-3 text-sm"
        >
          Programamos la eliminación de tu cuenta y cerramos la sesión en este
          dispositivo. Tenés 30 días para volver a ingresar y cancelarla desde
          Configuración → Datos y cuenta.
        </div>
      )}

      {/* Google OAuth — requires Google provider configured in Supabase dashboard */}
      <GoogleButton />

      {/* Divider */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background text-muted-foreground px-2">o</span>
        </div>
      </div>

      <LoginForm action={loginAction} />
    </>
  );
}
