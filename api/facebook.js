export default async function handler(req, res) {
  const token = process.env.FACEBOOK_ACCESS_TOKEN;
  const adAccountId = process.env.FACEBOOK_AD_ACCOUNT_ID; // e.g. act_123456789012345

  if (!token || !adAccountId) {
    return res.status(500).json({ error: "Missing FACEBOOK_ACCESS_TOKEN or FACEBOOK_AD_ACCOUNT_ID environment variable" });
  }

  // Optional query params: ?since=2026-09-01&until=2026-09-15
  const { since, until } = req.query;

  const fields = "spend,impressions,clicks,actions,action_values,date_start,date_stop";
  const url = new URL(`https://graph.facebook.com/v21.0/${adAccountId}/insights`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", fields);
  url.searchParams.set("time_increment", "1"); // one row per day
  url.searchParams.set("level", "account");

  if (since && until) {
    url.searchParams.set("time_range", JSON.stringify({ since, until }));
  } else {
    url.searchParams.set("date_preset", "last_30d");
  }

  try {
    const r = await fetch(url.toString());
    const data = await r.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message || "Facebook API error" });
    }

    // Pull purchases / purchase value out of Facebook's "actions" array shape,
    // so the front-end gets plain numbers instead of having to parse nested arrays.
    const rowsOut = (data.data || []).map(row => {
      const findAction = (arr, type) => {
        if (!Array.isArray(arr)) return 0;
        const hit = arr.find(a => a.action_type === "purchase" || a.action_type === "omni_purchase");
        return hit ? Number(hit.value) : 0;
      };
      return {
        date: row.date_start,
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        purchases: findAction(row.actions, "purchase"),
        purchase_value: findAction(row.action_values, "purchase")
      };
    });

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate");
    return res.status(200).json({ rows: rowsOut });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
