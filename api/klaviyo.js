export default async function handler(req, res) {
  const apiKey = process.env.KLAVIYO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Missing KLAVIYO_API_KEY environment variable" });
  }

  // "Placed Order" metric for this account — used so Klaviyo can attribute
  // revenue to each email campaign.
  const CONVERSION_METRIC_ID = "TigK5J";

  const headers = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: "2025-07-15",
    accept: "application/json",
    "content-type": "application/json"
  };

  // Optional query params: ?since=2026-09-01&until=2026-09-15
  const { since, until } = req.query;
  const timeframe = since && until
    ? { start: `${since}T00:00:00`, end: `${until}T23:59:59` }
    : { key: "last_30_days" };

  try {
    // Step 1: find which email campaigns were actually sent, and get their
    // names + send times (the values-report endpoint below only returns IDs).
    const listUrl = new URL("https://a.klaviyo.com/api/campaigns");
    listUrl.searchParams.set("filter", "equals(messages.channel,'email')");
    listUrl.searchParams.set("sort", "-scheduled_at");
    listUrl.searchParams.set("fields[campaign]", "name,status,send_time,scheduled_at");
    listUrl.searchParams.set("page[size]", "50");

    const listRes = await fetch(listUrl.toString(), { headers });
    const listData = await listRes.json();

    if (!listRes.ok || listData.errors) {
      const msg = listData.errors?.[0]?.detail || listRes.statusText;
      return res.status(502).json({ error: `Klaviyo campaigns error: ${msg}` });
    }

    // Only campaigns that actually sent, within the selected date range.
    const since_ts = since ? new Date(`${since}T00:00:00Z`).getTime() : -Infinity;
    const until_ts = until ? new Date(`${until}T23:59:59Z`).getTime() : Infinity;

    const campaigns = (listData.data || [])
      .filter(c => c.attributes.status === "Sent")
      .map(c => ({
        id: c.id,
        name: c.attributes.name,
        send_time: c.attributes.send_time || c.attributes.scheduled_at
      }))
      .filter(c => {
        if (!c.send_time) return false;
        const t = new Date(c.send_time).getTime();
        return t >= since_ts && t <= until_ts;
      });

    if (!campaigns.length) {
      res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate");
      return res.status(200).json({ rows: [] });
    }

    // Step 2: pull opens/clicks/revenue/etc for exactly those campaigns.
    const idList = campaigns.map(c => `"${c.id}"`).join(",");
    const filter = `and(equals(send_channel,'email'),contains-any(campaign_id,[${idList}]))`;

    const reportBody = {
      data: {
        type: "campaign-values-report",
        attributes: {
          timeframe,
          conversion_metric_id: CONVERSION_METRIC_ID,
          filter,
          statistics: [
            "recipients", "opens", "open_rate", "clicks", "click_rate",
            "unsubscribes", "unsubscribe_rate", "conversion_value"
          ],
          group_by: ["campaign_id", "campaign_message_id"]
        }
      }
    };

    const reportRes = await fetch("https://a.klaviyo.com/api/campaign-values-reports", {
      method: "POST",
      headers,
      body: JSON.stringify(reportBody)
    });
    const reportData = await reportRes.json();

    if (!reportRes.ok || reportData.errors) {
      const msg = reportData.errors?.[0]?.detail || reportRes.statusText;
      return res.status(502).json({ error: `Klaviyo report error: ${msg}` });
    }

    const byId = Object.fromEntries(campaigns.map(c => [c.id, c]));
    const rowsOut = (reportData.data?.attributes?.results || []).map(r => {
      const c = byId[r.groupings.campaign_id] || {};
      const s = r.statistics || {};
      return {
        campaign: c.name || r.groupings.campaign_id,
        date: c.send_time || null,
        sent: Number(s.recipients) || 0,
        opens: Number(s.opens) || 0,
        open_rate: s.open_rate ?? null,
        clicks: Number(s.clicks) || 0,
        click_rate: s.click_rate ?? null,
        unsubscribes: Number(s.unsubscribes) || 0,
        unsubscribe_rate: s.unsubscribe_rate ?? null,
        revenue: Number(s.conversion_value) || 0
      };
    });

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate");
    return res.status(200).json({ rows: rowsOut });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
