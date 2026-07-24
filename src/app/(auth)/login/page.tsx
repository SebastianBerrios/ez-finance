import type { Metadata } from "next";

import { loginAction } from "@/app/(auth)/actions/login.action";
import { GoogleButton } from "@/app/(auth)/components/google-button";
import { LoginForm } from "@/modules/auth/ui/components/login-form";

export const metadata: Metadata = {
  title: "Ingresar — ez finance",
};

export default function LoginPage() {
  return (
    <>
      <h2 className="text-foreground mb-6 text-center text-xl font-semibold">
        Ingresá a tu cuenta
      </h2>

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
