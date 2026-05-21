import type { AnalyticsIntent, ParsedAnalyticsQuery } from "./supabase-analytics.types";

export const MAX_ANALYTICS_LIMIT = 1000;
export const DEFAULT_ANALYTICS_LIMIT = 10;

export const INTENT_DESCRIPTIONS: Record<AnalyticsIntent, string> = {
  top_products: "Top produits (quantites + CA HT).",
  top_clients: "Top clients (visites + CA HT).",
  sales_evolution: "Evolution temporelle des ventes.",
  inactive_clients: "Clients sans vente recente.",
  visit_history: "Historique de visites detaille.",
  client_summary: "Synthese ciblee sur un client.",
  product_performance: "Performance produit ciblee ou globale.",
  sales_by_period: "Repartition des ventes sur une periode.",
  compare_periods: "Comparaison de 2 periodes."
};

export const READ_ONLY_TABLES = [
  "clients",
  "plaques",
  "produits",
  "tarifs_plaques",
  "visites",
  "visite_commandes"
] as const;

export type ReadOnlyTableName = (typeof READ_ONLY_TABLES)[number];

export interface IntentQueryPlan {
  intent: AnalyticsIntent;
  requiredTables: ReadOnlyTableName[];
  defaultLimit: number;
  supportsDateRange: boolean;
  supportsClientFilter: boolean;
  supportsPlaqueFilter: boolean;
}

export const INTENT_QUERY_PLANS: Record<AnalyticsIntent, IntentQueryPlan> = {
  top_products: {
    intent: "top_products",
    requiredTables: ["visites", "visite_commandes", "produits", "clients", "plaques"],
    defaultLimit: 10,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  top_clients: {
    intent: "top_clients",
    requiredTables: ["visites", "clients", "plaques"],
    defaultLimit: 10,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  sales_evolution: {
    intent: "sales_evolution",
    requiredTables: ["visites", "clients", "plaques"],
    defaultLimit: 30,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  inactive_clients: {
    intent: "inactive_clients",
    requiredTables: ["clients", "plaques", "visites"],
    defaultLimit: 50,
    supportsDateRange: false,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  visit_history: {
    intent: "visit_history",
    requiredTables: ["visites", "clients", "plaques"],
    defaultLimit: 50,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  client_summary: {
    intent: "client_summary",
    requiredTables: ["clients", "plaques", "visites", "visite_commandes", "produits"],
    defaultLimit: 8,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: false
  },
  product_performance: {
    intent: "product_performance",
    requiredTables: ["visites", "visite_commandes", "produits", "clients", "plaques"],
    defaultLimit: 20,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  sales_by_period: {
    intent: "sales_by_period",
    requiredTables: ["visites", "clients", "plaques"],
    defaultLimit: 20,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  },
  compare_periods: {
    intent: "compare_periods",
    requiredTables: ["visites", "clients", "plaques"],
    defaultLimit: 3,
    supportsDateRange: true,
    supportsClientFilter: true,
    supportsPlaqueFilter: true
  }
};

export function clampAnalyticsLimit(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYTICS_LIMIT;
  const safe = Math.floor(Number(value));
  if (safe <= 0) return DEFAULT_ANALYTICS_LIMIT;
  if (safe > MAX_ANALYTICS_LIMIT) return MAX_ANALYTICS_LIMIT;
  return safe;
}

export function normalizeParsedQuery(input: ParsedAnalyticsQuery): ParsedAnalyticsQuery {
  return {
    ...input,
    limit: clampAnalyticsLimit(input.limit)
  };
}
