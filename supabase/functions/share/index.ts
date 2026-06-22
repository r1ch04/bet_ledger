import { withSupabase } from "jsr:@supabase/server"

// 建立分享連結（需要使用者登入，由 publishable key 驗證）
// 驗證分享 token 並回傳注單資料（公開，不需登入）

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const url = new URL(req.url)
    const method = req.method

    // GET /share?token=xxx — 驗證 token 並回傳該使用者的注單
    if (method === "GET") {
      const token = url.searchParams.get("token")
      if (!token) return Response.json({ error: "Missing token" }, { status: 400 })

      // 查詢分享 token
      const { data: share, error: shareErr } = await ctx.supabase
        .from("shares")
        .select("user_id, expires_at")
        .eq("token", token)
        .maybeSingle()

      if (shareErr || !share) {
        return Response.json({ error: "Invalid share link" }, { status: 404 })
      }

      // 檢查是否過期
      if (share.expires_at && new Date(share.expires_at) < new Date()) {
        return Response.json({ error: "Share link expired" }, { status: 410 })
      }

      // 使用 admin client 讀取該使用者的注單（繞過 RLS）
      const { data: bets, error: betsErr } = await ctx.supabaseAdmin
        .from("bets")
        .select("*")
        .eq("user_id", share.user_id)
        .order("date", { ascending: true })

      if (betsErr) {
        return Response.json({ error: betsErr.message }, { status: 400 })
      }

      return Response.json({ bets })
    }

    // POST /share — 建立分享連結（需提供 user_id 與到期日）
    if (method === "POST") {
      const body = await req.json()
      const expiresAt = body.expires_at || null

      const { data, error } = await ctx.supabase
        .from("shares")
        .insert({
          expires_at: expiresAt,
        })
        .select("token")
        .single()

      if (error) return Response.json({ error: error.message }, { status: 400 })
      return Response.json(data, { status: 201 })
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }),
}
