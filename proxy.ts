import { NextResponse, type NextRequest } from "next/server";
import { checkRequestOrigin } from "@/lib/request-security";
export function proxy(request: NextRequest) {
  return checkRequestOrigin(request) ?? NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
