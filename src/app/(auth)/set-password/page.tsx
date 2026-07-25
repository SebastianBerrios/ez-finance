import type { Metadata } from "next";

import { resetPasswordAction } from "@/app/(auth)/actions/reset-password.action";
import { ResetPasswordForm } from "@/app/(auth)/components/reset-password-form";

export const metadata: Metadata = {
  title: "Nueva contraseña — ez finance",
};

// Password-reset completion page.
// The user arrives here after /auth/reset-password (route handler) has
// exchanged the recovery code for a session and redirected here.
//
// NOTE: Recovery email delivery is deferred until Resend SMTP is configured.
// The full code path is correct and ready.
export default function SetPasswordPage() {
  return (
    <>
      <h2 className="text-foreground mb-2 text-center text-xl font-semibold">
        Establecé tu nueva contraseña
      </h2>
      <p className="text-muted-foreground mb-6 text-center text-sm">
        Ingresá y confirmá tu nueva contraseña.
      </p>
      <ResetPasswordForm action={resetPasswordAction} />
    </>
  );
}
