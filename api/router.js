import actionPromoCampaignsHandler from "./_action-promo-campaigns.js";
import adminBudgetsHandler from "./_admin-budgets.js";
import adminFinanceSettingsHandler from "./_admin-finance-settings.js";
import adminReelImportsHandler from "./_admin-reel-imports.js";
import adminTarifsConditionnementsHandler from "./_admin-tarifs-conditionnements.js";
import adminUsersHandler from "./_admin-users.js";
import aiQueryHandler from "./_ai-query.js";
import documentsCommerciauxHandler from "./_documents-commerciaux.js";
import ficheClientHandler from "./_fiche-client.js";
import franceDepartmentsMapHandler from "./_france-departments-map.js";
import mesConditionnementsHandler from "./_mes-conditionnements.js";
import mesRappelsHandler from "./_mes-rappels.js";
import mesTarifsHandler from "./_mes-tarifs.js";
import mesVentesHandler from "./_mes-ventes.js";
import produitsPromoHandler from "./_produits-promo.js";
import rapportJournalierHandler from "./_rapport-journalier.js";
import requeteClientHandler from "./_requete-client.js";
import responsableDashboardHandler from "./_responsable-dashboard.js";
import sessionActivityHandler from "./_session-activity.js";
import sessionHandler from "./_session.js";
import teamCommerceQueryHandler from "./_team-commerce-query.js";

const API_ROUTES = new Map([
  ["action-promo-campaigns", actionPromoCampaignsHandler],
  ["admin-budgets", adminBudgetsHandler],
  ["admin-finance-settings", adminFinanceSettingsHandler],
  ["admin-reel-imports", adminReelImportsHandler],
  ["admin-tarifs-conditionnements", adminTarifsConditionnementsHandler],
  ["admin-users", adminUsersHandler],
  ["ai-query", aiQueryHandler],
  ["documents-commerciaux", documentsCommerciauxHandler],
  ["fiche-client", ficheClientHandler],
  ["france-departments-map", franceDepartmentsMapHandler],
  ["mes-conditionnements", mesConditionnementsHandler],
  ["mes-rappels", mesRappelsHandler],
  ["mes-tarifs", mesTarifsHandler],
  ["mes-ventes", mesVentesHandler],
  ["produits-promo", produitsPromoHandler],
  ["rapport-journalier", rapportJournalierHandler],
  ["requete-client", requeteClientHandler],
  ["responsable-dashboard", responsableDashboardHandler],
  ["session-activity", sessionActivityHandler],
  ["session", sessionHandler],
  ["team-commerce-query", teamCommerceQueryHandler]
]);

export default async function handler(request, response) {
  const routeName = getRouteName(request);
  const routeHandler = API_ROUTES.get(routeName);

  if (!routeHandler) {
    sendRouterJson(response, 404, {
      error: "Route API inconnue",
      route: routeName || null
    });
    return;
  }

  try {
    await routeHandler(request, response);
  } catch (error) {
    console.error(`Erreur route API ${routeName}:`, error);
    if (!response.headersSent) {
      sendRouterJson(response, 500, { error: "Erreur interne API" });
    } else {
      response.end();
    }
  }
}

function getRouteName(request) {
  const url = new URL(request.url, "http://localhost");
  const queryRoute = url.searchParams.get("__route") || url.searchParams.get("path");
  const route = queryRoute || url.pathname.replace(/^\/api\/?/, "");
  return String(route || "")
    .split("/")
    .filter(Boolean)[0]
    ?.trim() || "";
}

function sendRouterJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
