const FRANCE_DEPARTMENTS_GEOJSON_URL =
  "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/departements-1000m.geojson";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const response = await fetch(FRANCE_DEPARTMENTS_GEOJSON_URL, {
      headers: { accept: "application/geo+json, application/json, text/plain" }
    });

    if (!response.ok) {
      res.status(response.status).json({ error: "France departments map unavailable" });
      return;
    }

    const geojson = await response.text();
    res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(geojson);
  } catch (error) {
    res.status(502).json({
      error: "Unable to load France departments map",
      detail: error.message || "Unknown error"
    });
  }
}
