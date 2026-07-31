import type { Metadata } from "next";

import { registerAction } from "@/app/(auth)/actions/register.action";
import { GoogleButton } from "@/app/(auth)/components/google-button";
import { RegisterForm } from "@/modules/auth/ui/components/register-form";

export const metadata: Metadata = {
  title: "Crear cuenta — ez finance",
};

export default function RegisterPage() {
  return (
    <>
      <h2 className="text-foreground mb-6 text-center text-xl font-semibold">
        Crea tu cuenta
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

      <RegisterForm action={registerAction} />
    </>
  );
}
