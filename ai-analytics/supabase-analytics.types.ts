export type UUID = string;
export type IsoDate = string; // YYYY-MM-DD
export type VisitType = "vente" | "passage_sans_vente" | "client_ferme";
export type ReminderColor = "red" | "yellow" | "green" | "blue";

export interface ClientRow {
  id: UUID;
  nom: string;
  numero_compte: string;
  adresse: string | null;
  telephone: string | null;
  plaque_id: UUID;
}

export interface PlaqueRow {
  id: UUID;
  nom: string;
}

export interface ProduitRow {
  id: UUID;
  nom: string;
  reference_produit: string;
  prix_vente: number;
  actif: boolean;
}

export interface TarifPlaqueRow {
  plaque_id: UUID;
  produit_id: UUID;
  prix_vente: number;
}

export interface VisiteRow {
  id: UUID;
  client_id: UUID;
  date_visite: IsoDate;
  note: string | null;
  type_visite: VisitType;
  total_commande: number;
}

export interface VisiteCommandeRow {
  id: UUID;
  visite_id: UUID;
  produit_id: UUID;
  quantite: number;
  stock_client: number;
  couleur: ReminderColor | string;
  prix_unitaire: number;
}

export type AnalyticsIntent =
  | "top_products"
  | "top_clients"
  | "sales_evolution"
  | "inactive_clients"
  | "visit_history"
  | "client_summary"
  | "product_performance"
  | "sales_by_period"
  | "compare_periods";

export type VisualizationType = "table" | "bar" | "line" | "pie";

export interface AnalyticsFilters {
  period?: string;
  start_date?: IsoDate;
  end_date?: IsoDate;
  period_a?: string;
  period_b?: string;
  granularity?: "day" | "week" | "month";
  inactive_since?: string | number;
  client_id?: UUID | UUID[];
  client_name?: string;
  numero_compte?: string;
  plaque?: string | string[];
  entity?: string | string[];
  product_ref?: string;
  product_name?: string;
}

export interface ParsedAnalyticsQuery {
  intent: AnalyticsIntent;
  filters: AnalyticsFilters;
  limit: number;
  visualization: VisualizationType;
}

export interface AnalyticsApiResponse {
  ok: true;
  question: string;
  intent: AnalyticsIntent;
  visualization: VisualizationType;
  queryPlan: ParsedAnalyticsQuery;
  summary: string;
  finalResult: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  meta: {
    sourceTables: string[];
    limitApplied: number;
    rowCount: number;
    period: string | null;
    scope: "global_read_only";
  };
}

export interface AnalyticsApiErrorResponse {
  ok: false;
  message: string;
  error?: string;
}
