import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 비로그인 접근 허용 경로 */
const PUBLIC_PATHS = [/^\/login(\/|$)/, /^\/auth(\/|$)/, /^\/share\//, /^\/api\/share\//];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

/**
 * 세션 쿠키 갱신 + 낙관적 로그인 가드.
 * 역할(director/freelancer) 검증은 각 페이지/서버 액션에서 수행 — proxy는
 * "로그인 여부"만 본다 (Next 16 가이드: proxy를 인가 솔루션으로 쓰지 말 것).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser()는 토큰 검증 + 필요 시 갱신까지 수행한다
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
