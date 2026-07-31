import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Revisa tu correo — ez finance",
};

// NON-ENUMERATING: same message whether or not the email was already registered.
export default function CheckEmailPage() {
  return (
    <div className="flex flex-col gap-5 text-center">
      <div className="bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl">
        ✉
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-xl font-semibold">
          Revisa tu correo
        </h2>
        <p className="text-muted-foreground text-sm">
          Si el correo es válido, te enviamos un enlace de confirmación. Revisa
          tu bandeja de entrada y también la carpeta de spam.
        </p>
      </div>

      <Link
        href="/login"
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition-colors hover:underline"
      >
        Volver al inicio de sesión
      </Link>
    </div>
  );
}
