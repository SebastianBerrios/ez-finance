import type { Metadata } from "next";

import { loginAction } from "@/app/(auth)/actions/login.action";
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
      <LoginForm action={loginAction} />
    </>
  );
}
