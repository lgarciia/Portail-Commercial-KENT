(function () {
  function normalizeError(payload, fallback) {
    const message = payload?.message || payload?.error || fallback || "Erreur serveur.";
    return {
      message,
      details: payload?.details || "",
      hint: payload?.hint || "",
      code: payload?.code || ""
    };
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function createFicheClientApiClient(options = {}) {
    const sector = options.secteur || options.sector || "auto";
    const baseUrl = `/api/fiche-client?secteur=${encodeURIComponent(sector)}`;

    async function post(payload) {
      try {
        const response = await fetch(baseUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) {
          return { data: null, error: normalizeError(json, "Action fiche client impossible.") };
        }
        return { data: Object.prototype.hasOwnProperty.call(json, "data") ? json.data : null, error: null };
      } catch (error) {
        return { data: null, error: normalizeError({ message: error?.message }, "Réseau indisponible.") };
      }
    }

    class QueryBuilder {
      constructor(table) {
        this.table = table;
        this.action = "select";
        this.selectColumns = "*";
        this.filters = [];
        this.orders = [];
        this.rangeSpec = null;
        this.payload = null;
        this.onConflict = "";
        this.returnSingle = false;
      }

      select(columns = "*") {
        this.selectColumns = columns || "*";
        return this;
      }

      insert(payload) {
        this.action = "insert";
        this.payload = payload;
        this.selectColumns = "";
        return this;
      }

      upsert(payload, options = {}) {
        this.action = "upsert";
        this.payload = payload;
        this.onConflict = options.onConflict || "";
        this.selectColumns = "";
        return this;
      }

      update(payload) {
        this.action = "update";
        this.payload = payload;
        this.selectColumns = "";
        return this;
      }

      delete() {
        this.action = "delete";
        this.selectColumns = "";
        return this;
      }

      eq(column, value) {
        this.filters.push({ op: "eq", column, value });
        return this;
      }

      in(column, value) {
        this.filters.push({ op: "in", column, value: Array.isArray(value) ? value : [] });
        return this;
      }

      order(column, options = {}) {
        this.orders.push({ column, ascending: options.ascending !== false });
        return this;
      }

      range(from, to) {
        this.rangeSpec = { from, to };
        return this;
      }

      limit(count) {
        const value = Number(count);
        if (Number.isInteger(value) && value > 0) {
          this.rangeSpec = { from: 0, to: value - 1 };
        }
        return this;
      }

      single() {
        this.returnSingle = true;
        return this;
      }

      maybeSingle() {
        this.returnSingle = true;
        return this;
      }

      async execute() {
        return post({
          table: this.table,
          action: this.action,
          select: this.selectColumns,
          filters: this.filters,
          orders: this.orders,
          range: this.rangeSpec,
          payload: this.payload,
          onConflict: this.onConflict,
          single: this.returnSingle
        });
      }

      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      }
    }

    return {
      from(table) {
        return new QueryBuilder(table);
      },
      storage: {
        from(bucket) {
          return {
            async upload(path, blob, options = {}) {
              try {
                const buffer = await blob.arrayBuffer();
                return post({
                  kind: "storage",
                  operation: "upload",
                  bucket,
                  path,
                  contentType: options.contentType || blob.type || "application/pdf",
                  upsert: Boolean(options.upsert),
                  base64: arrayBufferToBase64(buffer)
                });
              } catch (error) {
                return { data: null, error: normalizeError({ message: error?.message }, "Upload document impossible.") };
              }
            },
            async remove(paths) {
              return post({
                kind: "storage",
                operation: "remove",
                bucket,
                paths: Array.isArray(paths) ? paths : []
              });
            }
          };
        }
      }
    };
  }

  window.createFicheClientApiClient = createFicheClientApiClient;
})();
