import type { Metadata } from "next";

import { requestRecoveryAction } from "@/app/(auth)/actions/request-recovery.action";
import { ForgotPasswordForm } from "@/modules/auth/ui/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña — ez finance",
};

export default function ForgotPasswordPage() {
  return (
    <>
      <h2 className="text-foreground mb-2 text-center text-xl font-semibold">
        Recuperá tu contraseña
      </h2>
      <p className="text-muted-foreground mb-6 text-center text-sm">
        Ingresá tu correo y te enviaremos las instrucciones.
      </p>
      <ForgotPasswordForm action={requestRecoveryAction} />
    </>
  );
}
