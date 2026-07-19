(function () {
  const scope = {
    user: null,
    loaded: false
  };

  async function load() {
    if (scope.loaded) return scope.user;
    scope.loaded = true;

    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) return null;
      const payload = await response.json();
      scope.user = payload?.user || null;
      return scope.user;
    } catch (error) {
      console.warn("Session commerciale indisponible:", error.message || error);
      scope.user = null;
      return null;
    }
  }

  function getUser() {
    return scope.user;
  }

  function isCommercialScoped() {
    return Boolean(scope.user?.dbUserId && scope.user?.role === "commercial");
  }

  function getCommercialUserId() {
    return isCommercialScoped() ? String(scope.user.dbUserId) : "";
  }

  function applyToQuery(query, column = "commercial_user_id") {
    const userId = getCommercialUserId();
    return userId ? query.eq(column, userId) : query;
  }

  function filterRows(rows, column = "commercial_user_id") {
    const userId = getCommercialUserId();
    if (!userId) return rows || [];
    return (rows || []).filter(row => String(row?.[column] || "") === userId);
  }

  window.KentCommercialScope = {
    load,
    getUser,
    isCommercialScoped,
    getCommercialUserId,
    applyToQuery,
    filterRows
  };
})();
