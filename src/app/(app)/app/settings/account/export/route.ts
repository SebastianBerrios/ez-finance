// GET /app/settings/account/export — streams the caller's data archive.
//
// Lives under /app so the middleware session guard applies, and re-checks the
// session here anyway: a route handler is a public endpoint.
import { NextResponse } from "next/server";

import { exportUserData } from "@/modules/auth/application/export-user-data";
import { ExportAdapter } from "@/modules/auth/infrastructure/export-adapter";
import { createServerClient } from "@/shared/infrastructure/supabase/server";

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const result = await exportUserData(
    { userId: user.id },
    { export: new ExportAdapter() },
  );

  if (!result.ok) {
    // Back to the account page with a flag; no provider detail is leaked.
    return NextResponse.redirect(
      new URL("/app/settings/account?export=error", request.url),
    );
  }

  const { filename, bytes, contentType } = result.value;

  // slice() re-anchors the view to a plain ArrayBuffer, which is what BodyInit
  // requires (the fflate output is typed over ArrayBufferLike). It is a single
  // memcpy — unlike `new Blob([Uint8Array.from(bytes)])`, which walked the
  // archive element by element and then copied it a second time into the Blob.
  const body: BodyInit = bytes instanceof Uint8Array ? bytes.slice() : bytes;

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Personal data: never cached by the browser or an intermediary.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
