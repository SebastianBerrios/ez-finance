import type { Metadata } from "next";

import { registerAction } from "@/app/(auth)/actions/register.action";
import { RegisterForm } from "@/modules/auth/ui/components/register-form";

export const metadata: Metadata = {
  title: "Crear cuenta — ez finance",
};

export default function RegisterPage() {
  return (
    <>
      <h2 className="text-foreground mb-6 text-center text-xl font-semibold">
        Creá tu cuenta
      </h2>
      <RegisterForm action={registerAction} />
    </>
  );
}
