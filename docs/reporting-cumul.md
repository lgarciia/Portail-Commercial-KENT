# Reporting cumul admin

## Scope

The Excel matrix is a calculation and layout reference, not a data import.
This first version implements Projection and Top 100 CA only. Gross/net
margin and margin rankings remain disabled until a reliable margin source
is agreed. No Excel values, names or internal workbook data are embedded
in the application.

The module is read-only. No SQL migration is required. Client records,
orders, imports, budgets and source settings are not modified.

## Data and access

- `GET /api/responsable-dashboard?mode=cumul&year=YYYY&month=M&day=YYYY-MM-DD`
  requires an admin session, including when called directly.
- The existing router remains the only public Vercel API function. The new
  mode reuses the existing sales, actual-import and budget aggregation paths.
- Activity counts, visits, demonstrations, documents and campaigns are not
  loaded by this mode. Existing dashboard modes keep their behavior.
- `GET /api/admin-finance-settings?year=YYYY` provides the monthly sources.
- Source `real` selects imported actuals; source `sales` selects field sales.
  An unset month uses `sales`, exactly as existing Finance. They are never
  added together for the same month. A missing settings table is disclosed.
- Only active, non-hidden commercial accounts are included, as in Finance.
  A seller contributes once, identified by UUID and attached to the current
  principal manager. Exceptional access does not duplicate contributions.
  Accounts without a principal manager remain visible in a separate group.

## Matrix mapping and calculations

The source `Ventes` sheet uses monthly actual / budget / achievement triplets
from G:AP, annual target F, remaining target E, actual cumulative AQ, budget
cumulative AR, achievement AS, annual projection AT and projection rate AU.
Its report date is H2 and elapsed-month count AT3. The app replaces those
fixed cells with the selected year and inclusive month-end cutoff.

The `Top 100 - CA` sheet ranks salespeople, not customers or products. Its
monthly triplets run F:AO and cumulative actual / budget / achievement AP:AR.
Name-based lookups and workbook control columns are not reproduced: lookups
use UUIDs and the ranking is recalculated from amounts.

For each seller and period from January through selected month M:

- Actual cumulative = sum of selected-source actuals for January through M.
- Budget cumulative = sum of active monthly budgets for January through M.
- Annual objective = sum of all 12 monthly budgets.
- Achievement = cumulative actual / cumulative budget.
- Gap = cumulative actual - cumulative budget.
- Gap rate = gap / cumulative budget.
- Annual projection = cumulative actual * 12 / M, as in the Excel prorata.
- Projection achievement = projection / annual objective.
- Remaining objective = annual objective - cumulative actual, signed.
- Contribution = seller actual / actual of the entire filtered scope.

All ratios use aggregated amounts, never an average of percentages. A zero
or negative denominator produces a missing rate, not a fabricated zero.
Forecasts do not add the remaining budget and do not adjust for seasonality.
By default the cutoff is the last completed calendar month (December of the
previous year in January). The current partial month can be selected but is
explicitly flagged; future months cannot be selected.

Amounts are summed as integer cents. Projection sub-cent remainders are
distributed deterministically within the filtered scope so displayed seller
amounts equal manager subtotals and the overall rounded projection. Input
array shape, amounts and duplicate seller IDs are validated before calculation.

The ranking is descending actual CA with shared ranks for exact ties; names
and UUIDs provide stable ordering. Zero/negative-CA sellers are retained.
The Top 100 display can be expanded to all sellers. KPI totals always cover
the full filter; the ranking footer explicitly totals the displayed rows.

## Reliability and performance

- Initial loading is lazy, on entering Reporting cumul only.
- Each entry/year change/refresh reads fresh aggregates and source settings.
- Month, manager, text filter and row expansion work locally, without new
  server calls. No persistent browser storage or cross-user cache is used.
- Old requests are aborted and stale responses cannot overwrite a new year.
- On a failed financial source, results are cleared rather than publishing
  partial totals as complete. Refresh allows recovery without page reload.
- Missing active imports are flagged. Absent amounts remain zero as in
  existing Finance, with a warning that projection is indicative. Import
  presence alone is not proof of coverage across all entities.
- Missing budgets are flagged. Source and methodology are available inline.

The Excel export contains Commerciaux, Responsables, Mensuel and Methode
(the visible sheet title uses the French accent). It includes every seller
in the current filter, even beyond the first 100 displayed rows, and records
the cutoff, source choices, calculation rules and data-quality notices.

## Verification

Run from the repository root:

```powershell
node tools/test-reporting-cumul.mjs
node tools/test-fiche-client.mjs
```

Set `PLAYWRIGHT_MODULE` to the bundled Playwright module when it is not
available through normal Node resolution. Optionally set `XLSX_TEST_BUNDLE`
to the same SheetJS 0.18.5 browser bundle already used by admin.html to test
an XLSX write/read byte round trip. `CUMUL_NO_BROWSER=1` runs calculations
and API checks alone.

All API tests intercept fetch, use synthetic signed sessions and reject
production network access. Reporting requests must be GET-only. Coverage
includes weighted totals, mixed sources, period boundaries, exact rounding,
manager grouping, duplicate names/IDs, negative amounts, role denial,
142-seller pagination, equality with Finance, filtering without network,
XSS escaping, partial-source failure/recovery, concurrent year changes,
desktop/mobile overflow and complete XLSX totals. The separate client-sheet
suite verifies order entry for automobile and industry using fake data only.

After deployment, compare one chosen month with Finance using the same
source settings; open a manager and a seller, and verify the same totals in
Excel. Real production data were not queried or modified by the tests.
