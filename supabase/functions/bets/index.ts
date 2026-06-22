import { withSupabase } from "@supabase/server"

interface Bet {
  id?: number
  date: string
  is_hedge: boolean
  item: string
  platform: string
  principal: number
  payout: number
  status: "settled" | "pending"
}

// GET /bets — 列出該使用者的所有注單
// POST /bets — 新增注單（body JSON）
// PUT /bets — 更新注單（body JSON 需含 id）
// DELETE /bets — 刪除注單（?id=xxx）
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const url = new URL(req.url)
    const method = req.method

    if (method === "GET") {
      const { data, error } = await ctx.supabase
        .from("bets")
        .select("*")
        .order("id", { ascending: false })

      if (error) return Response.json({ error: error.message }, { status: 400 })
      return Response.json(data)
    }

    if (method === "POST") {
      const body: Bet = await req.json()
      const { data, error } = await ctx.supabase
        .from("bets")
        .insert({
          user_id: ctx.user.id,
          date: body.date,
          is_hedge: body.is_hedge,
          item: body.item,
          platform: body.platform,
          principal: body.principal,
          payout: body.status === "pending" ? 0 : body.payout,
          status: body.status || "settled",
        })
        .select()
        .single()

      if (error) return Response.json({ error: error.message }, { status: 400 })
      return Response.json(data, { status: 201 })
    }

    if (method === "PUT") {
      const body: Bet & { id: number } = await req.json()
      const { data, error } = await ctx.supabase
        .from("bets")
        .update({
          date: body.date,
          is_hedge: body.is_hedge,
          item: body.item,
          platform: body.platform,
          principal: body.principal,
          payout: body.status === "pending" ? 0 : body.payout,
          status: body.status || "settled",
        })
        .eq("id", body.id)
        .select()
        .single()

      if (error) return Response.json({ error: error.message }, { status: 400 })
      return Response.json(data)
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id")
      if (!id) return Response.json({ error: "Missing id" }, { status: 400 })

      const { error } = await ctx.supabase
        .from("bets")
        .delete()
        .eq("id", +id)

      if (error) return Response.json({ error: error.message }, { status: 400 })
      return new Response(null, { status: 204 })
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }),
}
