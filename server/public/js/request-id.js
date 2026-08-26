(function () {
  function requestDomSlug(id) {
    return String(id).replace(/\//g, '--');
  }

  function requestIdFromDomSlug(slug) {
    return String(slug).replace(/--/g, '/');
  }

  window.rhRequestDomSlug = requestDomSlug;
  window.rhRequestIdFromDomSlug = requestIdFromDomSlug;
})();
